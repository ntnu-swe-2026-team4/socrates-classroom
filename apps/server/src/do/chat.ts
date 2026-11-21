import type { EntryRecord, UserInput } from "@earendil-works/pi-durable";
import { DurableObject } from "cloudflare:workers";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type AssistantMessage,
  type Message,
  type TextContent,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { PiHarness, type PiReceipt, type PiSession, type PiSubmitOptions, ROOT_SESSION } from "agents/harness/pi";
import { Lifecycle, type LifecycleJob, type LifecycleJobContext } from "agents/lifecycle";
import { WebSockets } from "agents/websockets";
import type { Env } from "../env";
import { SESSION_COOKIE, PARTICIPANT_COOKIE, accountState, lookupParticipant, lookupSession } from "../auth";
import { activityAccess, participantOf } from "../services/members";
import { createAvatarExtension } from "../pi/extensions/avatar";
import { createJudgmentExtension } from "../pi/extensions/judgment";
import { createWebSearchExtension } from "../pi/extensions/websearch";
import { fauxReplayExtension } from "../pi/extensions/faux-replay";
import { SOCRATES_PROMPTS, socratesExtension } from "../pi/extensions/socrates";
import { btwExtension, forkBtw } from "../pi/extensions/btw";
import { createUsageExtension } from "../pi/extensions/usage";
import { NoAvailableModelError, PROFILES } from "../pi/agents/profiles";
import { buildModels } from "../pi/models";
import { teacherLegsOf, teacherOfActivity, type TeacherLeg } from "../pi/credentials";
import { one } from "../db/d1";
import { getRouter } from "../gateway/router";
import { ApiError, type Lang } from "@socrates/shared";
import { normalizeLang } from "../http";
import { ChatSockets, type ReverifyOutcome, type SocketIdentity } from "../ws/sockets";

const STUDENT_LANG_KEY = "studentLang";

class ActivityFinishedError extends Error {
  constructor() {
    super("activity_finished");
    this.name = "ActivityFinished";
  }
}

const RUN_DEADLINE_JOB = "dialogue-run-deadline";
const RUN_TIMEOUT_MS = 120_000;
const FAILURE_REPLAY_MS = 120_000;

type DialogueRun = { session: string; operationId: string };
type RunFailure = { jobId: string; expiresAt: number };

function failureKey(session: string): string {
  return `dialogue-run-failure:${session}`;
}

export class Chat extends DurableObject<Env> {
  readonly registry = createRegistry();
  readonly models = buildModels(this.env, { teacherOf: () => this.teacherId() });
  #teacherId: string | null | undefined;
  readonly #sessionModels = new Map<string, { provider: string; id: string }>();
  readonly #runChecks = new Map<string, Promise<void>>();

  readonly btw = btwExtension();

  readonly harness = new PiHarness({
    harness: ({ storage, context, onWake }) => {
      this.registry.install(socratesExtension(() => this.studentLang()));
      this.registry.install(createAvatarExtension(this.env.AI));
      this.registry.install(
        createJudgmentExtension(this.env.AI, async (violation) => {
          console.warn("[judgment:sink]", violation.type, violation.source);
        }),
      );
      this.registry.install(createWebSearchExtension(this.env.AI));
      this.registry.install(createUsageExtension(this.env, () => this.teacherId()));
      this.registry.install(this.btw);
      const registry = this.registry;
      const btw = this.btw.name;
      return Harness.open(
        storage,
        {
          models: this.models.models,
          registry: this.registry,
          onWake,
          settings: {
            get extensions() {
              return registry
                .snapshot()
                .installed()
                .filter((extension) => extension.name !== btw);
            },
            retry: { enabled: true, maxRetries: 5, baseDelayMs: 1000 },
            afterFailedRun: "continue",
          },
          onReport: (report) =>
            console.warn("[pi]", report.kind, report.error instanceof Error ? report.error.name : typeof report.error),
        },
        context,
      );
    },
    defaults: { model: this.models.default, thinkingLevel: PROFILES.socrates.thinkingLevel },
  });

  readonly sockets = new ChatSockets(
    this.harness,
    this.registry,
    async (request) => {
      const identity = await this.authorize(request);
      if (identity) await this.rememberStudentLang(request, identity);
      return identity;
    },
    (handle, input, options) => this.routeSubmit(handle, input, options),
    (identity) => this.canSubmit(identity),
    () => forkBtw(this.harness, this.btw),
    (identity) => this.revalidate(identity),
    (session) => this.recentRunFailure(session),
  );
  readonly webSockets = new WebSockets(this.sockets.options());
  readonly lifecycle = Lifecycle.install(this).use(this.webSockets).use(this.harness);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (this.models.faux) {
      this.models.faux.setResponses([fauxSocraticScript]);
      this.registry.install(fauxReplayExtension(this.models.faux, fauxSocraticScript));
    }
  }

  async onStart(): Promise<void> {
    await this.sockets.reattach(this.webSockets.getConnections(), (identity) => this.reverify(identity));
    for (const job of this.lifecycle.jobs.list()) {
      if (job.fn === RUN_DEADLINE_JOB) this.ctx.waitUntil(this.checkRun(job));
    }
  }

  async onJob({ job }: LifecycleJobContext): Promise<void> {
    if (job.fn === RUN_DEADLINE_JOB) await this.checkRun(job);
  }

  private runDeadlineJobs(session: string): LifecycleJob[] {
    return this.lifecycle.jobs
      .list()
      .filter((job) => job.fn === RUN_DEADLINE_JOB && (job.payload as DialogueRun).session === session);
  }

  private recentRunFailure(session: string): string | undefined {
    const key = failureKey(session);
    const failure = this.ctx.storage.kv.get<RunFailure>(key);
    if (!failure) return undefined;
    if (failure.expiresAt <= Date.now()) {
      this.ctx.storage.kv.delete(key);
      return undefined;
    }
    if (this.runDeadlineJobs(session).some((job) => job.id !== failure.jobId)) return undefined;
    return failure.jobId;
  }

  private checkRun(job: LifecycleJob): Promise<void> {
    const current = this.#runChecks.get(job.id);
    if (current !== undefined) return current;
    const check = this.settleRun(job).finally(() => this.#runChecks.delete(job.id));
    this.#runChecks.set(job.id, check);
    return check;
  }

  private async settleRun(job: LifecycleJob): Promise<void> {
    const { session, operationId } = job.payload as DialogueRun;
    const handle = this.harness.session(session);
    const wait = new AbortController();
    const timer = setTimeout(() => wait.abort(), Math.max(1_000, job.time - Date.now()));
    const result = await handle
      .wait(operationId, wait.signal)
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
    if (!this.lifecycle.jobs.get(job.id)) return;
    if (result?.status !== "done" && result?.reason !== "aborted") {
      this.ctx.storage.kv.put(failureKey(session), {
        jobId: job.id,
        expiresAt: Date.now() + FAILURE_REPLAY_MS,
      } satisfies RunFailure);
      this.sockets.notifyRunFailure(session, job.id);
    } else {
      this.ctx.storage.kv.delete(failureKey(session));
    }
    await this.lifecycle.jobs.cancel(job.id);
  }

  private async submitWithDeadline(handle: PiSession, input: UserInput, options: PiSubmitOptions): Promise<PiReceipt> {
    const operationId = options.operationId ?? crypto.randomUUID();
    const olderJobs = this.runDeadlineJobs(handle.id);
    const job = await this.lifecycle.jobs.push({
      fn: RUN_DEADLINE_JOB,
      time: Date.now() + RUN_TIMEOUT_MS,
      payload: { session: handle.id, operationId } satisfies DialogueRun,
    });
    let receipt: PiReceipt;
    try {
      receipt = await handle.submit(input, { ...options, operationId });
    } catch (error) {
      await this.lifecycle.jobs.cancel(job.id);
      throw error;
    }
    if (!receipt.accepted) {
      await this.lifecycle.jobs.cancel(job.id);
      return receipt;
    }
    this.ctx.storage.kv.delete(failureKey(handle.id));
    await Promise.all(olderJobs.map((older) => this.lifecycle.jobs.cancel(older.id)));
    this.ctx.waitUntil(this.checkRun(job));
    return receipt;
  }

  private async teacherId(): Promise<string | null> {
    if (this.#teacherId === undefined) {
      const activityId = this.ctx.id.name?.split(":")[0] ?? "";
      this.#teacherId = activityId ? await teacherOfActivity(this.env, activityId) : null;
    }
    return this.#teacherId;
  }

  private async studentLang(): Promise<Lang> {
    return (await this.ctx.storage.get<Lang>(STUDENT_LANG_KEY)) ?? "zh";
  }

  private async rememberStudentLang(request: Request, identity: SocketIdentity): Promise<void> {
    const lang = new URL(request.url).searchParams.get("lang");
    if (!lang || !/^(zh|en|es)\b/i.test(lang) || !(await this.canSubmit(identity))) return;
    await this.ctx.storage.put(STUDENT_LANG_KEY, normalizeLang(lang));
  }

  private async teacherLegs(): Promise<TeacherLeg[]> {
    return teacherLegsOf(this.env, await this.teacherId());
  }

  private async routeSubmit(handle: PiSession, input: UserInput, options: PiSubmitOptions): Promise<PiReceipt> {
    const activityId = this.ctx.id.name?.split(":")[0] ?? "";
    const activity = await one<{ finished_at: string | null }>(
      this.env.DB,
      "SELECT finished_at FROM activities WHERE id = $id",
      { id: activityId },
    );
    if (activity?.finished_at) throw new ActivityFinishedError();
    const router = getRouter(this.env);
    const canServe = (entry: { provider: string; model: string }): boolean =>
      this.models.models.getModel(entry.provider, entry.model) !== undefined;
    const decision = router.pick("interactive", canServe, await this.teacherLegs());
    if (!decision && !this.models.faux) throw new NoAvailableModelError();
    if (!decision) return this.submitWithDeadline(handle, input, options);
    const model = this.models.models.getModel(decision.entry.provider, decision.model);
    const receipt = await router.withRoute(decision, async () => {
      const current = this.#sessionModels.get(handle.id);
      if (model && (current?.provider !== model.provider || current?.id !== model.id)) {
        await handle.setModel({ provider: model.provider, id: model.id });
        this.#sessionModels.set(handle.id, { provider: model.provider, id: model.id });
      }
      return this.submitWithDeadline(handle, input, options);
    });
    void handle
      .wait(receipt.operationId)
      .then((result) => {
        const ok = result.status === "done" || (result.status === "unanswered" && result.reason === "aborted");
        router.settle(decision, ok ? "ok" : "error");
      })
      .catch(() => {
        if (router.ledger.inFlight(decision.key) > 0) router.settle(decision, "error");
      });
    return receipt;
  }

  async transcript(): Promise<TranscriptReadout> {
    return readTranscript(await this.harness.session(ROOT_SESSION).messages());
  }

  private async canSubmit(identity: SocketIdentity): Promise<boolean> {
    const [activityId, participantId] = this.ctx.id.name?.split(":") ?? [];
    if (!activityId || !participantId || identity.participantId !== participantId) return false;
    const participant = await participantOf(this.env.DB, activityId, participantId);
    if (!participant) return false;
    return participant.user_id === identity.userId;
  }

  private async authorize(request: Request): Promise<SocketIdentity | null> {
    const name = decodeURIComponent(new URL(request.url).pathname.split("/chat/").at(-1) ?? "");
    const [activityId, participantId] = name.split(":");
    if (!activityId || !participantId) return null;
    const cookie = request.headers.get("Cookie") ?? "";
    const lookup = await lookupSession(this.env, cookieValue(cookie, SESSION_COOKIE));
    if (lookup.kind === "ok") {
      const identity: SocketIdentity = {
        userId: lookup.session.user.id,
        participantId,
        version: lookup.session.version,
      };
      const access = await activityAccess(this.env.DB, activityId, {
        user: lookup.session.user,
        participant: null,
      }).catch(() => null);
      if (access && (access.isTeacher || access.participant?.id === participantId)) return identity;
      const ownedHere = await participantOf(this.env.DB, activityId, participantId);
      return ownedHere?.user_id === lookup.session.user.id ? identity : null;
    }
    if (lookup.kind !== "missing") return null;
    const held = await lookupParticipant(this.env, cookieValue(cookie, PARTICIPANT_COOKIE));
    if (!held || held.activityId !== activityId || held.participantId !== participantId) return null;
    const participant = await participantOf(this.env.DB, activityId, participantId);
    if (!participant || participant.user_id !== null) return null;
    return { userId: null, participantId, version: null };
  }

  private async reverify(identity: SocketIdentity): Promise<ReverifyOutcome> {
    const [activityId, participantId] = this.ctx.id.name?.split(":") ?? [];
    if (!activityId || !participantId || identity.participantId !== participantId) return "revoked";
    try {
      if (identity.userId === null) {
        const participant = await participantOf(this.env.DB, activityId, participantId);
        return participant && participant.user_id === null ? "member" : "revoked";
      }
      const state = await accountState(this.env.DB, identity.userId);
      if (!state || state.disabled || state.version !== identity.version) return "revoked";
      const participant = await participantOf(this.env.DB, activityId, participantId);
      if (participant?.user_id === identity.userId) return "member";
      const access = await activityAccess(this.env.DB, activityId, {
        user: { id: identity.userId },
        participant: null,
      });
      return access.isTeacher ? "member" : "revoked";
    } catch (error) {
      return error instanceof ApiError ? "revoked" : "error";
    }
  }

  private async revalidate(identity: SocketIdentity): Promise<ReverifyOutcome> {
    try {
      if (identity.userId === null) {
        const [activityId, participantId] = this.ctx.id.name?.split(":") ?? [];
        if (!activityId || !participantId || identity.participantId !== participantId) return "revoked";
        const participant = await participantOf(this.env.DB, activityId, participantId);
        return participant && participant.user_id === null ? "member" : "revoked";
      }
      const state = await accountState(this.env.DB, identity.userId);
      if (!state || state.disabled || state.version !== identity.version) return "revoked";
      return "member";
    } catch {
      return "error";
    }
  }
}

function cookieValue(header: string, name: string): string | undefined {
  return header
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`))
    ?.slice(name.length + 1);
}

function fauxSocraticScript(context: TranscriptContext): AssistantMessage {
  const last = context.messages.filter((message) => message.role !== "system").at(-1);
  const said = last?.role === "user" ? textOf(last.content) : "";
  if (/python|排序|數學|程式/.test(said)) {
    return fauxAssistantMessage([fauxToolCall("report_violation", { type: "coding", excerpt: said })], {
      stopReason: "toolUse",
    });
  }
  const preamble = context.messages
    .filter((message) => message.role === "system")
    .map((message) => (message as { sections?: Record<string, string> }).sections?.preamble);
  if (preamble.includes(SOCRATES_PROMPTS.en)) {
    return fauxAssistantMessage([fauxText(`You said "${said}". What is your first judgment, and why?`)]);
  }
  return fauxAssistantMessage([fauxText(`你提到「${said}」。先別急著找標準答案——你的直覺判斷是什麼？為什麼？`)]);
}

function textOf(content: Message["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function entryText(entry: { model?: readonly Message[] }): string {
  return textOf(entry.model?.[0]?.content ?? "");
}

export interface TranscriptReadout {
  messages: Array<{ role: "user" | "assistant"; turn: number; text: string }>;
  violations: Array<{ turn: number; type: string; excerpt: string }>;
}

export function readTranscript(items: readonly EntryRecord[]): TranscriptReadout {
  const messages: Array<{ role: "user" | "assistant"; turn: number; text: string }> = [];
  const violations: Array<{ turn: number; type: string; excerpt: string }> = [];
  let turn = 0;
  for (const entry of items) {
    if (entry.kind === "pi.user") {
      turn += 1;
      messages.push({ role: "user", turn, text: entryText(entry) });
    } else if (entry.kind === "pi.assistant") {
      messages.push({ role: "assistant", turn, text: entryText(entry) });
    } else if (entry.kind === "app.violation") {
      const data = entry.data as { type?: string; excerpt?: string };
      violations.push({ turn, type: data.type ?? "other", excerpt: data.excerpt ?? "" });
    }
  }
  return { messages, violations };
}

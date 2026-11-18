import type { UserInput } from "@earendil-works/pi-durable";
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
import { Lifecycle } from "agents/lifecycle";
import { WebSockets } from "agents/websockets";
import type { Env } from "../env";
import { SESSION_COOKIE, PARTICIPANT_COOKIE, accountState, lookupParticipant, lookupSession } from "../auth";
import { activityAccess, participantOf } from "../services/members";
import { createAvatarExtension } from "../pi/extensions/avatar";
import { createJudgmentExtension } from "../pi/extensions/judgment";
import { createWebSearchExtension } from "../pi/extensions/websearch";
import { fauxReplayExtension } from "../pi/extensions/faux-replay";
import { socratesExtension } from "../pi/extensions/socrates";
import { btwExtension, forkBtw } from "../pi/extensions/btw";
import { NoAvailableModelError, PROFILES } from "../pi/agents/profiles";
import { buildModels } from "../pi/models";
import { teacherLegsOf, teacherOfActivity, type TeacherLeg } from "../pi/credentials";
import { one, run } from "../db/d1";
import { getRouter, isTeacherCredential } from "../gateway/router";
import { SOLO_PREFIX, ownedSoloChat } from "../routes/solo";
import { recordUsage } from "../routes/usage";
import { ApiError } from "@socrates/shared";
import { ChatSockets, type ReverifyOutcome, type SocketIdentity } from "../ws/sockets";

const LAST_ACTIVE_KEY = "lastActiveAt";

class ActivityFinishedError extends Error {
  constructor() {
    super("activity_finished");
    this.name = "ActivityFinished";
  }
}

export class Chat extends DurableObject<Env> {
  readonly registry = createRegistry();
  readonly models = buildModels(this.env, { teacherOf: () => this.teacherId() });
  #teacherId: string | null | undefined;
  readonly #sessionModels = new Map<string, { provider: string; id: string }>();
  readonly #meteredUpTo = new Map<string, number>();

  readonly btw = btwExtension();

  readonly harness = new PiHarness({
    harness: ({ storage, context, onWake }) => {
      this.registry.install(socratesExtension());
      this.registry.install(createAvatarExtension(this.env.AI));
      this.registry.install(
        createJudgmentExtension(this.env.AI, async (violation) => {
          console.warn("[judgment:sink]", violation.type, violation.source);
        }),
      );
      this.registry.install(createWebSearchExtension(this.env.AI));
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
    (tag) => this.ctx.getWebSockets(tag),
    (request) => this.authorize(request),
    (handle, input, options) => this.routeSubmit(handle, input, options),
    (identity) => this.canSubmit(identity),
    () => forkBtw(this.harness, this.btw),
    (identity) => this.reverify(identity),
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
  }

  private async teacherId(): Promise<string | null> {
    if (this.#teacherId === undefined) {
      const [threadId = "", ownerId = ""] = this.ctx.id.name?.split(":") ?? [];
      if (threadId.startsWith(SOLO_PREFIX)) {
        this.#teacherId = (await ownedSoloChat(this.env.DB, threadId, ownerId)) ? ownerId : null;
      } else {
        this.#teacherId = threadId ? await teacherOfActivity(this.env, threadId) : null;
      }
    }
    return this.#teacherId;
  }

  private async teacherLegs(): Promise<TeacherLeg[]> {
    return teacherLegsOf(this.env, await this.teacherId());
  }

  private async routeSubmit(handle: PiSession, input: UserInput, options: PiSubmitOptions): Promise<PiReceipt> {
    const threadId = this.ctx.id.name?.split(":")[0] ?? "";
    if (threadId.startsWith(SOLO_PREFIX)) {
      await run(this.env.DB, "UPDATE solo_chats SET updated_at = $at WHERE id = $id", {
        id: threadId,
        at: new Date().toISOString(),
      });
    } else {
      const activity = await one<{ finished_at: string | null }>(
        this.env.DB,
        "SELECT finished_at FROM activities WHERE id = $id",
        { id: threadId },
      );
      if (activity?.finished_at) throw new ActivityFinishedError();
      await this.ctx.storage.put(LAST_ACTIVE_KEY, new Date().toISOString());
    }
    const router = getRouter(this.env);
    const canServe = (entry: { provider: string; model: string }): boolean =>
      this.models.models.getModel(entry.provider, entry.model) !== undefined;
    const decision = router.pick("interactive", canServe, await this.teacherLegs());
    if (!decision && !this.models.faux) throw new NoAvailableModelError();
    if (!decision) return handle.submit(input, options);
    const model = this.models.models.getModel(decision.entry.provider, decision.model);
    const receipt = await router.withRoute(decision, async () => {
      const current = this.#sessionModels.get(handle.id);
      if (model && (current?.provider !== model.provider || current?.id !== model.id)) {
        await handle.setModel({ provider: model.provider, id: model.id });
        this.#sessionModels.set(handle.id, { provider: model.provider, id: model.id });
      }
      return handle.submit(input, options);
    });
    void handle
      .wait(receipt.operationId)
      .then((result) => {
        const ok = result.status === "done" || (result.status === "unanswered" && result.reason === "aborted");
        router.settle(decision, ok ? "ok" : "error");
        if (!ok) this.sockets.notifyRunFailure(handle.id);
        if (ok && isTeacherCredential(decision.entry.credential)) {
          this.ctx.waitUntil(this.meterTurn(handle));
        }
      })
      .catch(() => {
        if (router.ledger.inFlight(decision.key) > 0) router.settle(decision, "error");
        this.sockets.notifyRunFailure(handle.id);
      });
    return receipt;
  }

  private async meterTurn(handle: PiSession): Promise<void> {
    try {
      const ownerId = await this.teacherId();
      if (!ownerId) return;
      const items = await handle.messages();
      const meteredUpTo = this.#meteredUpTo.get(handle.id) ?? 0;
      let tokens = 0;
      for (let index = items.length - 1; index >= 0; index -= 1) {
        const entry = items[index] as { id?: number; kind: string; model?: readonly Message[] };
        if (entry.id !== undefined && entry.id <= meteredUpTo) break;
        if (entry.kind === "pi.user") break;
        if (entry.kind !== "pi.assistant") continue;
        const message = entry.model?.[0];
        if (message?.role === "assistant") tokens += message.usage?.totalTokens ?? 0;
      }
      const newest = (items.at(-1) as { id?: number } | undefined)?.id ?? meteredUpTo;
      this.#meteredUpTo.set(handle.id, Math.max(meteredUpTo, newest));
      if (tokens > 0) await recordUsage(this.env, ownerId, tokens);
    } catch (error) {
      console.warn("[usage] metering failed", error instanceof Error ? error.message : "unknown error");
    }
  }

  async live(): Promise<{
    rounds: number;
    lastUtterance: string;
    lastActiveAt: string | null;
    flags: Array<{ turn: number; type: string; excerpt: string }>;
  }> {
    const { messages, violations } = await this.transcript();
    const said = messages.filter((message) => message.role === "user");
    return {
      rounds: said.length,
      lastUtterance: said.at(-1)?.text ?? "",
      lastActiveAt: (await this.ctx.storage.get<string>(LAST_ACTIVE_KEY)) ?? null,
      flags: violations,
    };
  }

  async transcript(): Promise<{
    messages: Array<{ role: "user" | "assistant"; turn: number; text: string }>;
    violations: Array<{ turn: number; type: string; excerpt: string }>;
  }> {
    const items = await this.harness.session(ROOT_SESSION).messages();
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
    const seen = new Set<string>();
    const deduped = violations.filter((violation) => {
      const key = `${violation.turn}:${violation.type}:${violation.excerpt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { messages, violations: deduped };
  }

  private async canSubmit(identity: SocketIdentity): Promise<boolean> {
    const [activityId, participantId] = this.ctx.id.name?.split(":") ?? [];
    if (!activityId || !participantId || identity.participantId !== participantId) return false;
    if (activityId.startsWith(SOLO_PREFIX)) {
      return identity.userId !== null && identity.userId === participantId;
    }
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
    if (activityId.startsWith(SOLO_PREFIX)) {
      if (lookup.kind !== "ok") return null;
      const owner = lookup.session.user.id;
      if (owner !== participantId || !(await ownedSoloChat(this.env.DB, activityId, owner))) return null;
      return { userId: owner, participantId, version: lookup.session.version };
    }
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
    if (activityId.startsWith(SOLO_PREFIX)) {
      try {
        const state = identity.userId === null ? null : await accountState(this.env.DB, identity.userId);
        if (!state || state.disabled || state.version !== identity.version) return "revoked";
        return (await ownedSoloChat(this.env.DB, activityId, identity.userId!)) ? "member" : "revoked";
      } catch {
        return "error";
      }
    }
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

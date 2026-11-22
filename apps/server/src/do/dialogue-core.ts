import { createRegistry, Harness, type EntryRecord, type Registry, type UserInput } from "@earendil-works/pi-durable";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type AssistantMessage,
  type Message,
  type TextContent,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { PiHarness, type PiReceipt, type PiSession, type PiSubmitOptions } from "agents/harness/pi";
import type { Lifecycle, LifecycleJob } from "agents/lifecycle";
import type { Env } from "../env";
import { createAvatarExtension } from "../pi/extensions/avatar";
import { createJudgmentExtension } from "../pi/extensions/judgment";
import { createWebSearchExtension } from "../pi/extensions/websearch";
import { fauxReplayExtension } from "../pi/extensions/faux-replay";
import { SOCRATES_PROMPTS, socratesExtension } from "../pi/extensions/socrates";
import { btwExtension } from "../pi/extensions/btw";
import type { Extension } from "@earendil-works/pi-durable";

export type BtwExtension = Extension;
import { createUsageExtension } from "../pi/extensions/usage";
import { NoAvailableModelError, PROFILES } from "../pi/agents/profiles";
import { buildModels, type ModelsBundle } from "../pi/models";
import { getRouter } from "../gateway/router";
import { teacherLegsOf } from "../pi/credentials";
import type { Lang } from "@socrates/shared";

export const STUDENT_LANG_KEY = "studentLang";
export const RUN_DEADLINE_JOB = "dialogue-run-deadline";
export const RUN_TIMEOUT_MS = 120_000;
export const FAILURE_REPLAY_MS = 120_000;

export interface DialogueRun {
  session: string;
  operationId: string;
}

export interface RunFailure {
  jobId: string;
  expiresAt: number;
}

export function failureKey(session: string): string {
  return `dialogue-run-failure:${session}`;
}

export interface DialogueHarnessConfig {
  credentialOwner: () => Promise<string | null>;
  getLang?: () => Promise<Lang>;
}

export interface DialogueCore {
  registry: Registry;
  models: ModelsBundle;
  btw: BtwExtension;
  harness: PiHarness;
  credentialOwner: DialogueHarnessConfig["credentialOwner"];
}

export function createDialogueCore(env: Env, config: DialogueHarnessConfig): DialogueCore {
  const { credentialOwner } = config;
  const registry = createRegistry();
  const models = buildModels(env, { teacherOf: credentialOwner });
  const btw = btwExtension();

  const harness = new PiHarness({
    harness: ({ storage, context, onWake }) => {
      registry.install(socratesExtension(config.getLang));
      registry.install(createAvatarExtension(env.AI));
      registry.install(
        createJudgmentExtension(env.AI, async (violation) => {
          console.warn("[judgment:sink]", violation.type, violation.source);
        }),
      );
      registry.install(createWebSearchExtension(env.AI));
      registry.install(createUsageExtension(env, credentialOwner));
      registry.install(btw);

      const btwName = btw.name;
      return Harness.open(
        storage,
        {
          models: models.models,
          registry,
          onWake,
          settings: {
            get extensions() {
              return registry
                .snapshot()
                .installed()
                .filter((extension) => extension.name !== btwName);
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
    defaults: { model: models.default, thinkingLevel: PROFILES.socrates.thinkingLevel },
  });

  if (models.faux) {
    models.faux.setResponses([fauxSocraticScript]);
    registry.install(fauxReplayExtension(models.faux, fauxSocraticScript));
  }

  return { registry, models, btw, harness, credentialOwner };
}

export class RunDeadlineTracker {
  readonly #getLifecycle: () => Lifecycle;
  readonly #storage: DurableObjectStorage;
  readonly #harness: PiHarness;
  readonly #notifyRunFailure: (session: string, jobId: string) => void;
  readonly #runChecks = new Map<string, Promise<void>>();

  constructor(
    getLifecycle: () => Lifecycle,
    storage: DurableObjectStorage,
    harness: PiHarness,
    notifyRunFailure: (session: string, jobId: string) => void,
  ) {
    this.#getLifecycle = getLifecycle;
    this.#storage = storage;
    this.#harness = harness;
    this.#notifyRunFailure = notifyRunFailure;
  }

  get lifecycle(): Lifecycle {
    return this.#getLifecycle();
  }

  runDeadlineJobs(session: string): LifecycleJob[] {
    return this.lifecycle.jobs
      .list()
      .filter((job) => job.fn === RUN_DEADLINE_JOB && (job.payload as DialogueRun).session === session);
  }

  recentRunFailure(session: string): string | undefined {
    const key = failureKey(session);
    const failure = this.#storage.kv.get<RunFailure>(key);
    if (!failure) return undefined;
    if (failure.expiresAt <= Date.now()) {
      this.#storage.kv.delete(key);
      return undefined;
    }
    if (this.runDeadlineJobs(session).some((job) => job.id !== failure.jobId)) return undefined;
    return failure.jobId;
  }

  checkRun(job: LifecycleJob): Promise<void> {
    const current = this.#runChecks.get(job.id);
    if (current !== undefined) return current;
    const check = this.settleRun(job).finally(() => this.#runChecks.delete(job.id));
    this.#runChecks.set(job.id, check);
    return check;
  }

  private async settleRun(job: LifecycleJob): Promise<void> {
    const { session, operationId } = job.payload as DialogueRun;
    const handle = this.#harness.session(session);
    const wait = new AbortController();
    const timer = setTimeout(() => wait.abort(), Math.max(1_000, job.time - Date.now()));
    const result = await handle
      .wait(operationId, wait.signal)
      .catch(() => undefined)
      .finally(() => clearTimeout(timer));
    if (!this.lifecycle.jobs.get(job.id)) return;
    if (result?.status !== "done" && result?.reason !== "aborted") {
      this.#storage.kv.put(failureKey(session), {
        jobId: job.id,
        expiresAt: Date.now() + FAILURE_REPLAY_MS,
      } satisfies RunFailure);
      this.#notifyRunFailure(session, job.id);
    } else {
      this.#storage.kv.delete(failureKey(session));
    }
    await this.lifecycle.jobs.cancel(job.id);
  }

  async submitWithDeadline(
    handle: PiSession,
    input: UserInput,
    options: PiSubmitOptions,
    waitUntil: (promise: Promise<unknown>) => void,
  ): Promise<PiReceipt> {
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
    this.#storage.kv.delete(failureKey(handle.id));
    await Promise.all(olderJobs.map((older) => this.lifecycle.jobs.cancel(older.id)));
    waitUntil(this.checkRun(job));
    return receipt;
  }
}

export async function submitViaRouter(
  env: Env,
  { models, credentialOwner }: DialogueCore,
  sessionModels: Map<string, { provider: string; id: string }>,
  handle: PiSession,
  input: UserInput,
  options: PiSubmitOptions,
  doSubmit: (handle: PiSession, input: UserInput, options: PiSubmitOptions) => Promise<PiReceipt>,
): Promise<PiReceipt> {
  const accountLegs = await teacherLegsOf(env, await credentialOwner());
  const router = getRouter(env);
  const canServe = (entry: { provider: string; model: string }): boolean =>
    models.models.getModel(entry.provider, entry.model) !== undefined;
  const decision = router.pick("interactive", canServe, accountLegs);
  if (!decision && !models.faux) throw new NoAvailableModelError();
  if (!decision) return doSubmit(handle, input, options);

  const model = models.models.getModel(decision.entry.provider, decision.model);
  const receipt = await router.withRoute(decision, async () => {
    const current = sessionModels.get(handle.id);
    if (model && (current?.provider !== model.provider || current?.id !== model.id)) {
      await handle.setModel({ provider: model.provider, id: model.id });
      sessionModels.set(handle.id, { provider: model.provider, id: model.id });
    }
    return doSubmit(handle, input, options);
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

export function fauxSocraticScript(context: TranscriptContext): AssistantMessage {
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

export interface TranscriptReadout {
  messages: Array<{ role: "user" | "assistant"; turn: number; text: string }>;
  violations: Array<{ turn: number; type: string; excerpt: string }>;
}

function entryText(entry: { model?: readonly Message[] }): string {
  return textOf(entry.model?.[0]?.content ?? "");
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

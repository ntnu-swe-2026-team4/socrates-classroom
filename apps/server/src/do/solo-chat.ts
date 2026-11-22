import type { UserInput } from "@earendil-works/pi-durable";
import { DurableObject } from "cloudflare:workers";
import { type PiReceipt, type PiSession, type PiSubmitOptions, ROOT_SESSION } from "agents/harness/pi";
import { Lifecycle, type LifecycleJobContext } from "agents/lifecycle";
import { WebSockets } from "agents/websockets";
import type { Env } from "../env";
import { SESSION_COOKIE, accountState, lookupSession } from "../auth";
import { forkBtw } from "../pi/extensions/btw";
import { run } from "../db/d1";
import type { Lang } from "@socrates/shared";
import { normalizeLang, nowIso } from "../http";
import { ChatSockets, type ReverifyOutcome, type SocketIdentity } from "../ws/sockets";
import {
  createDialogueCore,
  RunDeadlineTracker,
  submitViaRouter,
  RUN_DEADLINE_JOB,
  STUDENT_LANG_KEY,
  readTranscript,
  type TranscriptReadout,
} from "./dialogue-core";

export class SoloChat extends DurableObject<Env> {
  readonly #sessionModels = new Map<string, { provider: string; id: string }>();

  readonly core = createDialogueCore(this.env, {
    teacherOf: async () => null,
    getLang: () => this.studentLang(),
  });

  readonly tracker = new RunDeadlineTracker(
    () => this.lifecycle,
    this.ctx.storage,
    this.core.harness,
    (session, failureId) => this.sockets.notifyRunFailure(session, failureId),
  );

  readonly sockets: ChatSockets = new ChatSockets(
    this.core.harness,
    this.core.registry,
    async (request) => {
      const identity = await this.authorize(request);
      if (identity) await this.rememberStudentLang(request, identity);
      return identity;
    },
    (handle, input, options) => this.routeSubmit(handle, input, options),
    (identity) => this.canSubmit(identity),
    () => forkBtw(this.core.harness, this.core.btw),
    (identity) => this.revalidate(identity),
    (session) => this.tracker.recentRunFailure(session),
  );

  readonly webSockets = new WebSockets(this.sockets.options());
  readonly lifecycle = Lifecycle.install(this).use(this.webSockets).use(this.core.harness);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  get harness() {
    return this.core.harness;
  }

  get registry() {
    return this.core.registry;
  }

  get models() {
    return this.core.models;
  }

  get btw() {
    return this.core.btw;
  }

  async onStart(): Promise<void> {
    await this.sockets.reattach(this.webSockets.getConnections(), (identity) => this.reverify(identity));
    for (const job of this.lifecycle.jobs.list()) {
      if (job.fn === RUN_DEADLINE_JOB) this.ctx.waitUntil(this.tracker.checkRun(job));
    }
  }

  async onJob({ job }: LifecycleJobContext): Promise<void> {
    if (job.fn === RUN_DEADLINE_JOB) await this.tracker.checkRun(job);
  }

  private async studentLang(): Promise<Lang> {
    return (await this.ctx.storage.get<Lang>(STUDENT_LANG_KEY)) ?? "zh";
  }

  private async rememberStudentLang(request: Request, identity: SocketIdentity): Promise<void> {
    const lang = new URL(request.url).searchParams.get("lang");
    if (!lang || !/^(zh|en|es)\b/i.test(lang) || !(await this.canSubmit(identity))) return;
    await this.ctx.storage.put(STUDENT_LANG_KEY, normalizeLang(lang));
  }

  private async routeSubmit(handle: PiSession, input: UserInput, options: PiSubmitOptions): Promise<PiReceipt> {
    const [, threadId] = (this.ctx.id.name ?? "").split(":");
    if (threadId) {
      void run(this.env.DB, "UPDATE solo_threads SET updated_at = $now WHERE id = $id", {
        id: threadId,
        now: nowIso(),
      }).catch((error) => console.warn("[solo-chat] failed to touch thread updated_at", error));
    }

    return submitViaRouter(this.env, this.core.models, this.#sessionModels, [], handle, input, options, (h, inp, opt) =>
      this.tracker.submitWithDeadline(h, inp, opt, (p) => this.ctx.waitUntil(p)),
    );
  }

  async transcript(): Promise<TranscriptReadout> {
    return readTranscript(await this.core.harness.session(ROOT_SESSION).messages());
  }

  private async canSubmit(identity: SocketIdentity): Promise<boolean> {
    const [userId] = (this.ctx.id.name ?? "").split(":");
    return !!userId && identity.userId === userId;
  }

  private async authorize(request: Request): Promise<SocketIdentity | null> {
    const name = decodeURIComponent(new URL(request.url).pathname.split("/solo-chat/").at(-1) ?? "");
    const [userId, threadId] = name.split(":");
    if (!userId || !threadId) return null;

    const cookie = request.headers.get("Cookie") ?? "";
    const lookup = await lookupSession(this.env, cookieValue(cookie, SESSION_COOKIE));
    if (lookup.kind !== "ok" || lookup.session.user.id !== userId) return null;

    return {
      userId: lookup.session.user.id,
      participantId: threadId,
      version: lookup.session.version,
    };
  }

  private async reverify(identity: SocketIdentity): Promise<ReverifyOutcome> {
    const [userId] = (this.ctx.id.name ?? "").split(":");
    if (!userId || identity.userId !== userId) return "revoked";
    if (identity.userId === null) return "revoked";

    try {
      const state = await accountState(this.env.DB, identity.userId);
      if (!state || state.disabled || state.version !== identity.version) return "revoked";
      return "member";
    } catch {
      return "error";
    }
  }

  private async revalidate(identity: SocketIdentity): Promise<ReverifyOutcome> {
    if (identity.userId === null) return "revoked";
    try {
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

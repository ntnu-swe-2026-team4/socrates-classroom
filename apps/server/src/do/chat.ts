import type { UserInput } from "@earendil-works/pi-durable";
import { DurableObject } from "cloudflare:workers";
import { type PiReceipt, type PiSession, type PiSubmitOptions, ROOT_SESSION } from "agents/harness/pi";
import { Lifecycle, type LifecycleJobContext } from "agents/lifecycle";
import { WebSockets } from "agents/websockets";
import type { Env } from "../env";
import {
  SESSION_COOKIE,
  PARTICIPANT_COOKIE,
  accountState,
  cookieValue,
  lookupParticipant,
  lookupSession,
} from "../auth";
import { participantOf } from "../services/members";
import { forkBtw } from "../pi/extensions/btw";
import { teacherOfActivity } from "../pi/credentials";
import { one } from "../db/d1";
import { ApiError, type Lang } from "@socrates/shared";
import { normalizeLang } from "../http";
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

export { readTranscript, type TranscriptReadout };

class ActivityFinishedError extends Error {
  constructor() {
    super("activity_finished");
    this.name = "ActivityFinished";
  }
}

export class Chat extends DurableObject<Env> {
  #teacherId: string | null | undefined;
  readonly #sessionModels = new Map<string, { provider: string; id: string }>();

  readonly core = createDialogueCore(this.env, {
    credentialOwner: () => this.teacherId(),
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
    (identity) => this.reverify(identity),
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

  private async routeSubmit(handle: PiSession, input: UserInput, options: PiSubmitOptions): Promise<PiReceipt> {
    const activityId = this.ctx.id.name?.split(":")[0] ?? "";
    const activity = await one<{ finished_at: string | null }>(
      this.env.DB,
      "SELECT finished_at FROM activities WHERE id = $id",
      { id: activityId },
    );
    if (activity?.finished_at) throw new ActivityFinishedError();

    return submitViaRouter(this.env, this.core, this.#sessionModels, handle, input, options, (h, inp, opt) =>
      this.tracker.submitWithDeadline(h, inp, opt, (p) => this.ctx.waitUntil(p)),
    );
  }

  async transcript(): Promise<TranscriptReadout> {
    return readTranscript(await this.core.harness.session(ROOT_SESSION).messages());
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
      return (await this.activityPermitsThread(activityId, participantId, lookup.session.user.id)) ? identity : null;
    }
    if (lookup.kind !== "missing") return null;
    const held = await lookupParticipant(this.env, cookieValue(cookie, PARTICIPANT_COOKIE));
    if (!held || held.activityId !== activityId || held.participantId !== participantId) return null;
    const participant = await participantOf(this.env.DB, activityId, participantId);
    if (participant?.kind !== "guest" || participant.user_id !== null) return null;
    return { userId: null, participantId, version: null };
  }

  private async reverify(identity: SocketIdentity): Promise<ReverifyOutcome> {
    const [activityId, participantId] = this.ctx.id.name?.split(":") ?? [];
    if (!activityId || !participantId || identity.participantId !== participantId) return "revoked";
    try {
      if (identity.userId === null) {
        const participant = await participantOf(this.env.DB, activityId, participantId);
        return participant?.kind === "guest" && participant.user_id === null ? "member" : "revoked";
      }
      const state = await accountState(this.env.DB, identity.userId);
      if (!state || state.disabled || state.version !== identity.version) return "revoked";
      return (await this.activityPermitsThread(activityId, participantId, identity.userId)) ? "member" : "revoked";
    } catch (error) {
      return error instanceof ApiError ? "revoked" : "error";
    }
  }

  private async activityPermitsThread(activityId: string, participantId: string, userId: string): Promise<boolean> {
    const matching = await one(
      this.env.DB,
      `SELECT 1 FROM activities a JOIN classrooms c ON c.id = a.classroom_id
       LEFT JOIN activity_participants p ON p.activity_id = a.id AND p.id = $pid
       WHERE a.id = $aid AND (c.teacher_id = $uid OR (
         a.mode = 'live' AND p.user_id = $uid AND (p.kind = 'guest' OR EXISTS (
           SELECT 1 FROM members m WHERE m.classroom_id = c.id AND m.user_id = $uid
         ))
       ))`,
      { aid: activityId, pid: participantId, uid: userId },
    );
    return matching !== null;
  }

  async disconnectMember(userId: string): Promise<void> {
    await this.sockets.disconnectUser(userId);
  }
}

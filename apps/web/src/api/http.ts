import { hc } from "hono/client";
import type {
  ActivityInfo,
  ActivityInvite,
  ActivityMode,
  ActivitySlots,
  ActivityStarted,
  AdminUser,
  Axis,
  ClientConfig,
  ClassroomCreated,
  ClassroomInviteScope,
  ClassroomSummary,
  DevAccounts,
  InviteInfo,
  InviteJoined,
  JoinInfo,
  JoinResult,
  NotificationFeed,
  OAuthProviders,
  Report,
  ReportAxes,
  SoloThread,
  SoloThreadCreateInput,
  SoloThreadUpdateInput,
  TeacherKeyEcho,
  TeacherKeyModelEcho,
  TeacherKeyStatus,
  TermExplanation,
  Topic,
  TopicDraft,
  User,
} from "@socrates/shared";
import {
  ActivityStartInputSchema,
  AdminUserCreateInputSchema,
  AdminUserUpdateInputSchema,
  ClassroomCreateInputSchema,
  DevLoginInputSchema,
  ERROR_CODES,
  GenerateTopicsInputSchema,
  JoinInputSchema,
  LoginInputSchema,
  LookupInputSchema,
  PasswordForgotInputSchema,
  PasswordResetInputSchema,
  SignupInputSchema,
  SoloThreadCreateInputSchema,
  SoloThreadUpdateInputSchema,
  SttResultSchema,
  TopicCopyInputSchema,
  TopicCreateInputSchema,
  TtsInputSchema,
  type ErrorCode,
} from "@socrates/shared";
import type { RpcApi } from "@server/app";
import { clearLocalUserState, persistActivityId, recordTerm } from "./local";

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

function toErrorCode(raw: string | undefined): ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(raw ?? "") ? (raw as ErrorCode) : "internal_error";
}

export interface KeyProviderInfo {
  id: string;
  name: string;
}

export interface KeyModelInfo {
  id: string;
  name: string;
}

export interface Api {
  classroom: typeof classroomApi;
  me(): Promise<User | null>;
  config(): Promise<ClientConfig>;
  login(email: string, password: string): Promise<User>;
  signup(input: { name: string; email: string; password: string; tosAccepted: boolean }): Promise<User>;
  logout(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, password: string): Promise<void>;
  authProviders(): Promise<OAuthProviders>;
  notifications(): Promise<NotificationFeed>;
  markNotificationsSeen(): Promise<void>;
  joinByCode(code: string): Promise<JoinInfo>;
  joinAsGuest(code: string, input: { name?: string; tosAccepted: boolean }): Promise<JoinResult>;
  createActivityInvite(activityId: string): Promise<ActivityInvite>;
  inviteInfo(token: string): Promise<InviteInfo>;
  joinByInvite(token: string, input: { name?: string; tosAccepted: boolean }): Promise<InviteJoined>;
  listTopics(): Promise<Topic[]>;
  generateTopics(direction: string): Promise<TopicDraft[]>;
  createClassroom(name: string): Promise<ClassroomCreated>;
  listClassrooms(): Promise<ClassroomSummary[]>;
  listClassroomTopics(classroomId: string): Promise<Topic[]>;
  createClassroomTopic(
    classroomId: string,
    input: { title: string; statement: string; summary?: string; prompts: string[]; axes?: Axis[] },
  ): Promise<Topic>;
  copyTopic(topicId: string, classroomId: string): Promise<Topic>;
  startActivity(
    classroomId: string,
    topicId: string,
    mode?: ActivityMode,
    reportAxes?: ReportAxes,
    topicAxes?: Axis[],
  ): Promise<ActivityStarted>;
  listActivitySlots(activityId: string): Promise<ActivitySlots>;
  createActivitySlots(activityId: string, count: number): Promise<ActivitySlots>;
  stt(audio: Blob): Promise<string>;
  tts(text: string, onAmplitude: (value: number) => void, signal?: AbortSignal): Promise<void>;
  createTopic(input: {
    title: string;
    statement: string;
    summary?: string;
    prompts: string[];
    axes?: Axis[];
  }): Promise<Topic>;
  activityInfo(activityId: string, participantId?: string): Promise<ActivityInfo>;
  finishActivity(activityId: string): Promise<void>;
  report(activityId: string): Promise<Report>;
  listSoloThreads(): Promise<SoloThread[]>;
  getSoloThread(id: string): Promise<SoloThread>;
  createSoloThread(input: SoloThreadCreateInput): Promise<SoloThread>;
  updateSoloThread(id: string, input: SoloThreadUpdateInput): Promise<SoloThread>;
  deleteSoloThread(id: string): Promise<void>;
  lookupTerm(term: string): Promise<TermExplanation>;
  listTeacherKeys(): Promise<TeacherKeyStatus[]>;
  listKeyProviders(): Promise<KeyProviderInfo[]>;
  listKeyProviderModels(provider: string): Promise<KeyModelInfo[]>;
  putTeacherKey(provider: string, key: string, maxConcurrency?: number | null): Promise<TeacherKeyEcho>;
  putTeacherKeyProviderLimit(provider: string, maxConcurrency: number | null): Promise<TeacherKeyEcho>;
  putTeacherKeyMonthlyQuota(provider: string, monthlyQuotaUsd: number | null): Promise<TeacherKeyEcho>;
  putTeacherKeyModel(provider: string, model: string, maxConcurrency?: number | null): Promise<TeacherKeyModelEcho>;
  deleteTeacherKeyModel(provider: string, model: string): Promise<void>;
  orderTeacherKeyModels(provider: string, models: string[]): Promise<void>;
  deleteTeacherKey(provider: string): Promise<void>;
  orderTeacherKeys(providers: string[]): Promise<void>;
  devAccounts(): Promise<DevAccounts>;
  devLogin(email: string): Promise<User>;
  listAdminUsers(): Promise<AdminUser[]>;
  createAdminUser(input: { name: string; email: string; password: string }): Promise<AdminUser>;
  updateAdminUser(id: string, input: { disabled?: boolean }): Promise<AdminUser>;
}

const client = hc<RpcApi>("/api", {
  headers: langHeaders,
  init: { credentials: "include" },
});

function langHeaders(): Record<string, string> {
  const tag = document.documentElement.lang || "zh-TW";
  const value = tag.startsWith("en") ? "en" : tag.startsWith("es") ? "es" : "zh";
  return { "Accept-Language": value };
}

type JsonLike = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
};

async function raiseApiError(res: { statusText: string; json(): Promise<unknown> }): Promise<never> {
  const payload = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
  throw new ApiError(toErrorCode(payload?.code), payload?.message ?? res.statusText);
}

async function unwrap<R extends JsonLike>(res: R): Promise<Awaited<ReturnType<R["json"]>>> {
  if (res.status === 204) return undefined as Awaited<ReturnType<R["json"]>>;
  if (!res.ok) return raiseApiError(res);
  return res.json() as Promise<Awaited<ReturnType<R["json"]>>>;
}

async function playTts(text: string, onAmplitude: (value: number) => void, signal?: AbortSignal): Promise<void> {
  const input = TtsInputSchema.parse({ text, lang: langHeaders()["Accept-Language"] });
  const res = await client.tts.$post({ json: input }, { init: { signal } });
  if (!res.ok) return raiseApiError(res);
  const bytes = await res.arrayBuffer();
  const AudioContextCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioContextCtor();
  if (context.state === "suspended") await context.resume().catch(() => {});
  const source = context.createBufferSource();
  const stopEarly = () => {
    void context.close().catch(() => {});
  };
  if (signal?.aborted) {
    stopEarly();
    throw new DOMException("aborted", "AbortError");
  }
  const onAbortDuringDecode = () => stopEarly();
  signal?.addEventListener("abort", onAbortDuringDecode, { once: true });
  try {
    source.buffer = await context.decodeAudioData(bytes);
  } catch (error) {
    stopEarly();
    throw error;
  } finally {
    signal?.removeEventListener("abort", onAbortDuringDecode);
  }
  if (signal?.aborted) {
    stopEarly();
    throw new DOMException("aborted", "AbortError");
  }
  const analyser = context.createAnalyser();
  analyser.fftSize = 256;
  source.connect(analyser);
  analyser.connect(context.destination);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    void source.stop();
    void context.close();
    signal?.removeEventListener("abort", stop);
  };
  signal?.addEventListener("abort", stop, { once: true });
  await new Promise<void>((resolve) => {
    const tick = () => {
      if (stopped) return resolve();
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (const sample of data) sum += (sample - 128) ** 2;
      onAmplitude(Math.min(1, Math.sqrt(sum / data.length) / 42));
      raf = requestAnimationFrame(tick);
    };
    source.onended = () => {
      stop();
      resolve();
    };
    source.start();
    raf = requestAnimationFrame(tick);
  });
}

export const SESSION_SIGNAL_KEY = "socrates_session_changed";

function announceSession(): void {
  try {
    localStorage.setItem(SESSION_SIGNAL_KEY, String(Date.now()));
  } catch {
    return;
  }
}

type ScopedInviteInput =
  | { scope: "classroom" }
  | { scope: Exclude<ClassroomInviteScope, "classroom">; activityId: string };

const classroom = client.classrooms[":id"];
const scopedInvite = client["classroom-invites"][":token"];

function idempotencyHeaders(key: string) {
  return { headers: { ...langHeaders(), "Idempotency-Key": key } };
}

const classroomApi = {
  async announcements(id: string, cursor?: string) {
    return unwrap(await classroom.announcements.$get({ param: { id }, query: { cursor } }));
  },
  async publish(id: string, body: string, key: string) {
    return unwrap(await classroom.announcements.$post({ param: { id }, json: { body } }, idempotencyHeaders(key)));
  },
  async deleteAnnouncement(id: string, itemId: string) {
    await unwrap(await classroom.announcements[":itemId"].$delete({ param: { id, itemId } }));
  },
  async posts(id: string, cursor?: string) {
    return unwrap(await classroom.posts.$get({ param: { id }, query: { cursor } }));
  },
  async post(id: string, body: string, key: string) {
    return unwrap(await classroom.posts.$post({ param: { id }, json: { body } }, idempotencyHeaders(key)));
  },
  async replies(id: string, postId: string, cursor?: string) {
    return unwrap(await classroom.posts[":postId"].replies.$get({ param: { id, postId }, query: { cursor } }));
  },
  async reply(id: string, postId: string, body: string, key: string) {
    return unwrap(
      await classroom.posts[":postId"].replies.$post(
        { param: { id, postId }, json: { body } },
        idempotencyHeaders(key),
      ),
    );
  },
  async deletePost(id: string, postId: string) {
    await unwrap(await classroom.posts[":postId"].$delete({ param: { id, postId } }));
  },
  async members(id: string, cursor?: string) {
    return unwrap(await classroom.members.$get({ param: { id }, query: { cursor } }));
  },
  async removeMember(id: string, userId: string) {
    await unwrap(await classroom.members[":userId"].$delete({ param: { id, userId } }));
  },
  async activities(id: string, cursor?: string) {
    return unwrap(await classroom.activities.$get({ param: { id }, query: { cursor } }));
  },
  async invites(id: string, cursor?: string) {
    return unwrap(await classroom.invites.$get({ param: { id }, query: { cursor } }));
  },
  async createInvite(id: string, input: ScopedInviteInput) {
    return unwrap(await classroom.invites.$post({ param: { id }, json: input }));
  },
  async revokeInvite(id: string, inviteId: string) {
    await unwrap(await classroom.invites[":inviteId"].$delete({ param: { id, inviteId } }));
  },
  async previewInvite(token: string) {
    return unwrap(await scopedInvite.$get({ param: { token } }));
  },
  async acceptInvite(token: string, input: { name?: string; tosAccepted: boolean }) {
    const joined = await unwrap(await scopedInvite.join.$post({ param: { token }, json: input }));
    if (joined.activityId) persistActivityId(joined.activityId);
    return joined;
  },
  async myReports(cursor?: string) {
    return unwrap(await client.me.reports.$get({ query: { cursor } }));
  },
};

export const httpApi: Api = {
  async config() {
    return unwrap(await client.config.$get());
  },
  classroom: classroomApi,
  async me() {
    return unwrap(await client.me.$get());
  },
  async login(email, password) {
    const user = unwrap(await client.auth.login.$post({ json: LoginInputSchema.parse({ email, password }) }));
    announceSession();
    return user;
  },
  async signup(input) {
    const user = unwrap(await client.auth.signup.$post({ json: SignupInputSchema.parse(input) }));
    announceSession();
    return user;
  },
  async logout() {
    await unwrap(await client.auth.logout.$post());
    clearLocalUserState();
    announceSession();
  },
  async requestPasswordReset(email) {
    await unwrap(await client.auth.password.forgot.$post({ json: PasswordForgotInputSchema.parse({ email }) }));
  },
  async resetPassword(token, password) {
    await unwrap(await client.auth.password.reset.$post({ json: PasswordResetInputSchema.parse({ token, password }) }));
  },
  async authProviders() {
    return unwrap(await client.auth.providers.$get());
  },
  async notifications() {
    return unwrap(await client.notifications.$get());
  },
  async markNotificationsSeen() {
    await unwrap(await client.notifications.seen.$post());
  },
  async joinByCode(code) {
    return unwrap(await client.join[":code"].$get({ param: { code } }));
  },
  async joinAsGuest(code, input) {
    const data = await unwrap(
      await client.join.$post({
        json: JoinInputSchema.parse({ code, name: input.name, tosAccepted: input.tosAccepted }),
      }),
    );
    persistActivityId(data.activityId);
    return data;
  },
  async createActivityInvite(activityId) {
    return unwrap(await client.activities[":id"].invites.$post({ param: { id: activityId } }));
  },
  async inviteInfo(token) {
    return unwrap(await client.invites[":token"].$get({ param: { token } }));
  },
  async joinByInvite(token, input) {
    const data = await unwrap(await client.invites[":token"].join.$post({ param: { token }, json: input }));
    persistActivityId(data.activityId);
    return data;
  },
  async listTopics() {
    return unwrap(await client.topics.$get());
  },
  async generateTopics(direction) {
    const input = GenerateTopicsInputSchema.parse({ direction });
    return unwrap(await client.topics.generate.$post({ json: input }));
  },
  async createTopic(input) {
    return unwrap(await client.topics.$post({ json: TopicCreateInputSchema.parse(input) }));
  },
  async createClassroom(name) {
    const input = ClassroomCreateInputSchema.parse({ name });
    return unwrap(await client.classrooms.$post({ json: input }));
  },
  async listClassrooms() {
    return unwrap(await client.classrooms.$get());
  },
  async listClassroomTopics(classroomId) {
    return unwrap(await client.classrooms[":id"].topics.$get({ param: { id: classroomId } }));
  },
  async createClassroomTopic(classroomId, input) {
    return unwrap(
      await client.classrooms[":id"].topics.$post({
        param: { id: classroomId },
        json: TopicCreateInputSchema.parse(input),
      }),
    );
  },
  async copyTopic(topicId, classroomId) {
    return unwrap(
      await client.topics[":id"].copy.$post({
        param: { id: topicId },
        json: TopicCopyInputSchema.parse({ classroomId }),
      }),
    );
  },
  async startActivity(classroomId, topicId, mode = "live", reportAxes, topicAxes) {
    const input = ActivityStartInputSchema.parse({ topicId, mode, reportAxes, topicAxes });
    return unwrap(await client.classrooms[":id"].activities.$post({ param: { id: classroomId }, json: input }));
  },
  async listActivitySlots(activityId) {
    return unwrap(await client.activities[":id"].slots.$get({ param: { id: activityId } }));
  },
  async createActivitySlots(activityId, count) {
    return unwrap(
      await client.activities[":id"].slots.$post({
        param: { id: activityId },
        json: { count },
      }),
    );
  },
  async stt(audio) {
    const file = audio instanceof File ? audio : new File([audio], "speech.webm", { type: audio.type });
    const res = await client.stt.$post({ form: { audio: file } });
    if (!res.ok) return raiseApiError(res);
    return SttResultSchema.parse(await res.json()).text;
  },
  tts: playTts,
  async activityInfo(activityId, participantId) {
    return unwrap(await client.activities[":id"].$get({ param: { id: activityId }, query: { participantId } }));
  },
  async finishActivity(activityId) {
    await unwrap(await client.activities[":id"].finish.$post({ param: { id: activityId } }));
  },
  async report(activityId) {
    return unwrap(await client.activities[":id"].report.$get({ param: { id: activityId } }));
  },
  async listSoloThreads() {
    return unwrap(await client.solo.threads.$get());
  },
  async getSoloThread(id) {
    return unwrap(await client.solo.threads[":id"].$get({ param: { id } }));
  },
  async createSoloThread(input) {
    return unwrap(await client.solo.threads.$post({ json: SoloThreadCreateInputSchema.parse(input) }));
  },
  async updateSoloThread(id, input) {
    return unwrap(
      await client.solo.threads[":id"].$patch({ param: { id }, json: SoloThreadUpdateInputSchema.parse(input) }),
    );
  },
  async deleteSoloThread(id) {
    await unwrap(await client.solo.threads[":id"].$delete({ param: { id } }));
  },
  async lookupTerm(term) {
    const input = LookupInputSchema.parse({ term });
    const data = await unwrap(await client.lookup.$post({ json: input }));
    recordTerm(data.term);
    return data;
  },
  async listTeacherKeys() {
    return unwrap(await client.settings.keys.$get());
  },
  async listKeyProviders() {
    return unwrap(await client.settings.keys.providers.$get());
  },
  async listKeyProviderModels(provider) {
    return unwrap(await client.settings.keys.providers[":provider"].models.$get({ param: { provider } }));
  },
  async putTeacherKey(provider, key, maxConcurrency) {
    return unwrap(
      await client.settings.keys[":provider"].$put({
        param: { provider },
        json: maxConcurrency === undefined ? { key } : { key, maxConcurrency },
      }),
    );
  },
  async putTeacherKeyProviderLimit(provider, maxConcurrency) {
    return unwrap(await client.settings.keys[":provider"].$put({ param: { provider }, json: { maxConcurrency } }));
  },
  async putTeacherKeyMonthlyQuota(provider, monthlyQuotaUsd) {
    return unwrap(await client.settings.keys[":provider"].$put({ param: { provider }, json: { monthlyQuotaUsd } }));
  },
  async putTeacherKeyModel(provider, model, maxConcurrency) {
    return unwrap(
      await client.settings.keys[":provider"].models.$put({
        param: { provider },
        json: maxConcurrency === undefined ? { model } : { model, maxConcurrency },
      }),
    );
  },
  async deleteTeacherKeyModel(provider, model) {
    await unwrap(
      await client.settings.keys[":provider"].models[":model"].$delete({
        param: { provider, model: encodeURIComponent(model) },
      }),
    );
  },
  async orderTeacherKeyModels(provider, models) {
    await unwrap(await client.settings.keys[":provider"].models.order.$put({ param: { provider }, json: { models } }));
  },
  async deleteTeacherKey(provider) {
    await unwrap(await client.settings.keys[":provider"].$delete({ param: { provider } }));
  },
  async orderTeacherKeys(providers) {
    await unwrap(await client.settings.keys.order.$put({ json: { providers } }));
  },
  async devAccounts() {
    return unwrap(await client.dev.accounts.$get());
  },
  async devLogin(email) {
    const user = await unwrap(await client.dev.login.$post({ json: DevLoginInputSchema.parse({ email }) }));
    announceSession();
    return user;
  },
  async listAdminUsers() {
    return unwrap(await client.admin.users.$get());
  },
  async createAdminUser(input) {
    return unwrap(await client.admin.users.$post({ json: AdminUserCreateInputSchema.parse(input) }));
  },
  async updateAdminUser(id, input) {
    return unwrap(
      await client.admin.users[":id"].$patch({ param: { id }, json: AdminUserUpdateInputSchema.parse(input) }),
    );
  },
};

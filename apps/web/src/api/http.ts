import { hc } from "hono/client";
import type {
  ActivityInfo,
  ActivityInvite,
  ActivityMode,
  ActivitySlots,
  ActivityStarted,
  AdminUser,
  ClassroomCreated,
  ClassroomSummary,
  DevAccounts,
  InviteInfo,
  InviteJoined,
  JoinInfo,
  JoinResult,
  Report,
  TeacherKeyStatus,
  TermExplanation,
  Topic,
  TopicDraft,
  User,
} from "@socrates/shared";
import {
  ActivityStartInputSchema,
  ACTIVITY_SLOT_MAX,
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
  me(): Promise<User | null>;
  login(email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(token: string, password: string): Promise<void>;
  joinByCode(code: string): Promise<JoinInfo>;
  joinAsGuest(code: string, name?: string): Promise<JoinResult>;
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
    input: { title: string; statement: string; summary?: string; prompts: string[] },
  ): Promise<Topic>;
  copyTopic(topicId: string, classroomId: string): Promise<Topic>;
  startActivity(classroomId: string, topicId: string, mode?: ActivityMode): Promise<ActivityStarted>;
  listActivitySlots(activityId: string): Promise<ActivitySlots>;
  createActivitySlots(activityId: string, count: number): Promise<ActivitySlots>;
  stt(audio: Blob): Promise<string>;
  tts(text: string, onAmplitude: (value: number) => void, signal?: AbortSignal): Promise<void>;
  createTopic(input: { title: string; statement: string; summary?: string; prompts: string[] }): Promise<Topic>;
  activityInfo(activityId: string, participantId?: string): Promise<ActivityInfo>;
  finishActivity(activityId: string): Promise<void>;
  report(activityId: string): Promise<Report>;
  lookupTerm(term: string): Promise<TermExplanation>;
  listTeacherKeys(): Promise<TeacherKeyStatus[]>;
  listKeyProviders(): Promise<KeyProviderInfo[]>;
  listKeyProviderModels(provider: string): Promise<KeyModelInfo[]>;
  putTeacherKey(
    provider: string,
    key: string,
    maxConcurrency?: number | null,
  ): Promise<{ provider: string; last4: string; maxConcurrency: number | null }>;
  putTeacherKeyProviderLimit(
    provider: string,
    maxConcurrency: number | null,
  ): Promise<{ provider: string; maxConcurrency: number | null }>;
  putTeacherKeyMonthlyQuota(
    provider: string,
    monthlyQuotaUsd: number | null,
  ): Promise<{ provider: string; monthlyQuotaUsd: number | null }>;
  putTeacherKeyModel(
    provider: string,
    model: string,
    maxConcurrency?: number | null,
  ): Promise<{ provider: string; model: string; maxConcurrency: number | null }>;
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

async function unwrap<R extends JsonLike>(res: R): Promise<Awaited<ReturnType<R["json"]>>> {
  if (res.status === 204) return undefined as Awaited<ReturnType<R["json"]>>;
  if (!res.ok) {
    const error = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
    throw new ApiError(toErrorCode(error?.code), error?.message ?? res.statusText);
  }
  return res.json() as Promise<Awaited<ReturnType<R["json"]>>>;
}

async function raw<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      ...langHeaders(),
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    ...rest,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
    throw new ApiError(toErrorCode(payload?.code), payload?.message ?? res.statusText);
  }
  return (await res.json()) as T;
}

async function playTts(text: string, onAmplitude: (value: number) => void, signal?: AbortSignal): Promise<void> {
  const input = TtsInputSchema.parse({ text, lang: langHeaders()["Accept-Language"] });
  const res = await client.tts.$post({ json: input }, { init: { signal } });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
    throw new ApiError(toErrorCode(payload?.code), payload?.message ?? res.statusText);
  }
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

export const httpApi: Api = {
  async me() {
    return unwrap(await client.me.$get());
  },
  async login(email, password) {
    const user = unwrap(await client.auth.login.$post({ json: LoginInputSchema.parse({ email, password }) }));
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
  async joinByCode(code) {
    return unwrap(await client.join[":code"].$get({ param: { code } }));
  },
  async joinAsGuest(code, name) {
    const data = await raw<JoinResult>("/join", {
      method: "POST",
      json: JoinInputSchema.parse({ code, name, tosAccepted: true }),
    });
    persistActivityId(data.activityId);
    return data;
  },
  async createActivityInvite(activityId) {
    return await raw<ActivityInvite>(`/activities/${encodeURIComponent(activityId)}/invites`, { method: "POST" });
  },
  async inviteInfo(token) {
    return await raw<InviteInfo>(`/invites/${encodeURIComponent(token)}`);
  },
  async joinByInvite(token, input) {
    const data = await raw<InviteJoined>(`/invites/${encodeURIComponent(token)}/join`, {
      method: "POST",
      json: input,
    });
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
    return await raw<Topic[]>(`/classrooms/${encodeURIComponent(classroomId)}/topics`);
  },
  async createClassroomTopic(classroomId, input) {
    return await raw<Topic>(`/classrooms/${encodeURIComponent(classroomId)}/topics`, {
      method: "POST",
      json: TopicCreateInputSchema.parse(input),
    });
  },
  async copyTopic(topicId, classroomId) {
    return await raw<Topic>(`/topics/${encodeURIComponent(topicId)}/copy`, {
      method: "POST",
      json: TopicCopyInputSchema.parse({ classroomId }),
    });
  },
  async startActivity(classroomId, topicId, mode = "live") {
    const input = ActivityStartInputSchema.parse({ topicId, mode });
    return await raw<ActivityStarted>(`/classrooms/${classroomId}/activities`, { method: "POST", json: input });
  },
  async listActivitySlots(activityId) {
    return raw<ActivitySlots>(`/activities/${encodeURIComponent(activityId)}/slots`);
  },
  async createActivitySlots(activityId, count) {
    return raw<ActivitySlots>(`/activities/${encodeURIComponent(activityId)}/slots`, {
      method: "POST",
      json: { count: Math.min(Math.max(count, 1), ACTIVITY_SLOT_MAX) },
    });
  },
  async stt(audio) {
    const file = audio instanceof File ? audio : new File([audio], "speech.webm", { type: audio.type });
    const res = await client.stt.$post({ form: { audio: file } });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
      throw new ApiError(toErrorCode(payload?.code), payload?.message ?? res.statusText);
    }
    return SttResultSchema.parse(await res.json()).text;
  },
  tts: playTts,
  async activityInfo(activityId, participantId) {
    const query = participantId === undefined ? "" : `?participantId=${encodeURIComponent(participantId)}`;
    return raw<ActivityInfo>(`/activities/${encodeURIComponent(activityId)}${query}`);
  },
  async finishActivity(activityId) {
    await unwrap(await client.activities[":id"].finish.$post({ param: { id: activityId } }));
  },
  async report(activityId) {
    return unwrap(await client.activities[":id"].report.$get({ param: { id: activityId } }));
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
    return raw<{ provider: string; last4: string; maxConcurrency: number | null }>(
      `/settings/keys/${encodeURIComponent(provider)}`,
      { method: "PUT", json: maxConcurrency === undefined ? { key } : { key, maxConcurrency } },
    );
  },
  async putTeacherKeyProviderLimit(provider, maxConcurrency) {
    return raw<{ provider: string; maxConcurrency: number | null }>(`/settings/keys/${encodeURIComponent(provider)}`, {
      method: "PUT",
      json: { maxConcurrency },
    });
  },
  async putTeacherKeyMonthlyQuota(provider, monthlyQuotaUsd) {
    return raw<{ provider: string; monthlyQuotaUsd: number | null }>(`/settings/keys/${encodeURIComponent(provider)}`, {
      method: "PUT",
      json: { monthlyQuotaUsd },
    });
  },
  async putTeacherKeyModel(provider, model, maxConcurrency) {
    return raw<{ provider: string; model: string; maxConcurrency: number | null }>(
      `/settings/keys/${encodeURIComponent(provider)}/models`,
      { method: "PUT", json: maxConcurrency === undefined ? { model } : { model, maxConcurrency } },
    );
  },
  async deleteTeacherKeyModel(provider, model) {
    await raw<void>(`/settings/keys/${encodeURIComponent(provider)}/models/${encodeURIComponent(model)}`, {
      method: "DELETE",
    });
  },
  async orderTeacherKeyModels(provider, models) {
    await raw<void>(`/settings/keys/${encodeURIComponent(provider)}/models/order`, {
      method: "PUT",
      json: { models },
    });
  },
  async deleteTeacherKey(provider) {
    await unwrap(await client.settings.keys[":provider"].$delete({ param: { provider } }));
  },
  async orderTeacherKeys(providers) {
    await unwrap(await client.settings.keys.order.$put({ json: { providers } }));
  },
  async devAccounts() {
    return raw<DevAccounts>("/dev/accounts");
  },
  async devLogin(email) {
    const user = await raw<User>("/dev/login", { method: "POST", json: DevLoginInputSchema.parse({ email }) });
    announceSession();
    return user;
  },
  async listAdminUsers() {
    return unwrap(await client.admin.users.$get());
  },
  async createAdminUser(input) {
    return raw<AdminUser>("/admin/users", { method: "POST", json: AdminUserCreateInputSchema.parse(input) });
  },
  async updateAdminUser(id, input) {
    return raw<AdminUser>(`/admin/users/${encodeURIComponent(id)}`, {
      method: "PATCH",
      json: AdminUserUpdateInputSchema.parse(input),
    });
  },
};

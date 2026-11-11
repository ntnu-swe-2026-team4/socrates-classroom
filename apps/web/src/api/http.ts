import { hc } from "hono/client";
import type {
  ActivityInfo,
  Announcement,
  AuthProviders,
  ClassroomActivity,
  ClassroomCreated,
  ClassroomMembers,
  ClassroomSummary,
  Post,
  SoloChat,
  JoinInfo,
  Report,
  TeacherKeyStatus,
  TermExplanation,
  Topic,
  User,
} from "@socrates/shared";
import {
  ActivityStartInputSchema,
  AnnouncementInputSchema,
  ClassroomCreateInputSchema,
  ERROR_CODES,
  GenerateTopicsInputSchema,
  JoinInputSchema,
  LoginInputSchema,
  LookupInputSchema,
  PostInputSchema,
  SttResultSchema,
  TopicCreateInputSchema,
  TtsInputSchema,
  type ErrorCode,
} from "@socrates/shared";
import type { RpcApi } from "@server/app";
import { persistActivityId, recordTerm } from "./local";
import { getCompanion } from "@/lib/companion";

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
  loginAsGuest(name?: string): Promise<User>;
  register(input: { email: string; password: string; name?: string; code?: string }): Promise<User>;
  updateProfile(name: string): Promise<User>;
  authProviders(): Promise<AuthProviders>;
  getClassroom(classroomId: string): Promise<ClassroomSummary>;
  deleteClassroom(classroomId: string): Promise<void>;
  classroomActivities(classroomId: string): Promise<ClassroomActivity[]>;
  listAnnouncements(classroomId: string): Promise<Announcement[]>;
  createAnnouncement(classroomId: string, body: string): Promise<Announcement>;
  deleteAnnouncement(classroomId: string, announcementId: string): Promise<void>;
  listMembers(classroomId: string): Promise<ClassroomMembers>;
  removeMember(classroomId: string, userId: string): Promise<void>;
  listPosts(classroomId: string): Promise<Post[]>;
  createPost(classroomId: string, body: string, parentId?: string): Promise<Post>;
  deletePost(classroomId: string, postId: string): Promise<void>;
  listChats(): Promise<SoloChat[]>;
  getChat(chatId: string): Promise<SoloChat>;
  createChat(title: string): Promise<SoloChat>;
  renameChat(chatId: string, title: string): Promise<SoloChat>;
  deleteChat(chatId: string): Promise<void>;
  joinByCode(code: string): Promise<JoinInfo>;
  joinAsGuest(code: string, name?: string): Promise<{ user: User; activityId: string }>;
  listTopics(): Promise<Topic[]>;
  generateTopics(direction: string): Promise<Topic[]>;
  createClassroom(input?: { name?: string; topicId?: string }): Promise<ClassroomCreated>;
  renameClassroom(classroomId: string, name: string): Promise<{ id: string; name: string }>;
  listClassrooms(): Promise<ClassroomSummary[]>;
  startActivity(classroomId: string, topicId: string): Promise<ClassroomCreated>;
  previewAsStudent(classroomId: string): Promise<{ user: User; activityId: string }>;
  resetPreview(): Promise<{ user: User; activityId: string }>;
  exitPreview(): Promise<User>;
  stt(audio: Blob): Promise<string>;
  tts(text: string, onAmplitude: (value: number) => void, signal?: AbortSignal): Promise<void>;
  createTopic(input: { title: string; statement: string; summary?: string; prompts: string[] }): Promise<Topic>;
  activityInfo(activityId: string): Promise<ActivityInfo>;
  finishActivity(activityId: string): Promise<void>;
  report(activityId: string): Promise<Report>;
  lookupTerm(term: string): Promise<TermExplanation>;
  askAssistant(messages: Array<{ role: "user" | "assistant"; text: string }>): Promise<{ markdown: string }>;
  listTeacherKeys(): Promise<TeacherKeyStatus[]>;
  listKeyProviders(): Promise<KeyProviderInfo[]>;
  listKeyProviderModels(provider: string): Promise<KeyModelInfo[]>;
  putTeacherKey(
    provider: string,
    model: string,
    key: string,
  ): Promise<{ provider: string; model: string; last4: string }>;
  deleteTeacherKey(provider: string): Promise<void>;
  orderTeacherKeys(providers: string[]): Promise<void>;
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

async function rawVoid(path: string, init: RequestInit = {}): Promise<void> {
  const res = await fetch(`/api${path}`, { credentials: "include", headers: langHeaders(), ...init });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
    throw new ApiError(toErrorCode(payload?.code), payload?.message ?? res.statusText);
  }
}

const ELDER_RATE = 0.92;
const ELDER_TREMOLO_HZ = 5.2;
const ELDER_TREMOLO_DEPTH = 0.03;

function elderVoice(context: AudioContext, source: AudioBufferSourceNode): { output: AudioNode; stop: () => void } {
  source.playbackRate.value = ELDER_RATE;
  const warmth = context.createBiquadFilter();
  warmth.type = "lowshelf";
  warmth.frequency.value = 220;
  warmth.gain.value = 3;
  const soften = context.createBiquadFilter();
  soften.type = "lowpass";
  soften.frequency.value = 5000;
  soften.Q.value = 0.6;
  const tremolo = context.createGain();
  tremolo.gain.value = 1 - ELDER_TREMOLO_DEPTH;
  const lfo = context.createOscillator();
  lfo.frequency.value = ELDER_TREMOLO_HZ;
  const depth = context.createGain();
  depth.gain.value = ELDER_TREMOLO_DEPTH;
  lfo.connect(depth);
  depth.connect(tremolo.gain);
  source.connect(warmth);
  warmth.connect(soften);
  soften.connect(tremolo);
  lfo.start();
  return {
    output: tremolo,
    stop: () => {
      try {
        lfo.stop();
      } catch {}
    },
  };
}

const MALE_VOICE = /zhiwei|yunjhe|kangkang|yunyang|yunxi|danny|david|mark|guy|george|pablo|raul|jorge|alvaro|male/i;

function waitForVoices(): Promise<SpeechSynthesisVoice[]> {
  const voices = window.speechSynthesis.getVoices();
  if (voices.length) return Promise.resolve(voices);
  return new Promise((resolve) => {
    const done = () => resolve(window.speechSynthesis.getVoices());
    window.speechSynthesis.addEventListener("voiceschanged", done, { once: true });
    setTimeout(done, 1000);
  });
}

function pickLocalVoice(voices: SpeechSynthesisVoice[], lang: string): SpeechSynthesisVoice | null {
  const local = voices.filter((voice) => voice.localService && voice.lang.toLowerCase().startsWith(lang));
  const preferred = lang === "zh" ? local.filter((voice) => /tw|hant|hk/i.test(voice.lang)) : local;
  const pool = preferred.length ? preferred : local;
  return pool.find((voice) => MALE_VOICE.test(voice.name)) ?? pool[0] ?? null;
}

async function speakLocally(text: string, lang: string, signal?: AbortSignal): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window) || signal?.aborted) return;
  const voice = pickLocalVoice(await waitForVoices(), lang);
  if (!voice || signal?.aborted) return;
  const { voiceStyle, volume } = getCompanion();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.voice = voice;
  utterance.lang = voice.lang;
  utterance.pitch = voiceStyle === "elder" ? 0.55 : 1;
  utterance.rate = voiceStyle === "elder" ? 0.86 : 1;
  utterance.volume = volume;
  await new Promise<void>((resolve, reject) => {
    const cancel = () => {
      window.speechSynthesis.cancel();
      resolve();
    };
    signal?.addEventListener("abort", cancel, { once: true });
    utterance.onend = () => {
      signal?.removeEventListener("abort", cancel);
      resolve();
    };
    utterance.onerror = (event) => {
      signal?.removeEventListener("abort", cancel);
      if (event.error === "canceled" || event.error === "interrupted") resolve();
      else reject(new Error(event.error));
    };
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  });
}

async function playTts(text: string, onAmplitude: (value: number) => void, signal?: AbortSignal): Promise<void> {
  const input = TtsInputSchema.parse({ text, lang: langHeaders()["Accept-Language"] });
  const res = await client.tts.$post({ json: input }, { init: { signal } });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
    throw new ApiError(toErrorCode(payload?.code), payload?.message ?? res.statusText);
  }
  if (res.headers.get("X-Socrates-Fallback") === "mock") {
    await speakLocally(text, input.lang, signal);
    return;
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
  const gain = context.createGain();
  gain.gain.value = getCompanion().volume;
  const voice = getCompanion().voiceStyle === "elder" ? elderVoice(context, source) : null;
  (voice?.output ?? source).connect(analyser);
  analyser.connect(gain);
  gain.connect(context.destination);
  const data = new Uint8Array(analyser.frequencyBinCount);
  let raf = 0;
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    cancelAnimationFrame(raf);
    void source.stop();
    voice?.stop();
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

export const httpApi: Api = {
  async me() {
    return unwrap(await client.me.$get());
  },
  async login(email, password) {
    return unwrap(await client.auth.login.$post({ json: LoginInputSchema.parse({ email, password }) }));
  },
  async logout() {
    await unwrap(await client.auth.logout.$post());
  },
  async loginAsGuest(name) {
    return raw<User>("/auth/guest", { method: "POST", json: name ? { name } : {} });
  },
  async register(input) {
    return raw<User>("/auth/register", { method: "POST", json: { ...input, tosAccepted: true } });
  },
  async updateProfile(name) {
    return raw<User>("/me", { method: "PATCH", json: { name } });
  },
  async authProviders() {
    return raw<AuthProviders>("/auth/providers");
  },
  async getClassroom(classroomId) {
    return raw<ClassroomSummary>(`/classrooms/${encodeURIComponent(classroomId)}`);
  },
  async deleteClassroom(classroomId) {
    await rawVoid(`/classrooms/${encodeURIComponent(classroomId)}`, { method: "DELETE" });
  },
  async classroomActivities(classroomId) {
    return raw<ClassroomActivity[]>(`/classrooms/${encodeURIComponent(classroomId)}/activities`);
  },
  async listAnnouncements(classroomId) {
    return raw<Announcement[]>(`/classrooms/${encodeURIComponent(classroomId)}/announcements`);
  },
  async createAnnouncement(classroomId, body) {
    return raw<Announcement>(`/classrooms/${encodeURIComponent(classroomId)}/announcements`, {
      method: "POST",
      json: AnnouncementInputSchema.parse({ body }),
    });
  },
  async deleteAnnouncement(classroomId, announcementId) {
    await rawVoid(
      `/classrooms/${encodeURIComponent(classroomId)}/announcements/${encodeURIComponent(announcementId)}`,
      { method: "DELETE" },
    );
  },
  async listMembers(classroomId) {
    return raw<ClassroomMembers>(`/classrooms/${encodeURIComponent(classroomId)}/members`);
  },
  async removeMember(classroomId, userId) {
    await rawVoid(`/classrooms/${encodeURIComponent(classroomId)}/members/${encodeURIComponent(userId)}`, {
      method: "DELETE",
    });
  },
  async listPosts(classroomId) {
    return raw<Post[]>(`/classrooms/${encodeURIComponent(classroomId)}/posts`);
  },
  async createPost(classroomId, body, parentId) {
    return raw<Post>(`/classrooms/${encodeURIComponent(classroomId)}/posts`, {
      method: "POST",
      json: PostInputSchema.parse({ body, parentId }),
    });
  },
  async deletePost(classroomId, postId) {
    await rawVoid(`/classrooms/${encodeURIComponent(classroomId)}/posts/${encodeURIComponent(postId)}`, {
      method: "DELETE",
    });
  },
  async listChats() {
    return raw<SoloChat[]>("/solo/chats");
  },
  async getChat(chatId) {
    return raw<SoloChat>(`/solo/chats/${encodeURIComponent(chatId)}`);
  },
  async createChat(title) {
    return raw<SoloChat>("/solo/chats", { method: "POST", json: { title: title.slice(0, 120) } });
  },
  async renameChat(chatId, title) {
    return raw<SoloChat>(`/solo/chats/${encodeURIComponent(chatId)}`, {
      method: "PATCH",
      json: { title: title.slice(0, 120) },
    });
  },
  async deleteChat(chatId) {
    await rawVoid(`/solo/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" });
  },
  async joinByCode(code) {
    return unwrap(await client.join[":code"].$get({ param: { code } }));
  },
  async joinAsGuest(code, name) {
    const payload = unwrap(await client.join.$post({ json: JoinInputSchema.parse({ code, name, tosAccepted: true }) }));
    const data = await payload;
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
  async createClassroom(input = {}) {
    return raw<ClassroomCreated>("/classrooms", { method: "POST", json: ClassroomCreateInputSchema.parse(input) });
  },
  async renameClassroom(classroomId, name) {
    return raw<{ id: string; name: string }>(`/classrooms/${encodeURIComponent(classroomId)}`, {
      method: "PATCH",
      json: { name },
    });
  },
  async listClassrooms() {
    return unwrap(await client.classrooms.$get());
  },
  async startActivity(classroomId, topicId) {
    const input = ActivityStartInputSchema.parse({ topicId });
    return raw<ClassroomCreated>(`/classrooms/${classroomId}/activities`, { method: "POST", json: input });
  },
  async previewAsStudent(classroomId) {
    const data = await raw<{ user: User; activityId: string }>(`/classrooms/${classroomId}/preview`, {
      method: "POST",
    });
    persistActivityId(data.activityId);
    return data;
  },
  async resetPreview() {
    const data = await raw<{ user: User; activityId: string }>("/preview/reset", { method: "POST" });
    persistActivityId(data.activityId);
    return data;
  },
  async exitPreview() {
    return raw<User>("/preview/exit", { method: "POST" });
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
  async activityInfo(activityId) {
    return unwrap(await client.activities[":id"].$get({ param: { id: activityId } }));
  },
  async finishActivity(activityId) {
    await unwrap(await client.activities[":id"].finish.$post({ param: { id: activityId } }));
  },
  async report(activityId) {
    return unwrap(await client.activities[":id"].report.$get({ param: { id: activityId } }));
  },
  async askAssistant(messages) {
    return raw<{ markdown: string }>("/assistant", { method: "POST", json: { messages } });
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
  async putTeacherKey(provider, model, key) {
    return raw<{ provider: string; model: string; last4: string }>(`/settings/keys/${encodeURIComponent(provider)}`, {
      method: "PUT",
      json: { provider, model, key },
    });
  },
  async deleteTeacherKey(provider) {
    await unwrap(await client.settings.keys[":provider"].$delete({ param: { provider } }));
  },
  async orderTeacherKeys(providers) {
    await unwrap(await client.settings.keys.order.$put({ json: { providers } }));
  },
};

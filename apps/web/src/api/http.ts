import { hc } from "hono/client";
import type {
  ActivityInfo,
  ClassroomCreated,
  ClassroomSummary,
  JoinInfo,
  Report,
  StudentLive,
  TermExplanation,
  Topic,
  User,
} from "@socrates/shared";
import {
  ActivityStartInputSchema,
  ClassroomCreateInputSchema,
  JoinInputSchema,
  LoginInputSchema,
  LookupInputSchema,
  TtsInputSchema,
  TopicCreateInputSchema,
  GenerateTopicsInputSchema,
  type ErrorCode,
} from "@socrates/shared";
import type { RpcApi } from "@server/app";
import { persistActivityId, recordTerm } from "./local";

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type ByokStatus = { provider: string; last4: string } | null;

export interface Api {
  me(): Promise<User | null>;
  login(email: string, password: string): Promise<User>;
  logout(): Promise<void>;
  joinByCode(code: string): Promise<JoinInfo>;
  joinAsGuest(code: string, name: string): Promise<{ user: User; activityId: string }>;
  listTopics(): Promise<Topic[]>;
  generateTopics(direction: string): Promise<Topic[]>;
  createClassroom(name: string, topicId: string): Promise<ClassroomCreated>;
  listClassrooms(): Promise<ClassroomSummary[]>;
  startActivity(classroomId: string, topicId: string): Promise<ClassroomCreated>;
  liveStudents(activityId: string): Promise<StudentLive[]>;
  stt(audio: Blob): Promise<string>;
  tts(text: string, onAmplitude: (value: number) => void, signal?: AbortSignal): Promise<void>;
  createTopic(input: { title: string; statement: string; summary?: string; prompts: string[] }): Promise<Topic>;
  activityInfo(activityId: string): Promise<ActivityInfo>;
  finishActivity(activityId: string): Promise<void>;
  report(activityId: string): Promise<Report>;
  byokStatus(): Promise<ByokStatus>;
  byokSet(provider: string, key: string): Promise<ByokStatus>;
  byokClear(): Promise<ByokStatus>;
  lookupTerm(term: string): Promise<TermExplanation>;
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
    throw new ApiError((error?.code ?? "internal_error") as ErrorCode, error?.message ?? res.statusText);
  }
  return res.json() as Promise<Awaited<ReturnType<R["json"]>>>;
}

async function raw(path: string, init: RequestInit & { json?: unknown } = {}): Promise<Response> {
  const { json, ...rest } = init;
  return fetch(`/api${path}`, {
    credentials: "include",
    headers: {
      ...langHeaders(),
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    ...rest,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
}

async function playTts(text: string, onAmplitude: (value: number) => void, signal?: AbortSignal): Promise<void> {
  const input = TtsInputSchema.parse({ text, lang: langHeaders()["Accept-Language"] });
  const res = await client.tts.$post({ json: input }, { init: { signal } });
  if (!res.ok) throw new ApiError("internal_error" as ErrorCode, res.statusText);
  const bytes = await res.arrayBuffer();
  const AudioContextCtor =
    window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const context = new AudioContextCtor();
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
  async createClassroom(name, topicId) {
    const input = ClassroomCreateInputSchema.parse({ name, topicId });
    return unwrap(await client.classrooms.$post({ json: input }));
  },
  async listClassrooms() {
    return unwrap(await client.classrooms.$get());
  },
  async startActivity(classroomId, topicId) {
    const input = ActivityStartInputSchema.parse({ topicId });
    const res = await raw(`/classrooms/${classroomId}/activities`, { method: "POST", json: input });
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
      throw new ApiError((payload?.code ?? "internal_error") as ErrorCode, payload?.message ?? res.statusText);
    }
    return res.json();
  },
  async liveStudents(activityId) {
    const res = await raw(`/activities/${activityId}/live`);
    if (!res.ok) {
      const payload = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
      throw new ApiError((payload?.code ?? "internal_error") as ErrorCode, payload?.message ?? res.statusText);
    }
    return res.json();
  },
  async stt(audio) {
    const file = audio instanceof File ? audio : new File([audio], "speech.webm", { type: audio.type });
    const res = await client.stt.$post({ form: { audio: file } });
    if (!res.ok) throw new ApiError("internal_error" as ErrorCode, res.statusText);
    const payload = (await res.json()) as { text: string };
    return payload.text;
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
  async byokStatus() {
    return unwrap(await client.settings.byok.$get());
  },
  async byokSet(provider, key) {
    return unwrap(await client.settings.byok.$put({ json: { provider, key } }));
  },
  async byokClear() {
    await unwrap(await client.settings.byok.$delete());
    return null;
  },
  async lookupTerm(term) {
    const input = LookupInputSchema.parse({ term });
    const data = await unwrap(await client.lookup.$post({ json: input }));
    recordTerm(data.term);
    return data;
  },
};

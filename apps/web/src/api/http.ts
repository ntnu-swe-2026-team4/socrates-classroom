import { persistActivityId, recordTerm } from "./local";
import type {
  Api,
  ByokStatus,
  ClassroomCreated,
  DialogueMessage,
  JoinInfo,
  StudentLive,
  TermExplanation,
  Topic,
  User,
} from "./types";
import { ApiError } from "./types";
import type { ActivityInfo, Report } from "./types";
import type { ErrorCode } from "@socrates/shared";

const BASE = "/api";

function lang(): string {
  const tag = document.documentElement.lang || "zh-TW";
  if (tag.startsWith("en")) return "en";
  if (tag.startsWith("es")) return "es";
  return "zh";
}

async function call<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const { json, ...rest } = init;
  const res = await fetch(`${BASE}${path}`, {
    credentials: "include",
    headers: {
      "Accept-Language": lang(),
      ...(json !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(rest.headers ?? {}),
    },
    ...rest,
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  });
  if (res.status === 204) return undefined as T;
  const payload =
    res.status === 503 || res.headers.get("content-type")?.includes("audio")
      ? null
      : await res.json().catch(() => null);
  if (!res.ok) {
    const error = payload as { message?: string; code?: string } | null;
    throw new ApiError((error?.code ?? "internal_error") as ErrorCode, error?.message ?? res.statusText);
  }
  return payload as T;
}

async function sendDialogue(
  activityId: string,
  text: string,
  onDelta: (delta: string) => void,
  signal?: AbortSignal,
): Promise<DialogueMessage> {
  const res = await fetch(`${BASE}/activities/${activityId}/dialogue`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "Accept-Language": lang() },
    body: JSON.stringify({ text }),
    signal,
  });
  if (!res.ok || !res.body) {
    const payload = (await res.json().catch(() => null)) as { message?: string; code?: string } | null;
    throw new ApiError((payload?.code ?? "internal_error") as ErrorCode, payload?.message ?? res.statusText);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done: DialogueMessage | null = null;

  const handleFrame = (frame: string) => {
    const event = frame
      .split("\n")
      .find((line) => line.startsWith("event: "))
      ?.slice(7);
    const dataLine = frame.split("\n").find((line) => line.startsWith("data: "));
    if (!event || !dataLine) return;
    if (event === "delta") {
      onDelta((JSON.parse(dataLine.slice(6)) as { text: string }).text);
    } else if (event === "done") {
      done = (JSON.parse(dataLine.slice(6)) as { message: DialogueMessage }).message;
    } else if (event === "error") {
      const error = JSON.parse(dataLine.slice(6)) as { message: string; code: string };
      throw new ApiError(error.code as ErrorCode, error.message);
    }
  };

  while (true) {
    const { done: streamDone, value } = await reader.read();
    if (streamDone) break;
    buffer += decoder.decode(value, { stream: true });
    let separator = buffer.indexOf("\n\n");
    while (separator !== -1) {
      const frame = buffer.slice(0, separator);
      buffer = buffer.slice(separator + 2);
      handleFrame(frame);
      separator = buffer.indexOf("\n\n");
    }
  }
  if (buffer.trim()) handleFrame(buffer);
  if (!done) throw new ApiError("llm_unavailable" as ErrorCode, "stream_closed");
  return done;
}

async function playTts(text: string, onAmplitude: (value: number) => void, signal?: AbortSignal): Promise<void> {
  const res = await fetch(`${BASE}/tts`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", "Accept-Language": lang() },
    body: JSON.stringify({ text, lang: lang() }),
    signal,
  });
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
  me: () => call<User | null>("/me"),
  login: (email, password) => call<User>("/auth/login", { method: "POST", json: { email, password } }),
  logout: () => call<void>("/auth/logout", { method: "POST" }),
  joinByCode: (code) => call<JoinInfo>(`/join/${encodeURIComponent(code)}`),
  async joinAsGuest(code, name) {
    const payload = await call<{ user: User; activityId: string }>("/join", {
      method: "POST",
      json: { code, name, tosAccepted: true },
    });
    persistActivityId(payload.activityId);
    return payload;
  },
  listTopics: () => call<Topic[]>("/topics"),
  generateTopics: (direction) => call<Topic[]>("/topics/generate", { method: "POST", json: { direction } }),
  createTopic: (input) => call<Topic>("/topics", { method: "POST", json: input }),
  createClassroom: (name, topicId) =>
    call<ClassroomCreated>("/classrooms", { method: "POST", json: { name, topicId } }),
  liveStudents: (activityId) => call<StudentLive[]>(`/activities/${activityId}/live`),
  dialogueHistory: (activityId) => call<DialogueMessage[]>(`/activities/${activityId}/dialogue`),
  sendDialogue,
  async stt(audio: Blob) {
    const form = new FormData();
    form.append("audio", audio, "speech.webm");
    const payload = await call<{ text: string }>("/stt", { method: "POST", body: form });
    return payload.text;
  },
  tts: playTts,
  activityInfo: (activityId) => call<ActivityInfo>(`/activities/${activityId}`),
  finishActivity: (activityId) => call<void>(`/activities/${activityId}/finish`, { method: "POST" }),
  report: (activityId) => call<Report>(`/activities/${activityId}/report`),
  byokStatus: () => call<ByokStatus>("/settings/byok"),
  byokSet: (provider, key) => call<ByokStatus>("/settings/byok", { method: "PUT", json: { provider, key } }),
  async byokClear() {
    await call<void>("/settings/byok", { method: "DELETE" });
    return null;
  },
  lookupTerm: async (term) => {
    const explanation = await call<TermExplanation>("/lookup", { method: "POST", json: { term } });
    recordTerm(explanation.term);
    return explanation;
  },
};

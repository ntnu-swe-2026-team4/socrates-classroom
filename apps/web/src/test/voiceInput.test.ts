import { beforeEach, expect, test, vi } from "vitest";
import type { Mock } from "vitest";
import {
  VoiceInputController,
  type MediaStreamLike,
  type SpeechRecognitionLike,
  type VoiceEnv,
} from "@/lib/voiceInput";

class FakeRecognition implements SpeechRecognitionLike {
  lang = "";
  continuous = false;
  interimResults = false;
  started = false;
  stopped = false;
  onresult: SpeechRecognitionLike["onresult"] = null;
  onerror: ((event: { error?: string }) => void) | null = null;
  onend: (() => void) | null = null;
  start() {
    this.started = true;
  }
  stop() {
    this.stopped = true;
  }
}

class FakeRecorder {
  state = "inactive";
  silent = false;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    if (this.state !== "recording") return;
    this.state = "inactive";
    if (this.silent) return;
    void Promise.resolve().then(() => {
      this.ondataavailable?.({ data: new Blob(["FINAL"], { type: "audio/webm" }) });
      this.onstop?.();
    });
  }
}

class FakeAudioContext {
  close = vi.fn(async () => {});
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
  createAnalyser() {
    return {
      fftSize: 512,
      frequencyBinCount: 256,
      getByteTimeDomainData(data: Uint8Array) {
        data.fill(128);
      },
    };
  }
}

function makeStream(trackStop: ReturnType<typeof vi.fn> = vi.fn()): MediaStreamLike {
  return { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStreamLike;
}

function makeEnv(overrides: Partial<VoiceEnv> = {}): VoiceEnv {
  return {
    getUserMedia: vi.fn(async () => makeStream()),
    createAudioContext: vi.fn(() => new FakeAudioContext()),
    recognitionCtor: vi.fn(() => null),
    createRecorder: vi.fn(() => new FakeRecorder()),
    raf: vi.fn(() => 1),
    cancelRaf: vi.fn(),
    lang: vi.fn(() => "zh-Hant"),
    stt: vi.fn(async () => "Final transcript"),
    ...overrides,
  };
}

function makeRecognitionCtor(): { recognition: FakeRecognition; recognitionCtor: VoiceEnv["recognitionCtor"] } {
  const recognition = new FakeRecognition();
  const recognitionCtor = vi.fn(
    () =>
      new Proxy(FakeRecognition, {
        construct: () => recognition,
      }) as unknown as new () => FakeRecognition,
  );
  return { recognition, recognitionCtor };
}

interface Harness {
  controller: VoiceInputController;
  env: VoiceEnv;
  onFinal: ReturnType<typeof vi.fn>;
  onAmplitude: ReturnType<typeof vi.fn>;
  states: string[];
  interims: string[];
  errors: Array<string | null>;
}

function mountController(overrides: Partial<VoiceEnv> = {}): Harness {
  const env = makeEnv(overrides);
  const onFinal = vi.fn();
  const onAmplitude = vi.fn();
  const states: string[] = [];
  const interims: string[] = [];
  const errors: Array<string | null> = [];
  const controller = new VoiceInputController(env, {
    onFinal,
    onAmplitude,
    onState: (state) => states.push(state),
    onInterim: (text) => interims.push(text),
    onError: (error) => errors.push(error),
  });
  return { controller, env, onFinal, onAmplitude, states, interims, errors };
}

function recorderOf(harness: Harness): FakeRecorder {
  return (harness.env.createRecorder as Mock).mock.results[0].value as FakeRecorder;
}

function recognitionResult(
  final: string,
  interim: string,
): Parameters<NonNullable<SpeechRecognitionLike["onresult"]>>[0] {
  const results = [
    { 0: { transcript: final }, isFinal: true, length: 1 },
    { 0: { transcript: interim }, isFinal: false, length: 1 },
  ];
  return { resultIndex: 0, results } as unknown as Parameters<NonNullable<SpeechRecognitionLike["onresult"]>>[0];
}

beforeEach(() => {
  vi.useRealTimers();
});

test("no getUserMedia in the environment reports unsupported and stays idle", async () => {
  const h = mountController({ getUserMedia: vi.fn((): Promise<MediaStreamLike> | null => null) });
  await h.controller.start();
  expect(h.errors).toEqual(["unsupported"]);
  expect(h.states).toEqual(["listening", "idle"]);
  expect(h.env.createAudioContext).not.toHaveBeenCalled();
});

test("no recognition ctor and no recorder reports unsupported and releases the stream", async () => {
  const trackStop = vi.fn();
  const h = mountController({
    getUserMedia: vi.fn(async () => makeStream(trackStop)),
    createRecorder: vi.fn(() => null),
  });
  await h.controller.start();
  expect(h.errors).toEqual(["unsupported"]);
  expect(h.states.at(-1)).toBe("idle");
  expect(trackStop).toHaveBeenCalled();
});

test("a NotAllowedError from getUserMedia maps to denied", async () => {
  const h = mountController({
    getUserMedia: vi.fn(async () => {
      throw new DOMException("denied by user", "NotAllowedError");
    }),
  });
  await h.controller.start();
  expect(h.errors).toEqual(["denied"]);
  expect(h.states.at(-1)).toBe("idle");
});

test("other getUserMedia failures map to failed", async () => {
  const h = mountController({
    getUserMedia: vi.fn(async () => {
      throw new Error("boom");
    }),
  });
  await h.controller.start();
  expect(h.errors).toEqual(["failed"]);
});

test("stopping while the permission prompt is pending releases the stream and stays idle", async () => {
  let releaseStream: (stream: MediaStreamLike) => void = () => {};
  const gate = new Promise<MediaStreamLike>((resolve) => {
    releaseStream = resolve;
  });
  const trackStop = vi.fn();
  const h = mountController({ getUserMedia: vi.fn(() => gate) });
  const starting = h.controller.start();
  await h.controller.stop();
  releaseStream(makeStream(trackStop));
  await starting;
  expect(h.states).toEqual(["listening", "idle"]);
  expect(trackStop).toHaveBeenCalled();
  expect(h.env.createAudioContext).not.toHaveBeenCalled();
});

test("a second start while the first is still pending is ignored", async () => {
  let releaseStream: (stream: MediaStreamLike) => void = () => {};
  const gate = new Promise<MediaStreamLike>((resolve) => {
    releaseStream = resolve;
  });
  const h = mountController({ getUserMedia: vi.fn(() => gate) });
  const first = h.controller.start();
  const second = h.controller.start();
  releaseStream(makeStream());
  await first;
  await second;
  expect(h.env.createAudioContext).toHaveBeenCalledTimes(1);
  expect(h.env.createRecorder).toHaveBeenCalledTimes(1);
});

test("native recognition accumulates final and interim text and delivers it on stop without stt", async () => {
  const { recognition, recognitionCtor } = makeRecognitionCtor();
  const h = mountController({ recognitionCtor });
  await h.controller.start();
  expect(recognition.started).toBe(true);
  expect(recognition.lang).toBe("zh-Hant");
  expect(recognition.continuous).toBe(true);
  expect(recognition.interimResults).toBe(true);

  recognition.onresult?.(recognitionResult("你好", "世界"));
  expect(h.interims.at(-1)).toBe("你好世界");

  await h.controller.stop();
  expect(h.onFinal).toHaveBeenCalledWith("你好世界");
  expect(h.env.stt).not.toHaveBeenCalled();
  expect(recognition.stopped).toBe(true);
  expect(h.states).toEqual(["listening", "processing", "idle"]);
});

test("aborted and no-speech recognition errors are ignored and the session continues", async () => {
  const { recognition, recognitionCtor } = makeRecognitionCtor();
  const h = mountController({ recognitionCtor });
  await h.controller.start();
  recognition.onerror?.({ error: "aborted" });
  recognition.onerror?.({ error: "no-speech" });
  expect(h.errors).toEqual([]);
  expect(h.states.at(-1)).toBe("listening");
  expect(recognition.stopped).toBe(false);
});

test("not-allowed recognition errors map to denied and tear the session down", async () => {
  const trackStop = vi.fn();
  const { recognition, recognitionCtor } = makeRecognitionCtor();
  const h = mountController({
    getUserMedia: vi.fn(async () => makeStream(trackStop)),
    recognitionCtor,
  });
  await h.controller.start();
  recognition.onerror?.({ error: "not-allowed" });
  expect(h.errors).toEqual(["denied"]);
  expect(h.states.at(-1)).toBe("idle");
  expect(recognition.stopped).toBe(true);
  expect(trackStop).toHaveBeenCalled();
});

test("other recognition errors map to failed", async () => {
  const { recognition, recognitionCtor } = makeRecognitionCtor();
  const h = mountController({ recognitionCtor });
  await h.controller.start();
  recognition.onerror?.({ error: "network" });
  expect(h.errors).toEqual(["failed"]);
  expect(h.states.at(-1)).toBe("idle");
});

test("recognition ending on its own runs the stop flow and delivers the captured text", async () => {
  const { recognition, recognitionCtor } = makeRecognitionCtor();
  const h = mountController({ recognitionCtor });
  await h.controller.start();
  recognition.onresult?.(recognitionResult("答完", ""));
  recognition.onend?.();
  await vi.waitFor(() => expect(h.states.at(-1)).toBe("idle"));
  expect(h.onFinal).toHaveBeenCalledWith("答完");
  expect(h.env.stt).not.toHaveBeenCalled();
});

test("the fallback path collects recorder chunks and uploads them through stt exactly once", async () => {
  const h = mountController();
  await h.controller.start();
  const recorder = recorderOf(h);
  expect(recorder.state).toBe("recording");
  recorder.ondataavailable?.({ data: new Blob(["A"], { type: "audio/webm" }) });
  await h.controller.stop();
  expect(h.env.stt).toHaveBeenCalledTimes(1);
  const blob = (h.env.stt as Mock).mock.calls[0][0] as Blob;
  expect(blob.type).toBe("audio/webm");
  expect(h.onFinal).toHaveBeenCalledWith("Final transcript");
  expect(h.states).toEqual(["listening", "processing", "idle"]);
});

test("a recorder whose onstop never fires still resolves through the timeout insurance", async () => {
  vi.useFakeTimers();
  try {
    const h = mountController({ createRecorder: vi.fn(() => new FakeRecorder()) });
    await h.controller.start();
    const recorder = recorderOf(h);
    recorder.silent = true;
    recorder.ondataavailable?.({ data: new Blob(["A"], { type: "audio/webm" }) });
    const stopping = h.controller.stop();
    await vi.advanceTimersByTimeAsync(1000);
    await stopping;
    expect(h.env.stt).toHaveBeenCalledTimes(1);
    expect(h.onFinal).toHaveBeenCalledWith("Final transcript");
  } finally {
    vi.useRealTimers();
  }
});

test("an stt failure maps to failed and delivers nothing", async () => {
  const h = mountController({
    stt: vi.fn(async () => {
      throw new Error("boom");
    }),
  });
  await h.controller.start();
  recorderOf(h).ondataavailable?.({ data: new Blob(["A"], { type: "audio/webm" }) });
  await h.controller.stop();
  expect(h.errors).toEqual(["failed"]);
  expect(h.onFinal).not.toHaveBeenCalled();
  expect(h.states.at(-1)).toBe("idle");
});

test("the 60-second timer stops a running session automatically", async () => {
  vi.useFakeTimers();
  try {
    const h = mountController();
    await h.controller.start();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(h.onFinal).toHaveBeenCalledWith("Final transcript");
    expect(h.states.at(-1)).toBe("idle");
  } finally {
    vi.useRealTimers();
  }
});

test("dispose stops the session, releases the mic, and zeroes the amplitude", async () => {
  const trackStop = vi.fn();
  const { recognition, recognitionCtor } = makeRecognitionCtor();
  const h = mountController({
    getUserMedia: vi.fn(async () => makeStream(trackStop)),
    recognitionCtor,
  });
  await h.controller.start();
  h.controller.dispose();
  expect(recognition.stopped).toBe(true);
  expect(trackStop).toHaveBeenCalled();
  expect(h.env.cancelRaf).toHaveBeenCalled();
  expect(h.onAmplitude).toHaveBeenLastCalledWith(0);
});

test("a normal fallback stop leaves no pending timer behind", async () => {
  vi.useFakeTimers();
  try {
    const h = mountController();
    await h.controller.start();
    recorderOf(h).ondataavailable?.({ data: new Blob(["A"], { type: "audio/webm" }) });
    await h.controller.stop();
    expect(h.onFinal).toHaveBeenCalledWith("Final transcript");
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

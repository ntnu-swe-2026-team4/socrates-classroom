import { afterEach, expect, test, vi } from "vitest";
import { httpApi } from "@/api/http";

afterEach(() => {
  vi.unstubAllGlobals();
});

const BUFFER: AudioBuffer = {
  get duration() {
    return 0;
  },
  get length() {
    return 0;
  },
  get numberOfChannels() {
    return 0;
  },
  get sampleRate() {
    return 0;
  },
  getChannelData: () => new Float32Array(0),
  copyFromChannel: () => {},
  copyToChannel: () => {},
};

function stubAudio(options: { decode?: () => Promise<AudioBuffer>; state?: AudioContextState; endOnStart?: boolean }) {
  const gain = { gain: { value: 1 }, connect() {} };
  const source: {
    buffer: AudioBuffer | null;
    onended: (() => void) | null;
    connect(): void;
    stop: () => void;
    start: () => void;
  } = {
    buffer: null,
    onended: null,
    connect() {},
    stop: vi.fn(),
    start: vi.fn(() => {
      if (options.endOnStart) void Promise.resolve().then(() => source.onended?.());
    }),
  };
  const decode = vi.fn(options.decode ?? (() => Promise.resolve(BUFFER)));
  const close = vi.fn().mockResolvedValue(undefined);
  const resume = vi.fn().mockResolvedValue(undefined);
  class AudioContextDouble {
    destination = {};
    state = options.state ?? "running";
    createBufferSource() {
      return source;
    }
    decodeAudioData = decode;
    createAnalyser() {
      return { connect() {}, frequencyBinCount: 2, getByteTimeDomainData() {} };
    }
    createGain() {
      return gain;
    }
    resume = resume;
    close = close;
  }
  vi.stubGlobal("AudioContext", AudioContextDouble);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]))));
  return { source, gain, decode, close };
}

test("F07: interrupt during decode never starts late audio playback", async () => {
  let decoded!: (value: AudioBuffer) => void;
  const pendingDecode = new Promise<AudioBuffer>((resolve) => {
    decoded = resolve;
  });
  const audio = stubAudio({ decode: () => pendingDecode, endOnStart: true });
  const controller = new AbortController();
  const settled = httpApi.tts("A reply", () => {}, controller.signal).catch((error: unknown) => error);
  await vi.waitFor(() => expect(audio.decode).toHaveBeenCalledTimes(1));
  controller.abort();
  decoded(BUFFER);
  const outcome = await settled;
  if (outcome !== undefined) expect(outcome).toMatchObject({ name: "AbortError" });
  expect(audio.source.start).not.toHaveBeenCalled();
});

test("interrupt during playback settles the request and releases the audio context (#479)", async () => {
  const audio = stubAudio({});
  const controller = new AbortController();
  const onStart = vi.fn();
  const settled = httpApi
    .tts("A reply", () => {}, controller.signal, { onStart })
    .then(() => "ended")
    .catch((error: unknown) => (error instanceof DOMException ? error.name : "failed"));
  await vi.waitFor(() => expect(onStart).toHaveBeenCalledTimes(1));
  controller.abort();
  expect(await settled).toBe("AbortError");
  expect(audio.source.stop).toHaveBeenCalledTimes(1);
  expect(audio.close).toHaveBeenCalledTimes(1);
});

test("reports the start only once audio plays and applies the chosen volume (#480, #481)", async () => {
  const audio = stubAudio({ endOnStart: true });
  const onStart = vi.fn(() => expect(audio.source.start).toHaveBeenCalledTimes(1));
  await httpApi.tts("A reply", () => {}, undefined, { volume: 0.3, onStart });
  expect(onStart).toHaveBeenCalledTimes(1);
  expect(audio.gain.gain.value).toBe(0.3);
});

test("fails instead of hanging when the browser keeps the audio context suspended (#479)", async () => {
  vi.useFakeTimers();
  try {
    const audio = stubAudio({ state: "suspended" });
    const onStart = vi.fn();
    const settled = httpApi.tts("A reply", () => {}, undefined, { onStart }).catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    expect(await settled).toBeInstanceOf(Error);
    expect(onStart).not.toHaveBeenCalled();
    expect(audio.source.start).not.toHaveBeenCalled();
    expect(audio.close).toHaveBeenCalledTimes(1);
  } finally {
    vi.useRealTimers();
  }
});

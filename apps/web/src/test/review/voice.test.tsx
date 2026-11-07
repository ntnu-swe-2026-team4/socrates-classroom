import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useVoiceInput } from "@/hooks/useVoiceInput";

const calls = vi.hoisted(() => ({ stt: vi.fn<(audio: Blob) => Promise<string>>() }));
vi.mock("@/api", () => ({ api: { stt: calls.stt } }));

class Recorder {
  static latest: Recorder;
  state = "inactive";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  constructor() {
    Recorder.latest = this;
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    void Promise.resolve().then(() => {
      this.ondataavailable?.({ data: new Blob(["FINAL"], { type: "audio/webm" }) });
      this.onstop?.();
    });
  }
}

class AudioContextDouble {
  close = vi.fn().mockResolvedValue(undefined);
  createMediaStreamSource() {
    return { connect() {} };
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

let trackStop: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn<() => Promise<MediaStream>>>;
let mediaDevicesDescriptor: PropertyDescriptor | undefined;
function stream(): MediaStream {
  return { getTracks: () => [{ stop: trackStop }] } as unknown as MediaStream;
}

beforeEach(() => {
  vi.useFakeTimers();
  mediaDevicesDescriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  trackStop = vi.fn();
  getUserMedia = vi.fn<() => Promise<MediaStream>>().mockResolvedValue(stream());
  Object.defineProperty(navigator, "mediaDevices", { value: { getUserMedia }, configurable: true });
  vi.stubGlobal("AudioContext", AudioContextDouble);
  vi.stubGlobal("MediaRecorder", Recorder);
  vi.stubGlobal("SpeechRecognition", undefined);
  vi.stubGlobal("webkitSpeechRecognition", undefined);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  calls.stt.mockReset();
  calls.stt.mockResolvedValue("Final transcript");
});

afterEach(() => {
  cleanup();
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (mediaDevicesDescriptor) Object.defineProperty(navigator, "mediaDevices", mediaDevicesDescriptor);
  else Reflect.deleteProperty(navigator, "mediaDevices");
});

test("F04: a short recording uploads the final asynchronous chunk exactly once", async () => {
  const onFinal = vi.fn();
  const { result } = renderHook(() => useVoiceInput(onFinal, vi.fn()));
  await act(async () => {
    await result.current.start();
  });
  await act(async () => {
    await result.current.stop();
  });
  expect(calls.stt).toHaveBeenCalledTimes(1);
  expect(calls.stt.mock.calls[0]?.[0].size).toBe(5);
  expect(onFinal).toHaveBeenCalledExactlyOnceWith("Final transcript");
});

test("F04: an existing chunk does not hide the final recording bytes", async () => {
  const { result } = renderHook(() => useVoiceInput(vi.fn(), vi.fn()));
  await act(async () => {
    await result.current.start();
  });
  Recorder.latest.ondataavailable?.({ data: new Blob(["EARLY"], { type: "audio/webm" }) });
  await act(async () => {
    await result.current.stop();
  });
  expect(calls.stt).toHaveBeenCalledTimes(1);
  expect(calls.stt.mock.calls[0]?.[0].size).toBe(10);
});

test("F05: permission granted after unmount immediately stops the late stream", async () => {
  let resolve!: (value: MediaStream) => void;
  getUserMedia.mockReturnValue(
    new Promise<MediaStream>((done) => {
      resolve = done;
    }),
  );
  const { result, unmount } = renderHook(() => useVoiceInput(vi.fn(), vi.fn()));
  let pending!: Promise<void>;
  await act(async () => {
    pending = result.current.start();
  });
  unmount();
  await act(async () => {
    resolve(stream());
    await pending;
  });
  expect(trackStop).toHaveBeenCalledTimes(1);
});

test("control: unmount stops an already established microphone session", async () => {
  const { result, unmount } = renderHook(() => useVoiceInput(vi.fn(), vi.fn()));
  await act(async () => {
    await result.current.start();
  });
  unmount();
  expect(trackStop).toHaveBeenCalledTimes(1);
  expect(calls.stt).not.toHaveBeenCalled();
});

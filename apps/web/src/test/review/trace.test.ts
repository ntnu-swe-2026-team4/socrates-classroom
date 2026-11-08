import { act, renderHook } from "@testing-library/react";
import { expect, test, vi } from "vitest";
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
      getByteTimeDomainData(d: Uint8Array) {
        d.fill(128);
      },
    };
  }
}

test("trace", async () => {
  vi.useFakeTimers();
  const trackStop = vi.fn();
  Object.defineProperty(navigator, "mediaDevices", {
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] }) },
    configurable: true,
  });
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

  const onFinal = vi.fn();
  const { result } = renderHook(() => useVoiceInput(onFinal, vi.fn()));
  await act(async () => {
    await result.current.start();
  });
  await act(async () => {
    await result.current.stop();
  });
  await act(async () => {
    await vi.runAllTimersAsync();
  });
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  console.log(
    "TRACE: state=",
    result.current.state,
    "chunks flow done, stt calls=",
    calls.stt.mock.calls.length,
    "recorder latest ondataavailable set?",
    Recorder.latest.ondataavailable !== null,
    "recorder.onstop set?",
    Recorder.latest.onstop !== null,
  );
  expect(true).toBe(true);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

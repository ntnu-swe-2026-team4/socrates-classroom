import { afterEach, expect, test, vi } from "vitest";
import { httpApi } from "@/api/http";

afterEach(() => {
  vi.unstubAllGlobals();
});

test("F07: interrupt during decode never starts late audio playback", async () => {
  let decoded!: (value: object) => void;
  const pendingDecode = new Promise<object>((resolve) => {
    decoded = resolve;
  });
  const decode = vi.fn(() => pendingDecode);
  const source = {
    buffer: null as object | null,
    onended: null as (() => void) | null,
    connect() {},
    stop() {},
    start: vi.fn(() => {
      void Promise.resolve().then(() => source.onended?.());
    }),
  };
  class AudioContextDouble {
    destination = {};
    createBufferSource() {
      return source;
    }
    decodeAudioData = decode;
    createAnalyser() {
      return { connect() {}, frequencyBinCount: 2, getByteTimeDomainData() {} };
    }
    close = vi.fn().mockResolvedValue(undefined);
  }
  vi.stubGlobal("AudioContext", AudioContextDouble);
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2]))));
  const controller = new AbortController();
  const settled = httpApi.tts("A reply", () => {}, controller.signal).catch((error: unknown) => error);
  await vi.waitFor(() => expect(decode).toHaveBeenCalledTimes(1));
  controller.abort();
  decoded({});
  const outcome = await settled;
  if (outcome !== undefined) expect(outcome).toMatchObject({ name: "AbortError" });
  expect(source.start).not.toHaveBeenCalled();
});

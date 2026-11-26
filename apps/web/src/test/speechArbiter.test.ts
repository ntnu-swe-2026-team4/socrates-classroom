import { describe, expect, it } from "vitest";
import type { SpeechSource } from "@/lib/companion";
import { must } from "./helpers";
import { SpeechArbiter, type SpeechEnv } from "@/lib/speechArbiter";

function fakeEnv(options: { maxChars?: number; settle?: boolean; hang?: boolean } = {}) {
  const requests: {
    text: string;
    signal: AbortSignal;
    start: () => void;
    amplitude: (value: number) => void;
  }[] = [];
  const amplitudes: number[] = [];
  let playing = 0;
  const sources: (SpeechSource | null)[] = [];
  let announced = 0;
  let mute = false;
  let listener: (() => void) | null = null;
  const env: SpeechEnv = {
    request: (text, amplitude, signal, start) => {
      requests.push({ text, signal, start, amplitude });
      if (options.settle) return Promise.resolve();
      if (options.hang) return new Promise<void>(() => {});
      return new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve()));
    },
    muted: () => mute,
    setSpeakingSource: (source) => sources.push(source),
    setPlaying: () => {
      playing += 1;
    },
    setAmplitude: (value) => amplitudes.push(value),
    announce: () => {
      announced += 1;
    },
    onRemoteAnnounce: (next) => {
      listener = next;
      return () => {
        listener = null;
      };
    },
    maxChars: () => options.maxChars ?? 100,
  };
  return {
    env,
    requests,
    sources,
    amplitudes,
    playing: () => playing,
    announced: () => announced,
    setMuted: (value: boolean) => {
      mute = value;
    },
    remoteStart: () => listener?.(),
    hasListener: () => listener !== null,
  };
}

describe("SpeechArbiter (injected environment)", () => {
  it("keeps each instance's bookkeeping to itself", async () => {
    const first = fakeEnv();
    const second = fakeEnv();
    const a = new SpeechArbiter(first.env);
    const b = new SpeechArbiter(second.env);

    const playing = a.speak("dialogue", "第一邊在講話");
    void b.speak("assistant", "第二邊朗讀", { userInitiated: true });

    expect(must(first.requests[0], "first request").signal.aborted).toBe(false);
    expect(first.sources).toEqual(["dialogue"]);
    expect(second.sources).toEqual(["assistant"]);
    expect(first.announced()).toBe(1);
    expect(second.announced()).toBe(1);

    a.stop();
    expect(await playing).toBe("interrupted");
    expect(first.sources).toEqual(["dialogue", null]);
    expect(second.sources).toEqual(["assistant"]);
  });

  it("lets a newer user intent outrank the older automatic reply", async () => {
    const fake = fakeEnv();
    const arbiter = new SpeechArbiter(fake.env);

    const auto = arbiter.speak("dialogue", "自動回覆");
    const replay = arbiter.speak("assistant", "使用者按了朗讀", { userInitiated: true });
    expect(await auto).toBe("interrupted");
    expect(await arbiter.speak("dialogue", "下一句自動回覆")).toBe("skipped");
    expect(fake.sources).toEqual(["dialogue", "assistant"]);

    arbiter.stop();
    expect(await replay).toBe("interrupted");
  });

  it("clears the speaking state on stop even when the transport never settles", () => {
    const fake = fakeEnv({ hang: true });
    const arbiter = new SpeechArbiter(fake.env);

    void arbiter.speak("dialogue", "播不出來的回覆");
    expect(fake.sources).toEqual(["dialogue"]);
    arbiter.stop();
    expect(fake.sources).toEqual(["dialogue", null]);
    expect(must(fake.requests[0], "request").signal.aborted).toBe(true);
  });

  it("reports playback and amplitude only for the reading that owns the channel", () => {
    const fake = fakeEnv();
    const arbiter = new SpeechArbiter(fake.env);

    void arbiter.speak("dialogue", "第一句");
    const first = must(fake.requests[0], "first request");
    expect(fake.playing()).toBe(0);
    first.start();
    first.amplitude(0.4);
    expect(fake.playing()).toBe(1);
    expect(fake.amplitudes).toEqual([0.4]);

    void arbiter.speak("dialogue", "第二句");
    first.start();
    first.amplitude(0.9);
    expect(fake.playing()).toBe(1);
    expect(fake.amplitudes).toEqual([0.4]);

    arbiter.stop();
    must(fake.requests[1], "second request").start();
    expect(fake.playing()).toBe(1);
  });

  it("stays silent while muted and never reaches the transport", async () => {
    const fake = fakeEnv();
    fake.setMuted(true);
    const arbiter = new SpeechArbiter(fake.env);

    expect(await arbiter.speak("dialogue", "不該出聲")).toBe("muted");
    expect(fake.requests).toHaveLength(0);
    expect(fake.sources).toEqual([]);
  });

  it("caps at the injected budget and cuts at a sentence end", async () => {
    const spaced = fakeEnv({ maxChars: 12, settle: true });
    await new SpeechArbiter(spaced.env).speak("dialogue", "第一句話比較長。 第二句話也很長。");
    expect(must(spaced.requests[0], "spaced request").text).toBe("第一句話比較長。");

    const tight = fakeEnv({ maxChars: 12, settle: true });
    await new SpeechArbiter(tight.env).speak("dialogue", "第一句話比較長。第二句話也很長。");
    const tightRequest = must(tight.requests[0], "tight request");
    expect(tightRequest.text).toBe("第一句話比較長。第二句話");
    expect(tightRequest.text.length).toBeLessThanOrEqual(12);
  });

  it("stops local playback when another tab starts, and dispose detaches the listener", async () => {
    const fake = fakeEnv();
    const arbiter = new SpeechArbiter(fake.env);
    expect(fake.hasListener()).toBe(true);

    const playing = arbiter.speak("dialogue", "本分頁正在講");
    fake.remoteStart();
    expect(await playing).toBe("interrupted");

    arbiter.dispose();
    expect(fake.hasListener()).toBe(false);
  });
});

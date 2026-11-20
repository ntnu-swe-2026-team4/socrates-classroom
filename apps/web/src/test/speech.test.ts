import { beforeEach, describe, expect, it, vi } from "vitest";

const tts = vi.hoisted(() => vi.fn());
vi.mock("@/api", () => ({ api: { tts: (...args: unknown[]) => tts(...args) } }));

import { TTS_MAX_CHARS } from "@socrates/shared";
import { companion, getCompanion } from "@/lib/companion";
import { speak, speakableText, stopSpeech } from "@/lib/speech";

function pendingTts() {
  tts.mockImplementation(
    (_text: string, _onAmplitude: unknown, signal: AbortSignal) =>
      new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve())),
  );
}

beforeEach(() => {
  tts.mockReset();
  stopSpeech();
  companion.setMuted(false);
});

describe("speech channel (one mouth, latest user intent wins)", () => {
  it("plays through tts and reports the speaking source while it lasts", async () => {
    pendingTts();
    const done = speak("dialogue", "你好");
    expect(getCompanion().speakingSource).toBe("dialogue");
    stopSpeech();
    expect(await done).toBe("interrupted");
    expect(getCompanion().speakingSource).toBeNull();
    expect(tts).toHaveBeenCalledWith("你好", expect.any(Function), expect.any(AbortSignal));
  });

  it("a user-initiated read-aloud interrupts the dialogue; the dialogue's next auto reply is skipped", async () => {
    pendingTts();
    const dialogue = speak("dialogue", "對話回覆");
    const assistant = speak("assistant", "朗讀內容", { userInitiated: true });
    expect(await dialogue).toBe("interrupted");
    expect(getCompanion().speakingSource).toBe("assistant");
    expect(await speak("dialogue", "背景回覆")).toBe("skipped");
    expect(getCompanion().speakingSource).toBe("assistant");
    stopSpeech();
    expect(await assistant).toBe("interrupted");
    expect(getCompanion().speakingSource).toBeNull();
  });

  it("a newer dialogue send outranks an older assistant read-aloud", async () => {
    pendingTts();
    const assistant = speak("assistant", "舊的朗讀", { userInitiated: true });
    const dialogue = speak("dialogue", "新的回答", { userInitiated: true });
    expect(await assistant).toBe("interrupted");
    expect(getCompanion().speakingSource).toBe("dialogue");
    stopSpeech();
    expect(await dialogue).toBe("interrupted");
  });

  it("stays silent when muted and rethrows real playback failures", async () => {
    companion.setMuted(true);
    expect(await speak("dialogue", "不該出聲")).toBe("muted");
    expect(tts).not.toHaveBeenCalled();
    companion.setMuted(false);
    tts.mockRejectedValue(new Error("decode failed"));
    await expect(speak("dialogue", "壞掉")).rejects.toThrow("decode failed");
    expect(getCompanion().speakingSource).toBeNull();
  });

  it("turns markdown into speakable text", () => {
    expect(speakableText("**光速**約每秒 [30 萬公里](https://x.y)\n- 真空中\n`code`")).toBe(
      "光速約每秒 30 萬公里 真空中 code",
    );
  });
});

describe("bounded read-aloud (unified char budget)", () => {
  it("caps read-aloud at the unified budget and cuts at a sentence end", async () => {
    tts.mockResolvedValue(undefined);
    await speak("dialogue", "答。".repeat(2100));
    const sent = tts.mock.calls[0]![0] as string;
    expect(sent.length).toBeLessThanOrEqual(TTS_MAX_CHARS);
    expect(sent.length).toBeGreaterThan(2000);
    expect(sent.endsWith("。")).toBe(true);
  });
});

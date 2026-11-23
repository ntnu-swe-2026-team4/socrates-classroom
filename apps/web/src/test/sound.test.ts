import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  UX_SOUND_STORAGE_KEY,
  fadeOutBgm,
  isUxSoundEnabled,
  playBgm,
  playNarration,
  playSound,
  startHoldSound,
  stopAllSounds,
} from "../lib/sound";

describe("UX sound engine", () => {
  beforeEach(() => {
    localStorage.clear();
    stopAllSounds();
    vi.restoreAllMocks();
  });

  it("defaults to muted when storage key is unset (#128)", () => {
    expect(isUxSoundEnabled()).toBe(false);
  });

  it("reads enabled state from localStorage", () => {
    localStorage.setItem(UX_SOUND_STORAGE_KEY, "1");
    expect(isUxSoundEnabled()).toBe(true);

    localStorage.setItem(UX_SOUND_STORAGE_KEY, "0");
    expect(isUxSoundEnabled()).toBe(false);
  });

  it("queues blocked autoplay narration and unlocks on first pointerdown", async () => {
    localStorage.setItem(UX_SOUND_STORAGE_KEY, "1");

    const playMock = vi.fn().mockRejectedValueOnce(new Error("NotAllowedError")).mockResolvedValue(undefined);

    vi.stubGlobal(
      "Audio",
      vi.fn(() => ({
        play: playMock,
        pause: vi.fn(),
        loop: false,
        volume: 1,
        currentTime: 0,
        paused: true,
      })),
    );

    playNarration("comic3");
    await Promise.resolve();

    window.dispatchEvent(new Event("pointerdown"));
    expect(playMock).toHaveBeenCalledTimes(2);
  });

  it("cleans up all active tracks via stopAllSounds without throwing", () => {
    localStorage.setItem(UX_SOUND_STORAGE_KEY, "1");

    expect(() => {
      playSound("click");
      playBgm(0.25);
      playNarration("comic1");
      startHoldSound("rockMove");
      fadeOutBgm(100);
      stopAllSounds();
    }).not.toThrow();
  });
});

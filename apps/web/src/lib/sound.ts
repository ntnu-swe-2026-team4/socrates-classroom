import { getCompanion } from "@/lib/companion";

export const SOUND_EFFECTS = {
  click: "/sounds/tap_01.mp3",
  tap2: "/sounds/tap_02.mp3",
  swipe: "/sounds/swipe_01.mp3",
  turnPage: "/sounds/turn_page.mp3",
  comic1: "/sounds/comic_1.mp3",
  //comic2: "/sounds/commic_2.mp3",
  comic3: "/sounds/comic_2_3.mp3",
  comic_band: "/sounds/comic_band.mp3",
  comic4: "/sounds/comic_4.mp3",
  comic5: "/sounds/comic_5.mp3",
  comic6: "/sounds/comic_6.mp3",
  bgm: "/sounds/sound_track_30s_1123.mp3",
  walk: "/sounds/walk.mp3",
  whispering: "/sounds/whispering.mp3",
  rockMove: "/sounds/rock_move.mp3",
} as const;

export type SoundName = keyof typeof SOUND_EFFECTS;

export const UX_SOUND_STORAGE_KEY = "socrates:ux-sound";

export function isUxSoundEnabled(): boolean {
  try {
    const value = localStorage.getItem(UX_SOUND_STORAGE_KEY);
    return value === null ? true : value === "1";
  } catch {
    return true;
  }
}

function canPlaySound(): boolean {
  return isUxSoundEnabled() && !getCompanion().muted;
}

const audioCache = new Map<SoundName, HTMLAudioElement>();

function getAudio(name: SoundName): HTMLAudioElement | null {
  if (typeof Audio === "undefined") return null;
  let audio = audioCache.get(name);
  if (!audio) {
    audio = new Audio(SOUND_EFFECTS[name]);
    audio.preload = "auto";
    audioCache.set(name, audio);
  }
  return audio;
}

export function playSound(name: SoundName, volume = 0.5): void {
  if (!canPlaySound()) return;

  const base = getAudio(name);
  if (!base) return;

  const instance = base.cloneNode() as HTMLAudioElement;
  instance.volume = Math.max(0, Math.min(1, volume));
  instance.play().catch((err) => {
    console.warn(`[sound] 無法播放 ${name}:`, err.message);
  });
}

// ==========================================
// 背景音樂（BGM）循環與淡出控制器
// ==========================================
let bgmAudio: HTMLAudioElement | null = null;
let bgmFadeRaf: number | null = null;
let pendingBgmVolume: number | null = null;

export function playBgm(volume = 0.25): void {
  if (!canPlaySound() || typeof Audio === "undefined") return;

  // 若正在淡出中，取消淡出並恢復音量
  if (bgmFadeRaf !== null) {
    cancelAnimationFrame(bgmFadeRaf);
    bgmFadeRaf = null;
  }

  if (!bgmAudio) {
    bgmAudio = new Audio(SOUND_EFFECTS.bgm);
    bgmAudio.loop = true;
  }

  bgmAudio.volume = Math.max(0, Math.min(1, volume));

  // 若已在播放中，確保音量正確即可，不重頭播放
  if (!bgmAudio.paused) return;

  bgmAudio
    .play()
    .then(() => {
      pendingBgmVolume = null;
    })
    .catch(() => {
      // 瀏覽器阻擋首次自動播放時，排入待補播佇列
      pendingBgmVolume = volume;
    });
}

export function fadeOutBgm(durationMs = 800): void {
  pendingBgmVolume = null;
  if (!bgmAudio) return;

  if (bgmFadeRaf !== null) {
    cancelAnimationFrame(bgmFadeRaf);
    bgmFadeRaf = null;
  }

  const audio = bgmAudio;
  const startVolume = audio.volume;
  const startTime = performance.now();

  const step = (now: number) => {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / durationMs, 1);
    audio.volume = Math.max(0, startVolume * (1 - progress));

    if (progress < 1) {
      bgmFadeRaf = requestAnimationFrame(step);
    } else {
      audio.pause();
      audio.currentTime = 0;
      bgmFadeRaf = null;
    }
  };

  bgmFadeRaf = requestAnimationFrame(step);
}

// ==========================================
// 故事旁白（Narration）單聲道控制器
// ==========================================
let currentNarration: HTMLAudioElement | null = null;
let currentAmbience: HTMLAudioElement | null = null;
let pendingNarration: { name: SoundName; volume: number } | null = null;

export function stopNarration(): void {
  pendingNarration = null;
  if (currentNarration) {
    currentNarration.pause();
    currentNarration.currentTime = 0;
    currentNarration = null;
  }
  if (currentAmbience) {
    currentAmbience.pause();
    currentAmbience.currentTime = 0;
    currentAmbience = null;
  }
}

export function playNarration(name: SoundName, volume = 0.85): void {
  stopNarration();
  if (!canPlaySound()) return;

  // 播放 comic1 時，同步啟動背景音樂循環 + 伴隨腳步聲
  if (name === "comic1") {
    playBgm(0.25);

    const walkAudio = new Audio(SOUND_EFFECTS.walk);
    walkAudio.loop = true; // ⬅️ 加上這行：在 comic_1 期間循環播放
    walkAudio.volume = 0.9;
    currentAmbience = walkAudio;
    walkAudio.play().catch(() => {
      // 若被瀏覽器阻擋，會在 unlock 補播 comic1 時一併重新啟動
    });
  }

  // 播放 comic5 時，同步循環播放人群耳語聲（到 comic_6 觸發 stopNarration 時自動停止）
  if (name === "comic5") {
    const whisperAudio = new Audio(SOUND_EFFECTS.whispering);
    whisperAudio.loop = true;
    whisperAudio.volume = 0.6; // 音量可依實際耳語聲大小調整（0 ~ 1）
    currentAmbience = whisperAudio;
    whisperAudio.play().catch(() => {
      // 若被瀏覽器阻擋，會在 unlock 補播 comic5 時一併重新啟動
    });
  }

  const src = SOUND_EFFECTS[name];
  if (!src) {
    console.warn(`[sound] 找不到音效設定: ${name}`);
    return;
  }

  const audio = new Audio(src);
  audio.volume = Math.max(0, Math.min(1, volume));
  currentNarration = audio;
  audio.play().catch(() => {
    // 若使用者還沒點擊頁面導致瀏覽器暫時阻擋自動播放，先記住這句旁白，等他一點擊畫面立刻補播！
    pendingNarration = { name, volume };
  });
}

// 使用者第一次點擊頁面時，自動補播剛才被瀏覽器擋住的旁白與背景音樂
if (typeof window !== "undefined") {
  const unlock = () => {
    if (pendingBgmVolume !== null) {
      const vol = pendingBgmVolume;
      pendingBgmVolume = null;
      playBgm(vol);
    }
    if (pendingNarration) {
      const { name, volume } = pendingNarration;
      pendingNarration = null;
      playNarration(name, volume);
    }
  };
  window.addEventListener("pointerdown", unlock, { passive: true });
  window.addEventListener("keydown", unlock, { passive: true });
}

// 在 sound.ts 裡加上按住循環音效控制：
let holdAudio: HTMLAudioElement | null = null;

export function startHoldSound(name: SoundName, volume = 0.65): void {
  if (!canPlaySound() || typeof Audio === "undefined") return;
  if (holdAudio && !holdAudio.paused) return;

  const src = SOUND_EFFECTS[name];
  if (!src) return;

  const audio = new Audio(src);
  audio.loop = true;
  audio.volume = Math.max(0, Math.min(1, volume));
  holdAudio = audio;
  audio.play().catch(() => {});
}

export function stopHoldSound(): void {
  if (holdAudio) {
    holdAudio.pause();
    holdAudio.currentTime = 0;
    holdAudio = null;
  }
}

export function stopAllSounds(): void {
  stopNarration(); // 同時停掉 currentNarration 與 currentAmbience（腳步聲、耳語聲）
  stopHoldSound(); // 停掉石像轉動聲
  fadeOutBgm(150); // 150ms 快速淡出並停止背景音樂（若想瞬間切斷也可以直接寫 if (bgmAudio) { bgmAudio.pause(); bgmAudio.currentTime = 0; }）
}
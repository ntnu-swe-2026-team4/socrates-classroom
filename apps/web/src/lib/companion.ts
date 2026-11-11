import { useSyncExternalStore } from "react";

export type CompanionExpression = "Happy" | "Confused" | "Angry";
export type SpeechSource = "dialogue" | "assistant";
export type VoiceStyle = "elder" | "natural";
export type CompanionManualExpression = CompanionExpression | "neutral";

export interface CompanionState {
  visible: boolean;
  muted: boolean;
  volume: number;
  voiceStyle: VoiceStyle;
  speaking: boolean;
  speakingSource: SpeechSource | null;
}

const VISIBLE_KEY = "socrates_companion_visible";
const MUTED_KEY = "socrates_companion_muted";
const VOLUME_KEY = "socrates_voice_volume";
const VOICE_STYLE_KEY = "socrates_voice_style";

function readVoiceStyle(): VoiceStyle {
  try {
    return localStorage.getItem(VOICE_STYLE_KEY) === "natural" ? "natural" : "elder";
  } catch {
    return "elder";
  }
}

function readVolume(): number {
  try {
    const saved = Number(localStorage.getItem(VOLUME_KEY));
    if (localStorage.getItem(VOLUME_KEY) !== null && Number.isFinite(saved)) return Math.min(1, Math.max(0, saved));
  } catch {}
  return 0.8;
}

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const saved = localStorage.getItem(key);
    if (saved === "1") return true;
    if (saved === "0") return false;
  } catch {}
  return fallback;
}

function writeFlag(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? "1" : "0");
  } catch {}
}

let state: CompanionState = {
  visible: readFlag(VISIBLE_KEY, true),
  muted: readFlag(MUTED_KEY, false),
  volume: readVolume(),
  voiceStyle: readVoiceStyle(),
  speaking: false,
  speakingSource: null,
};

const listeners = new Set<() => void>();
const expressionListeners = new Set<(name: CompanionExpression | null) => void>();

export function onExpression(listener: (name: CompanionExpression | null) => void): () => void {
  expressionListeners.add(listener);
  return () => {
    expressionListeners.delete(listener);
  };
}

function update(patch: Partial<CompanionState>) {
  state = { ...state, ...patch };
  for (const notify of listeners) notify();
}

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

export function getCompanion(): CompanionState {
  return state;
}

export function useCompanion(): CompanionState {
  return useSyncExternalStore(subscribe, getCompanion, getCompanion);
}

export const companion = {
  setVisible(v: boolean) {
    if (state.visible === v) return;
    writeFlag(VISIBLE_KEY, v);
    update({ visible: v });
  },
  toggleVisible() {
    companion.setVisible(!state.visible);
  },
  setMuted(v: boolean) {
    if (state.muted === v) return;
    writeFlag(MUTED_KEY, v);
    update({ muted: v });
  },
  setVoiceStyle(style: VoiceStyle) {
    if (state.voiceStyle === style) return;
    try {
      localStorage.setItem(VOICE_STYLE_KEY, style);
    } catch {}
    update({ voiceStyle: style });
  },
  setVolume(v: number) {
    const volume = Math.min(1, Math.max(0, v));
    if (state.volume === volume) return;
    try {
      localStorage.setItem(VOLUME_KEY, String(volume));
    } catch {}
    update({ volume });
  },
  toggleMuted() {
    companion.setMuted(!state.muted);
  },
  setSpeakingSource(source: SpeechSource | null) {
    if (state.speakingSource === source) return;
    update({ speakingSource: source, speaking: source !== null });
  },
  playExpression(name: CompanionManualExpression | null) {
    const clip = name === "neutral" ? null : name;
    for (const listener of expressionListeners) listener(clip);
  },
};

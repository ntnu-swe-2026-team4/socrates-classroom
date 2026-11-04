import { useSyncExternalStore } from "react";
import { speak, speechOutputSupported, stopSpeaking } from "@/lib/speech";

let speaking = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () =>
  listeners.forEach((l) => {
    l();
  });

export function setAiSpeaking(v: boolean) {
  if (timer) {
    clearTimeout(timer);
    timer = undefined;
  }
  if (speaking === v) return;
  speaking = v;
  emit();
}

export function pulseAiSpeaking(ms = 2500) {
  setAiSpeaking(true);
  timer = setTimeout(() => setAiSpeaking(false), ms);
}

let gen = 0;
export function speakAi(text: string) {
  const clean = text.trim();
  if (!clean) return;
  const my = ++gen;
  if (!speechOutputSupported()) {
    pulseAiSpeaking(Math.min(9000, Math.max(1500, clean.length * 90)));
    return;
  }
  speak(clean, {
    onStart: () => {
      if (my === gen) setAiSpeaking(true);
    },
    onEnd: () => {
      if (my === gen) setAiSpeaking(false);
    },
  });
}
export function stopAiSpeech() {
  gen++;
  stopSpeaking();
  setAiSpeaking(false);
}

export function useAiSpeaking() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => speaking,
    () => false,
  );
}

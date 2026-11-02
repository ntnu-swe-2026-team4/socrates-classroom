import { useSyncExternalStore } from "react";
import { speak, speechOutputSupported, stopSpeaking } from "@/lib/speech";

/**
 * 「AI 正在說話」的全域旗標：各階段的對話區在 AI 回覆時設成 true，
 * 資訊欄裡的小蘇格拉底雕像讀這個旗標來動嘴巴。只是一個布林值，不需要 context。
 */
let speaking = false;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setAiSpeaking(v: boolean) {
  if (timer) { clearTimeout(timer); timer = undefined; }
  if (speaking === v) return;
  speaking = v;
  emit();
}

/** 一次性的說話（例如收到一則 AI 訊息）：嘴巴動 ms 毫秒後自動停 */
export function pulseAiSpeaking(ms = 2500) {
  setAiSpeaking(true);
  timer = setTimeout(() => setAiSpeaking(false), ms);
}

let gen = 0;
/** 跟單人對話一樣：用語音把 AI 的話念出來，嘴巴跟著念的時間動；瀏覽器不支援語音時，依字數估算一段時間 */
export function speakAi(text: string) {
  const clean = text.trim();
  if (!clean) return;
  const my = ++gen;
  if (!speechOutputSupported()) { pulseAiSpeaking(Math.min(9000, Math.max(1500, clean.length * 90))); return; }
  speak(clean, { onStart: () => { if (my === gen) setAiSpeaking(true); }, onEnd: () => { if (my === gen) setAiSpeaking(false); } });
}
/** 離開頁面或階段時停止念話與動嘴 */
export function stopAiSpeech() { gen++; stopSpeaking(); setAiSpeaking(false); }

export function useAiSpeaking() {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
    () => speaking,
    () => false,
  );
}

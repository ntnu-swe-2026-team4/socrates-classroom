import { currentLang } from "@/i18n";

/** 語音辨識 / 合成的語言：跟著介面語言走 */
const speechLang = () => ({ "zh-TW": "zh-TW", en: "en-US", es: "es-ES" })[currentLang()];

/**
 * 瀏覽器內建的語音辨識與語音合成（Web Speech API）。
 * 注意：Chrome 的辨識與部分語音實際上是 Google 的服務；要統一品質請之後接後端語音服務。
 */
type SR = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: any) => void) | null; onerror: (() => void) | null; onend: (() => void) | null };
const Ctor = (): (new () => SR) | undefined => (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

export const speechInputSupported = () => !!Ctor();
export const speechOutputSupported = () => "speechSynthesis" in window;

/** 按下開始聽，放開時回傳辨識到的文字（沒聽清楚回傳空字串） */
export function createRecognizer() {
  const C = Ctor();
  if (!C) return null;
  const rec = new C();
  rec.lang = speechLang(); rec.interimResults = false; rec.continuous = false;
  let listening = false;
  return {
    start() { if (listening) return; listening = true; rec.start(); },
    stop(): Promise<string> {
      return new Promise((resolve) => {
        if (!listening) return resolve("");
        rec.onresult = (e) => resolve(e.results?.[0]?.[0]?.transcript ?? "");
        rec.onerror = () => resolve("");
        rec.onend = () => { listening = false; };
        rec.stop();
      });
    },
  };
}

/**
 * 蘇格拉底的聲音：瀏覽器沒有「老人」語音，所以挑系統裡的男聲，再壓低音高、放慢語速，聽起來像沉穩的老者。
 * 名單依序比對（越前面越優先）：Edge 的自然語音 → Windows 內建 → Chrome / macOS；都沒有就用名字裡有 male 的，最後才用預設聲音。
 */
const MALE_VOICES: Record<string, string[]> = {
  "zh-TW": ["Yunjhe", "Zhiwei", "Yunxi", "Yunyang", "Yunjian", "Kangkang"],
  "en-US": ["Guy", "Davis", "Christopher", "Eric", "Roger", "David", "Mark", "Google UK English Male", "Daniel", "Fred", "Alex"],
  "es-ES": ["Alvaro", "Jorge", "Pablo", "Raul", "Diego", "Juan"],
};
let voices: SpeechSynthesisVoice[] = [];
if (speechOutputSupported()) {
  // 語音清單在某些瀏覽器是非同步載入的，載入完會觸發 voiceschanged
  const load = () => { voices = window.speechSynthesis.getVoices(); };
  load();
  window.speechSynthesis.addEventListener("voiceschanged", load);
}
function elderVoice(lang: string) {
  const prefix = lang.split("-")[0];
  const same = voices.filter((v) => v.lang.replace("_", "-") === lang);
  const near = same.length ? same : voices.filter((v) => v.lang.toLowerCase().startsWith(prefix));
  for (const name of MALE_VOICES[lang] ?? []) {
    const hit = near.find((v) => v.name.includes(name));
    if (hit) return hit;
  }
  return near.find((v) => /\bmale\b/i.test(v.name));
}

type SpeakOpts = { rate?: number; pitch?: number; volume?: number; onStart?: () => void; onEnd?: () => void };

/** 說話倍速（對話頁左上角的按鈕，記在這個瀏覽器）；實際語速 = 老者的基本語速 × 倍速 */
export const SPEECH_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const RATE_KEY = "speech-rate";
let speechRate: number = (() => {
  try { const r = Number(localStorage.getItem(RATE_KEY)); return (SPEECH_RATES as readonly number[]).includes(r) ? r : 1; } catch { return 1; }
})();
export const getSpeechRate = () => speechRate;

/** 正在朗讀的句子；spoken = 已經唸到第幾個字（換倍速時從這裡接著唸） */
let current: { text: string; opts: SpeakOpts; spoken: number } | null = null;

function utter(text: string, opts: SpeakOpts, from: number) {
  const me = { text, opts, spoken: from };
  current = me;
  const u = new SpeechSynthesisUtterance(text.slice(from));
  const voice = elderVoice(speechLang());
  if (voice) u.voice = voice;
  // 低沉、緩慢：老者的語氣。找不到男聲時把音高壓得更低一點，盡量不要聽起來像年輕女聲
  u.lang = speechLang(); u.rate = (opts.rate ?? 0.85) * speechRate; u.pitch = opts.pitch ?? (voice ? 0.7 : 0.5); u.volume = opts.volume ?? 1;
  // 被換掉的句子（換倍速重唸、或開始唸新的一句）不再觸發自己的事件
  u.onstart = () => { if (current === me) opts.onStart?.(); };
  u.onboundary = (e) => { if (current === me) me.spoken = from + e.charIndex; };
  const end = () => { if (current !== me) return; current = null; opts.onEnd?.(); };
  u.onend = end;
  u.onerror = end;
  window.speechSynthesis.speak(u);
}

export function speak(text: string, opts: SpeakOpts = {}) {
  if (!speechOutputSupported()) return opts.onEnd?.();
  const prev = current;
  current = null;
  window.speechSynthesis.cancel();
  prev?.opts.onEnd?.();
  utter(text, opts, 0);
}

/** 換倍速；正在唸的話從目前的字用新速度接著唸（瀏覽器沒回報唸到哪裡時，從這句開頭重唸） */
export function setSpeechRate(rate: number) {
  speechRate = rate;
  try { localStorage.setItem(RATE_KEY, String(rate)); } catch { /* 沒有就算了 */ }
  if (!current || !speechOutputSupported()) return;
  const { text, opts, spoken } = current;
  current = null;
  window.speechSynthesis.cancel();
  utter(text, opts, spoken);
}

export const stopSpeaking = () => { if (speechOutputSupported()) window.speechSynthesis.cancel(); };

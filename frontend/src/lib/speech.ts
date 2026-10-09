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
  rec.lang = "zh-TW"; rec.interimResults = false; rec.continuous = false;
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

export function speak(text: string, opts: { rate?: number; pitch?: number; volume?: number; onStart?: () => void; onEnd?: () => void } = {}) {
  if (!speechOutputSupported()) return opts.onEnd?.();
  window.speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = "zh-TW"; u.rate = opts.rate ?? 0.95; u.pitch = opts.pitch ?? 0.9; u.volume = opts.volume ?? 1;
  u.onstart = () => opts.onStart?.();
  u.onend = () => opts.onEnd?.();
  u.onerror = () => opts.onEnd?.();
  window.speechSynthesis.speak(u);
}
export const stopSpeaking = () => { if (speechOutputSupported()) window.speechSynthesis.cancel(); };

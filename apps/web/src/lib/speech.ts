const SPEECH_LANG: Record<string, string> = { zh: "zh-TW", en: "en-US", es: "es-ES" };
const speechLang = () => SPEECH_LANG[document.documentElement.lang.slice(0, 2)] ?? "zh-TW";

type SR = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: any) => void) | null;
  onerror: (() => void) | null;
  onend: (() => void) | null;
};
const Ctor = (): (new () => SR) | undefined =>
  (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;

export const speechInputSupported = () => !!Ctor();
export const speechOutputSupported = () => "speechSynthesis" in window;

export function createRecognizer() {
  const C = Ctor();
  if (!C) return null;
  const rec = new C();
  rec.lang = speechLang();
  rec.interimResults = false;
  rec.continuous = false;
  let listening = false;
  return {
    start() {
      if (listening) return;
      listening = true;
      rec.start();
    },
    stop(): Promise<string> {
      return new Promise((resolve) => {
        if (!listening) return resolve("");
        rec.onresult = (e) => resolve(e.results?.[0]?.[0]?.transcript ?? "");
        rec.onerror = () => resolve("");
        rec.onend = () => {
          listening = false;
        };
        rec.stop();
      });
    },
  };
}

const MALE_VOICES: Record<string, string[]> = {
  "zh-TW": ["Yunjhe", "Zhiwei", "Yunxi", "Yunyang", "Yunjian", "Kangkang"],
  "en-US": [
    "Guy",
    "Davis",
    "Christopher",
    "Eric",
    "Roger",
    "David",
    "Mark",
    "Google UK English Male",
    "Daniel",
    "Fred",
    "Alex",
  ],
  "es-ES": ["Alvaro", "Jorge", "Pablo", "Raul", "Diego", "Juan"],
};
let voices: SpeechSynthesisVoice[] = [];
if (speechOutputSupported()) {
  const load = () => {
    voices = window.speechSynthesis.getVoices();
  };
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

export const SPEECH_RATES = [0.75, 1, 1.25, 1.5, 2] as const;
const RATE_KEY = "speech-rate";
let speechRate: number = (() => {
  try {
    const r = Number(localStorage.getItem(RATE_KEY));
    return (SPEECH_RATES as readonly number[]).includes(r) ? r : 1;
  } catch {
    return 1;
  }
})();
export const getSpeechRate = () => speechRate;

let current: { text: string; opts: SpeakOpts; spoken: number } | null = null;

function utter(text: string, opts: SpeakOpts, from: number) {
  const me = { text, opts, spoken: from };
  current = me;
  const u = new SpeechSynthesisUtterance(text.slice(from));
  const voice = elderVoice(speechLang());
  if (voice) u.voice = voice;
  u.lang = speechLang();
  u.rate = (opts.rate ?? 0.85) * speechRate;
  u.pitch = opts.pitch ?? (voice ? 0.7 : 0.5);
  u.volume = opts.volume ?? 1;
  u.onstart = () => {
    if (current === me) opts.onStart?.();
  };
  u.onboundary = (e) => {
    if (current === me) me.spoken = from + e.charIndex;
  };
  const end = () => {
    if (current !== me) return;
    current = null;
    opts.onEnd?.();
  };
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

export function setSpeechRate(rate: number) {
  speechRate = rate;
  try {
    localStorage.setItem(RATE_KEY, String(rate));
  } catch {}
  if (!current || !speechOutputSupported()) return;
  const { text, opts, spoken } = current;
  current = null;
  window.speechSynthesis.cancel();
  utter(text, opts, spoken);
}

export const stopSpeaking = () => {
  if (speechOutputSupported()) window.speechSynthesis.cancel();
};

import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

/**
 * 多語系：繁體中文（原文）、English、Español。
 *
 * 用法：畫面上的文字一律寫成 t("中文原文")，中文原文就是翻譯的 key。
 *   - 有變數：t("已對話 {n} 輪", { n: 3 })，翻譯檔裡同樣寫 "{n} rounds so far"
 *   - 不在 React 元件裡（例如 mock 的錯誤訊息、模組層級的常數）用 tr("中文原文")
 *   - 模組層級的常數只存中文 key，到畫面上才呼叫 t(key)，這樣切換語言時才會跟著變
 * 翻譯放在 ./messages/*.ts（每個檔案 export default { en: {...}, es: {...} }），會自動合併；
 * 缺少翻譯時退回中文原文，不會壞掉。
 */
export type Lang = "zh-TW" | "en" | "es";
export const LANGS: { code: Lang; label: string }[] = [
  { code: "zh-TW", label: "繁體中文" },
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
];
export type Messages = { en: Record<string, string>; es: Record<string, string> };

const table: Record<"en" | "es", Record<string, string>> = { en: {}, es: {} };
const files = import.meta.glob<{ default: Messages }>("./messages/*.ts", { eager: true });
for (const f of Object.values(files)) {
  Object.assign(table.en, f.default.en);
  Object.assign(table.es, f.default.es);
}

const STORAGE_KEY = "lang";
const isLang = (v: unknown): v is Lang => v === "zh-TW" || v === "en" || v === "es";
function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLang(saved)) return saved;
  } catch { /* 讀不到就用預設 */ }
  return "zh-TW";
}

let current: Lang = initialLang();
/** 開發時記錄「還沒有翻譯的 key」，方便檢查 */
export const missing = new Set<string>();
if (import.meta.env.DEV) (window as unknown as { __i18nMissing: Set<string> }).__i18nMissing = missing;

/** key 可以加「#說明」來區分同一個中文在不同語境的翻譯（例如 "加入#add"）；顯示時會去掉 */
const bare = (s: string) => s.replace(/#[a-z]+$/, "");
const fill = (s0: string, vars?: Record<string, string | number>) => { const s = bare(s0); return (vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s); };

/** 不在元件裡用的翻譯函式；讀的是目前選擇的語言 */
export function tr(key: string, vars?: Record<string, string | number>): string {
  if (current === "zh-TW") return fill(key, vars);
  const hit = table[current][key];
  if (hit === undefined && import.meta.env.DEV) missing.add(key);
  return fill(hit ?? key, vars);
}
export const currentLang = () => current;

const Ctx = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({ lang: "zh-TW", setLang: () => {} });

export function LangProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(current);
  const setLang = useCallback((l: Lang) => {
    current = l;
    try { localStorage.setItem(STORAGE_KEY, l); } catch { /* 存不了就算了 */ }
    setLangState(l);
  }, []);
  useEffect(() => { document.documentElement.lang = lang === "zh-TW" ? "zh-Hant" : lang; }, [lang]);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  // 換語言時整個畫面重新掛載（key = lang）：保證每一段文字（包含模組層級的常數、沒用 useT 的小元件）都用新語言重畫。
  // 資料快取（QueryClient）與網址都在外面，不會因此遺失。
  return <Ctx.Provider value={value}><Fragment key={lang}>{children}</Fragment></Ctx.Provider>;
}

export const useLang = () => useContext(Ctx);

/** 元件裡用的翻譯函式；語言切換時元件會重新繪製 */
export function useT() {
  const { lang } = useLang();
  // lang 變了才換新函式，讓依賴 t 的 useMemo / useEffect 跟著更新
  return useCallback((key: string, vars?: Record<string, string | number>) => { void lang; return tr(key, vars); }, [lang]);
}

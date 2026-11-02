import { createContext, Fragment, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

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
  } catch {}
  return "zh-TW";
}

let current: Lang = initialLang();
export const missing = new Set<string>();
if (import.meta.env.DEV) (window as unknown as { __i18nMissing: Set<string> }).__i18nMissing = missing;

const bare = (s: string) => s.replace(/#[a-z]+$/, "");
const fill = (s0: string, vars?: Record<string, string | number>) => {
  const s = bare(s0);
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
};

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
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {}
    setLangState(l);
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang === "zh-TW" ? "zh-Hant" : lang;
  }, [lang]);
  const value = useMemo(() => ({ lang, setLang }), [lang, setLang]);
  return (
    <Ctx.Provider value={value}>
      <Fragment key={lang}>{children}</Fragment>
    </Ctx.Provider>
  );
}

export const useLang = () => useContext(Ctx);

export function useT() {
  const { lang } = useLang();
  return useCallback(
    (key: string, vars?: Record<string, string | number>) => {
      void lang;
      return tr(key, vars);
    },
    [lang],
  );
}

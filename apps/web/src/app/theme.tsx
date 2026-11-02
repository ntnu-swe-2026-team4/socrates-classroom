import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

type Theme = "dark" | "light";
/** 只在使用者自己切換時才記下來；沒切換過一律用白色介面。（舊的 "theme" 每次載入都會被寫入，所以換一個名字） */
export const THEME_KEY = "theme-choice";
const saved = (): Theme => { try { return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light"; } catch { return "light"; } };

const Ctx = createContext<{ theme: Theme; toggle: () => void }>({ theme: "light", toggle: () => {} });
export const useTheme = () => useContext(Ctx);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setTheme] = useState<Theme>(saved);
  useEffect(() => { document.documentElement.classList.toggle("dark", theme === "dark"); }, [theme]);
  function toggle() {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      try { localStorage.setItem(THEME_KEY, next); } catch { /* 沒有就算了 */ }
      return next;
    });
  }
  return <Ctx.Provider value={{ theme, toggle }}>{children}</Ctx.Provider>;
}

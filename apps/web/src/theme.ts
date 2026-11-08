import { useSyncExternalStore } from "react";

export type Theme = "light" | "dark";

const KEY = "theme";
const listeners = new Set<() => void>();

function initial(): Theme {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === "light" || saved === "dark") return saved;
  } catch {}
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

let current: Theme = initial();

function apply() {
  document.documentElement.dataset.theme = current;
}

apply();

if (typeof matchMedia === "function") {
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", (event) => {
    try {
      if (localStorage.getItem(KEY)) return;
    } catch {}
    current = event.matches ? "dark" : "light";
    apply();
    for (const notify of listeners) notify();
  });
}

export function setTheme(theme: Theme) {
  current = theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {}
  apply();
  for (const notify of listeners) notify();
}

export function toggleTheme() {
  setTheme(current === "dark" ? "light" : "dark");
}

export function subscribeTheme(notify: () => void) {
  listeners.add(notify);
  return () => listeners.delete(notify);
}

export function themeSnapshot(): Theme {
  return current;
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribeTheme, themeSnapshot);
}

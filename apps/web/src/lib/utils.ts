import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { currentLang } from "@/i18n";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const pad = (n: number) => String(n).padStart(2, "0");

export function formatDateTime(iso: string) {
  const d = new Date(iso);
  const lang = currentLang();
  const sameYear = d.getFullYear() === new Date().getFullYear();
  if (lang !== "zh-TW") {
    return new Intl.DateTimeFormat(lang, {
      year: sameYear ? undefined : "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: lang === "en",
    }).format(d);
  }
  const year = sameYear ? "" : `${d.getFullYear()} 年 `;
  return `${year}${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

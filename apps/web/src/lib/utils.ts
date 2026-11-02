import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { currentLang } from "@/i18n";

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

const pad = (n: number) => String(n).padStart(2, "0");

/** ISO 時間 → 「10 月 8 日 23:59」（不同年份會加上年份）；英文 / 西班牙文用該語言的慣用格式 */
export function formatDateTime(iso: string) {
  const d = new Date(iso);
  const lang = currentLang();
  const sameYear = d.getFullYear() === new Date().getFullYear();
  if (lang !== "zh-TW") {
    return new Intl.DateTimeFormat(lang, { year: sameYear ? undefined : "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: lang === "en" }).format(d);
  }
  const year = sameYear ? "" : `${d.getFullYear()} 年 `;
  return `${year}${d.getMonth() + 1} 月 ${d.getDate()} 日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO 時間 ↔ <input type="datetime-local"> 的值（使用者的本地時間） */
export function toLocalInput(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
export const fromLocalInput = (v: string) => (v ? new Date(v).toISOString() : null);

/** 位元組 → 「1.2 MB」 */
export function formatBytes(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 ** 2).toFixed(1)} MB`;
}

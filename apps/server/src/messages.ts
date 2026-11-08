import type { Lang } from "@socrates/shared";
import type { ErrorCode } from "@socrates/shared";

type Entry = { zh: string; en: string; es: string };

const M: Record<ErrorCode, Entry> = {
  unauthorized: { zh: "請先登入。", en: "Please sign in first.", es: "Inicia sesión primero." },
  forbidden: {
    zh: "你沒有權限執行這個動作。",
    en: "You are not allowed to do that.",
    es: "No tienes permiso para hacer eso.",
  },
  not_found: { zh: "找不到資料。", en: "Not found.", es: "No encontrado." },
  conflict: {
    zh: "這個動作和目前的狀態衝突。",
    en: "That conflicts with the current state.",
    es: "Eso entra en conflicto con el estado actual.",
  },
  validation: {
    zh: "送出的資料不正確。",
    en: "The submitted data is invalid.",
    es: "Los datos enviados no son válidos.",
  },
  rate_limited: {
    zh: "送得太頻繁了，請稍後再試。",
    en: "Too many requests. Please slow down.",
    es: "Demasiadas solicitudes. inténtalo más tarde.",
  },
  internal_error: {
    zh: "伺服器發生錯誤，請稍後再試。",
    en: "Something went wrong on the server.",
    es: "Algo falló en el servidor.",
  },
  join_code_invalid: {
    zh: "邀請連結無效。",
    en: "This invite link is not valid.",
    es: "Este enlace de invitación no es válido.",
  },
  tos_required: {
    zh: "需要同意使用條款才能進入。",
    en: "You must accept the Terms of Service to continue.",
    es: "Debes aceptar los Términos de Servicio para continuar.",
  },
  name_taken: {
    zh: "這個名字已經有人使用了。",
    en: "That name is already taken in this classroom.",
    es: "Ese nombre ya está en uso en esta clase.",
  },
  only_student: {
    zh: "只有學生可以進行對話。",
    en: "Only students can hold this dialogue.",
    es: "Solo los estudiantes pueden dialogar.",
  },
  already_streaming: {
    zh: "上一則回覆還在產生中。",
    en: "The previous reply is still streaming.",
    es: "La respuesta anterior aún se está generando.",
  },
  activity_finished: {
    zh: "活動已結束，無法繼續對話。",
    en: "This activity has finished.",
    es: "Esta actividad ha terminado.",
  },
  llm_unavailable: {
    zh: "蘇格拉底暫時無法回應，請再試一次。",
    en: "Socrates cannot respond right now. Try again.",
    es: "Sócrates no puede responder ahora. Inténtalo de nuevo.",
  },
  llm_rate_limited: {
    zh: "目前太忙碌了，請稍等一下再問。",
    en: "It is too busy right now. Please wait a moment.",
    es: "Está muy ocupado ahora. Espera un momento.",
  },
  llm_timeout: {
    zh: "回應逾時，請再試一次。",
    en: "The reply timed out. Try again.",
    es: "La respuesta expiró. Inténtalo de nuevo.",
  },
  report_pending: {
    zh: "報告還在生成中，請稍後再讀取。",
    en: "The report is still being generated.",
    es: "El informe aún se está generando.",
  },
  report_failed: {
    zh: "報告生成失敗，請重新結束活動以重試。",
    en: "Report generation failed. Finish the activity again to retry.",
    es: "La generación del informe falló. Vuelve a finalizar la actividad.",
  },
  byok_provider_invalid: {
    zh: "不支援這個 provider。",
    en: "This provider is not supported.",
    es: "Este proveedor no es compatible.",
  },
};

export function localize(code: ErrorCode, lang: Lang, vars: Record<string, string | number> = {}): string {
  const template = M[code][lang];
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(vars[key] ?? `{${key}}`));
}

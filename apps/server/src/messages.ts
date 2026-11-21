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
  invite_invalid: {
    zh: "活動邀請連結無效。",
    en: "This activity invite link is not valid.",
    es: "Este enlace de invitación a la actividad no es válido.",
  },
  invite_revoked: {
    zh: "這個活動邀請連結已被撤回。",
    en: "This activity invite link has been revoked.",
    es: "Este enlace de invitación a la actividad fue revocado.",
  },
  invite_expired: {
    zh: "這個活動邀請連結已過期。",
    en: "This activity invite link has expired.",
    es: "Este enlace de invitación a la actividad ha caducado.",
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
  account_disabled: {
    zh: "這個帳號已停用，請聯絡管理員。",
    en: "This account is disabled. Contact an administrator.",
    es: "Esta cuenta está deshabilitada. Contacta a un administrador.",
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
  email_taken: {
    zh: "這個信箱已經註冊過了，請直接登入。",
    en: "This email is already registered. Please sign in instead.",
    es: "Este correo ya está registrado. Inicia sesión.",
  },
  oauth_unavailable: {
    zh: "這個登入方式目前無法使用。",
    en: "This sign-in method is not available right now.",
    es: "Este método de inicio de sesión no está disponible ahora.",
  },
  oauth_state_invalid: {
    zh: "登入請求已失效，請重新登入。",
    en: "The sign-in request expired. Please try again.",
    es: "La solicitud de inicio de sesión caducó. Inténtalo de nuevo.",
  },
  oauth_email_unverified: {
    zh: "這個帳號的信箱尚未驗證，無法登入。",
    en: "This account's email is not verified.",
    es: "El correo de esta cuenta no está verificado.",
  },
  oauth_failed: {
    zh: "第三方登入失敗，請再試一次。",
    en: "Third-party sign-in failed. Please try again.",
    es: "El inicio de sesión externo falló. Inténtalo de nuevo.",
  },
  reset_token_invalid: {
    zh: "重設密碼的連結無效或已過期，請重新申請。",
    en: "This password reset link is invalid or has expired. Please request a new one.",
    es: "Este enlace para restablecer la contraseña no es válido o ha caducado. Solicita uno nuevo.",
  },
};

export function localize(code: ErrorCode, lang: Lang, vars: Record<string, string | number> = {}): string {
  const template = M[code][lang];
  return template.replace(/\{(\w+)\}/g, (_match, key: string) => String(vars[key] ?? `{${key}}`));
}

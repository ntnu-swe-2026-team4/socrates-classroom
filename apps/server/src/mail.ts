import type { Lang } from "@socrates/shared";
import type { EmailMessageBuilder, Env } from "./env";

export interface QuotaAlertEmail {
  to: string;
  lang: Lang;
  teacherName: string;
  provider: string;
  threshold: number;
  spend: string;
  quota: string;
}

const money = (value: string) => `$${value}`;

const SUBJECT: Record<Lang, (provider: string, threshold: number) => string> = {
  zh: (provider, threshold) => `【蘇格拉底教室】${provider} 額度已達 ${threshold}%`,
  en: (provider, threshold) => `[Socrates Classroom] ${provider} usage at ${threshold}% of the monthly quota`,
  es: (provider, threshold) => `[Aula de Sócrates] ${provider} al ${threshold}% de la cuota mensual`,
};

const BODY: Record<Lang, (alert: Omit<QuotaAlertEmail, "to" | "lang">) => string> = {
  zh: (alert) =>
    `${alert.teacherName} 老師您好：\n\n` +
    `您在蘇格拉底教室的 ${alert.provider} 帳號，本月累計用量約 ${money(alert.spend)}／額度 ${money(alert.quota)}（${alert.threshold}%）。\n` +
    `同一水位本月只會提醒一次，下個月自動重置。\n` +
    `調整額度請到設定頁的 Teacher keys。\n`,
  en: (alert) =>
    `Hello ${alert.teacherName},\n\n` +
    `Your ${alert.provider} account in Socrates Classroom has used about ${money(alert.spend)} of its ${money(alert.quota)} monthly quota (${alert.threshold}%).\n` +
    `Each threshold is announced once per month and resets next month.\n` +
    `Adjust the quota on the Teacher keys card in Settings.\n`,
  es: (alert) =>
    `Hola, ${alert.teacherName}:\n\n` +
    `Tu cuenta de ${alert.provider} en el Aula de Sócrates ha usado unos ${money(alert.spend)} de su cuota mensual de ${money(alert.quota)} (${alert.threshold}%).\n` +
    `Cada nivel se avisa una sola vez al mes y se reinicia el mes que viene.\n` +
    `Ajusta la cuota en la tarjeta Teacher keys de Ajustes.\n`,
};

export interface PasswordResetEmail {
  to: string;
  lang: Lang;
  link: string;
  minutes: number;
}

const RESET_SUBJECT: Record<Lang, string> = {
  zh: "【蘇格拉底教室】重設密碼",
  en: "[Socrates Classroom] Reset your password",
  es: "[Aula de Sócrates] Restablece tu contraseña",
};

const RESET_BODY: Record<Lang, (mail: Omit<PasswordResetEmail, "to" | "lang">) => string> = {
  zh: (mail) =>
    `您好：\n\n` +
    `我們收到重設蘇格拉底教室密碼的申請。請在 ${mail.minutes} 分鐘內開啟以下連結設定新密碼：\n` +
    `${mail.link}\n\n` +
    `如果不是您本人申請，可以忽略這封信，您的密碼不會改變。\n`,
  en: (mail) =>
    `Hello,\n\n` +
    `We received a request to reset your Socrates Classroom password. Open this link within ${mail.minutes} minutes to choose a new one:\n` +
    `${mail.link}\n\n` +
    `If you did not ask for this, you can ignore this email; your password will not change.\n`,
  es: (mail) =>
    `Hola:\n\n` +
    `Recibimos una solicitud para restablecer tu contraseña del Aula de Sócrates. Abre este enlace en los próximos ${mail.minutes} minutos para elegir una nueva:\n` +
    `${mail.link}\n\n` +
    `Si no la solicitaste, puedes ignorar este correo; tu contraseña no cambiará.\n`,
};

export interface EmailVerificationEmail {
  to: string;
  lang: Lang;
  link: string;
  hours: number;
}

const VERIFY_SUBJECT: Record<Lang, string> = {
  zh: "【蘇格拉底教室】請驗證你的信箱",
  en: "[Socrates Classroom] Verify your email address",
  es: "[Aula de Sócrates] Verifica tu correo electrónico",
};

const VERIFY_BODY: Record<Lang, (mail: Omit<EmailVerificationEmail, "to" | "lang">) => string> = {
  zh: (mail) =>
    `你好：\n\n` +
    `這個信箱剛被用來註冊蘇格拉底教室。請在 ${mail.hours} 小時內開啟以下連結，證明這個信箱是你的：\n` +
    `${mail.link}\n\n` +
    `在你開啟連結之前，這個信箱都不算完成驗證。如果註冊的人不是你，忽略這封信就好，這個信箱會維持未驗證。\n`,
  en: (mail) =>
    `Hello,\n\n` +
    `This address was just used to sign up for Socrates Classroom. Open this link within ${mail.hours} hours to show that the address is yours:\n` +
    `${mail.link}\n\n` +
    `Until you open it, the address counts as unverified. If you did not sign up, you can ignore this email; the address stays unverified.\n`,
  es: (mail) =>
    `Hola:\n\n` +
    `Esta dirección se acaba de usar para crear una cuenta en el Aula de Sócrates. Abre este enlace en las próximas ${mail.hours} horas para demostrar que la dirección es tuya:\n` +
    `${mail.link}\n\n` +
    `Hasta que lo abras, la dirección cuenta como no verificada. Si no te registraste tú, puedes ignorar este correo; la dirección seguirá sin verificar.\n`,
};

export async function sendEmailVerificationEmail(env: Env, mail: EmailVerificationEmail): Promise<void> {
  if (!env.SEND_EMAIL || !env.ALERT_FROM_EMAIL) throw new Error("email_path_missing");
  await env.SEND_EMAIL.send({
    to: mail.to,
    from: env.ALERT_FROM_EMAIL,
    subject: VERIFY_SUBJECT[mail.lang],
    text: VERIFY_BODY[mail.lang](mail),
  });
}

export async function sendPasswordResetEmail(env: Env, mail: PasswordResetEmail): Promise<void> {
  if (!env.SEND_EMAIL || !env.ALERT_FROM_EMAIL) throw new Error("email_path_missing");
  await env.SEND_EMAIL.send({
    to: mail.to,
    from: env.ALERT_FROM_EMAIL,
    subject: RESET_SUBJECT[mail.lang],
    text: RESET_BODY[mail.lang](mail),
  });
}

export interface EmailChangeVerifyEmail {
  to: string;
  lang: Lang;
  name: string;
  link: string;
  minutes: number;
}

const CHANGE_VERIFY_SUBJECT: Record<Lang, string> = {
  zh: "【蘇格拉底教室】確認信箱變更",
  en: "[Socrates Classroom] Confirm your email change",
  es: "[Aula de Sócrates] Confirma el cambio de correo",
};

const CHANGE_VERIFY_BODY: Record<Lang, (mail: Omit<EmailChangeVerifyEmail, "to" | "lang">) => string> = {
  zh: (mail) =>
    `你好：\n\n` +
    `帳號「${mail.name}」要求把蘇格拉底教室的登入信箱改成這個地址。請在 ${mail.minutes} 分鐘內開啟以下連結完成變更：\n` +
    `${mail.link}\n\n` +
    `驗證之後，這個地址就可以用來登入該帳號，也會收到該帳號的密碼重設信。在你開啟連結之前，帳號不會有任何變動。\n` +
    `如果這不是你申請的，忽略這封信即可。\n`,
  en: (mail) =>
    `Hello,\n\n` +
    `The Socrates Classroom account "${mail.name}" asked to change its sign-in email to this address. Open this link within ${mail.minutes} minutes to confirm:\n` +
    `${mail.link}\n\n` +
    `After you confirm, this address can sign in to that account and receives its password reset emails. Until you open the link, the account stays unchanged.\n` +
    `If you did not request this, just ignore this email.\n`,
  es: (mail) =>
    `Hola:\n\n` +
    `La cuenta «${mail.name}» del Aula de Sócrates pidió cambiar su correo de acceso a esta dirección. Abre este enlace en los próximos ${mail.minutes} minutos para confirmar:\n` +
    `${mail.link}\n\n` +
    `Después de confirmar, esta dirección podrá iniciar sesión en esa cuenta y recibirá sus correos de restablecimiento. Hasta que abras el enlace, la cuenta no cambia.\n` +
    `Si no lo solicitaste, ignora este correo.\n`,
};

export interface EmailChangeNoticeEmail {
  to: string;
  lang: Lang;
  newEmail: string;
  cancelLink: string;
}

const CHANGE_NOTICE_SUBJECT: Record<Lang, string> = {
  zh: "【蘇格拉底教室】你的信箱被要求變更",
  en: "[Socrates Classroom] An email change was requested",
  es: "[Aula de Sócrates] Se solicitó un cambio de correo",
};

const CHANGE_NOTICE_BODY: Record<Lang, (mail: Omit<EmailChangeNoticeEmail, "to" | "lang">) => string> = {
  zh: (mail) =>
    `你好：\n\n` +
    `有登入你這個信箱的蘇格拉底教室帳號，要求把登入信箱改成「${mail.newEmail}」。\n` +
    `在新信箱完成驗證之前，你這個信箱的登入與密碼找回功能都不受影響。\n\n` +
    `如果這不是你本人申請的，開啟以下連結即可取消這次變更：\n` +
    `${mail.cancelLink}\n`,
  en: (mail) =>
    `Hello,\n\n` +
    `An account that signs in with this address asked to move its sign-in email to "${mail.newEmail}".\n` +
    `Until the new address is confirmed, sign-in and password recovery for this address keep working.\n\n` +
    `If that was not you, open this link to cancel the change:\n` +
    `${mail.cancelLink}\n`,
  es: (mail) =>
    `Hola:\n\n` +
    `Una cuenta que inicia sesión con esta dirección pidió cambiar su correo de acceso a «${mail.newEmail}".\n` +
    `Hasta que la nueva dirección se confirme, el acceso y la recuperación de contraseña de esta dirección siguen funcionando.\n\n` +
    `Si no fuiste tú, abre este enlace para cancelar el cambio:\n` +
    `${mail.cancelLink}\n`,
};

export async function sendEmailChangeVerifyEmail(env: Env, mail: EmailChangeVerifyEmail): Promise<void> {
  if (!env.SEND_EMAIL || !env.ALERT_FROM_EMAIL) throw new Error("email_path_missing");
  await env.SEND_EMAIL.send({
    to: mail.to,
    from: env.ALERT_FROM_EMAIL,
    subject: CHANGE_VERIFY_SUBJECT[mail.lang],
    text: CHANGE_VERIFY_BODY[mail.lang](mail),
  });
}

export async function sendEmailChangeNoticeEmail(env: Env, mail: EmailChangeNoticeEmail): Promise<void> {
  if (!env.SEND_EMAIL || !env.ALERT_FROM_EMAIL) throw new Error("email_path_missing");
  await env.SEND_EMAIL.send({
    to: mail.to,
    from: env.ALERT_FROM_EMAIL,
    subject: CHANGE_NOTICE_SUBJECT[mail.lang],
    text: CHANGE_NOTICE_BODY[mail.lang](mail),
  });
}

export async function sendQuotaAlertEmail(env: Env, alert: QuotaAlertEmail): Promise<void> {
  if (!env.SEND_EMAIL || !env.ALERT_FROM_EMAIL) throw new Error("email_path_missing");
  const message: EmailMessageBuilder = {
    to: alert.to,
    from: env.ALERT_FROM_EMAIL,
    subject: SUBJECT[alert.lang](alert.provider, alert.threshold),
    text: BODY[alert.lang](alert),
  };
  await env.SEND_EMAIL.send(message);
}

export interface AdminQuotaAlertEmail {
  to: string;
  provider: string;
  threshold: number;
  spend: string;
  quota: string;
}

const ADMIN_SUBJECT: Record<Lang, (provider: string, threshold: number) => string> = {
  zh: (provider, threshold) => `【蘇格拉底教室】平台池 ${provider} 額度已達 ${threshold}%`,
  en: (provider, threshold) =>
    `[Socrates Classroom] platform pool ${provider} usage at ${threshold}% of the monthly quota`,
  es: (provider, threshold) =>
    `[Aula de Sócrates] ${provider} (pool de plataforma) al ${threshold}% de la cuota mensual`,
};

const ADMIN_BODY: Record<Lang, (alert: Omit<AdminQuotaAlertEmail, "to">) => string> = {
  zh: (alert) =>
    `管理員您好：\n\n` +
    `平台池的 ${alert.provider} admin key 本月累計用量約 ${money(alert.spend)}／額度 ${money(alert.quota)}（${alert.threshold}%）。\n` +
    `同一水位本月只會提醒一次，下個月自動重置。\n` +
    `調整額度請到 admin console 的 provider 管理。\n`,
  en: (alert) =>
    `Hello admin,\n\n` +
    `The ${alert.provider} admin key of the platform pool has used about ${money(alert.spend)} of its ${money(alert.quota)} monthly quota (${alert.threshold}%).\n` +
    `Each threshold is announced once per month and resets next month.\n` +
    `Adjust the quota in the admin console provider management.\n`,
  es: (alert) =>
    `Hola:\n\n` +
    `La admin key de ${alert.provider} del pool de plataforma ha usado unos ${money(alert.spend)} de su cuota mensual de ${money(alert.quota)} (${alert.threshold}%).\n` +
    `Cada nivel se avisa una sola vez al mes y se reinicia el mes que viene.\n` +
    `Ajusta la cuota en la gestión de proveedores de la consola de administración.\n`,
};

export async function sendAdminQuotaAlertEmail(env: Env, alert: AdminQuotaAlertEmail): Promise<void> {
  if (!env.SEND_EMAIL || !env.ALERT_FROM_EMAIL) throw new Error("email_path_missing");
  await env.SEND_EMAIL.send({
    to: alert.to,
    from: env.ALERT_FROM_EMAIL,
    subject: ADMIN_SUBJECT.zh(alert.provider, alert.threshold),
    text: ADMIN_BODY.zh(alert),
  });
}

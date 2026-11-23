import { rememberClassroomInvite } from "@/lib/classroomInvite";
import { meOf, meQueryOptions } from "@/api/me";
import { authProvidersOptions, notificationsOptions } from "@/api/queries";
import { useState } from "react";
import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api, ApiError, type User } from "@/api";
import { StoaField } from "@/components/StoaField";
import { cn, Spinner } from "@/components/ui";
import { locales, setLocale, useI18n, useT, type Locale, type MessageKey } from "@/i18n";
import { OAUTH_PROVIDERS, type ErrorCode, type OAuthProvider } from "@socrates/shared";

type Mode = "login" | "register";

interface LoginSearch {
  mode?: Mode;
  next?: string;
  error?: string;
}

function safeNext(next: string | undefined): string {
  if (!next?.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/home";
  return next;
}

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    mode: search.mode === "register" ? "register" : search.mode === "login" ? "login" : undefined,
    next: typeof search.next === "string" ? search.next : undefined,
    error: typeof search.error === "string" ? search.error : undefined,
  }),
  beforeLoad: async ({ context, search }) => {
    const me = await meOf(context.queryClient);
    if (me) throw redirect({ href: me.isAdmin && !search.next ? "/admin" : safeNext(search.next) });
  },
  component: LoginPage,
});

const ERROR_KEYS: Record<string, MessageKey> = {
  oauth_unavailable: "login_err_oauth_unavailable",
  oauth_failed: "login_err_oauth_failed",
  oauth_state_invalid: "login_err_oauth_state",
  oauth_email_unverified: "login_err_oauth_unverified",
  account_disabled: "login_err_account_disabled",
};

const SUBMIT_ERROR_KEYS: Partial<Record<ErrorCode, MessageKey>> = {
  unauthorized: "login_err_credentials",
  conflict: "login_err_email_taken",
  email_taken: "login_err_email_taken",
  validation: "login_err_validation",
  account_disabled: "login_err_account_disabled",
  rate_limited: "login_err_rate_limited",
};

const PROVIDER_LABELS: Record<OAuthProvider, MessageKey> = {
  google: "login_google",
  facebook: "login_facebook",
};

const RIGHT_COLUMN_PX = 680;
const BOX = "border-[1.5px] border-comic-ink";
const FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vermilion";
const INPUT = cn(
  BOX,
  "h-[42px] w-full min-w-0 rounded-none bg-comic-paper px-3 text-[14px] text-comic-ink placeholder:text-comic-graphite/60",
  FOCUS,
);
const LABEL = "flex flex-col gap-1.5 text-[12.5px] font-medium";

function NoticeBar() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const feed = useQuery(notificationsOptions);
  const items = feed.data?.items ?? [];
  const latest = items[0];
  if (!feed.isSuccess) return null;
  return (
    <div className={cn(BOX, "bg-comic-paper text-[12.5px]")}>
      <div className="flex items-center gap-2.5 px-3.5 py-2.5">
        <span className="shrink-0 font-dot">{t("notify_board")} ·</span>
        {latest ? (
          <>
            <span className="min-w-0 flex-1 truncate">{latest.title}</span>
            {items.length > 1 && (
              <button
                type="button"
                aria-expanded={open}
                onClick={() => setOpen((value) => !value)}
                className={cn("shrink-0 cursor-pointer text-comic-soft underline", FOCUS)}
              >
                {open ? t("login_notice_less") : `${t("login_notice_all")} →`}
              </button>
            )}
          </>
        ) : (
          <span className="flex-1 text-comic-soft">{t("notify_empty")}</span>
        )}
      </div>
      {open && (
        <ul className="max-h-56 overflow-y-auto border-t-2 border-dotted border-comic-ink px-3.5 py-2">
          {items.slice(1).map((item) => (
            <li key={item.id} className="py-1.5">
              <p className="font-medium">{item.title}</p>
              {item.body && <p className="line-clamp-2 text-comic-soft">{item.body}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function LoginPage() {
  const t = useT();
  const { locale } = useI18n();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const next = safeNext(search.next);
  const [mode, setMode] = useState<Mode>(search.mode ?? "login");
  const [busy, setBusy] = useState(false);
  const [joinCode, setJoinCode] = useState("");
  const [errorKey, setErrorKey] = useState<MessageKey | null>(
    search.error && ERROR_KEYS[search.error] ? ERROR_KEYS[search.error] : null,
  );
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tos, setTos] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const providers = useQuery(authProvidersOptions);
  const me = useQuery({ ...meQueryOptions, enabled: false });

  async function run(action: () => Promise<User>) {
    if (busy) return;
    setErrorKey(null);
    setBusy(true);
    try {
      const user = await action();
      queryClient.setQueryData(meQueryOptions.queryKey, user);
      await navigate({ href: user.isAdmin && !search.next ? "/admin" : next });
    } catch (caught) {
      setErrorKey((caught instanceof ApiError && SUBMIT_ERROR_KEYS[caught.code]) || "common_error");
    } finally {
      setBusy(false);
    }
  }

  function goBack() {
    if (window.history.length > 1) window.history.back();
    else void navigate({ to: "/home" });
  }

  const formReady = email.trim() && password.length >= 8 && (mode === "login" || (name.trim() && tos)) && !busy;
  const title = mode === "login" ? t("login_title") : t("register_title");

  return (
    <div className="relative flex min-h-dvh flex-col overflow-x-hidden bg-comic-ground bg-[radial-gradient(var(--color-comic-dot)_1.1px,transparent_1.5px)] bg-size-[12px_12px] font-sans text-comic-ink [color-scheme:light] lg:grid lg:min-h-[max(100dvh,640px)] lg:grid-cols-[minmax(0,1fr)_minmax(600px,58%)] lg:overflow-clip">
      <StoaField reserve={RIGHT_COLUMN_PX} className="opacity-35 max-lg:hidden" />

      <section className="relative flex flex-col gap-6 px-4 pt-6 sm:px-8 lg:sticky lg:top-0 lg:h-dvh lg:min-h-[640px] lg:self-start lg:px-16 lg:pt-14">
        <div className="flex flex-wrap items-center gap-3">
          <Link to="/" className={cn(BOX, "inline-flex items-center gap-3 bg-comic-paper pr-3.5", FOCUS)}>
            <span className="flex size-10 items-center justify-center bg-comic-ink text-[20px] font-bold text-comic-paper">
              {t("app_mark")}
            </span>
            <span className="text-[13px] font-bold tracking-[0.3em] uppercase">{t("brand_name")}</span>
          </Link>
          <Link
            to="/"
            className={cn(
              BOX,
              "flex h-10 items-center gap-1.5 bg-comic-paper px-3 text-[12.5px] hover:bg-comic-ink hover:text-comic-paper",
              FOCUS,
            )}
          >
            <ArrowLeft className="size-3.5" />
            {t("login_back_to_story")}
          </Link>
          <fieldset className={cn(BOX, "m-0 flex h-10 p-0")}>
            <legend className="sr-only">{t("settings_lang")}</legend>
            {locales.map((code: Locale) => (
              <button
                key={code}
                type="button"
                lang={code}
                aria-pressed={locale === code}
                onClick={() => setLocale(code)}
                className={cn(
                  "cursor-pointer px-3 text-[12.5px] not-first:border-l-[1.5px] not-first:border-comic-ink",
                  locale === code ? "bg-comic-ink font-bold text-comic-paper" : "bg-comic-paper hover:bg-comic-ground",
                  FOCUS,
                )}
              >
                {code === "zh-TW" ? "中" : code === "en" ? "EN" : "ES"}
              </button>
            ))}
          </fieldset>
          <span className="flex-1" />
          {me.data && (
            <button
              type="button"
              onClick={goBack}
              className={cn(
                BOX,
                "flex h-10 cursor-pointer items-center gap-1.5 bg-comic-paper px-3 text-[12.5px] hover:bg-comic-ink hover:text-comic-paper",
                FOCUS,
              )}
            >
              <ArrowLeft className="size-3.5" />
              {t("common_back")}
            </button>
          )}
        </div>

        <div className="flex max-w-[520px] flex-col gap-4 lg:absolute lg:bottom-16 lg:left-16 lg:w-[calc(100%-8rem)]">
          <NoticeBar />
          <div className={cn(BOX, "bg-comic-paper/85 px-6 py-5 lg:px-7 lg:py-6")}>
            <h1 className="font-serif text-[32px] leading-[1.2] font-black tracking-[-0.01em] whitespace-pre-line lg:text-[44px]">
              {t("login_hero_title")}
            </h1>
            <p className="mt-4 text-end font-dot text-[14px] tracking-[0.12em] text-comic-soft lg:text-[15px]">
              <span aria-hidden>· · · </span>
              {t("login_hero_tagline")}
            </p>
          </div>
        </div>
      </section>

      <section className="relative mx-auto flex w-full max-w-[560px] flex-col justify-center gap-5 px-4 py-8 sm:px-8 lg:mx-0 lg:max-w-none lg:px-12 lg:py-12 lg:short:gap-3 lg:short:py-3 lg:*:mx-auto lg:*:w-full lg:*:max-w-[460px]">
        <div className="relative">
          <div aria-hidden className="absolute inset-[8px_-8px_-8px_8px] bg-comic-ink" />
          <div className={cn(BOX, "relative bg-comic-paper p-5 sm:p-7 lg:short:p-5")}>
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-serif text-[28px] leading-tight font-black">{title}</h2>
              <fieldset className={cn(BOX, "m-0 flex p-0")}>
                <legend className="sr-only">{t("login_mode")}</legend>
                {(["login", "register"] as const).map((value) => (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={mode === value}
                    onClick={() => {
                      setMode(value);
                      setErrorKey(null);
                    }}
                    className={cn(
                      "cursor-pointer px-3.5 py-1.5 text-[13px] not-first:border-l-[1.5px] not-first:border-comic-ink",
                      mode === value ? "bg-ht-accent font-bold" : "bg-comic-paper hover:bg-comic-ground",
                      FOCUS,
                    )}
                  >
                    {value === "login" ? t("login_title") : t("register_title")}
                  </button>
                ))}
              </fieldset>
            </div>
            <p className="mt-1.5 mb-5 text-[13px] text-comic-soft lg:short:mb-3">{t("login_hint")}</p>

            <div className="grid grid-cols-1 gap-2">
              {OAUTH_PROVIDERS.map((id) => {
                const enabled = providers.data?.providers.includes(id) ?? false;
                const label = t(PROVIDER_LABELS[id]);
                const body = (
                  <>
                    <i aria-hidden className="size-2 rounded-full bg-current" />
                    {label}
                  </>
                );
                const base = cn(BOX, "flex h-10 items-center gap-3 bg-comic-paper px-3.5 text-[13.5px]");
                return enabled ? (
                  <a
                    key={id}
                    href={`/api/auth/oauth/${id}/start`}
                    onClick={() => rememberClassroomInvite(next)}
                    aria-label={label}
                    className={cn(base, "hover:bg-comic-ink hover:text-comic-paper", FOCUS)}
                  >
                    {body}
                  </a>
                ) : (
                  <button
                    type="button"
                    disabled
                    key={id}
                    aria-label={`${label} · ${t("login_provider_off")}`}
                    title={t("login_provider_off")}
                    className={cn(base, "cursor-not-allowed border-dashed text-comic-graphite/70")}
                  >
                    {body}
                  </button>
                );
              })}
            </div>

            <div className="my-[18px] flex items-center gap-3 text-[12px] text-comic-soft lg:short:my-2">
              <span className="flex-1 border-t-2 border-dotted border-comic-ink" />
              {t("login_or")}
              <span className="flex-1 border-t-2 border-dotted border-comic-ink" />
            </div>

            <form
              className="flex flex-col gap-3.5 lg:short:gap-2.5"
              onSubmit={(event) => {
                event.preventDefault();
                if (!formReady) return;
                void run(() =>
                  mode === "login"
                    ? api.login(email.trim(), password)
                    : api.signup({ name: name.trim(), email: email.trim(), password, tosAccepted: tos }),
                );
              }}
            >
              {mode === "register" && (
                <label className={LABEL}>
                  {t("register_name")}
                  <input
                    type="text"
                    autoComplete="name"
                    maxLength={80}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                    className={INPUT}
                  />
                </label>
              )}
              <label className={LABEL}>
                {t("login_email")}
                <input
                  type="email"
                  autoComplete="email"
                  autoCapitalize="none"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  className={INPUT}
                />
              </label>
              <label className={LABEL} htmlFor="login-password">
                {t("login_password")}
              </label>
              <span className="relative block">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={8}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  className={cn(INPUT, "pr-16")}
                />
                <button
                  type="button"
                  aria-pressed={showPassword}
                  aria-controls="login-password"
                  onClick={() => setShowPassword((value) => !value)}
                  className={cn("absolute inset-y-1.5 right-1.5 cursor-pointer px-2 text-[12px] underline", FOCUS)}
                >
                  {showPassword ? t("password_hide") : t("password_show")}
                </button>
              </span>
              <label
                aria-hidden={mode === "login"}
                className={cn(
                  "flex cursor-pointer items-start gap-2.5 text-[12.5px] leading-relaxed",
                  mode === "login" && "invisible lg:short:hidden",
                )}
              >
                <input
                  type="checkbox"
                  checked={tos}
                  disabled={mode === "login"}
                  onChange={(event) => setTos(event.target.checked)}
                  className={cn("mt-1 size-4 shrink-0 cursor-pointer accent-comic-ink", FOCUS)}
                />
                {t("join_tos")}
              </label>
              {errorKey && (
                <p role="alert" className="text-[12.5px] text-vermilion">
                  {t(errorKey)}
                </p>
              )}
              <button
                type="submit"
                disabled={!formReady}
                aria-busy={busy}
                className={cn(
                  BOX,
                  "flex h-[46px] cursor-pointer items-center justify-between bg-ht-accent px-[18px] text-[15px] font-bold enabled:hover:shadow-[3px_3px_0_var(--color-comic-ink)] disabled:cursor-not-allowed disabled:opacity-55",
                  FOCUS,
                )}
              >
                {mode === "login" ? t("login_title") : t("register_submit")}
                {busy ? (
                  <Spinner className="border-comic-ink/25 border-t-comic-ink" />
                ) : (
                  <span aria-hidden className="font-dot tracking-[0.2em]">
                    ● ● ●
                  </span>
                )}
              </button>
              {mode === "login" && (
                <Link
                  to="/forgot-password"
                  className={cn("self-end text-[12.5px] underline underline-offset-4", FOCUS)}
                >
                  {t("login_forgot")}
                </Link>
              )}
            </form>
          </div>
        </div>

        <form
          className="border-[1.5px] border-dashed border-comic-ink bg-comic-paper/75 px-5 py-4 lg:short:py-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            const code = joinCode.trim().toLowerCase();
            if (code) void navigate({ to: "/join/$code", params: { code } });
          }}
        >
          <label htmlFor="join-code" className="block text-[13px] font-bold">
            {t("login_have_code")}
          </label>
          <div className="mt-2 flex gap-2">
            <input
              id="join-code"
              value={joinCode}
              autoCapitalize="none"
              autoComplete="off"
              placeholder={t("login_code_placeholder")}
              onChange={(event) => setJoinCode(event.target.value)}
              className={cn(INPUT, "font-dot tracking-[0.3em]")}
            />
            <button
              type="submit"
              disabled={!joinCode.trim()}
              className={cn(
                BOX,
                "shrink-0 cursor-pointer bg-comic-ink px-[18px] text-[14px] font-bold text-comic-paper disabled:cursor-not-allowed disabled:opacity-55",
                FOCUS,
              )}
            >
              {t("login_code_go")}
            </button>
          </div>
          <p className="mt-2 text-[12px] leading-[1.7] text-comic-soft">{t("login_guest_hint")}</p>
        </form>
      </section>
    </div>
  );
}

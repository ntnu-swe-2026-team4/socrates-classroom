import { useState, type ReactNode } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft } from "lucide-react";
import { api, ApiError, type User } from "@/api";
import { Button, Checkbox, Field, Initial, Input, Segmented, Spinner } from "@/components/ui";
import { useT, type MessageKey } from "@/i18n";
import type { AuthProvider } from "@socrates/shared";

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
  component: LoginPage,
});

const ERROR_KEYS: Record<string, MessageKey> = {
  oauth_unavailable: "login_err_oauth_unavailable",
  oauth_failed: "login_err_oauth_failed",
};

const PROVIDERS: Array<{ id: AuthProvider; label: MessageKey; icon: ReactNode }> = [
  {
    id: "google",
    label: "login_google",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-current">
        <path d="M21.6 12.23c0-.68-.06-1.36-.18-2.02H12v3.83h5.4a4.6 4.6 0 0 1-2 3.02v2.5h3.24c1.9-1.75 2.96-4.33 2.96-7.33ZM12 22c2.7 0 4.98-.9 6.64-2.44l-3.24-2.5c-.9.6-2.05.96-3.4.96-2.6 0-4.82-1.76-5.6-4.13H3.06v2.58A10 10 0 0 0 12 22Zm-5.6-8.11a6 6 0 0 1 0-3.78V7.53H3.06a10 10 0 0 0 0 8.94l3.34-2.58ZM12 5.98c1.47 0 2.8.5 3.84 1.5l2.88-2.88A9.65 9.65 0 0 0 12 2a10 10 0 0 0-8.94 5.53l3.34 2.58C7.18 7.74 9.4 5.98 12 5.98Z" />
      </svg>
    ),
  },
  {
    id: "apple",
    label: "login_apple",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-current">
        <path d="M16.37 12.6c-.02-2.1 1.72-3.12 1.8-3.17a3.88 3.88 0 0 0-3.05-1.65c-1.3-.13-2.54.77-3.2.77-.66 0-1.67-.75-2.75-.73a4.07 4.07 0 0 0-3.44 2.08c-1.47 2.55-.38 6.32 1.05 8.39.7 1.01 1.53 2.15 2.62 2.11 1.05-.04 1.45-.68 2.72-.68 1.27 0 1.62.68 2.73.66 1.13-.02 1.85-1.03 2.54-2.05a8.9 8.9 0 0 0 1.15-2.36 3.66 3.66 0 0 1-2.17-3.37ZM14.3 6.43c.58-.7.97-1.68.86-2.65-.83.03-1.84.55-2.44 1.25-.53.62-1 1.6-.88 2.56.93.07 1.88-.47 2.46-1.16Z" />
      </svg>
    ),
  },
  {
    id: "facebook",
    label: "login_facebook",
    icon: (
      <svg viewBox="0 0 24 24" aria-hidden className="size-4 fill-current">
        <path d="M22 12.06A10 10 0 1 0 10.44 22v-7.03H7.9v-2.9h2.54V9.85c0-2.52 1.49-3.91 3.78-3.91 1.1 0 2.24.2 2.24.2v2.47h-1.26c-1.24 0-1.63.78-1.63 1.57v1.88h2.78l-.45 2.9h-2.33V22A10 10 0 0 0 22 12.06Z" />
      </svg>
    ),
  },
];

function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const search = Route.useSearch();
  const next = safeNext(search.next);
  const [mode, setMode] = useState<Mode>(search.mode ?? "login");
  const [busy, setBusy] = useState<"form" | "guest" | null>(null);
  const [error, setError] = useState(search.error && ERROR_KEYS[search.error] ? t(ERROR_KEYS[search.error]!) : "");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tos, setTos] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const providers = useQuery({ queryKey: ["authProviders"], queryFn: () => api.authProviders(), staleTime: Infinity });
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });

  async function run(kind: "form" | "guest", action: () => Promise<User>) {
    if (busy) return;
    setError("");
    setBusy(kind);
    try {
      const user = await action();
      queryClient.setQueryData(["me"], user);
      await navigate({ href: next });
    } catch (caught) {
      const code = caught instanceof ApiError ? caught.code : null;
      setError(
        code === "unauthorized"
          ? t("login_err_credentials")
          : code === "conflict"
            ? t("login_err_email_taken")
            : code === "validation"
              ? t("login_err_validation")
              : t("common_error"),
      );
      setBusy(null);
    }
  }

  const signedIn = me.data && !me.data.guest && !me.data.preview ? me.data : null;
  const [switching, setSwitching] = useState(false);

  async function switchAccount() {
    if (switching) return;
    setSwitching(true);
    try {
      await api.logout();
    } finally {
      queryClient.clear();
      queryClient.setQueryData(["me"], null);
      setSwitching(false);
    }
  }

  function goBack() {
    if (window.history.length > 1) window.history.back();
    else void navigate({ to: "/home" });
  }

  const formReady = email.trim() && password.length >= 8 && (mode === "login" || tos) && !busy;

  return (
    <div className="flex min-h-dvh items-center justify-center bg-paper px-4 py-8">
      <div className="w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-card">
        <div className="border-b border-line px-5 pt-4 pb-4">
          <div className="flex items-center justify-between gap-2">
            <Link to="/" className="font-serif text-[15px] text-ink">
              {t("app_name")} <span className="text-[12px] text-ink-faint">{t("app_sub")}</span>
            </Link>
            {me.data && (
              <button
                type="button"
                onClick={goBack}
                className="flex cursor-pointer items-center gap-1 rounded-full px-2 py-1 text-[12.5px] text-ink-soft hover:bg-paper-deep hover:text-ink"
              >
                <ArrowLeft className="size-3.5" />
                {t("common_back")}
              </button>
            )}
          </div>
          <h1 className="mt-3 font-serif text-[22px] leading-snug text-ink">
            {mode === "login" ? t("login_title") : t("register_title")}
          </h1>
          <p className="mt-0.5 text-[12.5px] text-ink-soft">{t("login_hint")}</p>
        </div>

        {signedIn ? (
          <div className="flex flex-col gap-3 px-5 py-5">
            <p className="text-[12.5px] text-ink-soft">{t("login_signed_in_as")}</p>
            <div className="flex items-center gap-3 rounded-2xl border border-line bg-paper px-3 py-3">
              <Initial name={signedIn.name} className="size-10 text-base" />
              <span className="min-w-0 flex-1 truncate font-serif text-[15px] text-ink">{signedIn.name}</span>
            </div>
            <Button onClick={() => void navigate({ href: next })}>
              {t("login_continue_as", { name: signedIn.name })}
            </Button>
            <Button variant="outline" disabled={switching} onClick={() => void switchAccount()}>
              {switching ? <Spinner /> : t("login_switch_account")}
            </Button>
          </div>
        ) : (
          <>
            <div className="flex flex-col gap-2 px-5 pt-4">
              {PROVIDERS.map((provider) => {
                const enabled = providers.data?.[provider.id] ?? false;
                const href = `/api/auth/oauth/${provider.id}/start?next=${encodeURIComponent(next)}`;
                return enabled ? (
                  <a
                    key={provider.id}
                    href={href}
                    className="flex h-9 items-center justify-center gap-2 rounded-full border border-line-strong bg-paper text-[13.5px] text-ink transition-colors hover:border-ember"
                  >
                    {provider.icon}
                    {t(provider.label)}
                  </a>
                ) : (
                  <span
                    key={provider.id}
                    aria-disabled="true"
                    title={t("login_provider_off")}
                    className="flex h-9 cursor-not-allowed items-center justify-center gap-2 rounded-full border border-line bg-paper text-[13.5px] text-ink-faint"
                  >
                    {provider.icon}
                    {t(provider.label)}
                  </span>
                );
              })}
            </div>

            <div className="flex items-center gap-3 px-5 py-3 text-[11.5px] text-ink-faint">
              <span className="h-px flex-1 bg-line" />
              {t("login_or")}
              <span className="h-px flex-1 bg-line" />
            </div>

            <form
              className="flex flex-col gap-3 px-5"
              onSubmit={(event) => {
                event.preventDefault();
                if (!formReady) return;
                void run("form", () =>
                  mode === "login"
                    ? api.login(email.trim(), password)
                    : api.register({ email: email.trim(), password }),
                );
              }}
            >
              <Segmented
                label={t("login_mode")}
                value={mode}
                onChange={(value) => {
                  setMode(value);
                  setError("");
                }}
                items={[
                  { value: "login", label: t("login_title") },
                  { value: "register", label: t("register_title") },
                ]}
              />
              <Field label={t("login_email")}>
                <Input
                  type="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                />
              </Field>
              <Field label={t("login_password")}>
                <div className="relative">
                  <Input
                    type={showPassword ? "text" : "password"}
                    autoComplete={mode === "login" ? "current-password" : "new-password"}
                    minLength={8}
                    placeholder="••••••••"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    className="pr-16"
                  />
                  <button
                    type="button"
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword((value) => !value)}
                    className="absolute inset-y-0 right-1 my-1 cursor-pointer rounded-full px-2.5 text-[12px] text-ink-soft hover:bg-paper-deep hover:text-ink"
                  >
                    {showPassword ? t("password_hide") : t("password_show")}
                  </button>
                </div>
              </Field>
              {mode === "register" && (
                <>
                  <Checkbox label={t("join_tos")} checked={tos} onCheckedChange={setTos} />
                  {me.data?.guest && !me.data.preview && (
                    <p className="text-[12px] leading-relaxed text-ink-soft">{t("register_keeps_guest")}</p>
                  )}
                </>
              )}
              {error && (
                <p role="alert" className="text-[12.5px] text-flag">
                  {error}
                </p>
              )}
              <Button type="submit" disabled={!formReady}>
                {busy === "form" ? <Spinner /> : mode === "login" ? t("login_title") : t("register_submit")}
              </Button>
            </form>

            <div className="mt-4 border-t border-line px-5 py-4">
              {me.data?.guest && !me.data.preview ? (
                <Button variant="ghost" className="w-full" onClick={goBack}>
                  {t("login_continue_guest", { name: me.data.name })}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="w-full"
                  disabled={busy !== null}
                  onClick={() => void run("guest", () => api.loginAsGuest())}
                >
                  {busy === "guest" ? <Spinner /> : t("login_guest")}
                </Button>
              )}
              <p className="mt-2 text-center text-[11.5px] leading-relaxed text-ink-faint">{t("login_guest_hint")}</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

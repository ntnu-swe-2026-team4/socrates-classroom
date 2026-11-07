import { useState } from "react";
import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, type User } from "@/api";
import { useT } from "@/i18n";
import { LoginScreen } from "@/landing/LandingChrome";
import { safeNext } from "@/lib/safeNext";

export const Route = createFileRoute("/login")({
  validateSearch: (search: Record<string, unknown>): { next?: string } => ({ next: safeNext(search.next) }),
  component: LoginPage,
});

type Busy = "form" | "guest" | "teacher" | null;

function LoginPage() {
  const t = useT();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { next } = Route.useSearch();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState("");

  async function run(kind: Exclude<Busy, null>, action: () => Promise<User>, failure: string) {
    if (busy) return;
    setError("");
    setBusy(kind);
    try {
      const user = await action();
      queryClient.setQueryData(["me"], user);
      await queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "me" });
      router.history.push(next ?? "/home");
    } catch {
      setError(failure);
      setBusy(null);
    }
  }

  function submit() {
    if (mode === "login") void run("form", () => api.login(email.trim(), password), t("login_failed"));
    else
      void run("form", () => api.register({ name: name.trim(), email: email.trim(), password }), t("register_failed"));
  }

  return (
    <LoginScreen label={t("login_title")}>
      <div className="login-card login-card-split login-card-single" data-running="true">
        <div className="login-card-left">
          <p className="login-eyebrow">{t("app_sub")}</p>
          <h2 id="login-title">{mode === "login" ? t("login_title") : t("register_title")}</h2>
          <p className="sub">{mode === "login" ? t("login_hint_guest") : t("register_note")}</p>

          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            {mode === "signup" && (
              <div className="field">
                <label htmlFor="account-name">{t("join_name_label")}</label>
                <input
                  id="account-name"
                  autoComplete="name"
                  value={name}
                  maxLength={40}
                  onChange={(event) => setName(event.target.value)}
                  required
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="account-email">{t("login_email")}</label>
              <input
                id="account-email"
                type="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="account-password">{t("login_password")}</label>
              <div className="password-field">
                <input
                  id="account-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete={mode === "login" ? "current-password" : "new-password"}
                  minLength={8}
                  placeholder="••••••••"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                />
                <button
                  type="button"
                  className="password-toggle"
                  aria-pressed={showPassword}
                  onClick={() => setShowPassword((v) => !v)}
                >
                  {showPassword ? t("password_hide") : t("password_show")}
                </button>
              </div>
            </div>
            {error && (
              <p className="entry-error" role="alert" style={{ margin: 0 }}>
                {error}
              </p>
            )}
            <button className="pill-btn primary full account-submit" type="submit" disabled={busy !== null}>
              {busy === "form" ? t("dlg_thinking") : mode === "login" ? t("login_title") : t("register_title")}
            </button>
          </form>

          <button
            type="button"
            className="auth-forgot"
            style={{ display: "block", margin: "14px auto 0", color: "var(--bronze)", cursor: "pointer" }}
            onClick={() => {
              setMode(mode === "login" ? "signup" : "login");
              setError("");
            }}
          >
            {mode === "login" ? t("login_to_signup") : t("login_to_login")}
          </button>

          <div className="login-or">
            <span>{t("login_or")}</span>
          </div>

          <div className="login-alt">
            <button
              type="button"
              className="pill-btn"
              disabled={busy !== null}
              aria-busy={busy === "guest"}
              onClick={() => void run("guest", () => api.guest(), t("common_error"))}
            >
              {busy === "guest" ? t("dlg_thinking") : t("login_guest_student")}
              <span aria-hidden="true">→</span>
            </button>
            <button
              type="button"
              className="pill-btn"
              disabled={busy !== null}
              aria-busy={busy === "teacher"}
              onClick={() => void run("teacher", () => api.login("demo@socrates.tw", "demo-demo"), t("common_error"))}
            >
              {busy === "teacher" ? t("dlg_thinking") : t("login_demo_teacher")}
              <span aria-hidden="true">→</span>
            </button>
          </div>
        </div>
      </div>
    </LoginScreen>
  );
}

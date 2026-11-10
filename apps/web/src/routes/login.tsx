import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { useT } from "@/i18n";
import { LoginScreen } from "@/landing/LandingChrome";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"teacher" | "form" | null>(null);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  async function run(kind: "teacher" | "form", action: () => Promise<unknown>) {
    if (busy) return;
    setError("");
    setBusy(kind);
    try {
      const user = await action();
      queryClient.setQueryData(["me"], user);
      await navigate({ to: "/t/setup" });
    } catch {
      setError(t("common_error"));
      setBusy(null);
    }
  }

  return (
    <LoginScreen label={t("login_title")}>
      <div className="login-card login-card-split login-card-single" data-running="true">
        <div className="login-card-left">
          <p className="login-eyebrow">{t("app_sub")}</p>
          <h2 id="login-title">{t("login_title")}</h2>
          <p className="sub">{t("login_hint")}</p>

          <form
            className="auth-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run("form", () => api.login(email.trim(), password));
            }}
          >
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
                  autoComplete="current-password"
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
              {busy === "form" ? t("dlg_thinking") : t("login_title")}
            </button>
          </form>

          <div className="login-or">
            <span>{t("login_or")}</span>
          </div>

          <div className="login-alt">
            <button
              type="button"
              className="pill-btn"
              disabled={busy !== null}
              onClick={() => void navigate({ to: "/join" })}
            >
              {t("login_guest")}
            </button>
            <button
              type="button"
              className="pill-btn"
              disabled={busy !== null}
              aria-busy={busy === "teacher"}
              onClick={() => void run("teacher", () => api.login("demo@socrates.tw", "demo-demo"))}
            >
              {busy === "teacher" ? t("dlg_thinking") : t("login_demo_teacher")}
            </button>
          </div>
        </div>
      </div>
    </LoginScreen>
  );
}

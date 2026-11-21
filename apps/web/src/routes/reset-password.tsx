import { useState } from "react";
import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { api, ApiError } from "@/api";
import { Button, buttonStyles, Field, Input } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/reset-password")({
  component: ResetPasswordPage,
});

function tokenOf(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, "")).get("token") ?? "";
}

function ResetPasswordPage() {
  const t = useT();
  const navigate = useNavigate();
  const token = useRouterState({ select: (state) => tokenOf(state.location.hash) });
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [state, setState] = useState<"idle" | "busy" | "done" | "invalid" | "error">("idle");

  async function submit() {
    if (state === "busy") return;
    setState("busy");
    try {
      await api.resetPassword(token, password);
      setState("done");
      void navigate({ to: "/reset-password", hash: "", replace: true });
    } catch (error) {
      setState(error instanceof ApiError && error.code === "reset_token_invalid" ? "invalid" : "error");
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-ink">{t("reset_title")}</h1>
        {state === "done" ? (
          <div className="mt-3 flex flex-col items-start gap-4">
            <p role="status" className="text-sm leading-relaxed text-ink-soft">
              {t("reset_done")}
            </p>
            <Link to="/login" className={buttonStyles({ variant: "primary" })}>
              {t("login_title")}
            </Link>
          </div>
        ) : !token || state === "invalid" ? (
          <div className="mt-3 flex flex-col items-start gap-4">
            <p role="alert" className="text-sm leading-relaxed text-flag">
              {t("reset_invalid")}
            </p>
            <Link to="/forgot-password" className={buttonStyles({ variant: "outline" })}>
              {t("reset_request_again")}
            </Link>
          </div>
        ) : (
          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <Field label={t("reset_new_password")}>
              <Input
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                minLength={8}
                maxLength={128}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
            </Field>
            <Button
              variant="ghost"
              size="sm"
              className="self-start"
              aria-pressed={showPassword}
              onClick={() => setShowPassword((shown) => !shown)}
            >
              {showPassword ? t("password_hide") : t("password_show")}
            </Button>
            {state === "error" && (
              <p role="alert" className="text-[13px] text-flag">
                {t("common_error")}
              </p>
            )}
            <Button type="submit" disabled={state === "busy"} aria-busy={state === "busy"}>
              {state === "busy" ? t("dlg_thinking") : t("reset_submit")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

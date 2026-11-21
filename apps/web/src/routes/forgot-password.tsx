import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { api } from "@/api";
import { Button, Field, Input } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/forgot-password")({
  component: ForgotPasswordPage,
});

function ForgotPasswordPage() {
  const t = useT();
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "sent" | "error">("idle");

  async function submit() {
    if (state === "busy") return;
    setState("busy");
    try {
      await api.requestPasswordReset(email.trim());
      setState("sent");
    } catch {
      setState("error");
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-ink">{t("forgot_title")}</h1>
        {state === "sent" ? (
          <p role="status" className="mt-3 text-sm leading-relaxed text-ink-soft">
            {t("forgot_sent")}
          </p>
        ) : (
          <form
            className="mt-3 flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <p className="text-sm leading-relaxed text-ink-soft">{t("forgot_hint")}</p>
            <Field label={t("login_email")}>
              <Input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </Field>
            {state === "error" && (
              <p role="alert" className="text-[13px] text-flag">
                {t("common_error")}
              </p>
            )}
            <Button type="submit" disabled={state === "busy"} aria-busy={state === "busy"}>
              {state === "busy" ? t("dlg_thinking") : t("forgot_submit")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}

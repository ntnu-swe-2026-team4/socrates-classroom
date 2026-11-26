import { useState } from "react";
import { createFileRoute, Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, ApiError } from "@/api";
import { meQueryOptions } from "@/api/me";
import { Button, buttonStyles } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/verify-email")({
  component: VerifyEmailPage,
});

function tokenOf(hash: string): string {
  return new URLSearchParams(hash.replace(/^#/, "")).get("token") ?? "";
}

function VerifyEmailPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const token = useRouterState({ select: (state) => tokenOf(state.location.hash) });
  const [state, setState] = useState<"idle" | "busy" | "done" | "invalid" | "error">(token ? "idle" : "invalid");

  async function submit() {
    if (!token || state === "busy") return;
    setState("busy");
    try {
      await api.verifyEmail(token);
      await queryClient.invalidateQueries({ queryKey: meQueryOptions.queryKey });
      setState("done");
      await navigate({ to: "/verify-email", hash: "", replace: true });
    } catch (error) {
      setState(error instanceof ApiError && error.code === "verify_token_invalid" ? "invalid" : "error");
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-[22px] leading-tight font-semibold tracking-tight text-ink">{t("verify_title")}</h1>
        {(state === "idle" || state === "busy") && (
          <form
            className="mt-3 flex flex-col items-start gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <p className="text-sm leading-relaxed text-ink-soft">{t("verify_hint")}</p>
            <Button type="submit" disabled={state === "busy"} aria-busy={state === "busy"}>
              {state === "busy" ? t("verify_busy") : t("verify_submit")}
            </Button>
          </form>
        )}
        {state === "done" && (
          <div className="mt-3 flex flex-col items-start gap-4">
            <p role="status" className="text-sm leading-relaxed text-ink-soft">
              {t("verify_done")}
            </p>
            <Link to="/home" className={buttonStyles({ variant: "primary" })}>
              {t("verify_continue")}
            </Link>
          </div>
        )}
        {(state === "invalid" || state === "error") && (
          <div className="mt-3 flex flex-col items-start gap-4">
            <p role="alert" className="text-sm leading-relaxed text-flag">
              {state === "invalid" ? t("verify_invalid") : t("common_error")}
            </p>
            <Link to="/home" className={buttonStyles({ variant: "outline" })}>
              {t("verify_continue")}
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}

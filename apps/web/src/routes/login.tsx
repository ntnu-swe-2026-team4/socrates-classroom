import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api, DEFAULT_JOIN_CODE } from "@/api";
import { Button, Card, Field, Input, Spinner, Wordmark } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<"teacher" | null>(null);
  const [error, setError] = useState("");

  async function demoTeacher() {
    if (busy) return;
    setError("");
    setBusy("teacher");
    try {
      const user = await api.login("demo@socrates.tw", "demo-demo");
      queryClient.setQueryData(["me"], user);
      await navigate({ to: "/t/setup" });
    } catch {
      setError(t("common_error"));
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center px-6 py-16">
      <div className="flex flex-col items-center text-center">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-ink font-serif text-lg font-semibold text-paper shadow-sm">
          詰
        </span>
        <h1 className="mt-5 font-serif text-2xl font-semibold text-ink">{t("login_title")}</h1>
        <p className="mt-3 text-[13.5px] leading-[1.8] text-ink-soft">{t("login_hint")}</p>
      </div>

      <Card className="mt-8 flex flex-col gap-5 p-6 opacity-90" aria-label={t("login_title")}>
        <Field label={t("login_email")}>
          <Input type="email" placeholder="you@example.com" disabled />
        </Field>
        <Field label={t("login_password")}>
          <Input type="password" placeholder="••••••••" disabled />
        </Field>
        <Button disabled className="w-full">
          {t("login_title")}
        </Button>
      </Card>

      <div className="mt-6 flex flex-col gap-2.5">
        <Button
          variant="outline"
          onClick={() => void navigate({ to: "/join/$code", params: { code: DEFAULT_JOIN_CODE } })}
        >
          {t("login_guest")}
        </Button>
        <Button variant="ghost" onClick={() => void demoTeacher()} disabled={busy !== null}>
          {busy === "teacher" ? <Spinner /> : t("login_demo_teacher")}
        </Button>
        {error && (
          <p className="text-center text-[13px] text-flag" role="alert">
            {error}
          </p>
        )}
      </div>

      <div className="mt-10 flex justify-center">
        <Wordmark sub />
      </div>
    </div>
  );
}

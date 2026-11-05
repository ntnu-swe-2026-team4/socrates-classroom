import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { Button, Card, Field, Input, Spinner, Wordmark } from "@/components/ui";
import { useT } from "@/i18n";

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

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError("");
    setBusy("form");
    try {
      const user = await api.login(email, password);
      queryClient.setQueryData(["me"], user);
      await navigate({ to: "/t/setup" });
    } catch {
      setError(t("common_error"));
      setBusy(null);
    }
  }

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

      <Card className="mt-8 flex flex-col gap-5 p-6" aria-label={t("login_title")}>
        <form className="flex flex-col gap-5" onSubmit={(event) => void submit(event)}>
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
            <Input
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          {error ? <p className="text-[13px] text-flag">{error}</p> : null}
          <Button type="submit" disabled={busy !== null} className="w-full">
            {busy === "form" ? <Spinner /> : t("login_title")}
          </Button>
        </form>
      </Card>

      <div className="mt-6 flex flex-col gap-2.5">
        <Button variant="outline" onClick={() => void navigate({ to: "/join" })}>
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

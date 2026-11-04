import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { api } from "@/api";
import { Button, Field, Input, Spinner } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setPending(true);
    try {
      await api.login(email, password);
      await navigate({ to: "/t/setup" });
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="mx-auto flex w-full max-w-sm flex-col justify-center px-6 py-16">
      <h1 className="font-serif text-2xl font-semibold text-ink">{t("login_title")}</h1>
      <div className="mt-8 flex flex-col gap-5">
        <Field label={t("login_email")}>
          <Input
            type="email"
            required
            value={email}
            autoComplete="email"
            onChange={(event) => setEmail(event.target.value)}
          />
        </Field>
        <Field label={t("login_password")}>
          <Input
            type="password"
            required
            value={password}
            autoComplete="current-password"
            onChange={(event) => setPassword(event.target.value)}
          />
        </Field>
        <Button type="submit" size="lg" disabled={pending} className="mt-2 w-full">
          {pending ? <Spinner /> : t("login_submit")}
        </Button>
      </div>
      <p className="mt-6 text-[12.5px] leading-relaxed text-ink-faint">{t("login_hint")}</p>
    </form>
  );
}

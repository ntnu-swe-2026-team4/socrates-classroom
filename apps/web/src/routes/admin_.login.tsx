import { useState } from "react";
import { Link, createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import { api, ApiError } from "@/api";
import { Button, Field, Input, Spinner } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/admin_/login")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient
      .fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity })
      .catch(() => null);
    if (me?.admin) throw redirect({ to: "/admin" });
  },
  component: AdminLoginPage,
});

function AdminLoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const user = await api.login(email.trim(), password);
      if (!user.admin) {
        await api.logout().catch(() => {});
        queryClient.clear();
        queryClient.setQueryData(["me"], null);
        setError(t("admin_login_denied"));
        setBusy(false);
        return;
      }
      queryClient.clear();
      queryClient.setQueryData(["me"], user);
      await navigate({ to: "/admin" });
    } catch (caught) {
      setError(
        caught instanceof ApiError && caught.code === "unauthorized" ? t("login_err_credentials") : t("common_error"),
      );
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center bg-comic-night px-4 py-10 [--font-serif:var(--font-sans)]">
      <div className="mb-6 flex flex-col items-center gap-3 text-comic-paper">
        <span className="flex size-12 items-center justify-center rounded-xl bg-comic-paper/10">
          <ShieldCheck className="size-6" aria-hidden />
        </span>
        <p className="text-[13px] tracking-[0.3em] text-comic-paper/70 uppercase">{t("app_name")}</p>
      </div>
      <form
        className="flex w-full max-w-sm flex-col gap-4 rounded-xl border border-line bg-paper p-6 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <div>
          <h1 className="text-[20px] leading-tight font-semibold text-ink">{t("admin_login_title")}</h1>
          <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{t("admin_login_hint")}</p>
        </div>
        <Field label={t("login_email")}>
          <Input
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field label={t("login_password")}>
          <Input
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        {error && (
          <p role="alert" className="text-[12.5px] text-flag">
            {error}
          </p>
        )}
        <Button type="submit" size="lg" disabled={!email.trim() || !password || busy}>
          {busy ? <Spinner /> : null}
          {t("admin_login_submit")}
        </Button>
      </form>
      <Link to="/login" className="mt-5 text-[12.5px] text-comic-paper/70 underline-offset-2 hover:underline">
        {t("admin_login_back")}
      </Link>
    </div>
  );
}

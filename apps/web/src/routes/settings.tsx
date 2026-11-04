import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { Button, Card, Field, Input, Spinner } from "@/components/ui";
import { locales, setLocale, useI18n, useT, type Locale } from "@/i18n";
import { cn } from "@/components/ui";

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (me?.role !== "teacher") throw redirect({ to: "/" });
  },
  component: SettingsPage,
});

const PROVIDERS = ["openrouter", "openai", "anthropic", "google"];

function SettingsPage() {
  const t = useT();
  const { locale } = useI18n();
  const queryClient = useQueryClient();
  const byok = useQuery({ queryKey: ["byok"], queryFn: () => api.byokStatus() });
  const [provider, setProvider] = useState("openrouter");
  const [key, setKey] = useState("");
  const save = useMutation({
    mutationFn: () => api.byokSet(provider, key),
    onSuccess: (status) => {
      queryClient.setQueryData(["byok"], status);
      setKey("");
    },
  });
  const clear = useMutation({
    mutationFn: () => api.byokClear(),
    onSuccess: (status) => queryClient.setQueryData(["byok"], status),
  });

  return (
    <div className="mx-auto w-full max-w-md px-6 py-10">
      <h1 className="font-serif text-2xl font-semibold text-ink">{t("settings_title")}</h1>

      <Card className="mt-8 flex flex-col gap-3 p-5">
        <p className="text-[13px] font-medium text-ink-soft">{t("settings_lang")}</p>
        <div className="flex gap-2">
          {locales.map((l: Locale) => (
            <button
              type="button"
              key={l}
              onClick={() => setLocale(l)}
              className={cn(
                "rounded-full border px-4 py-1.5 text-[13px] transition-colors",
                l === locale
                  ? "border-ember bg-ember-wash font-medium text-ember"
                  : "border-line bg-card text-ink-soft",
              )}
            >
              {l === "zh" ? "繁體中文" : l === "en" ? "English" : "Español"}
            </button>
          ))}
        </div>
      </Card>

      <Card className="mt-5 flex flex-col gap-4 p-5">
        <div className="flex items-center justify-between">
          <p className="text-[13px] font-medium text-ink-soft">{t("settings_byok")}</p>
          {byok.data && (
            <span className="rounded-full bg-moss-wash px-3 py-0.5 font-mono text-[12px] text-moss">
              {t("settings_byok_set", { last4: byok.data.last4 })}
            </span>
          )}
        </div>
        <p className="text-[12.5px] leading-relaxed text-ink-faint">{t("settings_byok_hint")}</p>
        {byok.data ? (
          <Button variant="outline" size="sm" onClick={() => clear.mutate()} disabled={clear.isPending}>
            {clear.isPending ? <Spinner /> : t("settings_byok_clear")}
          </Button>
        ) : (
          <div className="flex flex-col gap-3">
            <Field label={t("settings_byok_provider")}>
              <select
                value={provider}
                onChange={(event) => setProvider(event.target.value)}
                className="h-11 rounded-xl border border-line bg-card px-3 text-[15px] text-ink focus:border-ember focus:outline-none"
              >
                {PROVIDERS.map((item) => (
                  <option key={item} value={item}>
                    {item}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t("settings_byok_key")}>
              <Input type="password" value={key} placeholder="sk-…" onChange={(event) => setKey(event.target.value)} />
            </Field>
            <Button
              size="sm"
              disabled={key.length < 8 || save.isPending}
              onClick={() => save.mutate()}
              className="self-start"
            >
              {save.isPending ? <Spinner /> : t("settings_byok_save")}
            </Button>
          </div>
        )}
      </Card>
    </div>
  );
}

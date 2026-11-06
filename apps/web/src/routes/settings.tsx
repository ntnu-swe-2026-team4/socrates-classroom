import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { Button, Card, Field, Input, PageHeader, Spinner } from "@/components/ui";
import { locales, setLocale, useI18n, useT, type Locale } from "@/i18n";
import { cn } from "@/components/ui";

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (me?.role !== "teacher") throw redirect({ to: "/home" });
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
  const saveFailed = save.isError;
  const clear = useMutation({
    mutationFn: () => api.byokClear(),
    onSuccess: (status) => queryClient.setQueryData(["byok"], status),
  });

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader width="max-w-2xl" eyebrow={t("eyebrow_teacher")} title={t("settings_title")} />
      <div className="mx-auto w-full max-w-2xl px-6 py-6">
        <Card className="flex flex-col gap-3 p-5">
          <p className="font-serif text-[15.5px] text-ink">{t("settings_lang")}</p>
          <div className="inline-flex gap-0.5 self-start rounded-full border border-line-strong bg-paper-deep p-0.5">
            {locales.map((l: Locale) => (
              <button
                type="button"
                key={l}
                onClick={() => setLocale(l)}
                className={cn(
                  "cursor-pointer rounded-full px-4 py-1.5 text-[13px] transition-colors",
                  l === locale ? "bg-ember font-semibold text-on-ember" : "text-ink-soft hover:text-ink",
                )}
              >
                {l === "zh-TW" ? "繁體中文" : l === "en" ? "English" : "Español"}
              </button>
            ))}
          </div>
        </Card>

        <Card className="mt-5 flex flex-col gap-4 p-5">
          <div className="flex items-center justify-between">
            <p className="font-serif text-[15.5px] text-ink">{t("settings_byok")}</p>
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
                  className="h-10 rounded-full border border-line-strong bg-paper-deep px-4 text-sm text-ink outline-none focus:border-ember"
                >
                  {PROVIDERS.map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label={t("settings_byok_key")}>
                <Input
                  type="password"
                  value={key}
                  placeholder="sk-…"
                  onChange={(event) => setKey(event.target.value)}
                />
              </Field>
              <Button
                size="sm"
                disabled={key.length < 8 || save.isPending}
                onClick={() => save.mutate()}
                className="self-start"
              >
                {save.isPending ? <Spinner /> : t("settings_byok_save")}
              </Button>
              {(saveFailed || clear.isError) && <p className="text-[12.5px] text-flag">{t("common_error")}</p>}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

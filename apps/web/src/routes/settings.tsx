import { createFileRoute, redirect } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, type TeacherKeyEntry } from "@/api";
import { Card, PageHeader } from "@/components/ui";
import { locales, setLocale, useI18n, useT, type Locale } from "@/i18n";
import { cn } from "@/components/ui";

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (me?.role !== "teacher") throw redirect({ to: "/home" });
  },
  component: SettingsPage,
});

function SettingsPage() {
  const t = useT();
  const { locale } = useI18n();

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader width="max-w-2xl" eyebrow={t("eyebrow_teacher")} title={t("settings_title")} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-6 py-6">
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
        <TeacherKeysCard />
      </div>
    </div>
  );
}

function TeacherKeysCard() {
  const t = useT();
  const queryClient = useQueryClient();
  const keys = useQuery({ queryKey: ["teacherKeys"], queryFn: () => api.listTeacherKeys() });
  const providers = useQuery({
    queryKey: ["keyProviders"],
    queryFn: () => api.listKeyProviders(),
    staleTime: Infinity,
  });
  const [provider, setProvider] = useState("");
  const [model, setModel] = useState("");
  const [keyInput, setKeyInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const models = useQuery({
    queryKey: ["keyProviderModels", provider],
    queryFn: () => api.listKeyProviderModels(provider),
    enabled: provider !== "",
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["teacherKeys"] });

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!provider || !model || !keyInput) return;
    setBusy(true);
    setError(null);
    try {
      await api.putTeacherKey(provider, model, keyInput);
      setKeyInput("");
      setProvider("");
      setModel("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async (entry: TeacherKeyEntry) => {
    await api.deleteTeacherKey(entry.provider);
    await refresh();
  };

  const move = async (index: number, delta: -1 | 1) => {
    const list = (keys.data ?? []).map((entry) => entry.provider);
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    [list[index], list[target]] = [list[target]!, list[index]!];
    await api.orderTeacherKeys(list);
    await refresh();
  };

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-serif text-[17px] text-ink">{t("settings_keys_title")}</h2>
        <p className="text-[13px] leading-relaxed text-ink-soft">{t("settings_keys_desc")}</p>
        <p className="text-[13px] leading-relaxed text-ink-soft">{t("settings_keys_responsibility")}</p>
      </div>

      <form onSubmit={save} className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          <label className="flex min-w-40 flex-1 flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-soft">{t("settings_keys_provider")}</span>
            <select
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value);
                setModel("");
              }}
              aria-label={t("settings_keys_provider")}
              className="rounded-lg border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink"
            >
              <option value="">{t("settings_keys_pick_provider")}</option>
              {(providers.data ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-40 flex-1 flex-col gap-1">
            <span className="text-[12px] font-medium text-ink-soft">{t("settings_keys_model")}</span>
            <select
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={provider === ""}
              aria-label={t("settings_keys_model")}
              className="rounded-lg border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink disabled:opacity-50"
            >
              <option value="">{t("settings_keys_pick_model")}</option>
              {(models.data ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="flex flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-soft">{t("settings_keys_key")}</span>
          <input
            type="password"
            value={keyInput}
            onChange={(event) => setKeyInput(event.target.value)}
            autoComplete="off"
            placeholder="sk-…"
            aria-label={t("settings_keys_key")}
            className="rounded-lg border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink"
          />
        </label>
        {error ? (
          <p role="alert" className="text-[13px] text-danger">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !provider || !model || !keyInput}
          className="self-start rounded-full bg-ember px-5 py-2 text-[14px] font-semibold text-on-ember transition-opacity disabled:opacity-40"
        >
          {busy ? t("settings_keys_saving") : t("settings_keys_save")}
        </button>
      </form>

      {keys.data && keys.data.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {keys.data.map((entry, index) => (
            <li
              key={entry.provider}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-[14px]"
            >
              <span className="font-medium text-ink">{entry.provider}</span>
              <span className="text-ink-soft">{entry.model}</span>
              <span className="text-ink-soft">•••• {entry.last4}</span>
              <span className="ml-auto flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => move(index, -1)}
                  disabled={index === 0}
                  aria-label={t("settings_keys_up")}
                  className="cursor-pointer rounded-md px-2 py-1 text-ink-soft hover:text-ink disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === keys.data!.length - 1}
                  aria-label={t("settings_keys_down")}
                  className="cursor-pointer rounded-md px-2 py-1 text-ink-soft hover:text-ink disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(entry)}
                  aria-label={t("settings_keys_delete")}
                  className="cursor-pointer rounded-md px-2 py-1 text-ink-soft hover:text-danger"
                >
                  ✕
                </button>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </Card>
  );
}

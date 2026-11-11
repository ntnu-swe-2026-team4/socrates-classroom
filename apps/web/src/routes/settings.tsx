import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TeacherKeyStatus } from "@socrates/shared";
import { useState } from "react";
import { api } from "@/api";
import { Button, Card, Field, Input, PageHeader, Segmented, Spinner } from "@/components/ui";
import { locales, setLocale, useI18n, useT, type Locale } from "@/i18n";
import { companion, useCompanion } from "@/lib/companion";
import { Volume1, Volume2, VolumeX } from "lucide-react";
import { cn } from "@/components/ui";

export const Route = createFileRoute("/settings")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (me?.preview && me.previewClassroomId) {
      throw redirect({ to: "/classrooms/$classroomId", params: { classroomId: me.previewClassroomId } });
    }
    if (!me || me.preview) throw redirect({ to: "/home" });
  },
  component: SettingsPage,
});

function SettingsPage() {
  const t = useT();
  const { locale } = useI18n();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });

  return (
    <div className="flex min-h-full flex-col">
      <PageHeader width="max-w-2xl" title={t("settings_title")} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-5 md:px-6">
        {me.data && <ProfileCard key={me.data.name} name={me.data.name} />}
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
        <VoiceCard />
        {me.data && !me.data.guest && <TeacherKeysCard />}
      </div>
    </div>
  );
}

function ProfileCard({ name }: { name: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(name);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => api.updateProfile(value.trim()),
    onSuccess: (user) => {
      queryClient.setQueryData(["me"], user);
      setSaved(true);
    },
  });
  const dirty = value.trim().length > 0 && value.trim() !== name;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <p className="font-serif text-[15.5px] text-ink">{t("settings_profile")}</p>
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty && !save.isPending) save.mutate();
        }}
      >
        <div className="min-w-0 flex-1">
          <Field label={t("register_name")}>
            <Input
              value={value}
              maxLength={80}
              autoComplete="nickname"
              onChange={(event) => {
                setValue(event.target.value);
                setSaved(false);
              }}
            />
          </Field>
        </div>
        <Button type="submit" disabled={!dirty || save.isPending}>
          {save.isPending ? <Spinner /> : t("common_save")}
        </Button>
      </form>
      <p role="status" className="text-[12px] text-ink-faint">
        {save.isError ? (
          <span className="text-flag">{t("common_error")}</span>
        ) : saved ? (
          t("settings_profile_saved")
        ) : (
          t("settings_profile_hint")
        )}
      </p>
    </Card>
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

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = (entry: TeacherKeyStatus) =>
    run(async () => {
      await api.deleteTeacherKey(entry.provider);
    });

  const move = (index: number, delta: -1 | 1) =>
    run(async () => {
      const list = (keys.data ?? []).map((entry) => entry.provider);
      const target = index + delta;
      if (target < 0 || target >= list.length) return;
      [list[index], list[target]] = [list[target]!, list[index]!];
      await api.orderTeacherKeys(list);
    });

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
              className="border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink"
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
              className="border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink disabled:opacity-50"
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
            className="border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink"
          />
        </label>
        {error ? (
          <p role="alert" className="text-[13px] text-flag">
            {error}
          </p>
        ) : null}
        <button
          type="submit"
          disabled={busy || !provider || !model || !keyInput}
          className="self-start bg-ember px-5 py-2 text-[14px] font-semibold text-on-ember transition-opacity disabled:opacity-40"
        >
          {busy ? t("settings_keys_saving") : t("settings_keys_save")}
        </button>
      </form>

      {keys.data && keys.data.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {keys.data.map((entry, index) => (
            <li
              key={entry.provider}
              className="flex flex-wrap items-center gap-2 border border-line px-3 py-2 text-[14px]"
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
                  className="cursor-pointer px-2 py-1 text-ink-soft hover:text-ink disabled:opacity-30"
                >
                  ↑
                </button>
                <button
                  type="button"
                  onClick={() => move(index, 1)}
                  disabled={index === keys.data!.length - 1}
                  aria-label={t("settings_keys_down")}
                  className="cursor-pointer px-2 py-1 text-ink-soft hover:text-ink disabled:opacity-30"
                >
                  ↓
                </button>
                <button
                  type="button"
                  onClick={() => remove(entry)}
                  aria-label={t("settings_keys_delete")}
                  className="cursor-pointer px-2 py-1 text-ink-soft hover:text-flag"
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

function VoiceCard() {
  const t = useT();
  const { muted, volume, voiceStyle } = useCompanion();
  const enabled = !muted;
  const percent = Math.round(volume * 100);
  const Icon = !enabled || percent === 0 ? VolumeX : percent < 50 ? Volume1 : Volume2;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <p className="font-serif text-[15.5px] text-ink">{t("settings_voice")}</p>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          aria-label={t("settings_voice_toggle")}
          onClick={() => companion.setMuted(enabled)}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember",
            enabled ? "bg-ember" : "bg-paper-shade",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block size-5 rounded-full bg-paper shadow transition-transform",
              enabled ? "translate-x-5.5" : "translate-x-0.5",
            )}
          />
        </button>
        <span className="text-[13px] text-ink-soft">{enabled ? t("settings_voice_on") : t("settings_voice_off")}</span>
        <label className={cn("flex min-w-48 flex-1 items-center gap-3", !enabled && "opacity-40")}>
          <Icon className="size-4 shrink-0 text-ink-soft" aria-hidden />
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            value={percent}
            disabled={!enabled}
            aria-label={t("settings_voice_volume")}
            onChange={(event) => companion.setVolume(Number(event.target.value) / 100)}
            className="h-1.5 min-w-0 flex-1 cursor-pointer accent-ember disabled:cursor-not-allowed"
          />
          <span className="w-10 shrink-0 text-right font-mono text-[12px] text-ink-faint">{percent}%</span>
        </label>
      </div>
      <div className={cn("flex flex-wrap items-center gap-3", !enabled && "opacity-40")}>
        <span className="text-[13px] text-ink-soft">{t("settings_voice_style")}</span>
        <Segmented
          label={t("settings_voice_style")}
          value={voiceStyle}
          onChange={(value) => companion.setVoiceStyle(value)}
          items={[
            { value: "elder", label: t("settings_voice_elder") },
            { value: "natural", label: t("settings_voice_natural") },
          ]}
        />
      </div>
      <p className="text-[12px] text-ink-faint">{t("settings_voice_hint")}</p>
    </Card>
  );
}

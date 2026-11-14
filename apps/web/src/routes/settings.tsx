import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TeacherKeyStatus } from "@socrates/shared";
import { useState } from "react";
import { api } from "@/api";
import { Button, Card, ConfirmDialog, Field, Input, PageHeader, Segmented, Spinner } from "@/components/ui";
import { locales, setLocale, useI18n, useT, type Locale } from "@/i18n";
import { companion, useCompanion } from "@/lib/companion";
import { TeacherModeCard } from "@/components/TeacherMode";
import {
  ChevronDown,
  ChevronUp,
  Copy,
  GripVertical,
  KeyRound,
  Plus,
  Trash2,
  Volume1,
  Volume2,
  VolumeX,
} from "lucide-react";
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
    <div className="flex min-h-full flex-col bg-paper-deep pb-10">
      <PageHeader width="max-w-2xl" title={t("settings_title")} />
      <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-4 py-5 md:px-6">
        {me.data &&
          (me.data.kind === "student" ? (
            <StudentProfileCard name={me.data.name} username={me.data.username ?? ""} />
          ) : (
            <ProfileCard key={me.data.name} name={me.data.name} />
          ))}
        {me.data && !me.data.guest && me.data.kind !== "student" && <TeacherModeCard user={me.data} />}
        <Card className="flex flex-col gap-3 p-5">
          <p className="font-serif text-[15.5px] text-ink">{t("settings_lang")}</p>
          <div className="inline-flex gap-0.5 self-start rounded-full border border-line-strong bg-paper-deep p-0.5">
            {locales.map((l: Locale) => (
              <button
                type="button"
                key={l}
                onClick={() => setLocale(l)}
                className={cn(
                  "cursor-pointer rounded-lg px-4 py-1.5 text-[13px] transition-colors",
                  l === locale ? "bg-ink font-semibold text-paper" : "text-ink-soft hover:text-ink",
                )}
              >
                {l === "zh-TW" ? "繁體中文" : l === "en" ? "English" : "Español"}
              </button>
            ))}
          </div>
        </Card>
        <ModelCard />
        <VoiceCard />
        {me.data && !me.data.guest && me.data.kind !== "student" && <TeacherKeysCard />}
      </div>
    </div>
  );
}

function StudentProfileCard({ name, username }: { name: string; username: string }) {
  const t = useT();
  return (
    <Card className="flex flex-col gap-2 p-5">
      <p className="font-serif text-[15.5px] text-ink">{t("settings_profile")}</p>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-[13.5px]">
        <dt className="text-ink-soft">{t("register_name")}</dt>
        <dd className="text-ink">{name}</dd>
        <dt className="text-ink-soft">{t("student_username")}</dt>
        <dd className="font-mono text-ink">{username}</dd>
      </dl>
      <p className="text-[12px] text-ink-faint">{t("student_profile_hint")}</p>
    </Card>
  );
}

function ProfileCard({ name }: { name: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [value, setValue] = useState(name);
  const [saved, setSaved] = useState(false);
  const save = useMutation({
    mutationFn: () => api.updateProfile({ name: value.trim() }),
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
  const [order, setOrder] = useState<TeacherKeyStatus[] | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ provider: string; fromEntry?: string } | null>(null);
  const [confirming, setConfirming] = useState<TeacherKeyStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const list = order ?? keys.data ?? [];
  const providerName = (id: string) => providers.data?.find((entry) => entry.id === id)?.name ?? id;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ["teacherKeys"] });
    setOrder(null);
  };

  const commitOrder = async (next: TeacherKeyStatus[]) => {
    setOrder(next);
    setError(null);
    try {
      await api.orderTeacherKeys(next.map((entry) => entry.id));
      queryClient.setQueryData(["teacherKeys"], next);
    } catch {
      setError(t("common_error"));
    } finally {
      setOrder(null);
    }
  };

  const move = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= list.length) return;
    const next = [...list];
    [next[index], next[target]] = [next[target]!, next[index]!];
    void commitOrder(next);
  };

  const dragOver = (overId: string) => {
    if (!dragId || dragId === overId) return;
    const current = [...list];
    const from = current.findIndex((entry) => entry.id === dragId);
    const to = current.findIndex((entry) => entry.id === overId);
    if (from < 0 || to < 0) return;
    const [moved] = current.splice(from, 1);
    current.splice(to, 0, moved!);
    setOrder(current);
  };

  const remove = useMutation({
    mutationFn: (id: string) => api.deleteTeacherKey(id),
    onSuccess: refresh,
    onError: () => setError(t("common_error")),
  });

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <h2 className="font-serif text-[17px] text-ink">{t("settings_keys_title")}</h2>
        <p className="text-[13px] leading-relaxed text-ink-soft">{t("settings_keys_desc")}</p>
        <p className="text-[12.5px] leading-relaxed text-ink-faint">{t("settings_keys_responsibility")}</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-medium text-ink-soft">{t("settings_keys_priority")}</span>
          {list.length > 1 && <span className="text-[11.5px] text-ink-faint">{t("settings_keys_drag_hint")}</span>}
        </div>
        {keys.isPending ? (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        ) : (
          <ol className="flex flex-col gap-1.5">
            {list.map((entry, index) => (
              <KeyRow
                key={entry.id}
                entry={entry}
                index={index}
                total={list.length}
                providerName={providerName(entry.provider)}
                dragging={dragId === entry.id}
                onDragStart={() => setDragId(entry.id)}
                onDragOver={() => dragOver(entry.id)}
                onDragEnd={() => {
                  setDragId(null);
                  if (order) void commitOrder(order);
                }}
                onMove={(delta) => move(index, delta)}
                onAddModel={() => setAdding({ provider: entry.provider, fromEntry: entry.id })}
                onDelete={() => setConfirming(entry)}
                onSaved={refresh}
              />
            ))}
            <li className="flex items-center gap-3 rounded-xl border border-dashed border-line px-3 py-2 text-[12.5px] text-ink-faint">
              <span className="w-5 text-center font-mono">{list.length + 1}</span>
              <span>{t("settings_keys_platform")}</span>
            </li>
          </ol>
        )}
      </div>

      {error && (
        <p role="alert" className="text-[13px] text-flag">
          {error}
        </p>
      )}

      {adding ? (
        <AddKeyForm
          key={`${adding.provider}:${adding.fromEntry ?? ""}`}
          initialProvider={adding.provider}
          initialFromEntry={adding.fromEntry}
          entries={keys.data ?? []}
          providers={providers.data ?? []}
          onCancel={() => setAdding(null)}
          onSaved={async () => {
            setAdding(null);
            await refresh();
          }}
        />
      ) : (
        <Button variant="outline" className="self-start" onClick={() => setAdding({ provider: "" })}>
          <Plus className="size-4" />
          {t("settings_keys_add")}
        </Button>
      )}

      <ConfirmDialog
        open={confirming !== null}
        danger
        title={t("settings_keys_delete_title")}
        body={
          confirming
            ? t("settings_keys_delete_body", {
                name: `${providerName(confirming.provider)} · ${confirming.model} · •••• ${confirming.last4}`,
              })
            : undefined
        }
        confirmLabel={t("settings_keys_delete")}
        cancelLabel={t("common_cancel")}
        onCancel={() => setConfirming(null)}
        onConfirm={() => {
          if (confirming) remove.mutate(confirming.id);
          setConfirming(null);
        }}
      />
    </Card>
  );
}

function KeyRow({
  entry,
  index,
  total,
  providerName,
  dragging,
  onDragStart,
  onDragOver,
  onDragEnd,
  onMove,
  onAddModel,
  onDelete,
  onSaved,
}: {
  entry: TeacherKeyStatus;
  index: number;
  total: number;
  providerName: string;
  dragging: boolean;
  onDragStart: () => void;
  onDragOver: () => void;
  onDragEnd: () => void;
  onMove: (delta: -1 | 1) => void;
  onAddModel: () => void;
  onDelete: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const [replacing, setReplacing] = useState(false);
  const [value, setValue] = useState("");
  const replace = useMutation({
    mutationFn: () => api.updateTeacherKey(entry.id, { key: value }),
    onSuccess: async () => {
      setReplacing(false);
      setValue("");
      await onSaved();
    },
  });
  const iconButton =
    "flex size-7 cursor-pointer items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-paper-deep hover:text-ink disabled:cursor-default disabled:opacity-30";
  return (
    <li
      onDragOver={(event) => {
        event.preventDefault();
        onDragOver();
      }}
      onDrop={(event) => event.preventDefault()}
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-paper px-2 py-2 transition-shadow",
        dragging ? "border-ember shadow-md" : "border-line",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          draggable
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("text/plain", entry.id);
            onDragStart();
          }}
          onDragEnd={onDragEnd}
          title={t("settings_keys_drag")}
          aria-hidden
          className="flex size-7 shrink-0 cursor-grab items-center justify-center text-ink-faint active:cursor-grabbing"
        >
          <GripVertical className="size-4" />
        </span>
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-ember-wash font-mono text-[11px] text-ember">
          {index + 1}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] text-ink">
            {providerName} <span className="text-ink-soft">· {entry.model}</span>
          </span>
          <span className="block font-mono text-[11.5px] text-ink-faint">•••• {entry.last4}</span>
        </span>
        <span className="flex shrink-0 items-center">
          <button
            type="button"
            onClick={() => onMove(-1)}
            disabled={index === 0}
            aria-label={t("settings_keys_up")}
            title={t("settings_keys_up")}
            className={iconButton}
          >
            <ChevronUp className="size-4" />
          </button>
          <button
            type="button"
            onClick={() => onMove(1)}
            disabled={index === total - 1}
            aria-label={t("settings_keys_down")}
            title={t("settings_keys_down")}
            className={iconButton}
          >
            <ChevronDown className="size-4" />
          </button>
          <button
            type="button"
            onClick={onAddModel}
            aria-label={t("settings_keys_add_model")}
            title={t("settings_keys_add_model")}
            className={iconButton}
          >
            <Copy className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={() => setReplacing((open) => !open)}
            aria-label={t("settings_keys_replace")}
            title={t("settings_keys_replace")}
            className={iconButton}
          >
            <KeyRound className="size-3.5" />
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={t("settings_keys_delete")}
            title={t("settings_keys_delete")}
            className={cn(iconButton, "hover:bg-flag-wash hover:text-flag")}
          >
            <Trash2 className="size-3.5" />
          </button>
        </span>
      </div>
      {replacing && (
        <form
          className="flex items-center gap-2 pl-14"
          onSubmit={(event) => {
            event.preventDefault();
            if (value.length >= 8 && !replace.isPending) replace.mutate();
          }}
        >
          <Input
            type="password"
            value={value}
            autoComplete="off"
            placeholder="sk-…"
            aria-label={t("settings_keys_new_key")}
            onChange={(event) => setValue(event.target.value)}
            className="h-8 text-[13px]"
          />
          <Button type="submit" size="sm" disabled={value.length < 8 || replace.isPending}>
            {replace.isPending ? <Spinner /> : t("common_save")}
          </Button>
        </form>
      )}
    </li>
  );
}

function AddKeyForm({
  initialProvider,
  initialFromEntry,
  entries,
  providers,
  onCancel,
  onSaved,
}: {
  initialProvider: string;
  initialFromEntry?: string;
  entries: TeacherKeyStatus[];
  providers: Array<{ id: string; name: string }>;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const t = useT();
  const [provider, setProvider] = useState(initialProvider);
  const [model, setModel] = useState("");
  const [fromEntry, setFromEntry] = useState(initialFromEntry ?? "");
  const [key, setKey] = useState("");
  const models = useQuery({
    queryKey: ["keyProviderModels", provider],
    queryFn: () => api.listKeyProviderModels(provider),
    enabled: provider !== "",
  });
  const reusable = entries.filter((entry) => entry.provider === provider);
  const save = useMutation({
    mutationFn: () => api.addTeacherKey(fromEntry ? { provider, model, fromEntry } : { provider, model, key }),
    onSuccess: onSaved,
  });
  const ready = provider !== "" && model !== "" && (fromEntry !== "" || key.length >= 8) && !save.isPending;
  const selectClass =
    "h-9 rounded-lg border border-line-strong bg-paper px-3 text-[13.5px] text-ink disabled:opacity-50";
  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-line bg-paper-deep/40 p-4"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) save.mutate();
      }}
    >
      <p className="text-[13.5px] font-medium text-ink">{t("settings_keys_add")}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={t("settings_keys_provider")}>
          <select
            value={provider}
            onChange={(event) => {
              setProvider(event.target.value);
              setModel("");
              setFromEntry("");
            }}
            className={selectClass}
          >
            <option value="">{t("settings_keys_pick_provider")}</option>
            {providers.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label={t("settings_keys_model")}>
          <select
            value={model}
            disabled={provider === ""}
            onChange={(event) => setModel(event.target.value)}
            className={selectClass}
          >
            <option value="">{t("settings_keys_pick_model")}</option>
            {(models.data ?? []).map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      {reusable.length > 0 && (
        <Field label={t("settings_keys_key_source")}>
          <select value={fromEntry} onChange={(event) => setFromEntry(event.target.value)} className={selectClass}>
            <option value="">{t("settings_keys_new_key")}</option>
            {reusable.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {t("settings_keys_reuse", { last4: entry.last4, model: entry.model })}
              </option>
            ))}
          </select>
        </Field>
      )}
      {fromEntry === "" && (
        <Field label={t("settings_keys_key")}>
          <Input
            type="password"
            value={key}
            autoComplete="off"
            placeholder="sk-…"
            onChange={(event) => setKey(event.target.value)}
          />
        </Field>
      )}
      {save.isError && (
        <p role="alert" className="text-[12.5px] text-flag">
          {t("common_error")}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onCancel}>
          {t("common_cancel")}
        </Button>
        <Button type="submit" disabled={!ready}>
          {save.isPending ? <Spinner /> : t("settings_keys_save")}
        </Button>
      </div>
    </form>
  );
}

function ModelCard() {
  const t = useT();
  const { visible } = useCompanion();
  return (
    <Card className="flex flex-col gap-3 p-5">
      <p className="font-serif text-[15.5px] text-ink">{t("settings_model")}</p>
      <div className="flex flex-wrap items-center gap-4">
        <button
          type="button"
          role="switch"
          aria-checked={visible}
          aria-label={t("settings_model_toggle")}
          onClick={() => companion.setVisible(!visible)}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember",
            visible ? "bg-ember" : "bg-paper-shade",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block size-5 rounded-full bg-paper shadow transition-transform",
              visible ? "translate-x-5.5" : "translate-x-0.5",
            )}
          />
        </button>
        <span className="text-[13px] text-ink-soft">{visible ? t("settings_model_on") : t("settings_model_off")}</span>
      </div>
      <p className="text-[12px] text-ink-faint">{t("settings_model_hint")}</p>
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

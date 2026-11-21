import { useQuery, useQueryClient } from "@tanstack/react-query";
import { keyProviderModelsOptions, keyProvidersOptions, teacherKeysOptions } from "@/api/queries";
import type { TeacherKeyStatus } from "@socrates/shared";
import { useCallback, useMemo, useState } from "react";
import { api } from "@/api";
import { Card, cn, ConfirmDialog } from "@/components/ui";
import { useT } from "@/i18n";
import { focusNextIn, focusRestoreOnUnmount } from "@/lib/focus";
import { providerIcon, providerKind, type ProviderKind } from "@/lib/providers";

type ConfirmTarget = { kind: "provider" } | { kind: "model"; model: string };

export function ProviderIcon({ id, className }: { id: string; className?: string }) {
  const icon = providerIcon(id);
  if (!icon) {
    return (
      <span
        aria-hidden
        className={cn(
          "flex items-center justify-center rounded-md border border-line-strong bg-paper-deep font-serif text-[11px] font-semibold text-ink-soft",
          className,
        )}
      >
        {id.slice(0, 1).toUpperCase()}
      </span>
    );
  }
  return <img src={icon} alt="" aria-hidden className={cn("rounded-md object-contain", className)} />;
}

const kindOrder: ProviderKind[] = ["vendor", "relay", "platform"];

export function ProviderKeys() {
  const t = useT();
  const queryClient = useQueryClient();
  const keys = useQuery(teacherKeysOptions);
  const providers = useQuery(keyProvidersOptions);

  const [expanded, setExpanded] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [armed, setArmed] = useState<string | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const nameOf = useMemo(() => {
    const map = new Map((providers.data ?? []).map((entry) => [entry.id, entry.name]));
    return (id: string) => map.get(id) ?? id;
  }, [providers.data]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: teacherKeysOptions.queryKey });

  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const list = keys.data ?? [];

  const move = (id: string, delta: -1 | 1) =>
    run(async () => {
      const providers = list.map((entry) => entry.provider);
      const from = providers.indexOf(id);
      const to = from + delta;
      if (from < 0 || to < 0 || to >= providers.length) return;
      providers.splice(to, 0, ...providers.splice(from, 1));
      await api.orderTeacherKeys(providers);
    });

  const dropOn = (target: string) =>
    run(async () => {
      const source = dragId;
      setDragId(null);
      setArmed(null);
      if (!source || source === target) return;
      const ids = list.map((entry) => entry.provider);
      const from = ids.indexOf(source);
      const to = ids.indexOf(target);
      if (from < 0 || to < 0) return;
      ids.splice(to, 0, ...ids.splice(from, 1));
      await api.orderTeacherKeys(ids);
    });

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-3">
          <h2 className="font-serif text-[17px] text-ink">{t("settings_keys_title")}</h2>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="ml-auto cursor-pointer rounded-full border border-line-strong px-4 py-1.5 text-[13px] font-semibold text-ink transition-colors hover:bg-paper-deep"
          >
            {t("settings_keys_add_provider")}
          </button>
        </div>
        <p className="text-[13px] leading-relaxed text-ink-soft">{t("settings_keys_desc")}</p>
        <p className="text-[13px] leading-relaxed text-ink-soft">{t("settings_keys_responsibility")}</p>
      </div>

      {error ? (
        <p role="alert" className="text-[13px] text-flag">
          {error}
        </p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {list.map((entry) => (
          <ProviderRow
            key={entry.provider}
            entry={entry}
            name={nameOf(entry.provider)}
            expanded={expanded === entry.provider}
            armed={armed === entry.provider}
            dragging={dragId === entry.provider}
            dragActive={dragId !== null}
            onToggle={() => setExpanded(expanded === entry.provider ? null : entry.provider)}
            onArm={(on) => setArmed(on ? entry.provider : null)}
            onDragStart={() => setDragId(entry.provider)}
            onDragEnd={() => {
              setDragId(null);
              setArmed(null);
            }}
            onDrop={() => dropOn(entry.provider)}
            onStep={(delta) => move(entry.provider, delta)}
            onError={setError}
          />
        ))}
      </ul>

      {list.length === 0 && !keys.isLoading ? (
        <p className="text-[13px] text-ink-faint">{t("settings_keys_empty")}</p>
      ) : null}

      {sheetOpen ? (
        <ProviderSheet
          providers={providers.data ?? []}
          owned={new Set(list.map((entry) => entry.provider))}
          onClose={() => setSheetOpen(false)}
          onOpenExisting={(id) => {
            setSheetOpen(false);
            setExpanded(id);
          }}
          onSaved={(id) => {
            void refresh();
            setSheetOpen(false);
            setExpanded(id);
          }}
        />
      ) : null}
    </Card>
  );
}

const kindHint = {
  vendor: "settings_keys_kind_vendor_hint",
  relay: "settings_keys_kind_relay_hint",
  platform: null,
} as const;

function ProviderSheet({
  providers,
  owned,
  onClose,
  onOpenExisting,
  onSaved,
}: {
  providers: { id: string; name: string }[];
  owned: Set<string>;
  onClose: () => void;
  onOpenExisting: (id: string) => void;
  onSaved: (id: string) => void;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const focusInput = useCallback((element: HTMLInputElement | null) => {
    element?.focus();
  }, []);

  const restoreFocus = (node: HTMLElement | null) => {
    if (!node) return;
    const restore = focusRestoreOnUnmount();
    return () => restore();
  };

  const f = query.trim().toLowerCase();
  const matches = (entry: { id: string; name: string }) =>
    f === "" || entry.name.toLowerCase().includes(f) || entry.id.includes(f);
  const sections = kindOrder.map((kind) => ({
    kind,
    entries: providers.filter((entry) => providerKind(entry.id) === kind && matches(entry)),
  }));
  const anyTile = sections.some((section) => section.entries.length > 0);

  const back = () => {
    setPicked(null);
    setKey("");
    setError(null);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!picked || !key) return;
    setBusy(true);
    setError(null);
    try {
      await api.putTeacherKey(picked, key);
      onSaved(picked);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      ref={restoreFocus}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/50 p-4 sm:items-center sm:p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("settings_keys_add_title")}
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            event.preventDefault();
            focusNextIn(event.currentTarget);
            return;
          }
          if (event.key !== "Escape") return;
          event.stopPropagation();
          if (picked) back();
          else if (query) setQuery("");
          else onClose();
        }}
        className="flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-lg"
      >
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          {picked ? (
            <>
              <button
                type="button"
                onClick={back}
                aria-label={t("settings_keys_back")}
                className="cursor-pointer rounded-md px-1 text-[15px] text-ink-faint hover:text-ink"
              >
                ←
              </button>
              <ProviderIcon id={picked} className="h-6 w-6" />
              <h3 className="min-w-0 truncate font-serif text-[15px] text-ink">
                {providers.find((entry) => entry.id === picked)?.name ?? picked}
              </h3>
            </>
          ) : (
            <h3 className="min-w-0 font-serif text-[15px] text-ink">{t("settings_keys_add_title")}</h3>
          )}
          {!picked ? (
            <input
              type="search"
              ref={focusInput}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("settings_keys_find")}
              aria-label={t("settings_keys_find")}
              className="ml-auto w-44 rounded-lg border border-line-strong bg-paper px-3 py-1.5 text-[13px] text-ink"
            />
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className={cn(
              "cursor-pointer rounded-md px-1.5 py-1 text-[13px] text-ink-faint hover:text-ink",
              !picked && "ml-auto",
            )}
          >
            {t("settings_keys_close")}
          </button>
        </div>

        {picked ? (
          <form onSubmit={save} className="flex flex-col gap-2 px-4 py-4">
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-ink-soft">{t("settings_keys_key")}</span>
              <input
                type="password"
                ref={focusInput}
                value={key}
                onChange={(event) => setKey(event.target.value)}
                autoComplete="off"
                placeholder="sk-…"
                aria-label={t("settings_keys_key")}
                className="rounded-lg border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink"
              />
            </label>
            {error ? (
              <p role="alert" className="text-[13px] text-flag">
                {error}
              </p>
            ) : null}
            <div className="flex items-center gap-2">
              <button
                type="submit"
                disabled={busy || !key}
                className="rounded-full bg-ember px-5 py-2 text-[14px] font-semibold text-on-ember transition-opacity disabled:opacity-40"
              >
                {busy ? t("settings_keys_saving") : t("settings_keys_save")}
              </button>
              <button
                type="button"
                onClick={back}
                className="cursor-pointer rounded-full border border-line-strong px-4 py-2 text-[13px] font-medium text-ink"
              >
                {t("settings_keys_cancel")}
              </button>
            </div>
          </form>
        ) : (
          <div className="flex flex-col gap-4 overflow-y-auto px-4 py-3">
            {sections.map((section) => {
              if (section.entries.length === 0) return null;
              const hint = kindHint[section.kind];
              return (
                <section key={section.kind} className="flex flex-col gap-2">
                  <div className="flex items-baseline gap-2">
                    <b className="text-[12.5px] font-semibold text-ink-soft">
                      {t(`settings_keys_kind_${section.kind}` as const)}
                    </b>
                    {hint ? <span className="text-[12px] text-ink-faint">{t(hint)}</span> : null}
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {section.entries.map((entry) => {
                      const added = owned.has(entry.id);
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => (added ? onOpenExisting(entry.id) : setPicked(entry.id))}
                          title={added ? t("settings_keys_added_open", { name: entry.name }) : entry.id}
                          className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-paper px-3 py-2.5 text-left transition-colors hover:border-line-strong"
                        >
                          <ProviderIcon id={entry.id} className="h-6 w-6 shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">
                            {entry.name}
                          </span>
                          {added ? (
                            <span title={t("settings_keys_added")} className="text-[14px] text-moss" aria-hidden>
                              ✓
                            </span>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
            {anyTile ? null : (
              <p className="text-[13px] text-ink-faint">{t("settings_keys_no_provider", { q: query.trim() })}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ProviderRow({
  entry,
  name,
  expanded,
  armed,
  dragging,
  dragActive,
  onToggle,
  onArm,
  onDragStart,
  onDragEnd,
  onDrop,
  onStep,
  onError,
}: {
  entry: TeacherKeyStatus;
  name: string;
  expanded: boolean;
  armed: boolean;
  dragging: boolean;
  dragActive: boolean;
  onToggle: () => void;
  onArm: (on: boolean) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
  onDrop: () => void;
  onStep: (delta: -1 | 1) => void;
  onError: (message: string) => void;
}) {
  const t = useT();

  return (
    <li
      className={cn("flex flex-col overflow-hidden rounded-xl border border-line bg-paper", dragging && "opacity-50")}
      onDragOver={(event) => {
        if (dragActive) event.preventDefault();
      }}
      onDrop={onDrop}
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          type="button"
          draggable={armed}
          onDragStart={onDragStart}
          onDragEnd={onDragEnd}
          onPointerDown={() => onArm(true)}
          onPointerUp={() => onArm(false)}
          onKeyDown={(event) => {
            if (event.altKey && event.key === "ArrowUp") {
              event.preventDefault();
              onStep(-1);
            }
            if (event.altKey && event.key === "ArrowDown") {
              event.preventDefault();
              onStep(1);
            }
          }}
          aria-label={`${t("settings_keys_drag")} ${name}`}
          title={t("settings_keys_drag")}
          className="cursor-grab rounded-md p-1 text-ink-faint hover:text-ink active:cursor-grabbing"
        >
          <ProviderIcon id={entry.provider} className="h-6 w-6" />
        </button>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
          className="flex min-w-0 flex-1 cursor-pointer flex-col items-start gap-0.5 rounded-md text-left"
        >
          <span className="flex items-center gap-2">
            <span className="text-[14.5px] font-medium text-ink">{name}</span>
            <span className="rounded-full border border-line bg-paper-deep px-2 py-0.5 text-[11.5px] text-ink-soft">
              {entry.models.length === 1
                ? t("settings_keys_one_model")
                : t("settings_keys_models", { n: entry.models.length })}
            </span>
          </span>
          <span className="font-mono text-[12px] text-ink-faint">{entry.provider}</span>
        </button>
        <span className="rounded-full border border-line bg-paper-deep px-2.5 py-1 font-mono text-[12px] text-ink-soft">
          •••• {entry.last4}
        </span>
        <span aria-hidden className={cn("pr-1 text-ink-faint transition-transform", expanded && "rotate-90")}>
          ▸
        </span>
      </div>
      {expanded ? <ProviderEditor entry={entry} name={name} onError={onError} /> : null}
    </li>
  );
}

function ProviderEditor({
  entry,
  name,
  onError,
}: {
  entry: TeacherKeyStatus;
  name: string;
  onError: (message: string) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const models = useQuery(keyProviderModelsOptions(entry.provider));
  const [search, setSearch] = useState("");
  const [editingLimit, setEditingLimit] = useState<string | null>(null);
  const [limitDraft, setLimitDraft] = useState("");
  const [limitError, setLimitError] = useState(false);
  const [editingProviderLimit, setEditingProviderLimit] = useState(false);
  const [providerLimitDraft, setProviderLimitDraft] = useState("");
  const [providerLimitError, setProviderLimitError] = useState(false);
  const [editingQuota, setEditingQuota] = useState(false);
  const [quotaDraft, setQuotaDraft] = useState("");
  const [quotaError, setQuotaError] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: teacherKeysOptions.queryKey });

  const catalog = models.data ?? [];
  const owned = new Set(entry.models.map((leg) => leg.model));
  const results =
    search === ""
      ? []
      : catalog
          .filter(
            (model) =>
              !owned.has(model.id) &&
              (model.id.toLowerCase().includes(search.toLowerCase()) ||
                model.name.toLowerCase().includes(search.toLowerCase())),
          )
          .slice(0, 24);

  const run = async (action: () => Promise<void>) => {
    try {
      await action();
      await refresh();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  const addModel = (model: string) =>
    run(async () => {
      await api.putTeacherKeyModel(entry.provider, model);
      setSearch("");
    });

  const saveLimit = (model: string) =>
    run(async () => {
      const trimmed = limitDraft.trim();
      if (trimmed !== "") {
        const maxConcurrency = Number(trimmed);
        if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 100) {
          setLimitError(true);
          return;
        }
        await api.putTeacherKeyModel(entry.provider, model, maxConcurrency);
      } else {
        await api.putTeacherKeyModel(entry.provider, model, null);
      }
      setLimitError(false);
      setEditingLimit(null);
      setLimitDraft("");
    });

  const saveProviderLimit = () =>
    run(async () => {
      const trimmed = providerLimitDraft.trim();
      if (trimmed !== "") {
        const maxConcurrency = Number(trimmed);
        if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1 || maxConcurrency > 100) {
          setProviderLimitError(true);
          return;
        }
        await api.putTeacherKeyProviderLimit(entry.provider, maxConcurrency);
      } else {
        await api.putTeacherKeyProviderLimit(entry.provider, null);
      }
      setProviderLimitError(false);
      setEditingProviderLimit(false);
      setProviderLimitDraft("");
    });

  const saveQuota = () =>
    run(async () => {
      const trimmed = quotaDraft.trim();
      if (trimmed !== "") {
        const monthlyQuotaUsd = Number(trimmed);
        if (!Number.isFinite(monthlyQuotaUsd) || monthlyQuotaUsd <= 0 || monthlyQuotaUsd > 100000) {
          setQuotaError(true);
          return;
        }
        await api.putTeacherKeyMonthlyQuota(entry.provider, monthlyQuotaUsd);
      } else {
        await api.putTeacherKeyMonthlyQuota(entry.provider, null);
      }
      setQuotaError(false);
      setEditingQuota(false);
      setQuotaDraft("");
    });

  const reorder = (index: number, delta: -1 | 1) =>
    run(async () => {
      const ids = entry.models.map((leg) => leg.model);
      const to = index + delta;
      if (to < 0 || to >= ids.length) return;
      ids.splice(to, 0, ...ids.splice(index, 1));
      await api.orderTeacherKeyModels(entry.provider, ids);
    });

  const replaceKey = () =>
    run(async () => {
      if (!keyDraft) return;
      await api.putTeacherKey(entry.provider, keyDraft);
      setKeyDraft("");
    });

  const removeModel = (model: string) => setConfirmTarget({ kind: "model", model });

  const removeProvider = () => setConfirmTarget({ kind: "provider" });

  const confirmedRemoval = () =>
    run(async () => {
      const target = confirmTarget;
      setConfirmTarget(null);
      if (target?.kind === "provider") await api.deleteTeacherKey(entry.provider);
      else if (target?.kind === "model") await api.deleteTeacherKeyModel(entry.provider, target.model);
    });

  return (
    <div className="flex flex-col gap-3 border-t border-line bg-card px-3 py-3">
      <ul className="flex flex-col gap-1">
        {entry.models.map((leg, index) => (
          <li
            key={leg.model}
            className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-paper px-2.5 py-1.5"
          >
            <span className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => reorder(index, -1)}
                disabled={index === 0}
                aria-label={t("settings_keys_up")}
                className="cursor-pointer rounded-md px-1 text-ink-faint hover:text-ink disabled:opacity-30"
              >
                ↑
              </button>
              <button
                type="button"
                onClick={() => reorder(index, 1)}
                disabled={index === entry.models.length - 1}
                aria-label={t("settings_keys_down")}
                className="cursor-pointer rounded-md px-1 text-ink-faint hover:text-ink disabled:opacity-30"
              >
                ↓
              </button>
            </span>
            <span className="min-w-0 flex-1 truncate font-mono text-[13px] text-ink">{leg.model}</span>
            {editingLimit === leg.model ? (
              <span className="flex items-center gap-1">
                <input
                  type="number"
                  min={1}
                  max={100}
                  value={limitDraft}
                  onChange={(event) => setLimitDraft(event.target.value)}
                  placeholder={t("settings_keys_concurrency_default")}
                  aria-label={t("settings_keys_edit_concurrency")}
                  className="w-20 rounded-md border border-line-strong bg-paper px-2 py-1 text-[13px] text-ink"
                />
                <button
                  type="button"
                  onClick={() => saveLimit(leg.model)}
                  aria-label={t("settings_keys_concurrency_save")}
                  className="cursor-pointer rounded-full bg-ember px-2.5 py-1 text-[12px] font-semibold text-on-ember"
                >
                  ✓
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEditingLimit(null);
                    setLimitDraft("");
                    setLimitError(false);
                  }}
                  aria-label={t("settings_keys_cancel")}
                  className="cursor-pointer rounded-md px-1.5 py-1 text-[12px] text-ink-faint hover:text-ink"
                >
                  ✕
                </button>
                {limitError ? (
                  <span role="alert" className="text-[11px] text-flag">
                    {t("settings_keys_limit_invalid")}
                  </span>
                ) : null}
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEditingLimit(leg.model);
                  setLimitDraft(leg.maxConcurrency === null ? "" : String(leg.maxConcurrency));
                  setLimitError(false);
                }}
                aria-label={`${t("settings_keys_edit_concurrency")} ${leg.model}`}
                title={t("settings_keys_edit_concurrency")}
                className="cursor-pointer rounded-full border border-line bg-paper-deep px-2.5 py-0.5 text-[12px] text-ink-soft hover:text-ink"
              >
                {leg.maxConcurrency === null
                  ? t("settings_keys_concurrency_default")
                  : t("settings_keys_concurrency", { n: leg.maxConcurrency })}
              </button>
            )}
            <button
              type="button"
              onClick={() => removeModel(leg.model)}
              aria-label={`${t("settings_keys_remove_model")} ${leg.model}`}
              className="cursor-pointer rounded-md px-1.5 py-1 text-ink-faint hover:text-flag"
            >
              ✕
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-ink-soft">{t("settings_keys_add_model")}</span>
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder={t("settings_keys_search_model")}
          aria-label={t("settings_keys_search_model")}
          className="rounded-lg border border-line-strong bg-paper px-3 py-1.5 text-[13px] text-ink"
        />
        {search !== "" && results.length === 0 ? (
          <p className="text-[12.5px] text-ink-faint">{t("settings_keys_no_model")}</p>
        ) : null}
        {results.length > 0 ? (
          <ul className="max-h-56 overflow-y-auto rounded-lg border border-line bg-paper">
            {results.map((model) => (
              <li key={model.id}>
                <button
                  type="button"
                  onClick={() => addModel(model.id)}
                  className="flex w-full cursor-pointer flex-col items-start gap-0.5 border-b border-line px-3 py-1.5 text-left last:border-b-0 hover:bg-paper-deep"
                >
                  <span className="font-mono text-[13px] text-ink">{model.id}</span>
                  <span className="text-[11.5px] text-ink-faint">{model.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-w-44 flex-1 flex-col gap-1">
          <span className="text-[12px] font-medium text-ink-soft">{t("settings_keys_replace_key")}</span>
          <input
            type="password"
            value={keyDraft}
            onChange={(event) => setKeyDraft(event.target.value)}
            autoComplete="off"
            placeholder="sk-…"
            aria-label={t("settings_keys_replace_key")}
            className="rounded-lg border border-line-strong bg-paper px-3 py-1.5 text-[13px] text-ink"
          />
        </label>
        <button
          type="button"
          onClick={replaceKey}
          disabled={!keyDraft}
          className="rounded-full border border-line-strong px-4 py-1.5 text-[13px] font-medium text-ink transition-opacity disabled:opacity-40"
        >
          {t("settings_keys_save")}
        </button>
        {editingProviderLimit ? (
          <span className="flex items-center gap-1">
            <input
              type="number"
              min={1}
              max={100}
              value={providerLimitDraft}
              onChange={(event) => setProviderLimitDraft(event.target.value)}
              placeholder={t("settings_keys_provider_limit_none")}
              aria-label={t("settings_keys_provider_limit_edit")}
              className="w-24 rounded-md border border-line-strong bg-paper px-2 py-1 text-[13px] text-ink"
            />
            <button
              type="button"
              onClick={saveProviderLimit}
              aria-label={t("settings_keys_provider_limit_save")}
              className="cursor-pointer rounded-full bg-ember px-2.5 py-1 text-[12px] font-semibold text-on-ember"
            >
              ✓
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingProviderLimit(false);
                setProviderLimitDraft("");
                setProviderLimitError(false);
              }}
              aria-label={t("settings_keys_cancel")}
              className="cursor-pointer rounded-md px-1.5 py-1 text-[12px] text-ink-faint hover:text-ink"
            >
              ✕
            </button>
            {providerLimitError ? (
              <span role="alert" className="text-[11px] text-flag">
                {t("settings_keys_limit_invalid")}
              </span>
            ) : null}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditingProviderLimit(true);
              setProviderLimitDraft(entry.maxConcurrency === null ? "" : String(entry.maxConcurrency));
              setProviderLimitError(false);
            }}
            aria-label={t("settings_keys_provider_limit_edit")}
            title={t("settings_keys_provider_limit_edit")}
            className="cursor-pointer rounded-full border border-line bg-paper-deep px-2.5 py-1.5 text-[12px] text-ink-soft hover:text-ink"
          >
            {entry.maxConcurrency === null
              ? t("settings_keys_provider_limit_none")
              : t("settings_keys_provider_limit", { n: entry.maxConcurrency })}
          </button>
        )}
        {editingQuota ? (
          <span className="flex items-center gap-1">
            <input
              type="number"
              min={0.01}
              step="0.5"
              value={quotaDraft}
              onChange={(event) => setQuotaDraft(event.target.value)}
              placeholder={t("settings_keys_quota_none")}
              aria-label={t("settings_keys_quota_edit")}
              className="w-24 rounded-md border border-line-strong bg-paper px-2 py-1 text-[13px] text-ink"
            />
            <button
              type="button"
              onClick={saveQuota}
              aria-label={t("settings_keys_quota_save")}
              className="cursor-pointer rounded-full bg-ember px-2.5 py-1 text-[12px] font-semibold text-on-ember"
            >
              ✓
            </button>
            <button
              type="button"
              onClick={() => {
                setEditingQuota(false);
                setQuotaDraft("");
                setQuotaError(false);
              }}
              aria-label={t("settings_keys_cancel")}
              className="cursor-pointer rounded-md px-1.5 py-1 text-[12px] text-ink-faint hover:text-ink"
            >
              ✕
            </button>
            {quotaError ? (
              <span role="alert" className="text-[11px] text-flag">
                {t("settings_keys_quota_invalid")}
              </span>
            ) : null}
          </span>
        ) : (
          <button
            type="button"
            onClick={() => {
              setEditingQuota(true);
              setQuotaDraft(entry.monthlyQuotaUsd === null ? "" : String(entry.monthlyQuotaUsd));
              setQuotaError(false);
            }}
            aria-label={t("settings_keys_quota_edit")}
            title={t("settings_keys_quota_edit")}
            className="cursor-pointer rounded-full border border-line bg-paper-deep px-2.5 py-1.5 text-[12px] text-ink-soft hover:text-ink"
          >
            {entry.monthlyQuotaUsd === null
              ? t("settings_keys_quota_none")
              : t("settings_keys_quota", { n: entry.monthlyQuotaUsd })}
          </button>
        )}
        <span className="text-[11px] text-ink-faint">
          {t("settings_keys_month_usage", {
            cost: entry.monthCostUsd.toFixed(2),
            tokens: entry.monthTokens,
          })}
        </span>
        <button
          type="button"
          onClick={removeProvider}
          aria-label={t("settings_keys_delete")}
          className="ml-auto cursor-pointer rounded-md px-2 py-1.5 text-[13px] text-ink-faint hover:text-flag"
        >
          {t("settings_keys_delete")}
        </button>
      </div>
      <ConfirmDialog
        open={confirmTarget !== null}
        title={
          confirmTarget
            ? confirmTarget.kind === "provider"
              ? t("settings_keys_confirm_delete_provider_title", { name })
              : t("settings_keys_confirm_remove_model_title", { model: confirmTarget.model })
            : ""
        }
        body={
          confirmTarget
            ? confirmTarget.kind === "provider"
              ? t("settings_keys_confirm_delete_provider_message")
              : t("settings_keys_confirm_remove_model_message")
            : null
        }
        confirmLabel={t("settings_keys_confirm_remove")}
        cancelLabel={t("settings_keys_cancel")}
        onConfirm={confirmedRemoval}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}

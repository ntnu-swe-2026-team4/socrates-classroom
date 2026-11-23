import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { GripVertical, ShieldCheck } from "lucide-react";
import type { AdminKeyStatus, AdminTeacherKeyStatus } from "@socrates/shared";
import { api, ApiError } from "@/api";
import {
  adminKeyProviderModelsOptions,
  adminKeysOptions,
  adminPlatformChainOptions,
  adminTeacherKeysOptions,
  keyProvidersOptions,
} from "@/api/queries";
import { ProviderIcon } from "@/components/ProviderKeys";
import { Button, Card, ConfirmDialog, Field, FormDialog, Input, SectionTitle, Spinner, cn } from "@/components/ui";
import { useSortableOrder, type SortHandleProps } from "@/hooks/useSortableOrder";
import { useFormatDate, useT } from "@/i18n";
import { focusNextIn, focusRestoreOnUnmount } from "@/lib/focus";
import { providerKind, type ProviderKind } from "@/lib/providers";

type ConfirmTarget = { kind: "provider" } | { kind: "model"; model: string };

function errorText(error: unknown, t: (key: "admin_providers_conflict" | "common_error") => string): string {
  return error instanceof ApiError && error.code === "conflict" ? t("admin_providers_conflict") : t("common_error");
}

export function AdminProviderKeys() {
  const t = useT();
  return (
    <div className="space-y-8">
      <AdminKeysSection />
      <TeacherKeysSurvey />
      <PlatformChain />
      <p className="flex items-center gap-2 text-[12.5px] text-ink-faint">
        <ShieldCheck className="size-4 shrink-0" aria-hidden />
        {t("admin_providers_zdr_note")}
      </p>
    </div>
  );
}

function AdminKeysSection() {
  const t = useT();
  const queryClient = useQueryClient();
  const keys = useQuery(adminKeysOptions);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: adminKeysOptions.queryKey });

  const [expanded, setExpanded] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zdrFor, setZdrFor] = useState<AdminKeyStatus | null>(null);
  const [retentionSource, setRetentionSource] = useState("");

  const approveZdr = useMutation({
    mutationFn: () => {
      if (!zdrFor) throw new Error("no key");
      return api.approveAdminKeyZdr(zdrFor.id, {
        retentionSource: retentionSource.trim(),
        verifiedAt: new Date().toISOString().slice(0, 10),
      });
    },
    onSuccess: async () => {
      setZdrFor(null);
      setRetentionSource("");
      await invalidate();
    },
  });

  const list = keys.data ?? [];

  const sort = useSortableOrder({
    ids: list.map((entry) => entry.id),
    save: async (ids) => {
      await api.orderAdminKeys(ids);
      await invalidate();
    },
    onError: setError,
  });
  const byId = useMemo(() => new Map(list.map((entry) => [entry.id, entry])), [list]);

  return (
    <section>
      <SectionTitle>{t("admin_providers_pool_title")}</SectionTitle>
      <Card className="flex flex-col gap-4 p-5">
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 text-[13px] leading-relaxed text-ink-soft">{t("admin_providers_pool_desc")}</p>
          <Button
            size="sm"
            onClick={() => {
              setError(null);
              setSheetOpen(true);
            }}
          >
            {t("admin_providers_add")}
          </Button>
        </div>

        {error ? (
          <p role="alert" className="text-[13px] text-flag">
            {error}
          </p>
        ) : null}

        {keys.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6" />
          </div>
        ) : keys.isError ? (
          <p role="alert" className="text-[13px] text-flag">
            {t("common_error")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sort.order.map((id) => {
              const entry = byId.get(id);
              if (!entry) return null;
              return (
                <AdminKeyRow
                  key={entry.id}
                  entry={entry}
                  expanded={expanded === entry.id}
                  handleProps={sort.handleProps}
                  onToggle={() => setExpanded(expanded === entry.id ? null : entry.id)}
                  onZdr={(target) => {
                    approveZdr.reset();
                    setRetentionSource(target.zdrRetentionSource ?? "");
                    setZdrFor(target);
                  }}
                  onError={setError}
                />
              );
            })}
          </ul>
        )}
        {keys.data && keys.data.length === 0 ? (
          <p className="text-[13px] text-ink-faint">{t("admin_providers_pool_empty")}</p>
        ) : null}

        {sheetOpen ? (
          <AdminKeySheet
            owned={new Set(list.map((entry) => entry.provider))}
            onClose={() => setSheetOpen(false)}
            onSaved={(id) => {
              void invalidate();
              setSheetOpen(false);
              setExpanded(id);
            }}
          />
        ) : null}

        <FormDialog
          open={zdrFor !== null}
          title={zdrFor ? t("admin_providers_zdr_title", { provider: zdrFor.provider }) : ""}
          description={t("admin_providers_zdr_desc")}
          submitLabel={t("admin_providers_zdr_approve")}
          cancelLabel={t("settings_keys_cancel")}
          canSubmit={Boolean(retentionSource.trim())}
          submitting={approveZdr.isPending}
          onSubmit={() => approveZdr.mutate()}
          onCancel={() => setZdrFor(null)}
        >
          <Field label={t("admin_providers_zdr_source")}>
            <Input
              type="url"
              value={retentionSource}
              placeholder="https://…"
              required
              onChange={(event) => setRetentionSource(event.target.value)}
            />
          </Field>
          <p className="text-[12px] leading-relaxed text-ink-faint">
            {t("admin_providers_zdr_verified", { date: new Date().toISOString().slice(0, 10) })}
          </p>
          {approveZdr.isError && (
            <p role="alert" className="text-[13px] text-flag">
              {errorText(approveZdr.error, t)}
            </p>
          )}
        </FormDialog>
      </Card>
    </section>
  );
}

function AdminKeyRow({
  entry,
  expanded,
  handleProps,
  onToggle,
  onZdr,
  onError,
}: {
  entry: AdminKeyStatus;
  expanded: boolean;
  handleProps: SortHandleProps;
  onToggle: () => void;
  onZdr: (entry: AdminKeyStatus) => void;
  onError: (message: string) => void;
}) {
  const t = useT();
  return (
    <li
      data-provider={entry.provider}
      data-sort-id={entry.id}
      className="flex flex-col overflow-hidden rounded-xl border border-line bg-paper"
    >
      <div className="flex items-center gap-3 px-3 py-2">
        <button
          type="button"
          {...handleProps}
          aria-label={`${t("settings_keys_drag")} ${entry.provider}`}
          title={t("settings_keys_drag")}
          className="cursor-grab touch-none rounded-md p-1 text-ink-faint hover:text-ink active:cursor-grabbing"
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
            <span className="text-[14.5px] font-medium text-ink">{entry.provider}</span>
            <span className="rounded-full border border-line bg-paper-deep px-2 py-0.5 text-[11.5px] text-ink-soft">
              {entry.models.length === 1
                ? t("settings_keys_one_model")
                : t("settings_keys_models", { n: entry.models.length })}
            </span>
            {entry.zdrStatus === "approved" ? (
              <Badge tone="moss">{t("admin_providers_zdr_approved")}</Badge>
            ) : (
              <Badge tone="flag">{t("admin_providers_zdr_unverified")}</Badge>
            )}
          </span>
          <span className="font-mono text-[12px] text-ink-faint">
            <span>····{entry.last4}</span>
            {entry.monthlyQuotaUsd !== null ? (
              <span> · {t("admin_providers_quota", { n: entry.monthlyQuotaUsd })}</span>
            ) : null}
          </span>
        </button>
        {entry.zdrStatus !== "approved" && (
          <Button variant="outline" size="sm" onClick={() => onZdr(entry)}>
            {t("admin_providers_zdr_approve")}
          </Button>
        )}
        <span aria-hidden className={cn("pr-1 text-ink-faint transition-transform", expanded && "rotate-90")}>
          ▸
        </span>
      </div>
      {expanded ? <AdminKeyEditor entry={entry} onError={onError} onZdr={onZdr} /> : null}
    </li>
  );
}

function AdminKeyEditor({
  entry,
  onError,
  onZdr,
}: {
  entry: AdminKeyStatus;
  onError: (message: string) => void;
  onZdr: (entry: AdminKeyStatus) => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const models = useQuery(adminKeyProviderModelsOptions(entry.provider));
  const [search, setSearch] = useState("");
  const [editingLimit, setEditingLimit] = useState<string | null>(null);
  const [limitDraft, setLimitDraft] = useState("");
  const [limitError, setLimitError] = useState(false);
  const [editingQuota, setEditingQuota] = useState(false);
  const [quotaDraft, setQuotaDraft] = useState("");
  const [quotaError, setQuotaError] = useState(false);
  const [keyDraft, setKeyDraft] = useState("");
  const [confirmTarget, setConfirmTarget] = useState<ConfirmTarget | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: adminKeysOptions.queryKey });

  const sort = useSortableOrder({
    ids: entry.models.map((leg) => leg.model),
    save: async (models) => {
      await api.orderAdminKeyModels(entry.id, models);
      await refresh();
    },
    onError,
  });
  const byModel = useMemo(() => new Map(entry.models.map((leg) => [leg.model, leg])), [entry.models]);

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
      await api.putAdminKeyModel(entry.id, model);
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
        await api.putAdminKeyModel(entry.id, model, maxConcurrency);
      } else {
        await api.putAdminKeyModel(entry.id, model, null);
      }
      setLimitError(false);
      setEditingLimit(null);
      setLimitDraft("");
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
        await api.updateAdminKey(entry.id, { monthlyQuotaUsd });
      } else {
        await api.updateAdminKey(entry.id, { monthlyQuotaUsd: null });
      }
      setQuotaError(false);
      setEditingQuota(false);
      setQuotaDraft("");
    });

  const replaceKey = () =>
    run(async () => {
      if (!keyDraft) return;
      await api.updateAdminKey(entry.id, { key: keyDraft });
      setKeyDraft("");
    });

  const confirmedRemoval = () =>
    run(async () => {
      const target = confirmTarget;
      setConfirmTarget(null);
      if (target?.kind === "provider") await api.deleteAdminKey(entry.id);
      else if (target?.kind === "model") await api.deleteAdminKeyModel(entry.id, target.model);
    });

  return (
    <div className="flex flex-col gap-3 border-t border-line bg-card px-3 py-3">
      {entry.zdrStatus !== "approved" ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => onZdr(entry)}>
            {t("admin_providers_zdr_approve")}
          </Button>
          <span className="text-[12px] text-ink-faint">{t("admin_providers_zdr_desc")}</span>
        </div>
      ) : null}

      <ul className="flex flex-col gap-1">
        {sort.order.map((model) => {
          const leg = byModel.get(model);
          if (!leg) return null;
          return (
            <li
              key={leg.model}
              data-sort-id={leg.model}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-paper px-2.5 py-1.5"
            >
              <button
                type="button"
                {...sort.handleProps}
                aria-label={`${t("settings_keys_drag")} ${leg.model}`}
                title={t("settings_keys_drag")}
                className="cursor-grab touch-none rounded-md p-1 text-ink-faint hover:text-ink active:cursor-grabbing"
              >
                <GripVertical className="size-4" aria-hidden />
              </button>
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
                onClick={() => setConfirmTarget({ kind: "model", model: leg.model })}
                aria-label={`${t("settings_keys_remove_model")} ${leg.model}`}
                className="cursor-pointer rounded-md px-1.5 py-1 text-ink-faint hover:text-flag"
              >
                ✕
              </button>
            </li>
          );
        })}
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
        {editingQuota ? (
          <span className="flex items-center gap-1">
            <input
              type="number"
              min={0.01}
              step="0.5"
              value={quotaDraft}
              onChange={(event) => setQuotaDraft(event.target.value)}
              placeholder={t("settings_keys_quota_none")}
              aria-label={t("admin_providers_quota_optional")}
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
            aria-label={t("admin_providers_quota_optional")}
            title={t("admin_providers_quota_optional")}
            className="cursor-pointer rounded-full border border-line bg-paper-deep px-2.5 py-1.5 text-[12px] text-ink-soft hover:text-ink"
          >
            {entry.monthlyQuotaUsd === null
              ? t("settings_keys_quota_none")
              : t("admin_providers_quota", { n: entry.monthlyQuotaUsd })}
          </button>
        )}
        <span className="text-[11px] text-ink-faint">
          {t("admin_providers_month_usage", {
            cost: entry.monthCostUsd.toFixed(2),
            tokens: entry.monthTokens,
          })}
        </span>
        <button
          type="button"
          onClick={() => setConfirmTarget({ kind: "provider" })}
          aria-label={t("admin_providers_delete")}
          className="ml-auto cursor-pointer rounded-md px-2 py-1.5 text-[13px] text-ink-faint hover:text-flag"
        >
          {t("admin_providers_delete")}
        </button>
      </div>
      <ConfirmDialog
        open={confirmTarget !== null}
        danger
        title={
          confirmTarget
            ? confirmTarget.kind === "provider"
              ? t("admin_providers_delete_title", { provider: entry.provider })
              : t("settings_keys_confirm_remove_model_title", { model: confirmTarget.model })
            : ""
        }
        body={
          confirmTarget
            ? confirmTarget.kind === "provider"
              ? t("admin_providers_delete_body")
              : t("settings_keys_confirm_remove_model_message")
            : null
        }
        confirmLabel={t("admin_providers_delete")}
        cancelLabel={t("settings_keys_cancel")}
        onConfirm={confirmedRemoval}
        onCancel={() => setConfirmTarget(null)}
      />
    </div>
  );
}

const kindOrder: ProviderKind[] = ["vendor", "relay", "platform"];

function AdminKeySheet({
  owned,
  onClose,
  onSaved,
}: {
  owned: Set<string>;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  const t = useT();
  const providers = useQuery(keyProvidersOptions);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [key, setKey] = useState("");
  const [quota, setQuota] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const focusInput = (element: HTMLElement | null) => {
    element?.focus();
  };

  const restoreFocus = (node: HTMLElement | null) => {
    if (!node) return;
    const restore = focusRestoreOnUnmount();
    return () => restore();
  };

  const f = query.trim().toLowerCase();
  const data = providers.data ?? [];
  const sections = kindOrder.map((kind) => ({
    kind,
    entries: data.filter(
      (entry) =>
        providerKind(entry.id) === kind && (f === "" || entry.name.toLowerCase().includes(f) || entry.id.includes(f)),
    ),
  }));
  const anyTile = sections.some((section) => section.entries.length > 0);

  const back = () => {
    setPicked(null);
    setKey("");
    setQuota("");
    setError(null);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!picked || !key) return;
    setBusy(true);
    setError(null);
    try {
      const echo = await api.createAdminKey({
        provider: picked,
        key,
        monthlyQuotaUsd: quota.trim() === "" ? null : Number(quota),
      });
      onSaved(echo.id);
    } catch (err) {
      setError(errorText(err, t));
    } finally {
      setBusy(false);
    }
  };

  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: pointer-only backdrop by design — the keyboard path is the sheet's Escape handling and cancel button
    // biome-ignore lint/a11y/noStaticElementInteractions: pointer-only backdrop by design — the keyboard path is the sheet's Escape handling and cancel button
    <div
      ref={restoreFocus}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/50 p-4 sm:items-center sm:p-8"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("admin_providers_add")}
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
              <h3 className="min-w-0 truncate font-serif text-[15px] text-ink">{picked}</h3>
            </>
          ) : (
            <h3 className="min-w-0 font-serif text-[15px] text-ink">{t("admin_providers_add")}</h3>
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
              <span className="text-[12px] font-medium text-ink-soft">{t("admin_providers_key")}</span>
              <input
                type="password"
                ref={focusInput}
                value={key}
                onChange={(event) => setKey(event.target.value)}
                autoComplete="off"
                placeholder="sk-…"
                aria-label={t("admin_providers_key")}
                className="rounded-lg border border-line-strong bg-paper px-3 py-2 text-[14px] text-ink"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[12px] font-medium text-ink-soft">{t("admin_providers_quota_optional")}</span>
              <input
                type="number"
                min={0}
                step="0.01"
                value={quota}
                onChange={(event) => setQuota(event.target.value)}
                placeholder="—"
                aria-label={t("admin_providers_quota_optional")}
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
                {busy ? t("settings_keys_saving") : t("admin_providers_add")}
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
              return (
                <section key={section.kind} className="flex flex-col gap-2">
                  <b className="text-[12.5px] font-semibold text-ink-soft">
                    {t(`settings_keys_kind_${section.kind}` as const)}
                  </b>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {section.entries.map((entry) => {
                      const added = owned.has(entry.id);
                      return (
                        <button
                          key={entry.id}
                          type="button"
                          onClick={() => setPicked(entry.id)}
                          title={added ? t("admin_providers_conflict") : entry.id}
                          className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-line bg-paper px-3 py-2.5 text-left transition-colors hover:border-line-strong"
                        >
                          <ProviderIcon id={entry.id} className="h-6 w-6 shrink-0" />
                          <span className="min-w-0 flex-1 truncate text-[13.5px] font-medium text-ink">
                            {entry.name}
                          </span>
                          {added ? (
                            <span title={t("admin_providers_conflict")} className="text-[14px] text-moss" aria-hidden>
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

function TeacherKeysSurvey() {
  const t = useT();
  const queryClient = useQueryClient();
  const survey = useQuery(adminTeacherKeysOptions);
  const [target, setTarget] = useState<AdminTeacherKeyStatus | null>(null);
  const toggle = useMutation({
    mutationFn: () => {
      if (!target) throw new Error("no key");
      return api.setAdminTeacherKeyDisabled(target.userId, target.provider, !target.disabled);
    },
    onSuccess: async () => {
      setTarget(null);
      await queryClient.invalidateQueries({ queryKey: adminTeacherKeysOptions.queryKey });
    },
  });
  const formatDate = useFormatDate();
  const rows = useMemo(() => survey.data ?? [], [survey.data]);

  return (
    <section>
      <SectionTitle>{t("admin_providers_teacher_title")}</SectionTitle>
      <Card className="flex flex-col gap-4 p-5">
        <p className="text-[13px] leading-relaxed text-ink-soft">{t("admin_providers_teacher_desc")}</p>
        {survey.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6" />
          </div>
        ) : survey.isError ? (
          <p role="alert" className="text-[13px] text-flag">
            {t("common_error")}
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li
                key={`${row.userId}/${row.provider}`}
                data-teacher={row.userId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-paper px-3 py-2"
              >
                <ProviderIcon id={row.provider} className="h-6 w-6 shrink-0" />
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-default flex-col items-start gap-0.5 text-left"
                >
                  <span className="flex items-center gap-2">
                    <span className="text-[14.5px] font-medium text-ink">{row.userName}</span>
                    {row.disabled ? <Badge tone="flag">{t("admin_providers_teacher_disabled")}</Badge> : null}
                  </span>
                  <span className="font-mono text-[12px] text-ink-faint">
                    <span>{row.provider} · </span>
                    <span>····{row.last4}</span>
                  </span>
                </button>
                <span className="text-[11.5px] text-ink-faint">
                  {t("admin_providers_month_usage", { cost: row.monthCostUsd.toFixed(2), tokens: row.monthTokens })}
                </span>
                <span className="text-[11.5px] text-ink-faint">{formatDate(row.updatedAt)}</span>
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(!row.disabled && "hover:bg-flag-wash hover:text-flag")}
                  onClick={() => setTarget(row)}
                >
                  {row.disabled ? t("admin_providers_teacher_enable") : t("admin_providers_teacher_disable")}
                </Button>
              </li>
            ))}
          </ul>
        )}
        {survey.data && survey.data.length === 0 ? (
          <p className="text-[13px] text-ink-faint">{t("admin_providers_teacher_empty")}</p>
        ) : null}
        {toggle.isError && (
          <p role="alert" className="text-[13px] text-flag">
            {t("common_error")}
          </p>
        )}
      </Card>
      <ConfirmDialog
        open={target !== null}
        danger={!target?.disabled}
        title={
          target
            ? t(target.disabled ? "admin_providers_teacher_enable_title" : "admin_providers_teacher_disable_title", {
                name: target.userName,
                provider: target.provider,
              })
            : ""
        }
        body={t(target?.disabled ? "admin_providers_teacher_enable_body" : "admin_providers_teacher_disable_body")}
        confirmLabel={t(target?.disabled ? "admin_providers_teacher_enable" : "admin_providers_teacher_disable")}
        cancelLabel={t("settings_keys_cancel")}
        onConfirm={() => toggle.mutate()}
        onCancel={() => setTarget(null)}
      />
    </section>
  );
}

function PlatformChain() {
  const t = useT();
  const chain = useQuery(adminPlatformChainOptions);
  return (
    <section>
      <SectionTitle>{t("admin_providers_chain_title")}</SectionTitle>
      <Card className="flex flex-col gap-4 p-5">
        <p className="text-[13px] leading-relaxed text-ink-soft">{t("admin_providers_chain_desc")}</p>
        {chain.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6" />
          </div>
        ) : chain.isError ? (
          <p role="alert" className="text-[13px] text-flag">
            {t("common_error")}
          </p>
        ) : (
          <ol className="flex flex-col gap-2">
            {chain.data.legs.map((leg, index) => (
              <li
                key={`${leg.provider}/${leg.model}/${leg.priority}`}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-paper px-3 py-2"
              >
                <span className="text-[11.5px] text-ink-faint tabular-nums">{index + 1}</span>
                <ProviderIcon id={leg.provider} className="h-6 w-6 shrink-0" />
                <button
                  type="button"
                  className="flex min-w-0 flex-1 cursor-default flex-col items-start gap-0.5 text-left"
                >
                  <span className="text-[14.5px] font-medium text-ink">{leg.provider}</span>
                  <span className="font-mono text-[12px] text-ink-faint">{leg.model}</span>
                </button>
                <span className="text-[11.5px] text-ink-faint">
                  {t("admin_providers_chain_leg", { concurrency: leg.maxConcurrency, priority: leg.priority })}
                </span>
              </li>
            ))}
          </ol>
        )}
      </Card>
    </section>
  );
}

function Badge({ tone, children }: { tone: "moss" | "flag"; children: React.ReactNode }) {
  const tones = {
    moss: "bg-moss-wash text-moss",
    flag: "bg-flag-wash text-flag",
  } as const;
  return <span className={cn("rounded-full px-2.5 py-0.5 text-[11.5px]", tones[tone])}>{children}</span>;
}

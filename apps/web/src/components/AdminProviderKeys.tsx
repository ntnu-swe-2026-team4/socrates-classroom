import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ShieldCheck } from "lucide-react";
import type { AdminKeyStatus, AdminTeacherKeyStatus } from "@socrates/shared";
import { api, ApiError } from "@/api";
import {
  adminKeysOptions,
  adminPlatformChainOptions,
  adminTeacherKeysOptions,
  keyProvidersOptions,
} from "@/api/queries";
import { ProviderIcon } from "@/components/ProviderKeys";
import { Button, Card, ConfirmDialog, Field, FormDialog, Input, SectionTitle, Spinner, cn } from "@/components/ui";
import { useFormatDate, useT } from "@/i18n";

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
  const providers = useQuery(keyProvidersOptions);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: adminKeysOptions.queryKey });

  const [adding, setAdding] = useState(false);
  const [provider, setProvider] = useState("");
  const [key, setKey] = useState("");
  const [quota, setQuota] = useState("");
  const [zdrFor, setZdrFor] = useState<AdminKeyStatus | null>(null);
  const [retentionSource, setRetentionSource] = useState("");
  const [removing, setRemoving] = useState<AdminKeyStatus | null>(null);

  const create = useMutation({
    mutationFn: () =>
      api.createAdminKey({
        provider,
        key,
        monthlyQuotaUsd: quota.trim() === "" ? null : Number(quota),
      }),
    onSuccess: async () => {
      setProvider("");
      setKey("");
      setQuota("");
      setAdding(false);
      await invalidate();
    },
  });
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
  const remove = useMutation({
    mutationFn: () => {
      if (!removing) throw new Error("no key");
      return api.deleteAdminKey(removing.id);
    },
    onSuccess: async () => {
      setRemoving(null);
      await invalidate();
    },
  });

  const list = keys.data ?? [];

  return (
    <section>
      <SectionTitle>{t("admin_providers_pool_title")}</SectionTitle>
      <Card className="p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] leading-relaxed text-ink-soft">{t("admin_providers_pool_desc")}</p>
          <Button
            size="sm"
            onClick={() => {
              create.reset();
              setAdding(true);
            }}
          >
            {t("admin_providers_add")}
          </Button>
        </div>
        {keys.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6" />
          </div>
        ) : keys.isError ? (
          <p role="alert" className="text-[13px] text-flag">
            {t("common_error")}
          </p>
        ) : list.length === 0 ? (
          <p className="text-[13px] text-ink-faint">{t("admin_providers_pool_empty")}</p>
        ) : (
          <ul className="space-y-2">
            {list.map((entry) => (
              <li
                key={entry.id}
                data-provider={entry.provider}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-line bg-paper px-4 py-3"
              >
                <ProviderIcon id={entry.provider} className="h-5 w-5 shrink-0" />
                <b className="font-serif text-[14.5px] text-ink">{entry.provider}</b>
                <code className="rounded bg-paper-deep px-1.5 py-0.5 text-[11.5px] text-ink-soft">
                  ····{entry.last4}
                </code>
                {entry.zdrStatus === "approved" ? (
                  <Badge tone="moss">{t("admin_providers_zdr_approved")}</Badge>
                ) : (
                  <Badge tone="flag">{t("admin_providers_zdr_unverified")}</Badge>
                )}
                {entry.monthlyQuotaUsd !== null && (
                  <span className="text-[12px] text-ink-soft">
                    {t("admin_providers_quota", { n: entry.monthlyQuotaUsd })}
                  </span>
                )}
                <span className="text-[11.5px] text-ink-faint">
                  {t("admin_providers_month_usage", {
                    cost: entry.monthCostUsd.toFixed(2),
                    tokens: entry.monthTokens,
                  })}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  {entry.zdrStatus !== "approved" && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        approveZdr.reset();
                        setRetentionSource(entry.zdrRetentionSource ?? "");
                        setZdrFor(entry);
                      }}
                    >
                      {t("admin_providers_zdr_approve")}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="hover:bg-flag-wash hover:text-flag"
                    onClick={() => setRemoving(entry)}
                  >
                    {t("admin_providers_delete")}
                  </Button>
                </span>
                {entry.models.length > 0 && (
                  <p className="w-full text-[12px] text-ink-faint">
                    {t("admin_providers_legs", { legs: entry.models.map((leg) => leg.model).join(", ") })}
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        {create.isError && (
          <p role="alert" className="mt-3 text-[13px] text-flag">
            {errorText(create.error, t)}
          </p>
        )}
      </Card>

      <AddKeyDialog
        open={adding}
        providers={(providers.data ?? []).map((entry) => entry.id)}
        provider={provider}
        keyValue={key}
        quota={quota}
        busy={create.isPending}
        onProvider={setProvider}
        onKey={setKey}
        onQuota={setQuota}
        onClose={() => setAdding(false)}
        onSubmit={() => create.mutate()}
      />

      <FormDialog
        open={zdrFor !== null}
        title={zdrFor ? t("admin_providers_zdr_title", { provider: zdrFor.provider }) : ""}
        description={t("admin_providers_zdr_desc")}
        submitLabel={t("admin_providers_zdr_approve")}
        cancelLabel={t("common_cancel")}
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

      <ConfirmDialog
        open={removing !== null}
        danger
        title={removing ? t("admin_providers_delete_title", { provider: removing.provider }) : ""}
        body={t("admin_providers_delete_body")}
        confirmLabel={t("admin_providers_delete")}
        cancelLabel={t("common_cancel")}
        onConfirm={() => remove.mutate()}
        onCancel={() => setRemoving(null)}
      />
    </section>
  );
}

function AddKeyDialog({
  open,
  providers,
  provider,
  keyValue,
  quota,
  busy,
  onProvider,
  onKey,
  onQuota,
  onClose,
  onSubmit,
}: {
  open: boolean;
  providers: string[];
  provider: string;
  keyValue: string;
  quota: string;
  busy: boolean;
  onProvider: (value: string) => void;
  onKey: (value: string) => void;
  onQuota: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const t = useT();
  return (
    <FormDialog
      open={open}
      title={t("admin_providers_add")}
      submitLabel={t("admin_providers_add")}
      cancelLabel={t("common_cancel")}
      canSubmit={Boolean(provider) && Boolean(keyValue)}
      submitting={busy}
      onSubmit={onSubmit}
      onCancel={onClose}
    >
      <Field label={t("admin_providers_provider")}>
        <select
          value={provider}
          onChange={(event) => onProvider(event.target.value)}
          className="h-9 w-full rounded-lg border border-line-strong bg-paper px-3 text-[13.5px] text-ink"
        >
          <option value="">—</option>
          {providers.map((id) => (
            <option key={id} value={id}>
              {id}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("admin_providers_key")}>
        <Input
          type="password"
          autoComplete="off"
          value={keyValue}
          required
          minLength={8}
          maxLength={256}
          onChange={(event) => onKey(event.target.value)}
        />
      </Field>
      <Field label={t("admin_providers_quota_optional")}>
        <Input
          type="number"
          min="0"
          step="0.01"
          value={quota}
          placeholder="—"
          onChange={(event) => onQuota(event.target.value)}
        />
      </Field>
    </FormDialog>
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
      <Card className="p-5">
        <p className="mb-4 text-[13px] leading-relaxed text-ink-soft">{t("admin_providers_teacher_desc")}</p>
        {survey.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6" />
          </div>
        ) : survey.isError ? (
          <p role="alert" className="text-[13px] text-flag">
            {t("common_error")}
          </p>
        ) : rows.length === 0 ? (
          <p className="text-[13px] text-ink-faint">{t("admin_providers_teacher_empty")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((row) => (
              <li
                key={`${row.userId}/${row.provider}`}
                data-teacher={row.userId}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3"
              >
                <ProviderIcon id={row.provider} className="h-5 w-5 shrink-0" />
                <b className="font-serif text-[14.5px] text-ink">{row.userName}</b>
                <span className="text-[12px] text-ink-soft">{row.provider}</span>
                <code className="rounded bg-paper-deep px-1.5 py-0.5 text-[11.5px] text-ink-soft">····{row.last4}</code>
                {row.disabled ? <Badge tone="flag">{t("admin_providers_teacher_disabled")}</Badge> : null}
                <span className="text-[11.5px] text-ink-faint">
                  {t("admin_providers_month_usage", { cost: row.monthCostUsd.toFixed(2), tokens: row.monthTokens })}
                </span>
                {row.models.length > 0 && (
                  <span className="w-full text-[12px] text-ink-faint">
                    {t("admin_providers_legs", { legs: row.models.map((leg) => leg.model).join(", ") })}
                  </span>
                )}
                <span className="ml-auto text-[11.5px] text-ink-faint">{formatDate(row.updatedAt)}</span>
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
        {toggle.isError && (
          <p role="alert" className="mt-3 text-[13px] text-flag">
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
        cancelLabel={t("common_cancel")}
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
      <Card className="p-5">
        <p className="mb-4 text-[13px] leading-relaxed text-ink-soft">{t("admin_providers_chain_desc")}</p>
        {chain.isPending ? (
          <div className="flex justify-center py-6">
            <Spinner className="h-6 w-6" />
          </div>
        ) : chain.isError ? (
          <p role="alert" className="text-[13px] text-flag">
            {t("common_error")}
          </p>
        ) : (
          <ol className="flex flex-col gap-1">
            {chain.data.legs.map((leg, index) => (
              <li
                key={`${leg.provider}/${leg.model}/${leg.priority}`}
                className="flex flex-wrap items-center gap-x-3 rounded-xl bg-paper-deep px-4 py-2.5"
              >
                <span className="text-[11.5px] text-ink-faint tabular-nums">{index + 1}</span>
                <ProviderIcon id={leg.provider} className="h-4 w-4" />
                <b className="font-serif text-[13.5px] text-ink">{leg.provider}</b>
                <code className="text-[12px] text-ink-soft">{leg.model}</code>
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

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/api";
import { Button, Card, Initial, Input, Spinner, cn } from "@/components/ui";
import { useFormatDate, useI18n, useT } from "@/i18n";

const MIN_QUOTA = 1000;

export function UsageCard() {
  const t = useT();
  const { locale } = useI18n();
  const formatDate = useFormatDate();
  const queryClient = useQueryClient();
  const usage = useQuery({ queryKey: ["usage"], queryFn: () => api.usage() });
  const [draft, setDraft] = useState("");
  const quota = usage.data?.quota ?? null;
  const [prevQuota, setPrevQuota] = useState(quota);
  if (quota !== prevQuota) {
    setPrevQuota(quota);
    setDraft(quota === null ? "" : String(quota));
  }
  const save = useMutation({
    mutationFn: (tokens: number | null) => api.setUsageQuota(tokens),
    onSuccess: (next) => queryClient.setQueryData(["usage"], next),
  });

  if (usage.isPending) {
    return (
      <Card className="p-5">
        <Spinner />
      </Card>
    );
  }
  if (!usage.data) {
    return (
      <Card className="p-5">
        <p role="alert" className="text-[13px] text-flag">
          {t("common_error")}
        </p>
      </Card>
    );
  }

  const data = usage.data;
  const number = (value: number) => value.toLocaleString(locale);
  const percent = quota ? Math.round((data.tokens / quota) * 100) : 0;
  const parsed = Number(draft.replaceAll(",", "").trim());
  const valid = draft.trim() !== "" && Number.isInteger(parsed) && parsed >= MIN_QUOTA;
  const changed = valid && parsed !== quota;

  return (
    <Card className="flex flex-col gap-4 p-5" data-usage-card>
      <div>
        <p className="font-serif text-[15.5px] text-ink">{t("usage_title")}</p>
        <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">{t("usage_desc")}</p>
      </div>

      <div className="grid gap-x-5 gap-y-2 sm:grid-cols-[minmax(0,11rem)_1fr_auto] sm:items-center">
        <div>
          <p className="text-[13.5px] text-ink">{t("usage_month")}</p>
          <p className="text-[12px] text-ink-faint">{t("usage_resets", { date: formatDate(data.resetsAt) })}</p>
        </div>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.min(percent, 100)}
          aria-label={t("usage_month")}
          className="h-2 overflow-hidden rounded-full bg-paper-deep"
        >
          <div
            className={cn("h-full rounded-full transition-[width]", percent >= 100 ? "bg-flag" : "bg-ink")}
            style={{ width: `${Math.min(percent, 100)}%` }}
          />
        </div>
        <p className="text-[13px] text-ink-soft tabular-nums sm:text-right" data-usage-percent>
          {quota ? t("usage_percent", { percent }) : t("usage_no_quota")}
        </p>
      </div>
      <p className="text-[12.5px] text-ink-faint tabular-nums">
        {t("usage_tokens", { tokens: number(data.tokens), requests: number(data.requests) })}
        {quota ? ` · ${t("usage_of_quota", { quota: number(quota) })}` : ""}
      </p>

      <form
        className="flex flex-col gap-2 border-t border-line pt-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (changed && !save.isPending) save.mutate(parsed);
        }}
      >
        <label htmlFor="usage-quota" className="text-[13.5px] text-ink">
          {t("usage_quota_label")}
        </label>
        <div className="flex flex-wrap gap-2">
          <Input
            id="usage-quota"
            inputMode="numeric"
            value={draft}
            placeholder="1000000"
            onChange={(event) => setDraft(event.target.value)}
            className="max-w-48 tabular-nums"
          />
          <Button type="submit" disabled={!changed || save.isPending}>
            {save.isPending ? <Spinner /> : t("common_save")}
          </Button>
          {quota !== null && (
            <Button type="button" variant="ghost" disabled={save.isPending} onClick={() => save.mutate(null)}>
              {t("usage_quota_remove")}
            </Button>
          )}
        </div>
        {draft.trim() !== "" && !valid && <p className="text-[12.5px] text-flag">{t("usage_quota_invalid")}</p>}
        {save.isError && (
          <p role="alert" className="text-[12.5px] text-flag">
            {t("common_error")}
          </p>
        )}
        <p className="text-[12px] leading-relaxed text-ink-faint">{t("usage_alert_hint")}</p>
      </form>

      <ul className="grid gap-2 sm:grid-cols-3">
        {data.thresholds.map((item) => (
          <li
            key={item.threshold}
            data-threshold={item.threshold}
            className={cn(
              "rounded-lg border px-3 py-2",
              item.reachedAt ? "border-ink bg-card" : "border-line text-ink-faint",
            )}
          >
            <p className="text-[15px] font-semibold tabular-nums">{item.threshold}%</p>
            <p className="text-[12px]">
              {!item.reachedAt
                ? t("usage_threshold_waiting")
                : item.emailedAt
                  ? t("usage_threshold_emailed")
                  : t("usage_threshold_pending")}
            </p>
          </li>
        ))}
      </ul>
      {!data.emailReady && <p className="text-[12px] leading-relaxed text-ink-faint">{t("usage_email_off")}</p>}
    </Card>
  );
}

export function AdminUsageAlerts() {
  const t = useT();
  const { locale } = useI18n();
  const formatDate = useFormatDate();
  const alerts = useQuery({ queryKey: ["admin", "usageAlerts"], queryFn: () => api.adminUsageAlerts() });
  const number = (value: number) => value.toLocaleString(locale);
  return (
    <Card className="overflow-hidden" data-usage-alerts>
      <h2 className="border-b border-line px-5 py-3.5 text-[15px] font-semibold text-ink">{t("admin_usage_alerts")}</h2>
      {alerts.isPending ? (
        <div className="p-5">
          <Spinner />
        </div>
      ) : (alerts.data ?? []).length === 0 ? (
        <p className="p-5 text-[13px] text-ink-faint">{t("admin_usage_alerts_empty")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {(alerts.data ?? []).map((alert) => (
            <li
              key={`${alert.ownerId}:${alert.month}:${alert.threshold}`}
              className="flex items-center gap-3 px-5 py-2.5"
            >
              <Initial name={alert.name} className="size-8 text-[13px]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13.5px] text-ink">{alert.name}</span>
                <span className="block truncate text-[12px] text-ink-faint tabular-nums">
                  {alert.email ?? "—"} · {number(alert.tokens)}
                  {alert.quota ? ` / ${number(alert.quota)}` : ""} tokens · {formatDate(alert.createdAt)}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-md px-2 py-0.5 text-[12px] font-semibold tabular-nums",
                  alert.threshold >= 100 ? "bg-flag-wash text-flag" : "bg-ember-wash text-ink",
                )}
              >
                {alert.threshold}%
              </span>
              <span className="hidden w-24 shrink-0 text-right text-[12px] text-ink-faint sm:block">
                {alert.emailedAt ? t("usage_threshold_emailed") : t("usage_threshold_pending")}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

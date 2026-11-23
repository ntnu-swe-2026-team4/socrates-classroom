import { useState } from "react";
import { adminOverviewOptions, adminUsersOptions } from "@/api/queries";
import { createFileRoute, Link, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { AdminOverview, AdminUser } from "@socrates/shared";
import { api, ApiError } from "@/api";
import { meOf } from "@/api/me";
import { NotificationComposer } from "@/components/Notifications";
import { Button, Card, ConfirmDialog, Field, Input, PageHeader, Spinner, cn } from "@/components/ui";
import { ADMIN_SECTIONS, type AdminTab } from "@/lib/adminSections";
import { useFormatDate, useT } from "@/i18n";

const TABS = ADMIN_SECTIONS.map((section) => section.tab);

export const Route = createFileRoute("/admin")({
  validateSearch: (search: Record<string, unknown>): { tab?: AdminTab } => ({
    tab: TABS.find((tab) => tab === search.tab && tab !== "overview"),
  }),
  beforeLoad: async ({ context, location }) => {
    const me = await meOf(context.queryClient);
    if (!me) throw redirect({ to: "/login", search: { next: location.href }, replace: true });
    if (!me.isAdmin) throw redirect({ to: "/classrooms" });
  },
  component: AdminConsolePage,
});

function AdminConsolePage() {
  const t = useT();
  const { tab = "overview" } = Route.useSearch();
  return (
    <div className="min-h-full pb-16">
      <PageHeader width="max-w-5xl" eyebrow={t("admin_eyebrow")} title={t("admin_title")} />
      <div className="mx-auto w-full max-w-5xl px-6 pt-8">
        <nav aria-label={t("admin_tabs")} className="mb-6 flex flex-wrap gap-2">
          {ADMIN_SECTIONS.map((section) => {
            const Icon = section.icon;
            return (
              <Link
                key={section.tab}
                to="/admin"
                search={section.tab === "overview" ? {} : { tab: section.tab }}
                activeOptions={{ exact: true, includeSearch: true }}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ember/60",
                  tab === section.tab
                    ? "border-ember-deep bg-ember-wash font-semibold text-ink"
                    : "border-line-strong bg-card text-ink-soft hover:border-ember-deep hover:text-ink",
                )}
              >
                <Icon className="size-4 shrink-0" aria-hidden />
                {t(section.label)}
              </Link>
            );
          })}
        </nav>
        {tab === "overview" && <Overview />}
        {tab === "users" && <Users />}
        {tab === "notify" && <NotificationComposer />}
      </div>
    </div>
  );
}

function Overview() {
  const t = useT();
  const overview = useQuery(adminOverviewOptions);
  if (overview.isPending) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (overview.isError) {
    return <Card className="p-6 text-sm text-ink-soft">{t("common_error")}</Card>;
  }
  const data = overview.data;
  const stats: { key: keyof AdminOverview; label: string; value: number }[] = [
    { key: "users", label: t("admin_stat_users"), value: data.users },
    { key: "classrooms", label: t("admin_stat_classrooms"), value: data.classrooms },
    { key: "runningActivities", label: t("admin_stat_running"), value: data.runningActivities },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      {stats.map((stat) => (
        <div key={stat.key} data-stat={stat.key} className="rounded-xl border border-line bg-card px-5 py-4 shadow-sm">
          <span className="block text-[12.5px] text-ink-soft">{stat.label}</span>
          <span className="mt-1 block text-[28px] font-semibold leading-tight tracking-tight text-ink tabular-nums">
            {stat.value}
          </span>
        </div>
      ))}
    </div>
  );
}

function Users() {
  const t = useT();
  const queryClient = useQueryClient();
  const users = useQuery(adminUsersOptions);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [created, setCreated] = useState<string | null>(null);
  const [disabling, setDisabling] = useState<AdminUser | null>(null);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: adminUsersOptions.queryKey });
  };

  const create = useMutation({
    mutationFn: () => api.createAdminUser({ name: name.trim(), email: email.trim(), password }),
    onSuccess: async (user) => {
      setCreated(user.name);
      setName("");
      setEmail("");
      setPassword("");
      await invalidate();
    },
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: { disabled?: boolean } }) => api.updateAdminUser(id, input),
    onSuccess: async () => {
      setDisabling(null);
      await invalidate();
    },
  });

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="mb-4 font-serif text-lg">{t("admin_create_title")}</h2>
        <p className="mb-4 text-[13px] leading-relaxed text-ink-soft">{t("admin_create_desc")}</p>
        <form
          className="grid gap-4 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (!create.isPending) create.mutate();
          }}
        >
          <Field label={t("admin_create_name")}>
            <Input value={name} onChange={(event) => setName(event.target.value)} required maxLength={80} />
          </Field>
          <Field label={t("admin_create_email")}>
            <Input
              type="email"
              autoComplete="off"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          <Field label={t("admin_create_password")}>
            <Input
              type="password"
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              minLength={8}
              maxLength={128}
            />
          </Field>
          <div className="flex items-end">
            <Button type="submit" disabled={create.isPending || !name.trim() || !email.trim() || password.length < 8}>
              {create.isPending ? <Spinner /> : null}
              {t("admin_create_submit")}
            </Button>
          </div>
          {create.isError && (
            <p role="alert" className="text-[13px] text-flag sm:col-span-2">
              {create.error instanceof ApiError && create.error.code === "conflict"
                ? t("admin_create_failed")
                : t("common_error")}
            </p>
          )}
          {created && (
            <p className="text-[13px] text-moss sm:col-span-2">{t("admin_create_done", { name: created })}</p>
          )}
        </form>
      </Card>

      <section>
        <h2 className="mb-3 font-serif text-lg">{t("admin_list_title")}</h2>
        {users.isPending ? (
          <div className="flex justify-center py-10">
            <Spinner className="h-6 w-6" />
          </div>
        ) : users.isError ? (
          <Card className="p-6 text-sm text-ink-soft">{t("common_error")}</Card>
        ) : (
          <ul className="space-y-3">
            {users.data.map((user) => (
              <UserRow
                key={user.id}
                user={user}
                busy={update.isPending && update.variables?.id === user.id}
                onDisable={setDisabling}
                onRestore={(id) => update.mutate({ id, input: { disabled: false } })}
              />
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={disabling !== null}
        danger
        title={disabling ? t("admin_disable_title", { name: disabling.name }) : ""}
        body={t("admin_disable_body")}
        confirmLabel={t("admin_disable")}
        cancelLabel={t("common_cancel")}
        onConfirm={() => {
          if (disabling) update.mutate({ id: disabling.id, input: { disabled: true } });
        }}
        onCancel={() => setDisabling(null)}
      />
    </div>
  );
}

function UserRow({
  user,
  busy,
  onDisable,
  onRestore,
}: {
  user: AdminUser;
  busy: boolean;
  onDisable: (user: AdminUser) => void;
  onRestore: (id: string) => void;
}) {
  const t = useT();
  const formatDate = useFormatDate();
  return (
    <Card className={cn("p-5", user.disabled && "opacity-70")}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <b className="font-serif text-[15.5px]">{user.name}</b>
            {user.isAdmin && <Badge tone="ember">{t("admin_badge_admin")}</Badge>}
            {user.disabled && <Badge tone="flag">{t("admin_badge_disabled")}</Badge>}
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-faint">{user.email ?? "—"}</p>
          <p className="text-[11.5px] text-ink-faint">{t("admin_created_at", { date: formatDate(user.createdAt) })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || user.isAdmin}
            onClick={() => (user.disabled ? onRestore(user.id) : onDisable(user))}
          >
            {user.disabled ? t("admin_enable") : t("admin_disable")}
          </Button>
        </div>
      </div>
    </Card>
  );
}

function Badge({ tone, children }: { tone: "ember" | "moss" | "flag" | "plain"; children: React.ReactNode }) {
  const tones = {
    ember: "bg-ember-wash text-ember",
    moss: "bg-moss-wash text-moss",
    flag: "bg-flag-wash text-flag",
    plain: "bg-paper-deep text-ink-faint",
  } as const;
  return <span className={cn("rounded-full px-2.5 py-0.5 text-[11.5px]", tones[tone])}>{children}</span>;
}

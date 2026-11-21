import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, ApiError, type AdminUser } from "@/api";
import { meOf } from "@/api/me";
import { Button, Card, Field, Input, PageHeader, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/admin/users")({
  beforeLoad: async ({ context }) => {
    const me = await meOf(context.queryClient);
    if (!me) throw redirect({ to: "/login" });
    if (!me.isAdmin) throw redirect({ to: "/classrooms" });
  },
  component: AdminUsersPage,
});

function AdminUsersPage() {
  const t = useT();
  const queryClient = useQueryClient();
  const users = useQuery({ queryKey: ["admin-users"], queryFn: () => api.listAdminUsers() });
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [created, setCreated] = useState<string | null>(null);

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ["admin-users"] });
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
    onSuccess: () => invalidate(),
  });

  return (
    <div className="min-h-full pb-16">
      <PageHeader
        width="max-w-4xl"
        eyebrow={t("admin_eyebrow")}
        title={t("admin_title")}
        description={t("admin_intro")}
      />
      <div className="mx-auto w-full max-w-4xl space-y-6 px-6 pt-8">
        <Card className="p-6">
          <h2 className="mb-4 font-serif text-lg">{t("admin_create_title")}</h2>
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
                {create.error instanceof ApiError ? create.error.message : t("common_error")}
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
                  onToggle={update.mutate}
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function UserRow({
  user,
  busy,
  onToggle,
}: {
  user: AdminUser;
  busy: boolean;
  onToggle: (input: { id: string; input: { disabled?: boolean } }) => void;
}) {
  const t = useT();
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
          <p className="text-[11.5px] text-ink-faint">{t("admin_created_at", { date: user.createdAt.slice(0, 10) })}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={busy || user.isAdmin}
            onClick={() => onToggle({ id: user.id, input: { disabled: !user.disabled } })}
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

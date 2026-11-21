import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { devAccountsOptions } from "@/api/queries";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { api, ApiError, type DevAccount } from "@/api";
import { meQueryOptions } from "@/api/me";
import { Button, Card, PageHeader, cn } from "@/components/ui";
import { useT, type MessageKey } from "@/i18n";

export const Route = createFileRoute("/dev/accounts")({ component: DevAccountsPage });

const ROLE_KEY: Record<DevAccount["fixtureRole"], MessageKey> = {
  admin: "dev_role_admin",
  teacher: "dev_role_teacher",
  student: "dev_role_student",
};

function DevAccountsPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accounts = useQuery(devAccountsOptions);

  const login = useMutation({
    mutationFn: (account: DevAccount) => api.devLogin(account.email),
    onSuccess: async (user, account) => {
      queryClient.clear();
      queryClient.setQueryData(meQueryOptions.queryKey, user);
      if (account.fixtureRole === "student") await navigate({ to: "/home" });
      else if (account.fixtureRole === "admin") await navigate({ to: "/admin/users" });
      else await navigate({ to: "/classrooms" });
    },
  });

  const unavailable = accounts.error instanceof ApiError && accounts.error.code === "not_found";
  const failed = accounts.isError && !unavailable;
  const nothingSeeded = accounts.isSuccess && accounts.data.accounts.length === 0;

  return (
    <div className="min-h-full pb-16">
      <PageHeader
        width="max-w-4xl"
        eyebrow={t("dev_eyebrow")}
        title={t("dev_title")}
        description={t("dev_intro")}
        actions={
          <Link to="/" className="text-xs text-ember">
            {t("common_back")}
          </Link>
        }
      />
      <div className="mx-auto w-full max-w-4xl space-y-4 px-6 pt-8">
        {unavailable && (
          <Card className="p-6 text-sm text-ink-soft">
            <p>{t("dev_unavailable")}</p>
          </Card>
        )}
        {failed && (
          <Card className="p-6 text-sm text-ink-soft">
            <p>{t("common_error")}</p>
          </Card>
        )}
        {nothingSeeded && (
          <Card className="p-6 text-sm text-ink-soft">
            <p>{t("dev_not_seeded")}</p>
            <code className="mt-2 inline-block rounded-lg bg-paper-deep px-3 py-1.5 font-mono text-xs">pnpm seed</code>
          </Card>
        )}
        {accounts.data && accounts.data.accounts.length > 0 && (
          <>
            <p className="text-xs text-ink-faint">{t("dev_password", { password: accounts.data.password })}</p>
            {login.isError && (
              <p role="alert" className="text-sm text-flag">
                {t("common_error")}
              </p>
            )}
            <div className="space-y-3">
              {accounts.data.accounts.map((account) => {
                const busy = login.isPending && login.variables?.email === account.email;
                return (
                  <Card key={account.id} className="p-5">
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <b className="font-serif text-[15.5px]">{account.name}</b>
                          <span
                            className={cn(
                              "rounded-full px-2.5 py-0.5 text-[11.5px]",
                              account.fixtureRole === "student" ? "bg-moss-wash text-moss" : "bg-ember-wash text-ember",
                            )}
                          >
                            {t(ROLE_KEY[account.fixtureRole])}
                          </span>
                        </div>
                        <p className="mt-0.5 truncate text-xs text-ink-faint">{account.email}</p>
                      </div>
                      <Button size="sm" disabled={login.isPending} onClick={() => login.mutate(account)}>
                        {busy ? t("dev_switching") : t("dev_switch")}
                      </Button>
                    </div>

                    <div className="mt-4 border-t border-line pt-3">
                      <p className="mb-1.5 text-[11.5px] text-ink-faint">{t("dev_classrooms")}</p>
                      {account.classrooms.length === 0 ? (
                        <p className="text-xs text-ink-faint">{t("dev_no_classrooms")}</p>
                      ) : (
                        <ul className="space-y-1.5">
                          {account.classrooms.map((room) => (
                            <li key={room.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
                              <Link
                                to="/classrooms/$classroomId"
                                params={{ classroomId: room.id }}
                                className="text-ember hover:underline"
                              >
                                {room.name}
                              </Link>
                              <span className="text-[11.5px] text-ink-faint">
                                {room.role === "teacher" ? t("dev_role_teacher") : t("dev_role_student")}
                              </span>
                              {room.code && (
                                <Link
                                  to="/join/$code"
                                  params={{ code: room.code }}
                                  className="text-[11.5px] text-ink-faint hover:text-ember"
                                >
                                  {t("dev_join_link")} · {room.code}
                                </Link>
                              )}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
            <p className="text-xs text-ink-faint">{t("dev_admin_hint")}</p>
          </>
        )}
      </div>
    </div>
  );
}

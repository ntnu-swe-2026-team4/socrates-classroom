import { useDeferredValue, useState } from "react";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Building2, ChevronRight, Plus, Search, UserMinus } from "lucide-react";
import type { AdminUser, SchoolTeacher } from "@socrates/shared";
import { api, ApiError } from "@/api";
import { ADMIN_SECTIONS, type AdminTab } from "@/lib/adminSections";
import { NotificationComposer } from "@/components/Notifications";
import { AdminUsageAlerts } from "@/components/UsageCard";
import {
  Button,
  Card,
  cn,
  ConfirmDialog,
  Field,
  FormDialog,
  Initial,
  Input,
  PageHeader,
  Spinner,
} from "@/components/ui";
import { type MessageKey, useFormatDate, useT } from "@/i18n";

const TABS = ADMIN_SECTIONS.map((section) => section.tab);
type Tab = AdminTab;

export const Route = createFileRoute("/admin")({
  validateSearch: (search: Record<string, unknown>): { tab?: Tab; school?: string } => ({
    tab: TABS.find((tab) => tab === search.tab && tab !== "overview"),
    school: search.tab === "schools" && typeof search.school === "string" ? search.school : undefined,
  }),
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient
      .fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity })
      .catch(() => null);
    if (!me || me.guest) throw redirect({ to: "/login", search: { next: "/admin" } });
    if (!me.isAdmin) throw redirect({ to: "/home" });
  },
  component: AdminPage,
});

const SELECT_CLASS =
  "h-9 w-full rounded-lg border border-line-strong bg-paper px-3 text-[13.5px] text-ink disabled:opacity-50";

function AdminPage() {
  const t = useT();
  const navigate = useNavigate();
  const tab = Route.useSearch().tab ?? "overview";
  const section = ADMIN_SECTIONS.find((item) => item.tab === tab) ?? ADMIN_SECTIONS[0];
  const go = (next: Tab) => navigate({ to: "/admin", search: next === "overview" ? {} : { tab: next } });

  return (
    <div className="flex min-h-full flex-col bg-paper-deep pb-10">
      <div className="border-b border-line bg-paper pb-5">
        <PageHeader
          width="max-w-6xl"
          eyebrow={t("admin_title")}
          title={t(section.label)}
          description={tab === "overview" ? t("admin_desc") : undefined}
        />
      </div>
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 pt-5 md:px-6">
        {tab === "overview" && <Overview go={go} />}
        {tab === "users" && <Users />}
        {tab === "requests" && <TeacherRequests />}
        {tab === "schools" && <Schools />}
        {tab === "notify" && <NotificationComposer />}
      </div>
    </div>
  );
}

function Overview({ go }: { go: (tab: Tab) => void }) {
  const t = useT();
  const overview = useQuery({ queryKey: ["admin", "overview"], queryFn: () => api.adminOverview() });
  if (overview.isPending) return <Spinner />;
  if (!overview.data) {
    return (
      <p role="alert" className="text-[13px] text-flag">
        {t("common_error")}
      </p>
    );
  }
  const data = overview.data;
  const stats: { key: string; label: string; value: number; tab?: Tab }[] = [
    { key: "users", label: t("admin_stat_users"), value: data.users, tab: "users" },
    { key: "teachers", label: t("admin_stat_teachers"), value: data.teachers, tab: "users" },
    { key: "students", label: t("admin_stat_students"), value: data.students },
    { key: "schools", label: t("admin_schools"), value: data.schools, tab: "schools" },
    { key: "classrooms", label: t("admin_stat_classrooms"), value: data.classrooms },
    { key: "running", label: t("admin_stat_running"), value: data.runningActivities },
  ];
  return (
    <>
      {data.pendingRequests > 0 && (
        <Card className="flex items-center gap-3 border-ember/40 px-5 py-3.5">
          <span className="rounded-md bg-ember px-2 py-1 text-[13px] font-semibold leading-none text-on-ember">
            {data.pendingRequests}
          </span>
          <span className="flex-1 text-[13.5px] text-ink">{t("admin_stat_pending")}</span>
          <Button size="sm" onClick={() => go("requests")}>
            {t("admin_review")}
          </Button>
        </Card>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {stats.map((stat) => {
          const body = (
            <>
              <span className="block text-[12.5px] text-ink-soft">{stat.label}</span>
              <span className="mt-1 block text-[28px] font-semibold leading-tight tracking-tight text-ink tabular-nums">
                {stat.value}
              </span>
            </>
          );
          const target = stat.tab;
          return target ? (
            <button
              key={stat.key}
              type="button"
              data-stat={stat.key}
              onClick={() => go(target)}
              className="cursor-pointer rounded-xl border border-line bg-paper px-5 py-4 text-left shadow-sm transition-colors hover:border-ink"
            >
              {body}
            </button>
          ) : (
            <div
              key={stat.key}
              data-stat={stat.key}
              className="rounded-xl border border-line bg-paper px-5 py-4 shadow-sm"
            >
              {body}
            </div>
          );
        })}
      </div>
      <AdminUsageAlerts />
    </>
  );
}

function roleKey(user: AdminUser): MessageKey {
  if (user.isAdmin) return "admin_role_admin";
  if (user.teacherPlan === "school") return "admin_role_school";
  if (user.teacherPlan === "trial") return "admin_role_trial";
  return "admin_role_member";
}

function Users() {
  const t = useT();
  const formatDate = useFormatDate();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const q = useDeferredValue(search.trim());
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const users = useQuery({
    queryKey: ["admin", "users", q],
    queryFn: () => api.adminUsers(q),
    placeholderData: keepPreviousData,
  });
  const [revoking, setRevoking] = useState<AdminUser | null>(null);
  const [assigning, setAssigning] = useState<AdminUser | null>(null);
  const [assignSchool, setAssignSchool] = useState("");
  const schools = useQuery({ queryKey: ["admin", "schools"], queryFn: () => api.listSchools() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });
  const grant = useMutation({ mutationFn: (id: string) => api.grantTeacher(id), onSettled: refresh });
  const revoke = useMutation({ mutationFn: (id: string) => api.revokeTeacher(id), onSettled: refresh });
  const assign = useMutation({
    mutationFn: (input: { email: string; schoolId: string }) => api.createSchoolTeacher(input),
    onSuccess: () => setAssigning(null),
    onSettled: refresh,
  });
  const busy = grant.isPending || revoke.isPending || assign.isPending;
  const rows = users.data ?? [];

  return (
    <Card className="overflow-hidden">
      <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search
            className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-faint"
            aria-hidden
          />
          <Input
            type="search"
            value={search}
            aria-label={t("admin_users_search")}
            placeholder={t("admin_users_search")}
            onChange={(event) => setSearch(event.target.value)}
            className="pl-9"
          />
        </div>
        <span className="text-[12.5px] text-ink-faint">{t("admin_users_count", { count: rows.length })}</span>
      </div>
      {(grant.isError || revoke.isError || assign.isError || users.isError) && (
        <p role="alert" className="px-5 pt-3 text-[12.5px] text-flag">
          {t("common_error")}
        </p>
      )}
      {users.isPending ? (
        <div className="p-5">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <p className="p-5 text-[13px] text-ink-faint">{t("admin_users_empty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[840px] text-left text-[13.5px]">
            <thead className="bg-card text-[12px] text-ink-soft">
              <tr>
                <th className="px-5 py-2.5 font-medium">{t("admin_col_user")}</th>
                <th className="px-3 py-2.5 font-medium">{t("admin_col_role")}</th>
                <th className="px-3 py-2.5 font-medium">{t("admin_school")}</th>
                <th className="px-3 py-2.5 text-right font-medium">{t("admin_col_classrooms")}</th>
                <th className="px-3 py-2.5 font-medium">{t("admin_col_joined")}</th>
                <th className="px-5 py-2.5 text-right font-medium">{t("admin_col_actions")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((user) => (
                <tr key={user.id} data-user={user.id} className="hover:bg-card">
                  <td className="px-5 py-2.5">
                    <span className="flex items-center gap-3">
                      <Initial name={user.name} className="size-8 text-[13px]" />
                      <span className="min-w-0">
                        <span className="block truncate text-ink">{user.name}</span>
                        <span className="block truncate text-[12px] text-ink-faint">{user.email ?? "—"}</span>
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2.5">
                    <span
                      className={cn(
                        "inline-block whitespace-nowrap rounded-md px-2 py-0.5 text-[12px]",
                        user.isAdmin
                          ? "bg-ink text-paper"
                          : user.teacherPlan
                            ? "bg-ember-wash text-ink"
                            : "bg-paper-deep text-ink-soft",
                      )}
                    >
                      {t(roleKey(user))}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-ink-soft">{user.schoolName ?? "—"}</td>
                  <td className="px-3 py-2.5 text-right text-ink-soft tabular-nums">{user.classrooms}</td>
                  <td className="whitespace-nowrap px-3 py-2.5 text-ink-soft">{formatDate(user.createdAt)}</td>
                  <td className="px-5 py-2.5">
                    <span className="flex items-center justify-end gap-1">
                      {user.email && (
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => {
                            setAssignSchool("");
                            setAssigning(user);
                          }}
                        >
                          {t("admin_assign_school")}
                        </Button>
                      )}
                      {user.teacherPlan ? (
                        user.id !== me.data?.id && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => setRevoking(user)}
                            className="hover:bg-flag-wash hover:text-flag"
                          >
                            {t("admin_revoke")}
                          </Button>
                        )
                      ) : (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => grant.mutate(user.id)}>
                          {t("admin_grant")}
                        </Button>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <FormDialog
        open={assigning !== null}
        title={t("admin_assign_title", { name: assigning?.name ?? "" })}
        description={t("admin_assign_desc")}
        submitLabel={t("admin_assign_school")}
        cancelLabel={t("common_cancel")}
        canSubmit={Boolean(assignSchool)}
        submitting={assign.isPending}
        onCancel={() => setAssigning(null)}
        onSubmit={() => {
          if (assigning?.email) assign.mutate({ email: assigning.email, schoolId: assignSchool });
        }}
      >
        <Field label={t("admin_school")}>
          <select
            value={assignSchool}
            onChange={(event) => setAssignSchool(event.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">{t("admin_pick_school")}</option>
            {(schools.data ?? []).map((school) => (
              <option key={school.id} value={school.id}>
                {school.name}
              </option>
            ))}
          </select>
        </Field>
      </FormDialog>
      <ConfirmDialog
        open={revoking !== null}
        danger
        title={t("admin_revoke_title", { name: revoking?.name ?? "" })}
        body={t("admin_revoke_body")}
        confirmLabel={t("admin_revoke")}
        cancelLabel={t("common_cancel")}
        onCancel={() => setRevoking(null)}
        onConfirm={() => {
          if (revoking) revoke.mutate(revoking.id);
          setRevoking(null);
        }}
      />
    </Card>
  );
}

function Schools() {
  const t = useT();
  const formatDate = useFormatDate();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const selected = Route.useSearch().school;
  const schools = useQuery({ queryKey: ["admin", "schools"], queryFn: () => api.listSchools() });
  const [adding, setAdding] = useState(false);
  const [schoolName, setSchoolName] = useState("");
  const createSchool = useMutation({
    mutationFn: () => api.createSchool(schoolName.trim()),
    onSuccess: async () => {
      setSchoolName("");
      setAdding(false);
      await queryClient.invalidateQueries({ queryKey: ["admin"] });
    },
  });
  const open = (school?: string) => navigate({ to: "/admin", search: { tab: "schools", school } });

  if (selected) return <SchoolDetail schoolId={selected} onBack={() => open()} />;

  const rows = schools.data ?? [];
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
        <span className="text-[12.5px] text-ink-faint">{t("admin_schools_count", { count: rows.length })}</span>
        <Button size="sm" onClick={() => setAdding(true)}>
          <Plus className="size-4" />
          {t("admin_new_school")}
        </Button>
      </div>
      {schools.isPending ? (
        <div className="p-5">
          <Spinner />
        </div>
      ) : rows.length === 0 ? (
        <p className="p-5 text-[13px] text-ink-faint">{t("admin_schools_empty")}</p>
      ) : (
        <ul className="divide-y divide-line">
          {rows.map((school) => (
            <li key={school.id}>
              <button
                type="button"
                data-school={school.id}
                onClick={() => open(school.id)}
                className="flex w-full cursor-pointer items-center gap-3 px-5 py-3 text-left hover:bg-card"
              >
                <Building2 className="size-4 shrink-0 text-ink-faint" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-ink">{school.name}</span>
                  <span className="block text-[12px] text-ink-faint">{formatDate(school.createdAt)}</span>
                </span>
                <span className="shrink-0 text-[12.5px] text-ink-soft">
                  {t("admin_teacher_count", { count: school.teacherCount })}
                </span>
                <ChevronRight className="size-4 shrink-0 text-ink-faint" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <FormDialog
        open={adding}
        title={t("admin_new_school")}
        submitLabel={t("admin_add")}
        cancelLabel={t("common_cancel")}
        canSubmit={Boolean(schoolName.trim())}
        submitting={createSchool.isPending}
        onCancel={() => setAdding(false)}
        onSubmit={() => createSchool.mutate()}
      >
        <Field label={t("admin_school_name")}>
          <Input autoFocus value={schoolName} onChange={(event) => setSchoolName(event.target.value)} />
        </Field>
        {createSchool.isError && (
          <p role="alert" className="text-[12.5px] text-flag">
            {t("common_error")}
          </p>
        )}
      </FormDialog>
    </Card>
  );
}

function SchoolDetail({ schoolId, onBack }: { schoolId: string; onBack: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const schools = useQuery({ queryKey: ["admin", "schools"], queryFn: () => api.listSchools() });
  const teachers = useQuery({ queryKey: ["admin", "teachers"], queryFn: () => api.listSchoolTeachers() });
  const [adding, setAdding] = useState(false);
  const [email, setEmail] = useState("");
  const [created, setCreated] = useState<SchoolTeacher | null>(null);
  const [removing, setRemoving] = useState<SchoolTeacher | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });
  const addTeacher = useMutation({
    mutationFn: () => api.createSchoolTeacher({ email: email.trim(), schoolId }),
    onSuccess: async (teacher) => {
      setEmail("");
      setAdding(false);
      setCreated(teacher);
      await refresh();
    },
  });
  const removeTeacher = useMutation({ mutationFn: (id: string) => api.removeSchoolTeacher(id), onSettled: refresh });
  const school = schools.data?.find((item) => item.id === schoolId);
  const rows = (teachers.data ?? []).filter((teacher) => teacher.schoolId === schoolId);
  const closeAdd = () => {
    setAdding(false);
    addTeacher.reset();
  };

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="flex cursor-pointer items-center gap-1.5 self-start text-[13px] text-ink-soft hover:text-ink"
      >
        <ArrowLeft className="size-3.5" />
        {t("admin_all_schools")}
      </button>
      {created && (
        <div role="status" className="rounded-lg border border-ember/40 bg-ember-wash px-4 py-3 text-[13px] text-ink">
          {created.temporaryPassword ? (
            <>
              <p>{t("admin_created_with_password", { name: created.name })}</p>
              <p className="mt-1 font-mono text-[13.5px]">
                {created.email} · {created.temporaryPassword}
              </p>
            </>
          ) : (
            <p>{t("admin_promoted", { name: created.name, school: created.schoolName })}</p>
          )}
        </div>
      )}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <h2 className="min-w-0 truncate text-[15px] font-semibold text-ink">
            {school?.name ?? (schools.isSuccess ? t("admin_school_missing") : "")}
          </h2>
          {school && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              {t("admin_add_teacher")}
            </Button>
          )}
        </div>
        {teachers.isPending ? (
          <div className="p-5">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <p className="p-5 text-[13px] text-ink-faint">{t("admin_teachers_empty")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {rows.map((teacher) => (
              <li key={teacher.id} data-teacher={teacher.id} className="flex items-center gap-3 px-5 py-2.5">
                <Initial name={teacher.name} className="size-8 text-[13px]" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13.5px] text-ink">{teacher.name}</span>
                  <span className="block truncate text-[12px] text-ink-faint">{teacher.email}</span>
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setRemoving(teacher)}
                  className="hover:bg-flag-wash hover:text-flag"
                >
                  <UserMinus className="size-3.5" />
                  {t("admin_remove_teacher")}
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <FormDialog
        open={adding}
        title={t("admin_add_teacher")}
        description={t("admin_add_teacher_desc")}
        submitLabel={t("admin_add")}
        cancelLabel={t("common_cancel")}
        canSubmit={email.includes("@")}
        submitting={addTeacher.isPending}
        onCancel={closeAdd}
        onSubmit={() => addTeacher.mutate()}
      >
        <Field label={t("login_email")}>
          <Input autoFocus type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
        </Field>
        {addTeacher.isError && (
          <p role="alert" className="text-[12.5px] text-flag">
            {addTeacher.error instanceof ApiError && addTeacher.error.code === "conflict"
              ? t("admin_email_conflict")
              : t("common_error")}
          </p>
        )}
      </FormDialog>
      <ConfirmDialog
        open={removing !== null}
        danger
        title={t("admin_remove_title", { name: removing?.name ?? "" })}
        body={t("admin_remove_body")}
        confirmLabel={t("admin_remove_teacher")}
        cancelLabel={t("common_cancel")}
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          if (removing) removeTeacher.mutate(removing.id);
          setRemoving(null);
        }}
      />
    </>
  );
}

function TeacherRequests() {
  const t = useT();
  const formatDate = useFormatDate();
  const queryClient = useQueryClient();
  const requests = useQuery({ queryKey: ["admin", "teacherRequests"], queryFn: () => api.listTeacherRequests() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });
  const approve = useMutation({ mutationFn: (id: string) => api.approveTeacherRequest(id), onSettled: refresh });
  const reject = useMutation({ mutationFn: (id: string) => api.rejectTeacherRequest(id), onSettled: refresh });
  const busy = approve.isPending || reject.isPending;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <h2 className="text-[15px] font-semibold text-ink">
        {t("admin_requests_title")}
        {requests.data && requests.data.length > 0 && (
          <span className="ml-2 rounded-md bg-ember px-1.5 py-0.5 text-[11.5px] font-semibold text-on-ember">
            {requests.data.length}
          </span>
        )}
      </h2>
      <ul className="flex flex-col">
        {requests.data?.map((item) => (
          <li key={item.id} data-request={item.id} className="flex items-center gap-3 border-t border-line py-3">
            <Initial name={item.name} className="size-8 text-[13px]" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13.5px] text-ink">{item.name}</p>
              <p className="truncate text-[11.5px] text-ink-faint">
                {item.email ?? "—"} · {formatDate(item.requestedAt)}
              </p>
            </div>
            <Button size="sm" disabled={busy} onClick={() => approve.mutate(item.id)}>
              {t("admin_requests_approve")}
            </Button>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => reject.mutate(item.id)}>
              {t("admin_requests_reject")}
            </Button>
          </li>
        ))}
      </ul>
      {requests.isSuccess && requests.data.length === 0 && (
        <p className="text-[13px] text-ink-faint">{t("admin_requests_empty")}</p>
      )}
      {(approve.isError || reject.isError || requests.isError) && (
        <p role="alert" className="text-[12.5px] text-flag">
          {t("common_error")}
        </p>
      )}
    </Card>
  );
}

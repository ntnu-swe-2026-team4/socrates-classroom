import { useState } from "react";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Plus, UserMinus } from "lucide-react";
import type { SchoolTeacher } from "@socrates/shared";
import { api, ApiError } from "@/api";
import { NotificationComposer } from "@/components/Notifications";
import { Button, Card, ConfirmDialog, Field, Input, PageHeader, Spinner } from "@/components/ui";
import { useFormatDate, useT } from "@/i18n";

export const Route = createFileRoute("/admin")({
  beforeLoad: async ({ context }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (!me?.admin) throw redirect({ to: "/home" });
  },
  component: AdminPage,
});

const SELECT_CLASS =
  "h-9 w-full rounded-lg border border-line-strong bg-paper px-3 text-[13.5px] text-ink disabled:opacity-50";

function AdminPage() {
  const t = useT();
  const formatDate = useFormatDate();
  const queryClient = useQueryClient();
  const schools = useQuery({ queryKey: ["admin", "schools"], queryFn: () => api.listSchools() });
  const teachers = useQuery({ queryKey: ["admin", "teachers"], queryFn: () => api.listSchoolTeachers() });
  const [schoolName, setSchoolName] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [teacherEmail, setTeacherEmail] = useState("");
  const [schoolId, setSchoolId] = useState("");
  const [created, setCreated] = useState<SchoolTeacher | null>(null);
  const [removing, setRemoving] = useState<SchoolTeacher | null>(null);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["admin"] });

  const createSchool = useMutation({
    mutationFn: () => api.createSchool(schoolName.trim()),
    onSuccess: async (school) => {
      setSchoolName("");
      setSchoolId(school.id);
      await refresh();
    },
  });
  const createTeacher = useMutation({
    mutationFn: () => api.createSchoolTeacher({ name: teacherName.trim(), email: teacherEmail.trim(), schoolId }),
    onSuccess: async (teacher) => {
      setTeacherName("");
      setTeacherEmail("");
      setCreated(teacher);
      await refresh();
    },
  });
  const removeTeacher = useMutation({ mutationFn: (id: string) => api.removeSchoolTeacher(id), onSettled: refresh });
  const teacherReady = teacherName.trim() && teacherEmail.includes("@") && schoolId && !createTeacher.isPending;

  return (
    <div className="flex min-h-full flex-col bg-paper-deep pb-10">
      <PageHeader width="max-w-4xl" eyebrow={t("nav_admin")} title={t("admin_title")} description={t("admin_desc")} />
      <div className="mx-auto w-full max-w-4xl px-4 pt-5 md:px-6">
        <NotificationComposer />
      </div>
      <div className="mx-auto grid w-full max-w-4xl gap-4 px-4 py-5 md:grid-cols-[1fr_1.4fr] md:px-6">
        <Card className="flex flex-col gap-3 p-5">
          <h2 className="font-serif text-[16px] text-ink">{t("admin_schools")}</h2>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (schoolName.trim() && !createSchool.isPending) createSchool.mutate();
            }}
          >
            <Input
              value={schoolName}
              aria-label={t("admin_school_name")}
              placeholder={t("admin_school_name")}
              onChange={(event) => setSchoolName(event.target.value)}
            />
            <Button type="submit" disabled={!schoolName.trim() || createSchool.isPending}>
              {createSchool.isPending ? <Spinner /> : <Plus className="size-4" />}
              {t("admin_add")}
            </Button>
          </form>
          {schools.isPending ? (
            <Spinner />
          ) : (schools.data ?? []).length === 0 ? (
            <p className="text-[13px] text-ink-faint">{t("admin_schools_empty")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
              {(schools.data ?? []).map((school) => (
                <li key={school.id} className="flex items-center gap-3 px-3 py-2.5">
                  <Building2 className="size-4 shrink-0 text-ink-faint" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-ink">{school.name}</span>
                    <span className="block text-[11.5px] text-ink-faint">{formatDate(school.createdAt)}</span>
                  </span>
                  <span className="shrink-0 rounded-lg bg-paper-deep px-2 py-0.5 text-[11.5px] text-ink-soft">
                    {t("admin_teacher_count", { count: school.teacherCount })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col gap-3 p-5">
          <h2 className="font-serif text-[16px] text-ink">{t("admin_teachers")}</h2>
          <p className="text-[12.5px] leading-relaxed text-ink-soft">{t("admin_teachers_desc")}</p>
          <form
            className="grid gap-2 sm:grid-cols-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (teacherReady) createTeacher.mutate();
            }}
          >
            <Field label={t("register_name")}>
              <Input value={teacherName} onChange={(event) => setTeacherName(event.target.value)} />
            </Field>
            <Field label={t("login_email")}>
              <Input type="email" value={teacherEmail} onChange={(event) => setTeacherEmail(event.target.value)} />
            </Field>
            <Field label={t("admin_school")}>
              <select value={schoolId} onChange={(event) => setSchoolId(event.target.value)} className={SELECT_CLASS}>
                <option value="">{t("admin_pick_school")}</option>
                {(schools.data ?? []).map((school) => (
                  <option key={school.id} value={school.id}>
                    {school.name}
                  </option>
                ))}
              </select>
            </Field>
            <div className="flex items-end">
              <Button type="submit" className="w-full" disabled={!teacherReady}>
                {createTeacher.isPending ? <Spinner /> : t("admin_create_teacher")}
              </Button>
            </div>
          </form>
          {createTeacher.isError && (
            <p role="alert" className="text-[12.5px] text-flag">
              {createTeacher.error instanceof ApiError && createTeacher.error.code === "conflict"
                ? t("admin_email_conflict")
                : t("common_error")}
            </p>
          )}
          {created && (
            <div
              role="status"
              className="rounded-xl border border-ember/40 bg-ember-wash px-3 py-2.5 text-[13px] text-ink"
            >
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
          {teachers.isPending ? (
            <Spinner />
          ) : (teachers.data ?? []).length === 0 ? (
            <p className="text-[13px] text-ink-faint">{t("admin_teachers_empty")}</p>
          ) : (
            <ul className="flex flex-col divide-y divide-line rounded-xl border border-line">
              {(teachers.data ?? []).map((teacher) => (
                <li key={teacher.id} className="flex items-center gap-3 px-3 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13.5px] text-ink">{teacher.name}</span>
                    <span className="block truncate text-[11.5px] text-ink-faint">
                      {teacher.email} · {teacher.schoolName}
                    </span>
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
      </div>
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
    </div>
  );
}

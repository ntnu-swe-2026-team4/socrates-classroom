import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TRIAL_LIMITS } from "@socrates/shared";
import { api, type User } from "@/api";
import { Card, ConfirmDialog, cn } from "@/components/ui";
import { useT } from "@/i18n";

export function useTeacherMode(onEnabled?: (user: User) => void) {
  const queryClient = useQueryClient();
  const [termsOpen, setTermsOpen] = useState(false);
  const update = useMutation({
    mutationFn: (input: { teacherMode: boolean; acceptTeacherTerms?: true }) => api.updateProfile(input),
    onSuccess: (user) => {
      queryClient.setQueryData(["me"], user);
      void queryClient.invalidateQueries({ queryKey: ["classrooms"] });
      if (user.teacherMode) onEnabled?.(user);
    },
  });
  const request = (user: User, on: boolean) => {
    if (on && !user.teacherPlan) setTermsOpen(true);
    else update.mutate({ teacherMode: on });
  };
  const dialog = (
    <TeacherTermsDialog
      open={termsOpen}
      onCancel={() => setTermsOpen(false)}
      onAccept={() => {
        setTermsOpen(false);
        update.mutate({ teacherMode: true, acceptTeacherTerms: true });
      }}
    />
  );
  return { request, dialog, pending: update.isPending, failed: update.isError };
}

export function TeacherTermsDialog({
  open,
  onAccept,
  onCancel,
}: {
  open: boolean;
  onAccept: () => void;
  onCancel: () => void;
}) {
  const t = useT();
  const limits = { classrooms: TRIAL_LIMITS.classrooms, members: TRIAL_LIMITS.membersPerClassroom };
  return (
    <ConfirmDialog
      open={open}
      title={t("teacher_terms_title")}
      body={
        <ul className="mt-1 flex list-disc flex-col gap-1.5 pl-4">
          <li>{t("teacher_terms_responsibility")}</li>
          <li>{t("teacher_terms_consent")}</li>
          <li>{t("teacher_terms_limits", limits)}</li>
        </ul>
      }
      confirmLabel={t("teacher_terms_accept")}
      cancelLabel={t("common_cancel")}
      onCancel={onCancel}
      onConfirm={onAccept}
    />
  );
}

export function TeacherModeCard({ user }: { user: User }) {
  const t = useT();
  const { request, dialog, pending, failed } = useTeacherMode();
  const on = user.teacherMode === true;
  return (
    <Card className="flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5">
          <p className="font-serif text-[15.5px] text-ink">{t("teacher_mode_title")}</p>
          <p className="text-[12.5px] leading-relaxed text-ink-soft">{t("teacher_mode_desc")}</p>
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={on}
          aria-label={t("teacher_mode_title")}
          disabled={pending}
          onClick={() => request(user, !on)}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember disabled:opacity-60",
            on ? "bg-ember" : "bg-paper-shade",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "inline-block size-5 rounded-full bg-paper shadow transition-transform",
              on ? "translate-x-5.5" : "translate-x-0.5",
            )}
          />
        </button>
      </div>
      {user.teacherPlan && (
        <p className="rounded-xl bg-paper-deep/60 px-3 py-2 text-[12.5px] leading-relaxed text-ink-soft">
          {user.teacherPlan === "school"
            ? t("teacher_plan_school", { school: user.schoolName ?? "" })
            : t("teacher_plan_trial", {
                classrooms: TRIAL_LIMITS.classrooms,
                members: TRIAL_LIMITS.membersPerClassroom,
              })}
        </p>
      )}
      {failed && (
        <p role="alert" className="text-[12.5px] text-flag">
          {t("common_error")}
        </p>
      )}
      {dialog}
    </Card>
  );
}

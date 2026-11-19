import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { TRIAL_LIMITS } from "@socrates/shared";
import { api, type User } from "@/api";
import { Button, Card, ConfirmDialog, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";

function TeacherTermsDialog({
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
      confirmLabel={t("teacher_request_submit")}
      cancelLabel={t("common_cancel")}
      onCancel={onCancel}
      onConfirm={onAccept}
    />
  );
}

export function TeacherModeCard({ user }: { user: User }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [termsOpen, setTermsOpen] = useState(false);
  const store = (next: User) => {
    queryClient.setQueryData(["me"], next);
    void queryClient.invalidateQueries({ queryKey: ["classrooms"] });
  };
  const toggle = useMutation({
    mutationFn: (teacherMode: boolean) => api.updateProfile({ teacherMode }),
    onSuccess: store,
  });
  const request = useMutation({ mutationFn: () => api.requestTeacher(), onSuccess: store });
  const approved = Boolean(user.teacherPlan) || user.canManageClasses;
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
          disabled={!approved || toggle.isPending}
          onClick={() => toggle.mutate(!on)}
          className={cn(
            "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ember disabled:cursor-not-allowed disabled:opacity-50",
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
      {approved ? (
        <p className="rounded-xl bg-paper-deep/60 px-3 py-2 text-[12.5px] leading-relaxed text-ink-soft">
          {user.teacherPlan === "school"
            ? t("teacher_plan_school", { school: user.schoolName ?? "" })
            : !user.teacherPlan
              ? t("teacher_plan_open")
              : t("teacher_plan_trial", {
                  classrooms: TRIAL_LIMITS.classrooms,
                  members: TRIAL_LIMITS.membersPerClassroom,
                })}
        </p>
      ) : user.teacherRequested ? (
        <p role="status" className="rounded-xl bg-ember-wash px-3 py-2 text-[12.5px] leading-relaxed text-ink">
          {t("teacher_request_pending")}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-paper-deep/60 px-3 py-2">
          <p className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-ink-soft">{t("teacher_request_hint")}</p>
          <Button size="sm" disabled={request.isPending} onClick={() => setTermsOpen(true)}>
            {request.isPending ? <Spinner /> : null}
            {t("teacher_request_button")}
          </Button>
        </div>
      )}
      {(toggle.isError || request.isError) && (
        <p role="alert" className="text-[12.5px] text-flag">
          {t("common_error")}
        </p>
      )}
      <TeacherTermsDialog
        open={termsOpen}
        onCancel={() => setTermsOpen(false)}
        onAccept={() => {
          setTermsOpen(false);
          request.mutate();
        }}
      />
    </Card>
  );
}

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { api, ApiError } from "@/api";
import { meQueryOptions } from "@/api/me";
import { classroomsOptions, scopedInviteOptions } from "@/api/queries";
import { PanelState } from "@/components/ClassroomCommunity";
import { Button, Card, Checkbox, Field, Input, PageHeader, buttonStyles } from "@/components/ui";
import { useT } from "@/i18n";
import { inviteScopeLabels } from "@/lib/classroomInvite";

export const Route = createFileRoute("/join/i/$token")({ component: InvitationRoute });

function InvitationRoute() {
  const { token } = Route.useParams();
  return <ClassroomInvitation key={token} token={token} />;
}

function ClassroomInvitation({ token }: { token: string }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const valid = /^[a-f0-9]{32}$/.test(token);
  const invite = useQuery({ ...scopedInviteOptions(token), enabled: valid });
  const me = useQuery(meQueryOptions);
  const [name, setName] = useState("");
  const [tos, setTos] = useState(false);
  const join = useMutation({
    mutationFn: () => api.classroom.acceptInvite(token, { name: name.trim() || undefined, tosAccepted: tos }),
  });
  const needsName = me.isSuccess && me.data === null;
  const next = `/join/i/${token}`;
  const scope = invite.data?.scope;
  const requiresAccount = scope !== "activity_guest";
  const error = join.error instanceof ApiError ? join.error.code : null;
  const ended = invite.data?.finishedAt || error === "activity_finished";
  const invalid =
    !valid ||
    (invite.error instanceof ApiError &&
      ["invite_invalid", "invite_revoked", "invite_expired"].includes(invite.error.code));
  const rejected = error === "invite_invalid" || error === "invite_revoked" || error === "invite_expired";
  const links = (
    <div className="flex flex-wrap gap-2">
      <Link to="/login" search={{ next }} className={buttonStyles({ variant: "outline" })}>
        {t("login_title")}
      </Link>
      <Link to="/login" search={{ next, mode: "register" }} className={buttonStyles({ variant: "ghost" })}>
        {t("register_submit")}
      </Link>
    </div>
  );

  return (
    <div className="min-h-full">
      <PageHeader width="max-w-xl" title={invite.data?.classroomName ?? t("invite_eyebrow")} />
      <div className="mx-auto w-full max-w-xl px-4 py-6 sm:px-6">
        <Card className="space-y-4 p-4 sm:p-6">
          {invalid || rejected ? (
            <p role="alert" className="text-sm text-flag">
              {t("invite_invalid")}
            </p>
          ) : ended ? (
            <div className="space-y-2">
              <h2 className="font-serif text-xl">{t("invite_finished_title")}</h2>
              <p className="text-sm text-ink-soft">{t("invite_finished_hint")}</p>
            </div>
          ) : (
            <>
              <PanelState
                pending={invite.isPending || me.isPending}
                error={invite.isError || me.isError}
                retry={() => {
                  void invite.refetch();
                  void me.refetch();
                }}
              />
              {invite.isSuccess && me.isSuccess && scope && (
                <>
                  <h2 className="font-serif text-xl text-ink">{t(inviteScopeLabels[scope])}</h2>
                  {invite.data.topic && (
                    <div className="border-l-2 border-ember/70 pl-3">
                      <h3 className="break-words font-serif text-lg text-ink">{invite.data.topic.title}</h3>
                      <p className="mt-1 break-words text-sm leading-relaxed text-ink-soft">
                        {invite.data.topic.summary ?? invite.data.topic.statement}
                      </p>
                    </div>
                  )}
                  {requiresAccount && needsName ? (
                    <>
                      <p className="text-sm text-ink-soft">{t("room_invite_requires_account")}</p>
                      {links}
                    </>
                  ) : (
                    <form
                      className="space-y-4"
                      aria-busy={join.isPending}
                      onSubmit={(event) => {
                        event.preventDefault();
                        if (!tos || (needsName && !name.trim()) || join.isPending) return;
                        join.mutate(undefined, {
                          onSuccess: async (joined) => {
                            if (scope !== "activity_guest")
                              await queryClient.invalidateQueries({ queryKey: classroomsOptions.queryKey });
                            if (joined.activityId) {
                              await navigate({
                                to: "/dialogue",
                                search: { activityId: joined.activityId },
                                replace: true,
                              });
                            } else {
                              await navigate({
                                to: "/classrooms/$classroomId",
                                params: { classroomId: joined.classroomId },
                                replace: true,
                              });
                            }
                          },
                        });
                      }}
                    >
                      {needsName && (
                        <Field label={t("join_name_label")}>
                          <Input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />
                        </Field>
                      )}
                      <Checkbox label={t("join_tos")} checked={tos} onCheckedChange={setTos} />
                      {join.isError && (
                        <p role="alert" className="text-sm text-flag">
                          {t(error === "name_taken" ? "join_err_name_taken" : "join_failed")}
                        </p>
                      )}
                      <Button type="submit" disabled={!tos || (needsName && !name.trim()) || join.isPending}>
                        {t(
                          scope === "classroom"
                            ? "room_invite_accept_classroom"
                            : scope === "classroom_activity"
                              ? "room_invite_accept_combined"
                              : "join_start",
                        )}
                      </Button>
                      {needsName && links}
                    </form>
                  )}
                </>
              )}
            </>
          )}
        </Card>
      </div>
    </div>
  );
}

import { useInfiniteQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Copy, Link2, LogOut, UserMinus } from "lucide-react";
import { useState } from "react";
import type { ClassroomInviteScope } from "@socrates/shared";
import { api } from "@/api";
import {
  classroomActivitiesOptions,
  classroomInvitesOptions,
  classroomMembersOptions,
  classroomsOptions,
} from "@/api/queries";
import { EmptyPanel, LoadMore, PanelState } from "@/components/ClassroomCommunity";
import { QrBlock, absoluteUrl } from "@/components/QrBlock";
import { Button, ConfirmDialog, Field } from "@/components/ui";
import { useNow } from "@/hooks/useSubscription";
import { useFormatDate, useT } from "@/i18n";
import { inviteScopeLabels } from "@/lib/classroomInvite";

const selectStyle =
  "h-10 min-w-0 rounded-lg border border-line-strong bg-paper px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-ember/60";

export function ClassroomPeople({
  id,
  viewerId,
  teacher,
  onLeave,
}: {
  id: string;
  viewerId: string;
  teacher: boolean;
  onLeave: () => void;
}) {
  const t = useT();
  const formatDate = useFormatDate();
  const client = useQueryClient();
  const options = classroomMembersOptions(id);
  const roster = useInfiniteQuery(options);
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const members = roster.data?.pages.flatMap((page) => page.items) ?? [];
  const owner = roster.data?.pages[0]?.teacher;
  const leaving = target?.id === viewerId;
  const remove = useMutation({
    mutationFn: (userId: string) => api.classroom.removeMember(id, userId),
    onSuccess: async (_, userId) => {
      if (userId === viewerId) {
        client.setQueryData(classroomsOptions.queryKey, (rooms) => rooms?.filter((room) => room.id !== id));
        onLeave();
      } else {
        await client.invalidateQueries({ queryKey: options.queryKey });
      }
      await client.invalidateQueries({ queryKey: classroomsOptions.queryKey });
    },
  });

  return (
    <div className="space-y-6">
      {teacher && <ClassroomInvites id={id} />}
      <PanelState pending={roster.isPending} error={roster.isError} retry={() => void roster.refetch()} />
      {owner && (
        <div className="overflow-hidden rounded-xl border border-line bg-paper">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-card p-4">
            <span className="text-sm font-medium text-ink-soft">{t("room_members_teacher")}</span>
            <span className="min-w-0 break-words text-sm font-semibold text-ink">{owner.name}</span>
          </div>
          {members.length > 0 ? (
            <ul className="divide-y divide-line">
              {members.map((member) => (
                <li key={member.id} className="flex min-w-0 items-center justify-between gap-3 p-4">
                  <div className="min-w-0">
                    <p className="break-words text-sm text-ink">
                      {member.name}
                      {member.id === viewerId && (
                        <span className="ml-2 text-xs text-ink-soft">{t("room_members_you")}</span>
                      )}
                    </p>
                    <p className="mt-1 text-xs text-ink-soft">
                      {t("room_members_joined", { date: formatDate(member.joinedAt) })}
                    </p>
                  </div>
                  {teacher && (
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={t("room_remove_named", { name: member.name })}
                      disabled={remove.isPending}
                      onClick={() => setTarget(member)}
                    >
                      <UserMinus className="size-4" aria-hidden />
                      {t("room_members_remove")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="p-4 text-sm text-ink-soft">{t("room_members_empty")}</p>
          )}
        </div>
      )}
      {roster.hasNextPage && (
        <LoadMore pending={roster.isFetchingNextPage} onClick={() => void roster.fetchNextPage()} />
      )}
      {!teacher && (
        <Button variant="outline" disabled={remove.isPending} onClick={() => setTarget({ id: viewerId, name: "" })}>
          <LogOut className="size-4" aria-hidden />
          {t("room_leave")}
        </Button>
      )}
      {remove.isError && (
        <p role="alert" className="text-sm text-flag">
          {t("common_error")}
        </p>
      )}
      {target && (
        <ConfirmDialog
          open
          danger
          title={leaving ? t("room_leave_title") : t("room_members_remove_title", { name: target.name })}
          body={t(leaving ? "room_leave_body" : "room_members_remove_body")}
          confirmLabel={t(leaving ? "room_leave" : "room_members_remove")}
          cancelLabel={t("common_cancel")}
          onCancel={() => setTarget(null)}
          onConfirm={() => {
            remove.mutate(target.id);
            setTarget(null);
          }}
        />
      )}
    </div>
  );
}

function ClassroomInvites({ id }: { id: string }) {
  const t = useT();
  const formatDate = useFormatDate();
  const now = useNow(30_000);
  const client = useQueryClient();
  const [scope, setScope] = useState<ClassroomInviteScope>("classroom");
  const [picked, setPicked] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const options = classroomInvitesOptions(id);
  const invites = useInfiniteQuery(options);
  const activities = useInfiniteQuery({ ...classroomActivitiesOptions(id), enabled: scope !== "classroom" });
  const openActivities =
    activities.data?.pages
      .flatMap((page) => page.items)
      .filter((activity) => activity.mode === "live" && !activity.finishedAt) ?? [];
  const entries = invites.data?.pages.flatMap((page) => page.items) ?? [];
  const activityId = picked ?? openActivities[0]?.id;
  const validActivity = openActivities.some((activity) => activity.id === activityId);
  const refresh = () => client.invalidateQueries({ queryKey: options.queryKey });
  const create = useMutation({
    mutationFn: () => {
      if (scope === "classroom") return api.classroom.createInvite(id, { scope });
      if (!activityId || !validActivity) throw new Error("Activity required");
      return api.classroom.createInvite(id, { scope, activityId });
    },
    onMutate: () => {
      setCopied(false);
      setCopyFailed(false);
    },
    onSuccess: refresh,
  });
  const created =
    create.isSuccess && create.data.scope === scope && (scope === "classroom" || create.data.activityId === activityId)
      ? create.data
      : null;
  const revoke = useMutation({
    mutationFn: (inviteId: string) => api.classroom.revokeInvite(id, inviteId),
    onSuccess: (_, inviteId) => {
      if (create.data?.id === inviteId) create.reset();
      return refresh();
    },
  });

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(absoluteUrl(url));
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  }

  return (
    <section className="space-y-4 rounded-xl border border-line bg-card p-4 sm:p-5">
      <h3 className="flex items-center gap-2 font-serif text-xl text-ink">
        <Link2 className="size-5" aria-hidden />
        {t("room_invites")}
      </h3>
      <form
        className="flex flex-wrap items-end gap-3"
        aria-busy={create.isPending}
        onSubmit={(event) => {
          event.preventDefault();
          if (!create.isPending && (scope === "classroom" || validActivity)) create.mutate();
        }}
      >
        <div className="min-w-0 max-w-full">
          <Field label={t("room_invite_scope")}>
            <select
              className={selectStyle}
              value={scope}
              disabled={create.isPending}
              onChange={(event) => {
                create.reset();
                setScope(event.target.value as ClassroomInviteScope);
              }}
            >
              <option value="classroom">{t(inviteScopeLabels.classroom)}</option>
              <option value="activity_guest">{t(inviteScopeLabels.activity_guest)}</option>
              <option value="classroom_activity">{t(inviteScopeLabels.classroom_activity)}</option>
            </select>
          </Field>
        </div>
        {scope !== "classroom" && (
          <div className="min-w-0 max-w-full flex-1 basis-48">
            <Field label={t("room_invite_activity")}>
              <select
                className={selectStyle}
                disabled={create.isPending}
                value={validActivity ? activityId : ""}
                onChange={(event) => {
                  create.reset();
                  setPicked(event.target.value);
                }}
              >
                <option value="" disabled>
                  {t("room_invite_pick_activity")}
                </option>
                {openActivities.map((activity) => (
                  <option key={activity.id} value={activity.id}>
                    {activity.topicTitle}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}
        <Button type="submit" className="h-10" disabled={create.isPending || (scope !== "classroom" && !validActivity)}>
          {t("classroom_activity_invite")}
        </Button>
      </form>
      {scope !== "classroom" && (
        <>
          <PanelState
            pending={activities.isPending}
            error={activities.isError}
            retry={() => void activities.refetch()}
          />
          {activities.isSuccess && !openActivities.length && (
            <p className="text-sm text-ink-soft">{t("room_invite_no_activity")}</p>
          )}
          {activities.hasNextPage && (
            <LoadMore pending={activities.isFetchingNextPage} onClick={() => void activities.fetchNextPage()} />
          )}
        </>
      )}
      {create.isError && (
        <p role="alert" className="text-sm text-flag">
          {t("common_error")}
        </p>
      )}
      {created && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border border-line bg-paper p-3">
          <div className="shrink-0">
            <QrBlock url={created.url} size={112} />
          </div>
          <div className="min-w-0 flex-1 basis-44 space-y-2">
            <p className="text-sm font-medium text-ink">{t(inviteScopeLabels[created.scope])}</p>
            <p className="break-all font-mono text-xs text-ink-soft">{absoluteUrl(created.url)}</p>
            <p className="text-xs text-ink-soft">{t("room_invite_once")}</p>
            <Button variant="outline" size="sm" onClick={() => void copy(created.url)}>
              <Copy className="size-3.5" aria-hidden />
              {copied ? t("setup_copied") : t("setup_copy")}
            </Button>
            {copyFailed && (
              <p role="alert" className="text-sm text-flag">
                {t("room_copy_failed")}
              </p>
            )}
          </div>
        </div>
      )}
      <PanelState pending={invites.isPending} error={invites.isError} retry={() => void invites.refetch()} />
      {invites.isSuccess && !entries.length && <EmptyPanel>{t("room_invites_empty")}</EmptyPanel>}
      {entries.length > 0 && (
        <ul className="divide-y divide-line border-t border-line">
          {entries.map((invite) => {
            const active = invite.revokedAt === null && Date.parse(invite.expiresAt) > now;
            return (
              <li key={invite.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <p className="text-sm font-medium text-ink">{t(inviteScopeLabels[invite.scope])}</p>
                  <p className="mt-0.5 text-xs text-ink-soft">
                    {invite.revokedAt
                      ? t("room_invite_revoked")
                      : active
                        ? t("room_invite_expires", { date: formatDate(invite.expiresAt) })
                        : t("room_invite_expired")}
                  </p>
                </div>
                {active && (
                  <Button variant="ghost" size="sm" disabled={revoke.isPending} onClick={() => setRevoking(invite.id)}>
                    {t("room_invite_revoke")}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {invites.hasNextPage && (
        <LoadMore pending={invites.isFetchingNextPage} onClick={() => void invites.fetchNextPage()} />
      )}
      {revoke.isError && (
        <p role="alert" className="text-sm text-flag">
          {t("common_error")}
        </p>
      )}
      {revoking && (
        <ConfirmDialog
          open
          danger
          title={t("room_invite_revoke_title")}
          confirmLabel={t("room_invite_revoke")}
          cancelLabel={t("common_cancel")}
          onCancel={() => setRevoking(null)}
          onConfirm={() => {
            revoke.mutate(revoking);
            setRevoking(null);
          }}
        />
      )}
    </section>
  );
}

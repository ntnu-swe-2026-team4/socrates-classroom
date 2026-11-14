import { useRef, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, LogOut, MessageSquare, Send, Trash2, UserMinus, UserPlus } from "lucide-react";
import type { Announcement, ClassroomSummary, Post, PostReply, StudentCredential } from "@socrates/shared";
import { api, ApiError } from "@/api";
import { Button, ConfirmDialog, EmptyState, FormDialog, Initial, Input, Spinner, cn } from "@/components/ui";
import { useFormatDate, useT, type MessageKey } from "@/i18n";

export const ROOM_TABS = ["topics", "announcements", "board", "members"] as const;
export type RoomTab = (typeof ROOM_TABS)[number];

const TAB_LABELS: Record<RoomTab, MessageKey> = {
  topics: "room_tab_topics",
  announcements: "room_tab_announcements",
  board: "room_tab_board",
  members: "room_tab_members",
};

export function roomTabId(tab: RoomTab) {
  return `room-tab-${tab}`;
}

export function roomPanelId(tab: RoomTab) {
  return `room-panel-${tab}`;
}

export function RoomTabs({ value, onChange }: { value: RoomTab; onChange: (tab: RoomTab) => void }) {
  const t = useT();
  const refs = useRef<Partial<Record<RoomTab, HTMLButtonElement | null>>>({});
  function move(offset: number | "first" | "last") {
    const index = ROOM_TABS.indexOf(value);
    const next =
      offset === "first"
        ? ROOM_TABS[0]
        : offset === "last"
          ? ROOM_TABS[ROOM_TABS.length - 1]!
          : ROOM_TABS[(index + offset + ROOM_TABS.length) % ROOM_TABS.length]!;
    onChange(next);
    refs.current[next]?.focus();
  }
  return (
    <div
      role="tablist"
      aria-label={t("room_tabs")}
      className="flex h-full gap-1 overflow-x-auto"
      onKeyDown={(event) => {
        const keys: Record<string, number | "first" | "last"> = {
          ArrowRight: 1,
          ArrowLeft: -1,
          Home: "first",
          End: "last",
        };
        const offset = keys[event.key];
        if (offset === undefined) return;
        event.preventDefault();
        move(offset);
      }}
    >
      {ROOM_TABS.map((tab) => {
        const selected = tab === value;
        return (
          <button
            key={tab}
            ref={(node) => {
              refs.current[tab] = node;
            }}
            id={roomTabId(tab)}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={selected ? roomPanelId(tab) : undefined}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab)}
            className={cn(
              "flex h-full cursor-pointer items-center whitespace-nowrap border-b-2 px-2.5 pt-0.5 text-[13px] transition-colors outline-none focus-visible:text-ember",
              selected ? "border-ember text-ink" : "border-transparent text-ink-faint hover:text-ink-soft",
            )}
          >
            {t(TAB_LABELS[tab])}
          </button>
        );
      })}
    </div>
  );
}

function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Number.POSITIVE_INFINITY }).data;
}

function Composer({
  placeholder,
  submitLabel,
  name,
  onSubmit,
}: {
  placeholder: string;
  submitLabel: string;
  name?: string;
  onSubmit: (body: string) => Promise<unknown>;
}) {
  const t = useT();
  const [value, setValue] = useState("");
  const submit = useMutation({
    mutationFn: (body: string) => onSubmit(body),
    onSuccess: () => setValue(""),
  });
  const body = value.trim();
  const ready = body.length > 0 && body.length <= 2000 && !submit.isPending;
  return (
    <form
      className="flex gap-2.5 rounded-xl border border-line bg-card p-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (ready) submit.mutate(body);
      }}
    >
      <Initial name={name} className="hidden size-8 text-[13px] sm:inline-flex" />
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <textarea
          value={value}
          rows={2}
          maxLength={2000}
          aria-label={placeholder}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
              event.preventDefault();
              if (ready) submit.mutate(body);
            }
          }}
          className="min-h-16 w-full resize-y rounded-xl border border-line-strong bg-paper px-3 py-2 text-[13.5px] leading-relaxed text-ink outline-none placeholder:text-ink-faint focus:border-ink"
        />
        <div className="flex items-center justify-end gap-3">
          {submit.isError && (
            <span role="alert" className="mr-auto text-[12px] text-flag">
              {t("common_error")}
            </span>
          )}
          <span className="hidden text-[11.5px] text-ink-faint sm:inline">{t("room_submit_hint")}</span>
          <Button type="submit" size="sm" disabled={!ready}>
            {submit.isPending ? <Spinner /> : <Send className="size-3.5" />}
            {submitLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Byline({ name, teacher, date }: { name: string; teacher: boolean; date: string }) {
  const t = useT();
  const formatDate = useFormatDate();
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[12.5px]">
      <span className="truncate font-medium text-ink">{name}</span>
      {teacher && (
        <span className="rounded-lg bg-ember-wash px-1.5 py-px text-[10.5px] text-ember">
          {t("room_teacher_badge")}
        </span>
      )}
      <span className="text-ink-faint">· {formatDate(date)}</span>
    </div>
  );
}

function DeleteIcon({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-full text-ink-faint transition-colors hover:bg-flag-wash hover:text-flag"
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <EmptyState motif="olive" className="border-line py-6 text-[13px]">
      {children}
    </EmptyState>
  );
}

function Loading() {
  return (
    <div className="flex justify-center py-6" aria-busy="true">
      <Spinner />
    </div>
  );
}

export function AnnouncementsPanel({ room }: { room: ClassroomSummary }) {
  const t = useT();
  const me = useMe();
  const queryClient = useQueryClient();
  const key = ["classroom", room.id, "announcements"];
  const list = useQuery({ queryKey: key, queryFn: () => api.listAnnouncements(room.id) });
  const [target, setTarget] = useState<Announcement | null>(null);
  const owner = room.role === "teacher";
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAnnouncement(room.id, id),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  return (
    <div className="flex flex-col gap-3">
      {owner && (
        <Composer
          name={me?.name}
          placeholder={t("room_announce_placeholder")}
          submitLabel={t("room_announce_publish")}
          onSubmit={async (body) => {
            await api.createAnnouncement(room.id, body);
            await queryClient.invalidateQueries({ queryKey: key });
          }}
        />
      )}
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <Empty>{t("common_error")}</Empty>
      ) : list.data.length === 0 ? (
        <Empty>{t("room_announce_empty")}</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data.map((entry) => (
            <li key={entry.id} className="rounded-xl border border-line bg-card p-3">
              <div className="flex items-start gap-2.5">
                <Initial name={entry.authorName} className="size-8 text-[13px]" />
                <div className="min-w-0 flex-1">
                  <Byline name={entry.authorName} teacher date={entry.createdAt} />
                  <p className="mt-1 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-ink">
                    {entry.body}
                  </p>
                </div>
                {owner && <DeleteIcon label={t("room_delete")} onClick={() => setTarget(entry)} />}
              </div>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={target !== null}
        danger
        title={t("room_announce_delete_title")}
        body={t("room_delete_body")}
        confirmLabel={t("room_delete")}
        cancelLabel={t("common_cancel")}
        onCancel={() => setTarget(null)}
        onConfirm={() => {
          if (target) remove.mutate(target.id);
          setTarget(null);
        }}
      />
    </div>
  );
}

type DeleteTarget = { post: PostReply; thread: boolean };

export function BoardPanel({ room }: { room: ClassroomSummary }) {
  const t = useT();
  const me = useMe();
  const queryClient = useQueryClient();
  const key = ["classroom", room.id, "posts"];
  const list = useQuery({ queryKey: key, queryFn: () => api.listPosts(room.id) });
  const [target, setTarget] = useState<DeleteTarget | null>(null);
  const owner = room.role === "teacher";
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  const remove = useMutation({
    mutationFn: (id: string) => api.deletePost(room.id, id),
    onSettled: refresh,
  });
  const canDelete = (post: PostReply) => owner || post.authorId === me?.id;
  return (
    <div className="flex flex-col gap-3">
      <Composer
        name={me?.name}
        placeholder={t("room_board_placeholder")}
        submitLabel={t("room_board_post")}
        onSubmit={async (body) => {
          await api.createPost(room.id, body);
          await refresh();
        }}
      />
      {list.isPending ? (
        <Loading />
      ) : list.isError ? (
        <Empty>{t("common_error")}</Empty>
      ) : list.data.length === 0 ? (
        <Empty>{t("room_board_empty")}</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {list.data.map((post) => (
            <Thread
              key={post.id}
              post={post}
              canDelete={canDelete}
              onDelete={(item, thread) => setTarget({ post: item, thread })}
              onReply={async (body) => {
                await api.createPost(room.id, body, post.id);
                await refresh();
              }}
            />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={target !== null}
        danger
        title={target?.thread ? t("room_board_delete_thread_title") : t("room_board_delete_reply_title")}
        body={target?.thread ? t("room_board_delete_thread_body") : t("room_delete_body")}
        confirmLabel={t("room_delete")}
        cancelLabel={t("common_cancel")}
        onCancel={() => setTarget(null)}
        onConfirm={() => {
          if (target) remove.mutate(target.post.id);
          setTarget(null);
        }}
      />
    </div>
  );
}

function Thread({
  post,
  canDelete,
  onDelete,
  onReply,
}: {
  post: Post;
  canDelete: (post: PostReply) => boolean;
  onDelete: (post: PostReply, thread: boolean) => void;
  onReply: (body: string) => Promise<void>;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const reply = useMutation({ mutationFn: onReply, onSuccess: () => setDraft("") });
  const body = draft.trim();
  const repliesId = `thread-${post.id}-replies`;
  return (
    <li className="rounded-xl border border-line bg-card">
      <article className="flex items-start gap-2.5 p-3">
        <Initial name={post.authorName} className="size-8 text-[13px]" />
        <div className="min-w-0 flex-1">
          <Byline name={post.authorName} teacher={post.isTeacher} date={post.createdAt} />
          <p className="mt-1 text-[13.5px] leading-relaxed break-words whitespace-pre-wrap text-ink">{post.body}</p>
          <button
            type="button"
            aria-expanded={open}
            aria-controls={repliesId}
            onClick={() => setOpen((value) => !value)}
            className="mt-1.5 -ml-2 inline-flex cursor-pointer items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
          >
            <MessageSquare className="size-3.5" />
            {open
              ? t("room_board_hide_replies")
              : post.replies.length > 0
                ? t("room_board_replies", { n: post.replies.length })
                : t("room_board_reply")}
          </button>
        </div>
        {canDelete(post) && <DeleteIcon label={t("room_delete")} onClick={() => onDelete(post, true)} />}
      </article>
      {open && (
        <div id={repliesId} className="border-t border-line bg-paper-deep/40 px-3 py-2.5">
          {post.replies.length > 0 && (
            <ul className="mb-2.5 flex flex-col gap-2.5">
              {post.replies.map((item) => (
                <li key={item.id} className="flex items-start gap-2">
                  <Initial name={item.authorName} className="size-6 text-[11px]" />
                  <div className="min-w-0 flex-1">
                    <Byline name={item.authorName} teacher={item.isTeacher} date={item.createdAt} />
                    <p className="mt-0.5 text-[13px] leading-relaxed break-words whitespace-pre-wrap text-ink">
                      {item.body}
                    </p>
                  </div>
                  {canDelete(item) && <DeleteIcon label={t("room_delete")} onClick={() => onDelete(item, false)} />}
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex items-center gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (body && !reply.isPending) reply.mutate(body);
            }}
          >
            <Input
              value={draft}
              maxLength={2000}
              aria-label={t("room_board_reply_placeholder")}
              placeholder={t("room_board_reply_placeholder")}
              onChange={(event) => setDraft(event.target.value)}
              className="h-8 text-[13px]"
            />
            <Button
              type="submit"
              size="sm"
              disabled={!body || reply.isPending}
              aria-label={t("room_send")}
              className="w-8 shrink-0 px-0"
            >
              {reply.isPending ? <Spinner /> : <Send className="size-3.5" />}
            </Button>
          </form>
          {reply.isError && (
            <p role="alert" className="mt-1.5 text-[12px] text-flag">
              {t("common_error")}
            </p>
          )}
        </div>
      )}
    </li>
  );
}

export function MembersPanel({ room }: { room: ClassroomSummary }) {
  const t = useT();
  const formatDate = useFormatDate();
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const list = useQuery({ queryKey: ["classroom", room.id, "members"], queryFn: () => api.listMembers(room.id) });
  const [kick, setKick] = useState<{ id: string; name: string; kind?: string } | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [credentials, setCredentials] = useState<StudentCredential[] | null>(null);
  const owner = room.role === "teacher";
  const resetPassword = useMutation({
    mutationFn: (userId: string) => api.resetStudentPassword(room.id, userId),
    onSuccess: (credential) => setCredentials([credential]),
  });
  const remove = useMutation({
    mutationFn: (userId: string) => api.removeMember(room.id, userId),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["classroom", room.id] });
      await queryClient.invalidateQueries({ queryKey: ["classrooms"] });
    },
  });
  const leave = useMutation({
    mutationFn: () => api.removeMember(room.id, me?.id ?? ""),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["classrooms"] });
      await navigate({ to: "/classrooms", search: { view: "student" }, replace: true });
      queryClient.removeQueries({ queryKey: ["classroom", room.id] });
    },
  });
  if (list.isPending) return <Loading />;
  if (list.isError) return <Empty>{t("common_error")}</Empty>;
  const { teacher, members } = list.data;
  return (
    <div className="flex flex-col gap-3">
      <section className="overflow-hidden rounded-xl border border-line bg-card">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <h2 className="flex-1 text-[13.5px] font-medium text-ink">{t("room_members_teacher")}</h2>
          <span className="rounded-lg bg-paper-deep px-2 py-0.5 text-[11px] text-ink-soft">1</span>
        </header>
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <Initial name={teacher.name} className="size-8 text-[13px]" />
          <span className="truncate text-[13.5px] text-ink">{teacher.name}</span>
          {teacher.id === me?.id && <YouBadge />}
        </div>
      </section>
      <section className="overflow-hidden rounded-xl border border-line bg-card">
        <header className="flex items-center gap-2 border-b border-line px-3 py-2">
          <h2 className="flex-1 text-[13.5px] font-medium text-ink">{t("room_members_students")}</h2>
          <span className="rounded-lg bg-paper-deep px-2 py-0.5 text-[11px] text-ink-soft">{members.length}</span>
          {owner && <AddStudentsButton classroomId={room.id} />}
        </header>
        {members.length === 0 ? (
          <p className="px-3 py-3 text-[13px] text-ink-faint">{t("room_members_empty")}</p>
        ) : (
          <ul className="flex flex-col gap-0.5 p-1.5">
            {members.map((member) => (
              <li key={member.id} className="flex items-center gap-2.5 rounded-xl px-1.5 py-1.5 hover:bg-paper-deep">
                <Initial name={member.name} className="size-8 text-[13px]" />
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 text-[13.5px] text-ink">
                    <span className="truncate">{member.name}</span>
                    {member.id === me?.id && <YouBadge />}
                    {owner && member.kind && member.kind !== "member" && (
                      <span className="shrink-0 rounded-lg bg-paper-deep px-1.5 py-px text-[10.5px] text-ink-soft">
                        {member.kind === "student" ? t("account_kind_student") : t("account_kind_guest")}
                      </span>
                    )}
                  </p>
                  <p className="text-[11.5px] text-ink-faint">
                    {owner && member.username ? (
                      <span className="font-mono">{member.username}</span>
                    ) : (
                      t("room_members_joined", { date: formatDate(member.joinedAt) })
                    )}
                  </p>
                </div>
                {owner && member.kind === "student" && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={resetPassword.isPending && resetPassword.variables === member.id}
                    onClick={() => resetPassword.mutate(member.id)}
                  >
                    <KeyRound className="size-3.5" />
                    {t("students_reset")}
                  </Button>
                )}
                {owner && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={remove.isPending && remove.variables === member.id}
                    onClick={() => setKick(member)}
                    className="hover:bg-flag-wash hover:text-flag"
                  >
                    <UserMinus className="size-3.5" />
                    {t("room_members_remove")}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
      {(remove.isError || resetPassword.isError) && (
        <p role="alert" className="text-[12.5px] text-flag">
          {t("common_error")}
        </p>
      )}
      {!owner && me && me.kind !== "student" && (
        <div className="flex flex-col items-start gap-1.5">
          <Button
            variant="outline"
            size="sm"
            disabled={leave.isPending}
            onClick={() => setLeaving(true)}
            className="hover:border-flag hover:text-flag"
          >
            {leave.isPending ? <Spinner /> : <LogOut className="size-3.5" />}
            {t("room_leave")}
          </Button>
          {leave.isError && (
            <p role="alert" className="text-[12.5px] text-flag">
              {t("common_error")}
            </p>
          )}
        </div>
      )}
      <ConfirmDialog
        open={kick !== null}
        danger
        title={t("room_members_remove_title", { name: kick?.name ?? "" })}
        body={kick?.kind === "student" ? t("students_remove_body") : t("room_members_remove_body")}
        confirmLabel={t("room_members_remove")}
        cancelLabel={t("common_cancel")}
        onCancel={() => setKick(null)}
        onConfirm={() => {
          if (kick) remove.mutate(kick.id);
          setKick(null);
        }}
      />
      {credentials && <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />}
      <ConfirmDialog
        open={leaving}
        danger
        title={t("room_leave_title")}
        body={t("room_leave_body")}
        confirmLabel={t("room_leave")}
        cancelLabel={t("common_cancel")}
        onCancel={() => setLeaving(false)}
        onConfirm={() => {
          setLeaving(false);
          leave.mutate();
        }}
      />
    </div>
  );
}

function YouBadge() {
  const t = useT();
  return (
    <span className="shrink-0 rounded-lg bg-paper-deep px-1.5 py-px text-[10.5px] text-ink-soft">
      {t("room_members_you")}
    </span>
  );
}

function CredentialsDialog({ credentials, onClose }: { credentials: StudentCredential[]; onClose: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  const text = credentials.map((entry) => [entry.name, entry.username, entry.password].join("\t")).join("\n");
  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="anim-fade absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="credentials-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        className="anim-rise relative flex max-h-[85dvh] w-full max-w-lg flex-col gap-3 rounded-xl border border-line bg-paper p-5 shadow-xl"
      >
        <div>
          <h2 id="credentials-title" className="font-serif text-[17px] text-ink">
            {t("students_credentials_title")}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{t("students_credentials_desc")}</p>
        </div>
        <div className="min-h-0 overflow-auto rounded-xl border border-line">
          <table className="w-full text-left text-[13px]">
            <thead className="bg-paper-deep/60 text-[12px] text-ink-soft">
              <tr>
                <th className="px-3 py-2 font-medium">{t("register_name")}</th>
                <th className="px-3 py-2 font-medium">{t("student_username")}</th>
                <th className="px-3 py-2 font-medium">{t("login_password")}</th>
              </tr>
            </thead>
            <tbody>
              {credentials.map((entry) => (
                <tr key={entry.id} className="border-t border-line">
                  <td className="px-3 py-2 text-ink">{entry.name}</td>
                  <td className="px-3 py-2 font-mono text-ink">{entry.username}</td>
                  <td className="px-3 py-2 font-mono text-ink">{entry.password}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => {
              void navigator.clipboard.writeText(text).then(() => setCopied(true));
            }}
          >
            {copied ? <Check className="size-4" /> : <Copy className="size-4" />}
            {copied ? t("students_copied") : t("students_copy")}
          </Button>
          <Button onClick={onClose}>{t("students_done")}</Button>
        </div>
      </div>
    </div>
  );
}

export function AddStudentsButton({ classroomId, block = false }: { classroomId: string; block?: boolean }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [namesText, setNamesText] = useState("");
  const [credentials, setCredentials] = useState<StudentCredential[] | null>(null);
  const names = namesText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const create = useMutation({
    mutationFn: () => api.createStudents(classroomId, names),
    onSuccess: async (created) => {
      setOpen(false);
      setNamesText("");
      setCredentials(created);
      await queryClient.invalidateQueries({ queryKey: ["classroom", classroomId] });
      await queryClient.invalidateQueries({ queryKey: ["classrooms"] });
    },
  });
  return (
    <>
      <Button size="sm" variant="outline" className={block ? "w-full" : undefined} onClick={() => setOpen(true)}>
        <UserPlus className="size-3.5" />
        {t("students_add")}
      </Button>
      <FormDialog
        open={open}
        title={t("students_add")}
        description={t("students_add_desc")}
        submitLabel={t("students_create", { count: names.length })}
        cancelLabel={t("common_cancel")}
        canSubmit={names.length > 0 && names.length <= 50}
        submitting={create.isPending}
        onSubmit={() => create.mutate()}
        onCancel={() => {
          setOpen(false);
          create.reset();
        }}
      >
        <textarea
          value={namesText}
          rows={8}
          aria-label={t("students_names")}
          placeholder={t("students_names_placeholder")}
          onChange={(event) => setNamesText(event.target.value)}
          className="w-full resize-y rounded-xl border border-line-strong bg-paper px-3 py-2 text-[13.5px] text-ink outline-none focus:border-ink"
        />
        {create.isError && (
          <p role="alert" className="text-[12.5px] text-flag">
            {create.error instanceof ApiError && ["name_taken", "trial_limit"].includes(create.error.code)
              ? create.error.message
              : t("common_error")}
          </p>
        )}
      </FormDialog>
      {credentials && <CredentialsDialog credentials={credentials} onClose={() => setCredentials(null)} />}
    </>
  );
}

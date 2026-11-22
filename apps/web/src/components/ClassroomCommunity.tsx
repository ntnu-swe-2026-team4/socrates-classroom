import { useMutation, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, MessagesSquare, Trash2 } from "lucide-react";
import { useId, useRef, useState, type ReactNode } from "react";
import { api } from "@/api";
import { classroomAnnouncementsOptions, classroomPostsOptions, classroomRepliesOptions } from "@/api/queries";
import { Button, ConfirmDialog, Spinner, cn } from "@/components/ui";
import { useFormatDate, useT } from "@/i18n";

type Message = Awaited<ReturnType<typeof api.classroom.posts>>["items"][number];

export function LoadMore({ pending, onClick }: { pending: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <Button variant="outline" disabled={pending} aria-busy={pending} onClick={onClick}>
      {pending ? <Spinner /> : t("room_load_more")}
    </Button>
  );
}

export function PanelState({ pending, error, retry }: { pending: boolean; error: boolean; retry: () => void }) {
  const t = useT();
  if (pending) {
    return (
      <div role="status" className="flex justify-center py-8 text-ink-soft">
        <Spinner />
        <span className="sr-only">{t("room_loading")}</span>
      </div>
    );
  }
  if (error) {
    return (
      <div className="flex flex-wrap items-center gap-3 py-4">
        <p role="alert" className="text-sm text-flag">
          {t("common_error")}
        </p>
        <Button variant="outline" onClick={retry}>
          {t("room_retry")}
        </Button>
      </div>
    );
  }
  return null;
}

export function EmptyPanel({ children }: { children: ReactNode }) {
  return (
    <p className="rounded-xl border border-dashed border-line-strong px-5 py-8 text-center text-sm text-ink-soft">
      {children}
    </p>
  );
}

type FeedKind = "announcements" | "posts";
type DeleteKind = "announcement" | "thread" | "reply";

const deletionLabels = {
  announcement: "room_announce_delete_title",
  thread: "room_board_delete_thread_title",
  reply: "room_board_delete_reply_title",
} as const;

export function ClassroomFeed({
  id,
  viewerId,
  teacher,
  kind,
}: {
  id: string;
  viewerId: string;
  teacher: boolean;
  kind: FeedKind;
}) {
  const t = useT();
  const client = useQueryClient();
  const [deleting, setDeleting] = useState<{ messageId: string; kind: DeleteKind } | null>(null);
  const announcements = kind === "announcements";
  const options = announcements ? classroomAnnouncementsOptions(id) : classroomPostsOptions(id);
  const feed = useInfiniteQuery(options);
  const messages = feed.data?.pages.flatMap((page) => page.items) ?? [];
  const refresh = () => client.invalidateQueries({ queryKey: options.queryKey });
  const remove = useMutation({
    mutationFn: ({ messageId }: NonNullable<typeof deleting>) =>
      announcements ? api.classroom.deleteAnnouncement(id, messageId) : api.classroom.deletePost(id, messageId),
    onSuccess: refresh,
  });

  return (
    <div className="space-y-5">
      {(!announcements || teacher) && (
        <Composer
          placeholder={announcements ? t("room_announce_placeholder") : t("room_board_placeholder")}
          action={announcements ? t("room_announce_publish") : t("room_board_post")}
          write={async (body, key) => {
            if (announcements) await api.classroom.publish(id, body, key);
            else await api.classroom.post(id, body, key);
            await refresh();
          }}
        />
      )}
      <PanelState pending={feed.isPending} error={feed.isError} retry={() => void feed.refetch()} />
      {feed.isSuccess && !messages.length && (
        <EmptyPanel>{t(announcements ? "room_announce_empty" : "room_board_empty")}</EmptyPanel>
      )}
      {messages.length > 0 && (
        <ol className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-paper">
          {messages.map((message) => (
            <li key={message.id} className="p-4 sm:p-5">
              <MessageBody
                message={message}
                onDelete={
                  teacher || (!announcements && message.authorId === viewerId)
                    ? () => setDeleting({ messageId: message.id, kind: announcements ? "announcement" : "thread" })
                    : undefined
                }
              />
              {!announcements && (
                <Thread
                  id={id}
                  postId={message.id}
                  canDelete={(reply) => teacher || reply.authorId === viewerId}
                  onDelete={(messageId) => setDeleting({ messageId, kind: "reply" })}
                />
              )}
            </li>
          ))}
        </ol>
      )}
      {feed.hasNextPage && <LoadMore pending={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()} />}
      {remove.isError && (
        <p role="alert" className="text-sm text-flag">
          {t("common_error")}
        </p>
      )}
      {deleting && (
        <ConfirmDialog
          open
          danger
          title={t(deletionLabels[deleting.kind])}
          body={t(deleting.kind === "thread" ? "room_board_delete_thread_body" : "room_delete_body")}
          confirmLabel={t("room_delete")}
          cancelLabel={t("common_cancel")}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            remove.mutate(deleting);
            setDeleting(null);
          }}
        />
      )}
    </div>
  );
}

function MessageBody({ message, onDelete }: { message: Message; onDelete?: () => void }) {
  const t = useT();
  const formatDate = useFormatDate();
  const name = message.authorName ?? t("room_removed_author");
  return (
    <article className="min-w-0">
      <div className="flex min-w-0 items-start gap-3">
        <span
          aria-hidden
          className="grid size-9 shrink-0 place-items-center rounded-xl bg-paper-deep text-sm font-semibold text-ink"
        >
          {Array.from(name)[0]?.toLocaleUpperCase()}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <strong className="min-w-0 break-words text-sm text-ink">{name}</strong>
            <time dateTime={message.createdAt} className="text-xs text-ink-soft">
              {formatDate(message.createdAt)}
            </time>
          </div>
          <p className="mt-2 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-ink">{message.body}</p>
        </div>
        {onDelete && (
          <Button
            variant="ghost"
            size="sm"
            className="size-9 shrink-0 px-0"
            aria-label={t("room_delete")}
            onClick={onDelete}
          >
            <Trash2 className="size-4" aria-hidden />
          </Button>
        )}
      </div>
    </article>
  );
}

function Thread({
  id,
  postId,
  canDelete,
  onDelete,
}: {
  id: string;
  postId: string;
  canDelete: (reply: Message) => boolean;
  onDelete: (replyId: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const repliesId = useId();
  return (
    <div className="mt-2 min-w-0 pl-4 sm:pl-12">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        aria-expanded={open}
        aria-controls={repliesId}
        onClick={() => setOpen(!open)}
      >
        <MessagesSquare className="size-3.5" aria-hidden />
        {t(open ? "room_board_hide_replies" : "room_board_reply")}
        <ChevronDown className={cn("size-3.5", open && "rotate-180")} aria-hidden />
      </Button>
      <div id={repliesId} hidden={!open}>
        {open && <Replies id={id} postId={postId} canDelete={canDelete} onDelete={onDelete} />}
      </div>
    </div>
  );
}

function Replies({
  id,
  postId,
  canDelete,
  onDelete,
}: {
  id: string;
  postId: string;
  canDelete: (reply: Message) => boolean;
  onDelete: (replyId: string) => void;
}) {
  const t = useT();
  const client = useQueryClient();
  const options = classroomRepliesOptions(id, postId);
  const replies = useInfiniteQuery(options);
  return (
    <div className="mt-2 space-y-3 border-l-2 border-line-strong pl-3">
      <PanelState pending={replies.isPending} error={replies.isError} retry={() => void replies.refetch()} />
      <ol className="space-y-4">
        {replies.data?.pages
          .flatMap((page) => page.items)
          .map((reply) => (
            <li key={reply.id}>
              <MessageBody message={reply} onDelete={canDelete(reply) ? () => onDelete(reply.id) : undefined} />
            </li>
          ))}
      </ol>
      {replies.hasNextPage && (
        <LoadMore pending={replies.isFetchingNextPage} onClick={() => void replies.fetchNextPage()} />
      )}
      {replies.isSuccess && (
        <Composer
          placeholder={t("room_board_reply_placeholder")}
          action={t("room_send")}
          write={async (body, key) => {
            await api.classroom.reply(id, postId, body, key);
            await client.invalidateQueries({ queryKey: options.queryKey });
          }}
        />
      )}
    </div>
  );
}

function Composer({
  placeholder,
  action,
  write,
}: {
  placeholder: string;
  action: string;
  write: (body: string, key: string) => Promise<void>;
}) {
  const t = useT();
  const [text, setText] = useState("");
  const submission = useRef<{ body: string; key: string } | null>(null);
  const inFlight = useRef(false);
  const mutation = useMutation({
    mutationFn: ({ body, key }: NonNullable<typeof submission.current>) => write(body, key),
    onSuccess: () => {
      submission.current = null;
      setText("");
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });

  function submit() {
    const body = text.trim();
    if (!body || inFlight.current) return;
    if (submission.current?.body !== body) submission.current = { body, key: crypto.randomUUID() };
    inFlight.current = true;
    mutation.mutate(submission.current);
  }

  return (
    <form
      className="space-y-2 rounded-xl border border-line bg-card p-3 sm:p-4"
      aria-busy={mutation.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <textarea
        aria-label={placeholder}
        placeholder={placeholder}
        rows={2}
        maxLength={4000}
        disabled={mutation.isPending}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return;
          event.preventDefault();
          submit();
        }}
        className="w-full resize-y rounded-lg border border-line-strong bg-paper px-3 py-2 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-soft focus-visible:ring-2 focus-visible:ring-ember/60"
      />
      {mutation.isError && (
        <p role="alert" className="text-sm text-flag">
          {t("common_error")}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" disabled={!text.trim() || mutation.isPending}>
          {action}
        </Button>
      </div>
    </form>
  );
}

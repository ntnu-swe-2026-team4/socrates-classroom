import { useMutation, useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronUp, MessageCircle, Trash2, X } from "lucide-react";
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
              {announcements ? (
                <MessageBody
                  message={message}
                  onDelete={teacher ? () => setDeleting({ messageId: message.id, kind: "announcement" }) : undefined}
                />
              ) : (
                <Post
                  id={id}
                  message={message}
                  onDelete={
                    teacher || message.authorId === viewerId
                      ? () => setDeleting({ messageId: message.id, kind: "thread" })
                      : undefined
                  }
                  canDelete={(reply) => teacher || reply.authorId === viewerId}
                  onDeleteReply={(messageId) => setDeleting({ messageId, kind: "reply" })}
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

function mentionOf(body: string, names: readonly string[]): string | null {
  let found: string | null = null;
  for (const name of names) {
    if (body.startsWith(`@${name} `) && name.length > (found?.length ?? 0)) found = name;
  }
  return found;
}

const ICON_ACTION = "size-8 px-0";

function MessageBody({
  message,
  small,
  connector,
  mentionable,
  actions,
  onDelete,
}: {
  message: Message;
  small?: boolean;
  connector?: boolean;
  mentionable?: readonly string[];
  actions?: ReactNode;
  onDelete?: () => void;
}) {
  const t = useT();
  const formatDate = useFormatDate();
  const name = message.authorName ?? t("room_removed_author");
  const mention = mentionable ? mentionOf(message.body, mentionable) : null;
  return (
    <article className="flex min-w-0 gap-3">
      <div className="flex shrink-0 flex-col items-center">
        <span
          aria-hidden
          className={cn(
            "grid shrink-0 place-items-center rounded-full bg-paper-deep font-semibold text-ink",
            small ? "size-7 text-xs" : "size-9 text-sm",
          )}
        >
          {Array.from(name)[0]?.toLocaleUpperCase()}
        </span>
        {connector && <span aria-hidden className="mt-2 w-px flex-1 bg-line-strong" />}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2">
          <strong className="min-w-0 text-sm text-ink wrap-anywhere">{name}</strong>
          <time dateTime={message.createdAt} className="shrink-0 text-xs text-ink-soft">
            {formatDate(message.createdAt)}
          </time>
        </div>
        <p className="mt-0.5 whitespace-pre-wrap text-[15px] leading-relaxed text-ink wrap-anywhere">
          {mention === null ? (
            message.body
          ) : (
            <>
              <strong className="font-semibold">@{mention}</strong>
              {message.body.slice(mention.length + 1)}
            </>
          )}
        </p>
        {(actions || onDelete) && (
          <div className="mt-1 -ml-2 flex items-center gap-1 text-ink-soft">
            {actions}
            {onDelete && (
              <Button
                variant="ghost"
                size="sm"
                className={ICON_ACTION}
                aria-label={t("room_delete")}
                title={t("room_delete")}
                onClick={onDelete}
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

function Post({
  id,
  message,
  onDelete,
  canDelete,
  onDeleteReply,
}: {
  id: string;
  message: Message;
  onDelete?: () => void;
  canDelete: (reply: Message) => boolean;
  onDeleteReply: (replyId: string) => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const repliesId = useId();
  const label = t(open ? "room_board_hide_replies" : "room_board_reply");
  return (
    <>
      <MessageBody
        message={message}
        connector={open}
        onDelete={onDelete}
        actions={
          <Button
            variant="ghost"
            size="sm"
            className={ICON_ACTION}
            aria-label={label}
            title={label}
            aria-expanded={open}
            aria-controls={repliesId}
            onClick={() => setOpen(!open)}
          >
            {open ? <ChevronUp className="size-4" aria-hidden /> : <MessageCircle className="size-4" aria-hidden />}
          </Button>
        }
      />
      <div
        id={repliesId}
        hidden={!open}
        className="ml-[17.5px] min-w-0 border-l border-line-strong pl-[18px] sm:pl-[30px]"
      >
        {open && (
          <Replies
            id={id}
            postId={message.id}
            rootAuthor={message.authorName}
            canDelete={canDelete}
            onDelete={onDeleteReply}
          />
        )}
      </div>
    </>
  );
}

function Replies({
  id,
  postId,
  rootAuthor,
  canDelete,
  onDelete,
}: {
  id: string;
  postId: string;
  rootAuthor: string | null;
  canDelete: (reply: Message) => boolean;
  onDelete: (replyId: string) => void;
}) {
  const t = useT();
  const client = useQueryClient();
  const options = classroomRepliesOptions(id, postId);
  const replies = useInfiniteQuery(options);
  const items = replies.data?.pages.flatMap((page) => page.items) ?? [];
  const [replyingTo, setReplyingTo] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const names = [rootAuthor, ...items.map((reply) => reply.authorName)].filter((name) => name !== null);
  return (
    <div className="space-y-3 pt-3">
      <PanelState pending={replies.isPending} error={replies.isError} retry={() => void replies.refetch()} />
      {items.length > 0 && (
        <ol className="space-y-3">
          {items.map((reply) => {
            const author = reply.authorName;
            return (
              <li key={reply.id}>
                <MessageBody
                  small
                  message={reply}
                  mentionable={names}
                  onDelete={canDelete(reply) ? () => onDelete(reply.id) : undefined}
                  actions={
                    author !== null && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className={ICON_ACTION}
                        aria-label={`${t("room_board_reply")} @${author}`}
                        title={t("room_board_reply")}
                        onClick={() => {
                          setReplyingTo(author);
                          inputRef.current?.focus();
                        }}
                      >
                        <MessageCircle className="size-4" aria-hidden />
                      </Button>
                    )
                  }
                />
              </li>
            );
          })}
        </ol>
      )}
      {replies.hasNextPage && (
        <LoadMore pending={replies.isFetchingNextPage} onClick={() => void replies.fetchNextPage()} />
      )}
      {replies.isSuccess && (
        <Composer
          compact
          inputRef={inputRef}
          mention={replyingTo}
          onClearMention={() => setReplyingTo(null)}
          placeholder={t("room_board_reply_placeholder")}
          action={t("room_send")}
          write={async (body, key) => {
            await api.classroom.reply(id, postId, body, key);
            setReplyingTo(null);
            await client.invalidateQueries({ queryKey: options.queryKey });
          }}
        />
      )}
    </div>
  );
}

const BODY_MAX = 4000;

function Composer({
  placeholder,
  action,
  compact,
  inputRef,
  mention = null,
  onClearMention,
  write,
}: {
  placeholder: string;
  action: string;
  compact?: boolean;
  inputRef?: React.Ref<HTMLTextAreaElement>;
  mention?: string | null;
  onClearMention?: () => void;
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
  const prefix = mention === null ? "" : `@${mention} `;

  function submit() {
    const typed = text.trim();
    if (!typed || inFlight.current) return;
    const body = `${prefix}${typed}`;
    if (submission.current?.body !== body) submission.current = { body, key: crypto.randomUUID() };
    inFlight.current = true;
    mutation.mutate(submission.current);
  }

  return (
    <form
      className="min-w-0 space-y-2"
      aria-busy={mutation.isPending}
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      {mention !== null && (
        <p className="flex min-w-0 items-center gap-1 text-xs text-ink-soft">
          <span className="min-w-0 truncate">
            {t("room_board_reply")} <strong className="font-semibold text-ink">@{mention}</strong>
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="size-6 shrink-0 px-0"
            aria-label={t("common_cancel")}
            title={t("common_cancel")}
            onClick={onClearMention}
          >
            <X className="size-3.5" aria-hidden />
          </Button>
        </p>
      )}
      <div className={cn("flex min-w-0 gap-2", compact ? "items-end" : "flex-col")}>
        <textarea
          ref={inputRef}
          aria-label={placeholder}
          placeholder={placeholder}
          rows={compact ? 1 : 2}
          maxLength={BODY_MAX - prefix.length}
          disabled={mutation.isPending}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || !(event.ctrlKey || event.metaKey) || event.nativeEvent.isComposing) return;
            event.preventDefault();
            submit();
          }}
          className="max-h-60 w-full min-w-0 flex-1 resize-y border border-line-strong bg-paper px-3 py-2 text-sm leading-relaxed text-ink outline-none placeholder:text-ink-soft focus-visible:ring-2 focus-visible:ring-ember/60"
        />
        <Button
          type="submit"
          size={compact ? "sm" : "md"}
          className={cn("shrink-0", !compact && "self-end")}
          disabled={!text.trim() || mutation.isPending}
        >
          {action}
        </Button>
      </div>
      {mutation.isError && (
        <p role="alert" className="text-sm text-flag">
          {t("common_error")}
        </p>
      )}
    </form>
  );
}

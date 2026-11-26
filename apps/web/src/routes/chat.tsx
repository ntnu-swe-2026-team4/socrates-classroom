import { meOf } from "@/api/me";
import { soloThreadOptions, soloThreadsOptions } from "@/api/queries";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Link,
  Outlet,
  createFileRoute,
  redirect,
  useNavigate,
  useRouter,
  useRouterState,
} from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Search, SquarePen, Trash2, X } from "lucide-react";
import { api } from "@/api";
import { ChatLayout, SidebarHeader } from "@/components/ChatLayout";
import { ConfirmDialog, cn } from "@/components/ui";
import { useNow } from "@/hooks/useSubscription";
import { useT, type MessageKey } from "@/i18n";
import type { SoloThread } from "@socrates/shared";

export const Route = createFileRoute("/chat")({
  beforeLoad: async ({ context, location }) => {
    const me = await meOf(context.queryClient);
    if (!me) throw redirect({ to: "/login", search: { next: location.href }, replace: true });
    return { soloUserId: me.id };
  },
  component: ChatSection,
});

function ChatSection() {
  const { soloUserId } = Route.useRouteContext();
  return (
    <ChatLayout sidebar={<SoloSidebar userId={soloUserId} />}>
      <Outlet />
    </ChatLayout>
  );
}

function bucketOf(iso: string, now: number): MessageKey {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const at = new Date(iso).getTime();
  if (at >= start.getTime()) return "chat_group_today";
  start.setDate(start.getDate() - 1);
  if (at >= start.getTime()) return "chat_group_yesterday";
  start.setDate(start.getDate() - 6);
  if (at >= start.getTime()) return "chat_group_week";
  return "chat_group_older";
}

function SoloSidebar({ userId }: { userId: string }) {
  const t = useT();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const chats = useQuery(soloThreadsOptions(userId));
  const [filter, setFilter] = useState("");
  const restoreFocus = useRef<Pick<SoloThread, "id" | "updatedAt"> | null>(null);
  const focusRenamedThread = useCallback((chat: SoloThread, link: HTMLAnchorElement | null) => {
    const target = restoreFocus.current;
    if (!link || target?.id !== chat.id || target.updatedAt !== chat.updatedAt) return;
    restoreFocus.current = null;
    link.focus();
  }, []);
  const now = useNow(60_000);
  const remove = useMutation({
    mutationFn: api.deleteSoloThread,
    onSuccess: async (_, chatId) => {
      const { queryKey } = soloThreadsOptions(userId);
      const detailKey = soloThreadOptions(userId, chatId).queryKey;
      await Promise.all([
        queryClient.cancelQueries({ queryKey, exact: true }),
        queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      queryClient.setQueryData(queryKey, (list: SoloThread[] | undefined) =>
        list?.filter((chat) => chat.id !== chatId),
      );
      if (router.state.location.pathname === `/chat/${chatId}`) await navigate({ to: "/chat", replace: true });
      queryClient.removeQueries({ queryKey: detailKey, exact: true });
    },
  });

  const groups = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    const result: Array<{ key: MessageKey; chats: SoloThread[] }> = [];
    for (const chat of chats.data ?? []) {
      if (needle && !(chat.title || t("chat_untitled")).toLowerCase().includes(needle)) continue;
      const key = bucketOf(chat.updatedAt, now);
      const group = result.find((entry) => entry.key === key);
      if (group) group.chats.push(chat);
      else result.push({ key, chats: [chat] });
    }
    return result;
  }, [chats.data, filter, now, t]);

  return (
    <>
      <SidebarHeader
        title={t("nav_chat")}
        actions={
          <Link
            to="/chat"
            aria-label={t("chat_new")}
            title={t("chat_new")}
            className="flex size-8 items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
          >
            <SquarePen className="size-[17px]" />
          </Link>
        }
      />
      <div className="px-2 pt-2 pb-1">
        <label className="flex h-8 items-center gap-2 rounded-lg border border-line bg-paper px-2 text-ink-faint focus-within:border-ink">
          <Search className="size-3.5 shrink-0" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("chat_search")}
            aria-label={t("chat_search")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-soft"
          />
        </label>
      </div>
      <nav
        aria-label={t("chat_sidebar")}
        aria-busy={chats.isPending}
        className="stream-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3"
      >
        {groups.map((group) => (
          <section key={group.key} className="pt-2">
            <h3 className="px-2 pb-1 text-[11.5px] text-ink-soft">{t(group.key)}</h3>
            <ul>
              {group.chats.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  userId={userId}
                  active={pathname === `/chat/${chat.id}`}
                  deleting={remove.isPending && remove.variables === chat.id}
                  onRenameEnd={(thread) => {
                    restoreFocus.current = { id: thread.id, updatedAt: thread.updatedAt };
                  }}
                  onLinkMount={focusRenamedThread}
                  onDelete={() => remove.mutate(chat.id)}
                />
              ))}
            </ul>
          </section>
        ))}
        {chats.isSuccess && groups.length === 0 && (
          <p className="px-2 pt-3 text-[12.5px] text-ink-soft">{filter ? t("chat_no_match") : t("chat_empty")}</p>
        )}
      </nav>
      {(chats.isError || remove.isError) && (
        <p role="alert" className="px-3 pb-3 text-sm text-flag">
          {t("common_error")}
        </p>
      )}
    </>
  );
}

function focusRenameInput(input: HTMLInputElement | null) {
  input?.focus();
  input?.select();
}

function ChatRow({
  chat,
  userId,
  active,
  deleting,
  onRenameEnd,
  onLinkMount,
  onDelete,
}: {
  chat: SoloThread;
  userId: string;
  active: boolean;
  deleting: boolean;
  onRenameEnd: (thread: SoloThread) => void;
  onLinkMount: (thread: SoloThread, link: HTMLAnchorElement | null) => void;
  onDelete: () => void;
}) {
  const t = useT();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const focusRow = useCallback((link: HTMLAnchorElement | null) => onLinkMount(chat, link), [chat, onLinkMount]);
  const stopEditing = (thread: SoloThread) => {
    onRenameEnd(thread);
    setEditing(false);
  };
  const displayTitle = chat.title || t("chat_untitled");
  const rename = useMutation({
    mutationFn: (name: string) => api.updateSoloThread(chat.id, { title: name }),
    onSuccess: async (updated) => {
      const { queryKey } = soloThreadsOptions(userId);
      const detailKey = soloThreadOptions(userId, updated.id).queryKey;
      await Promise.all([
        queryClient.cancelQueries({ queryKey, exact: true }),
        queryClient.cancelQueries({ queryKey: detailKey, exact: true }),
      ]);
      stopEditing(updated);
      queryClient.setQueryData(queryKey, (list: SoloThread[] | undefined) => [
        updated,
        ...(list?.filter((entry) => entry.id !== updated.id) ?? []),
      ]);
      queryClient.setQueryData(detailKey, updated);
    },
  });

  if (editing) {
    return (
      <li>
        <form
          className="flex items-center gap-1 rounded-lg bg-ember-wash py-1 pr-1 pl-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim() && !rename.isPending) rename.mutate(title.trim());
          }}
        >
          <input
            ref={focusRenameInput}
            value={title}
            maxLength={120}
            aria-label={t("chat_rename")}
            readOnly={rename.isPending}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === "Escape" && !rename.isPending) stopEditing(chat);
            }}
            className="h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-paper px-1.5 text-[13px] outline-none focus:border-ink"
          />
          <button
            type="submit"
            aria-label={t("common_save")}
            disabled={!title.trim() || rename.isPending}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-soft hover:text-ink"
          >
            <Check className="size-3.5" />
          </button>
          <button
            type="button"
            disabled={rename.isPending}
            aria-label={t("common_cancel")}
            onClick={() => stopEditing(chat)}
            className="flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-soft hover:text-ink"
          >
            <X className="size-3.5" />
          </button>
        </form>
        {rename.isError && (
          <p role="alert" className="px-2 py-1 text-xs text-flag">
            {t("common_error")}
          </p>
        )}
      </li>
    );
  }

  return (
    <li
      className={cn(
        "group flex items-center rounded-lg transition-colors",
        active ? "bg-ember-wash text-ink" : "text-ink-soft hover:bg-paper-deep",
      )}
    >
      <Link
        ref={focusRow}
        to="/chat/$chatId"
        params={{ chatId: chat.id }}
        className="min-w-0 flex-1 truncate py-2 pl-2.5 text-[13.5px]"
        title={displayTitle}
      >
        {displayTitle}
      </Link>
      <span
        className={cn(
          "flex shrink-0 pr-1",
          !active && "md:invisible md:group-focus-within:visible md:group-hover:visible",
        )}
      >
        <button
          type="button"
          aria-label={t("chat_rename")}
          title={t("chat_rename")}
          disabled={deleting}
          onClick={() => {
            rename.reset();
            setTitle(chat.title);
            setEditing(true);
          }}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-faint hover:text-ink"
        >
          <Pencil className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={t("chat_delete")}
          title={t("chat_delete")}
          disabled={deleting}
          onClick={() => setConfirming(true)}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-faint hover:text-flag"
        >
          <Trash2 className="size-3.5" />
        </button>
      </span>
      <ConfirmDialog
        open={confirming}
        danger
        title={t("chat_delete_confirm")}
        body={t("chat_delete_body", { title: displayTitle })}
        confirmLabel={t("chat_delete")}
        cancelLabel={t("common_cancel")}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          onDelete();
        }}
      />
    </li>
  );
}

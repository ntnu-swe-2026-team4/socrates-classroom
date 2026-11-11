import { useMemo, useState } from "react";
import { Link, Outlet, createFileRoute, redirect, useNavigate, useRouterState } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Search, SquarePen, Trash2, X } from "lucide-react";
import { api, type SoloChat } from "@/api";
import { ChatLayout, SidebarHeader } from "@/components/ChatLayout";
import { ConfirmDialog, cn } from "@/components/ui";
import { useT, type MessageKey } from "@/i18n";

export const Route = createFileRoute("/chat")({
  beforeLoad: async ({ context, location }) => {
    const me = await context.queryClient.fetchQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
    if (!me) throw redirect({ to: "/login", search: { next: location.href } });
    if (me?.preview && me.previewClassroomId) {
      throw redirect({ to: "/classrooms/$classroomId", params: { classroomId: me.previewClassroomId } });
    }
  },
  component: ChatSection,
});

function ChatSection() {
  return (
    <ChatLayout sidebar={<SoloSidebar />}>
      <Outlet />
    </ChatLayout>
  );
}

const DAY = 86_400_000;

function bucketOf(iso: string, now: number): MessageKey {
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const at = new Date(iso).getTime();
  if (at >= startOfToday) return "chat_group_today";
  if (at >= startOfToday - DAY) return "chat_group_yesterday";
  if (at >= startOfToday - 7 * DAY) return "chat_group_week";
  return "chat_group_older";
}

function SoloSidebar() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const chats = useQuery({ queryKey: ["chats"], queryFn: () => api.listChats() });
  const [filter, setFilter] = useState("");
  const remove = useMutation({
    mutationFn: (chatId: string) => api.deleteChat(chatId),
    onSuccess: async (_, chatId) => {
      queryClient.setQueryData<SoloChat[]>(["chats"], (list) => list?.filter((chat) => chat.id !== chatId));
      if (pathname === `/chat/${chatId}`) await navigate({ to: "/chat" });
    },
  });

  const groups = useMemo(() => {
    const now = Date.now();
    const needle = filter.trim().toLowerCase();
    const result: Array<{ key: MessageKey; chats: SoloChat[] }> = [];
    for (const chat of chats.data ?? []) {
      if (needle && !chat.title.toLowerCase().includes(needle)) continue;
      const key = bucketOf(chat.updatedAt, now);
      const group = result.find((entry) => entry.key === key);
      if (group) group.chats.push(chat);
      else result.push({ key, chats: [chat] });
    }
    return result;
  }, [chats.data, filter]);

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
        <label className="flex h-8 items-center gap-2 rounded-lg border border-line bg-paper px-2 text-ink-faint focus-within:border-ember">
          <Search className="size-3.5 shrink-0" />
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={t("chat_search")}
            aria-label={t("chat_search")}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-faint"
          />
        </label>
      </div>
      <nav className="stream-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {groups.map((group) => (
          <section key={group.key} className="pt-2">
            <h3 className="px-2 pb-1 text-[11.5px] text-ink-faint">{t(group.key)}</h3>
            <ul>
              {group.chats.map((chat) => (
                <ChatRow
                  key={chat.id}
                  chat={chat}
                  active={pathname === `/chat/${chat.id}`}
                  onDelete={() => remove.mutate(chat.id)}
                />
              ))}
            </ul>
          </section>
        ))}
        {chats.isSuccess && groups.length === 0 && (
          <p className="px-2 pt-3 text-[12.5px] text-ink-faint">{filter ? t("chat_no_match") : t("chat_empty")}</p>
        )}
      </nav>
    </>
  );
}

function ChatRow({ chat, active, onDelete }: { chat: SoloChat; active: boolean; onDelete: () => void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [title, setTitle] = useState(chat.title);
  const rename = useMutation({
    mutationFn: () => api.renameChat(chat.id, title.trim()),
    onSuccess: (updated) => {
      queryClient.setQueryData<SoloChat[]>(["chats"], (list) =>
        list?.map((entry) => (entry.id === updated.id ? updated : entry)),
      );
      queryClient.setQueryData(["chat", updated.id], updated);
      setEditing(false);
    },
  });

  if (editing) {
    return (
      <li className="flex items-center gap-1 rounded-lg bg-ember-wash py-1 pr-1 pl-2">
        <input
          // biome-ignore lint/a11y/noAutofocus: rename starts from an explicit click
          autoFocus
          value={title}
          maxLength={120}
          aria-label={t("chat_rename")}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter" && title.trim()) rename.mutate();
            if (event.key === "Escape") setEditing(false);
          }}
          className="h-7 min-w-0 flex-1 rounded-md border border-line-strong bg-paper px-1.5 text-[13px] outline-none focus:border-ember"
        />
        <button
          type="button"
          aria-label={t("common_save")}
          disabled={!title.trim() || rename.isPending}
          onClick={() => rename.mutate()}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-soft hover:text-ink"
        >
          <Check className="size-3.5" />
        </button>
        <button
          type="button"
          aria-label={t("common_cancel")}
          onClick={() => setEditing(false)}
          className="flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-soft hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
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
        to="/chat/$chatId"
        params={{ chatId: chat.id }}
        className="min-w-0 flex-1 truncate py-2 pl-2.5 text-[13.5px]"
        title={chat.title}
      >
        {chat.title}
      </Link>
      <span className={cn("flex shrink-0 pr-1", !active && "invisible group-focus-within:visible group-hover:visible")}>
        <button
          type="button"
          aria-label={t("chat_rename")}
          title={t("chat_rename")}
          onClick={() => {
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
        body={t("chat_delete_body", { title: chat.title })}
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

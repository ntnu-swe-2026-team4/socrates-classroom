import { useCallback } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { DialogueView } from "@/components/DialogueView";
import { Spinner } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/chat/$chatId")({
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search.q === "string" ? search.q : undefined,
  }),
  component: ChatPage,
});

function ChatPage() {
  const t = useT();
  const navigate = useNavigate();
  const { chatId } = Route.useParams();
  const { q } = Route.useSearch();
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  const chat = useQuery({ queryKey: ["chat", chatId], queryFn: () => api.getChat(chatId) });
  const clearQuery = useCallback(
    () => void navigate({ to: "/chat/$chatId", params: { chatId }, search: {}, replace: true }),
    [navigate, chatId],
  );

  if (chat.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[14px] text-ink-soft">{t("chat_missing")}</p>
        <Link
          to="/chat"
          className="rounded-full border border-line-strong px-3 py-1.5 text-[13px] text-ember hover:border-ember"
        >
          {t("chat_new")}
        </Link>
      </div>
    );
  }
  if (!me.data || !chat.data) {
    return (
      <div className="flex flex-1 items-center justify-center" aria-busy="true">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  return (
    <DialogueView
      key={chatId}
      threadId={chatId}
      userId={me.data.id}
      title={chat.data.title}
      subtitle={t("chat_solo_subtitle")}
      autoSend={q}
      onAutoSent={clearQuery}
    />
  );
}

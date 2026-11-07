import { useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ChatWorkspace } from "@/components/ChatWorkspace";

export const Route = createFileRoute("/chat/$chatId")({
  validateSearch: (search: Record<string, unknown>): { q?: string; term?: string } => ({
    q: typeof search.q === "string" ? search.q : undefined,
    term: typeof search.term === "string" ? search.term : undefined,
  }),
  component: SoloChatPage,
});

function SoloChatPage() {
  const navigate = useNavigate();
  const { chatId } = Route.useParams();
  const { q, term } = Route.useSearch();

  const clear = useCallback(
    (key: "q" | "term") =>
      void navigate({
        to: "/chat/$chatId",
        params: { chatId },
        search: (prev) => ({ ...prev, [key]: undefined }),
        replace: true,
      }),
    [navigate, chatId],
  );
  const clearQuery = useCallback(() => clear("q"), [clear]);
  const clearTerm = useCallback(() => clear("term"), [clear]);

  return (
    <ChatWorkspace
      key={chatId}
      chatId={chatId}
      autoSend={q}
      onAutoSent={clearQuery}
      openTerm={term}
      onTermOpened={clearTerm}
    />
  );
}

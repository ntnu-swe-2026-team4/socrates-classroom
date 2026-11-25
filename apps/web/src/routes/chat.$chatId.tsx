import { Link, createFileRoute, useLocation, useNavigate, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/api";
import { soloThreadOptions, soloThreadsOptions } from "@/api/queries";
import { DialogueView } from "@/components/DialogueView";
import { Spinner } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/chat/$chatId")({
  component: ChatPage,
});

function ChatPage() {
  const t = useT();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { chatId } = Route.useParams();
  const { soloUserId } = Route.useRouteContext();
  const question = useLocation({ select: (location) => location.state.soloQuestion });
  const chat = useQuery(soloThreadOptions(soloUserId, chatId));

  if (chat.isError) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
        <p role="alert" className="text-[14px] text-ink-soft">
          {t(chat.error instanceof ApiError && chat.error.code === "not_found" ? "chat_missing" : "common_error")}
        </p>
        <Link
          to="/chat"
          className="rounded-full border border-line-strong px-3 py-1.5 text-[13px] text-ember hover:border-ember"
        >
          {t("chat_new")}
        </Link>
      </div>
    );
  }
  if (!chat.data) {
    return (
      <div className="flex flex-1 items-center justify-center" aria-busy="true">
        <Spinner className="h-5 w-5" />
      </div>
    );
  }

  return (
    <DialogueView
      key={`${soloUserId}:${chatId}`}
      threadId={chatId}
      userId={soloUserId}
      agent="solo-chat"
      title={chat.data.title || t("chat_untitled")}
      subtitle={t("chat_solo_subtitle")}
      autoSend={question?.text}
      autoSendOperationId={question?.operationId}
      onAutoSent={(receipt) => {
        if (receipt && !receipt.accepted) return;
        if (question && router.state.location.state.soloQuestion?.operationId === question.operationId) {
          void navigate({ to: "/chat/$chatId", params: { chatId }, state: {}, replace: true });
        }
      }}
      onSubmitReceipt={() =>
        void queryClient.invalidateQueries({ queryKey: soloThreadsOptions(soloUserId).queryKey, exact: true })
      }
    />
  );
}

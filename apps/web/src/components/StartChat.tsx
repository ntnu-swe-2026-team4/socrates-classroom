import { useState } from "react";
import { useNavigate, useRouter } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { api } from "@/api";
import { soloThreadOptions, soloThreadsOptions } from "@/api/queries";
import { Spinner } from "@/components/ui";
import { useT, type MessageKey } from "@/i18n";
import type { SoloThread } from "@socrates/shared";

const SUGGESTIONS: MessageKey[] = ["chat_suggest_1", "chat_suggest_2", "chat_suggest_3"];

export function StartChat({ userId }: { userId: string }) {
  const t = useT();
  const navigate = useNavigate();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const start = useMutation({
    mutationFn: (question: string) => api.createSoloThread({ title: question.replace(/\s+/g, " ").slice(0, 120) }),
    onSuccess: async (chat, question) => {
      const list = soloThreadsOptions(userId);
      await queryClient.cancelQueries({ queryKey: list.queryKey, exact: true });
      queryClient.setQueryData(list.queryKey, (previous: SoloThread[] | undefined) => [
        chat,
        ...(previous?.filter((thread) => thread.id !== chat.id) ?? []),
      ]);
      queryClient.setQueryData(soloThreadOptions(userId, chat.id).queryKey, chat);
      void queryClient.invalidateQueries({ queryKey: list.queryKey, exact: true });
      if (!router.state.matches.some((match) => match.routeId === "/chat/")) return;
      await navigate({
        to: "/chat/$chatId",
        params: { chatId: chat.id },
        state: { soloQuestion: { text: question, operationId: crypto.randomUUID() } },
      });
    },
  });

  function submit(value: string) {
    const question = value.trim();
    if (!question || start.isPending) return;
    start.mutate(question.slice(0, 2000));
  }

  return (
    <div className="flex flex-col gap-2">
      <form
        aria-busy={start.isPending}
        className="rounded-2xl border border-line-strong bg-paper focus-within:border-ink"
        onSubmit={(event) => {
          event.preventDefault();
          submit(text);
        }}
      >
        <textarea
          rows={2}
          value={text}
          maxLength={2000}
          aria-label={t("chat_start_placeholder")}
          placeholder={t("chat_start_placeholder")}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.keyCode === 229) return;
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submit(text);
            }
          }}
          className="block w-full resize-none bg-transparent px-3 pt-3 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-soft"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <span className="truncate pl-1 text-[11.5px] text-ink-soft">{t("chat_start_hint")}</span>
          <button
            type="submit"
            disabled={!text.trim() || start.isPending}
            aria-label={t("common_send")}
            className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-full bg-ink text-paper transition-colors hover:bg-ember hover:text-on-ember disabled:opacity-40"
          >
            {start.isPending ? <Spinner className="border-paper/30 border-t-paper" /> : <ArrowUp className="size-4" />}
          </button>
        </div>
      </form>
      {start.isError && (
        <p role="alert" className="text-[12.5px] text-flag">
          {t("common_error")}
        </p>
      )}
      <div className="flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((key) => (
          <button
            key={key}
            type="button"
            disabled={start.isPending}
            onClick={() => submit(t(key))}
            className="cursor-pointer rounded-full border border-line px-2.5 py-1 text-[12.5px] text-ink-soft transition-colors hover:border-ember hover:text-ink disabled:opacity-50"
          >
            {t(key)}
          </button>
        ))}
      </div>
    </div>
  );
}

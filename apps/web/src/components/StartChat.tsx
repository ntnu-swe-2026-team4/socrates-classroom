import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowUp } from "lucide-react";
import { api, type SoloChat } from "@/api";
import { Spinner } from "@/components/ui";
import { useT, type MessageKey } from "@/i18n";

const SUGGESTIONS: MessageKey[] = ["chat_suggest_1", "chat_suggest_2", "chat_suggest_3"];

export function StartChat({ autoFocus = false }: { autoFocus?: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [text, setText] = useState("");
  const start = useMutation({
    mutationFn: (question: string) => api.createChat(question),
    onSuccess: async (chat, question) => {
      queryClient.setQueryData<SoloChat[]>(["chats"], (list) => [chat, ...(list ?? [])]);
      await navigate({ to: "/chat/$chatId", params: { chatId: chat.id }, search: { q: question } });
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
        className="rounded-2xl border border-line-strong bg-paper focus-within:border-ink"
        onSubmit={(event) => {
          event.preventDefault();
          submit(text);
        }}
      >
        <textarea
          // biome-ignore lint/a11y/noAutofocus: the new-chat screen exists to type a question
          autoFocus={autoFocus}
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
          className="block w-full resize-none bg-transparent px-3 pt-3 text-[15px] leading-6 text-ink outline-none placeholder:text-ink-faint"
        />
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <span className="truncate pl-1 text-[11.5px] text-ink-faint">{t("chat_start_hint")}</span>
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

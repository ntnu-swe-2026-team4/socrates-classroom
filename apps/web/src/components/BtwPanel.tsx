import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { MessageCircleQuestionMark, PanelRight, RotateCcw, Send } from "lucide-react";
import { Markdown } from "@/components/Markdown";
import { cn } from "@/components/ui";
import { useBtw } from "@/hooks/useBtw";
import { useT } from "@/i18n";

export interface BtwPanelHandle {
  ask(question: string): void;
}

interface BtwPanelProps {
  open: boolean;
  onClose: () => void;
  activityId: string;
  participantId: string;
}

export const BtwPanel = forwardRef<BtwPanelHandle, BtwPanelProps>(function BtwPanel(
  { open, onClose, activityId, participantId },
  ref,
) {
  const t = useT();
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (open) setConnected(true);
  }, [open]);
  const { messages, draft, phase, error, ready, ask, retryLast, interrupt, newTopic } = useBtw(
    activityId,
    participantId,
    connected,
  );
  const [text, setText] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busy = phase !== "idle";

  useImperativeHandle(ref, () => ({
    ask(question: string) {
      setConnected(true);
      ask(question);
    },
  }));

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  });

  function submit() {
    if (!text.trim() || busy || !ready) return;
    if (ask(text)) setText("");
  }

  const nothingToFork = error?.code === "NothingToFork";

  return (
    <aside
      inert={!open}
      aria-hidden={!open}
      aria-label={t("btw_panel")}
      className={cn(
        "flex shrink-0 flex-col overflow-hidden border-line bg-paper transition-[width] duration-200 max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:max-w-full max-md:shadow-xl",
        open ? "w-88 border-l" : "w-0 border-l-0",
      )}
    >
      <div className="flex h-full w-88 max-w-full flex-col">
        <header className="flex items-center gap-2 px-3 pt-3 pb-2">
          <button
            type="button"
            aria-label={t("btw_close")}
            title={t("btw_close")}
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-xl text-ink-faint hover:bg-paper-deep hover:text-ink"
          >
            <PanelRight size={18} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            onClick={newTopic}
            disabled={busy || !ready}
            title={t("btw_new_topic")}
            className="flex h-8 shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-2.5 text-[12.5px] text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink disabled:cursor-default disabled:opacity-50"
          >
            <RotateCcw size={14} strokeWidth={1.6} />
            {t("btw_new_topic")}
          </button>
          <span className="min-w-0 flex-1 truncate text-right font-serif text-[15px] font-semibold text-ink">
            {t("btw_panel")}
          </span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ember-wash text-ember">
            <MessageCircleQuestionMark size={16} strokeWidth={1.6} />
          </span>
        </header>

        <div ref={scrollRef} className="stream-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3" aria-busy={busy}>
          <p className="px-2.5 pb-3 text-[12.5px] leading-[1.85] text-ink-faint">{t("btw_hint")}</p>
          <div className="flex flex-col gap-3">
            {messages.map((message) =>
              message.role === "user" ? (
                <p
                  key={message.id}
                  className="ml-8 self-end whitespace-pre-wrap rounded-2xl border border-line bg-ember-wash px-3.5 py-2 text-[13.5px] leading-[1.8] text-ink"
                >
                  {message.text}
                </p>
              ) : (
                <AssistantNote key={message.id} text={message.text} />
              ),
            )}
            <div aria-live="polite">
              {draft ? (
                <AssistantNote text={draft} caret />
              ) : (
                phase === "thinking" && (
                  <p className="state-shimmer px-2.5 text-[12.5px] text-ink-faint">{t("dlg_thinking")}</p>
                )
              )}
            </div>
          </div>
        </div>

        <footer className="flex shrink-0 flex-col gap-2 border-t border-line px-3 pt-3 pb-4">
          {error && (
            <div
              role="alert"
              className="flex items-center gap-2 rounded-2xl border border-line bg-card px-3 py-2 text-[12.5px] text-ink-soft"
            >
              <span className="min-w-0 flex-1">{t(nothingToFork ? "btw_err_nothing" : "dlg_error")}</span>
              {!nothingToFork && error.code !== "ActivityFinished" && (
                <button
                  type="button"
                  onClick={retryLast}
                  className="shrink-0 cursor-pointer rounded-full border border-line-strong px-3 py-1 text-[12px] text-ember transition-colors hover:border-ember"
                >
                  {t("dlg_retry")}
                </button>
              )}
            </div>
          )}
          {!ready && !nothingToFork && open && (
            <p role="status" className="text-center text-[12.5px] text-ink-faint">
              {t("btw_connecting")}
            </p>
          )}
          <div className="flex items-center gap-2">
            <input
              ref={inputRef}
              value={text}
              aria-label={t("btw_placeholder")}
              placeholder={t("btw_placeholder")}
              disabled={!ready}
              maxLength={2000}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === "Enter") submit();
              }}
              className="h-10 min-w-0 flex-1 rounded-full border border-line-strong bg-paper-deep px-4 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ember disabled:opacity-60"
            />
            {busy ? (
              <button
                type="button"
                onClick={interrupt}
                className="h-10 shrink-0 cursor-pointer rounded-full border border-line-strong px-3 text-[12px] text-ink-soft transition-colors hover:text-ink"
              >
                {t("dlg_tap_to_interrupt")}
              </button>
            ) : (
              <button
                type="button"
                onClick={submit}
                disabled={!text.trim() || !ready}
                aria-label={t("common_send")}
                className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-ember text-on-ember transition hover:brightness-110 disabled:opacity-50"
              >
                <Send className="size-4" />
              </button>
            )}
          </div>
        </footer>
      </div>
    </aside>
  );
});

function AssistantNote({ text, caret }: { text: string; caret?: boolean }) {
  const t = useT();
  return (
    <div className="anim-rise flex items-start gap-2">
      <span className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full border border-line-strong bg-paper-deep text-[11px] text-ember">
        {t("btw_bubble")}
      </span>
      <div className={cn("min-w-0 flex-1 rounded-2xl border border-line bg-paper-deep px-3 py-0.5", caret && "caret")}>
        <Markdown>{text}</Markdown>
      </div>
    </div>
  );
}

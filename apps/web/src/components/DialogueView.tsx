import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Mic, Send, Square, TextSearch } from "lucide-react";
import { SidebarToggle } from "@/components/ChatLayout";
import { TermPanel, type TermPanelHandle } from "@/components/TermPanel";
import { cn } from "@/components/ui";
import { textOf, useDialogue } from "@/hooks/useDialogue";
import { useSelectionPopover } from "@/hooks/useSelectionPopover";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useT, type MessageKey } from "@/i18n";
import { companion } from "@/lib/companion";
import type { Message } from "@earendil-works/pi-ai";

const VOICE_ERROR_KEY: Record<"denied" | "unsupported" | "failed", MessageKey> = {
  denied: "voice_denied",
  unsupported: "voice_unsupported",
  failed: "voice_failed",
};

const EXPRESSIONS: Record<string, "Happy" | "Angry" | "Confused"> = {
  happy: "Happy",
  angry: "Angry",
  confused: "Confused",
};

const onAmplitudeNoop = () => {};

export interface DialogueViewProps {
  threadId: string;
  userId: string;
  title: string;
  subtitle?: ReactNode;
  statement?: string;
  prompts?: string[];
  autoSend?: string;
  onAutoSent?: () => void;
  onActivityFinished?: () => void;
  onFirstSend?: (text: string) => void;
  openTerm?: string;
  onTermOpened?: () => void;
  headerActions?: ReactNode;
  closedNotice?: ReactNode;
}

export function DialogueView({
  threadId,
  userId,
  title,
  subtitle,
  statement,
  prompts = [],
  autoSend,
  onAutoSent,
  onActivityFinished,
  onFirstSend,
  openTerm,
  onTermOpened,
  headerActions,
  closedNotice,
}: DialogueViewProps) {
  const t = useT();
  const {
    items,
    draft,
    phase,
    error,
    emotion,
    ttsFailed,
    ttsSkipped,
    ready,
    viewReady,
    canLoadEarlier,
    loadEarlier,
    fillGap,
    send,
    retryLast,
    replay,
    interrupt,
  } = useDialogue(threadId, userId);

  const sentRef = useRef(false);
  const playedEmotionRef = useRef<unknown>(null);
  useEffect(() => {
    if (!emotion || emotion === playedEmotionRef.current) return;
    if (!sentRef.current) {
      playedEmotionRef.current = emotion;
      return;
    }
    if (phase === "thinking" || phase === "streaming") return;
    playedEmotionRef.current = emotion;
    const name = EXPRESSIONS[emotion.emotion];
    if (name) companion.playExpression(name);
  }, [phase, emotion]);

  const [panelOpen, setPanelOpen] = useState(false);
  const [connectGraceOver, setConnectGraceOver] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setConnectGraceOver(true), 3000);
    return () => clearTimeout(timer);
  }, []);
  const panelRef = useRef<TermPanelHandle>(null);

  const autoSent = useRef<string | null>(null);
  const lastTerm = useRef<string | null>(null);
  useEffect(() => {
    if (openTerm && openTerm !== lastTerm.current) {
      lastTerm.current = openTerm;
      setPanelOpen(true);
      panelRef.current?.openTerm(openTerm);
      onTermOpened?.();
    }
  }, [openTerm, onTermOpened]);

  const hasEntries = items.some((item) => item.kind === "entry");
  const submit = useCallback(
    (value: string) => {
      const sent = send(value.slice(0, 2000));
      if (sent) sentRef.current = true;
      if (sent && !hasEntries) onFirstSend?.(value);
      return sent;
    },
    [send, hasEntries, onFirstSend],
  );

  useEffect(() => {
    if (autoSend && autoSent.current !== autoSend && phase === "idle" && ready && viewReady) {
      if (send(autoSend.slice(0, 2000))) {
        sentRef.current = true;
        autoSent.current = autoSend;
        onAutoSent?.();
      }
    } else if (!autoSend) {
      autoSent.current = null;
    }
  }, [autoSend, phase, ready, viewReady, send, onAutoSent]);

  useEffect(() => {
    if (error?.code === "ActivityFinished") onActivityFinished?.();
  }, [error, onActivityFinished]);

  const onVoiceFinal = useCallback((text: string) => void submit(text), [submit]);
  const voice = useVoiceInput(onVoiceFinal, onAmplitudeNoop);
  useEffect(() => {
    if (!ready && voice.state === "listening") void voice.stop();
  }, [ready, voice.state, voice.stop]);

  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const { selection, clear: clearSelection } = useSelectionPopover(scrollRef);

  function lookupSelection() {
    if (!selection) return;
    setPanelOpen(true);
    panelRef.current?.openTerm(selection.text);
    clearSelection();
  }

  useEffect(() => {
    const element = scrollRef.current;
    if (!element || !pinnedRef.current) return;
    element.scrollTop = element.scrollHeight;
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: textarea height follows every text change
  useLayoutEffect(() => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 160)}px`;
  }, [text]);

  function onScroll() {
    const element = scrollRef.current;
    if (!element) return;
    pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
  }

  const streaming = phase === "streaming";
  const busy = phase !== "idle";
  const awaitingReply = phase === "thinking" || phase === "streaming";
  const status =
    voice.state === "listening"
      ? t("dlg_listening")
      : phase === "thinking"
        ? t("dlg_thinking")
        : phase === "streaming"
          ? t("dlg_streaming")
          : phase === "speaking"
            ? t("dlg_speaking")
            : "";

  function submitText() {
    if (!text.trim() || awaitingReply || !viewReady) return;
    if (submit(text)) setText("");
  }

  const showIntro = !hasEntries && !draft;

  return (
    <div className="flex min-h-0 flex-1">
      <section className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b border-line pr-3 pl-14 md:pl-2">
          <SidebarToggle />
          <div className="min-w-0 flex-1 pl-1">
            <h1 className="truncate text-[14.5px] font-medium text-ink">{title}</h1>
            {subtitle && <p className="truncate text-[11.5px] text-ink-faint">{subtitle}</p>}
          </div>
          {status && <span className="state-shimmer hidden text-[12px] sm:inline">{status}</span>}
          {busy && (
            <button
              type="button"
              onClick={interrupt}
              className="h-8 cursor-pointer rounded-full px-2.5 text-xs text-ink-soft hover:bg-paper-deep hover:text-ink"
            >
              {t("dlg_tap_to_interrupt")}
            </button>
          )}
          {headerActions}
          <button
            type="button"
            onClick={() => setPanelOpen((v) => !v)}
            aria-pressed={panelOpen}
            title={t("term_panel")}
            className={cn(
              "flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
              panelOpen
                ? "border-ember bg-ember-wash text-ember"
                : "border-line-strong text-ink-soft hover:border-ember-deep hover:text-ink",
            )}
          >
            <TextSearch className="size-3.5" />
            <span className="hidden sm:inline">{t("term_panel")}</span>
          </button>
        </header>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="stream-scroll min-h-0 flex-1 overflow-y-auto px-4 md:px-8"
          aria-busy={busy}
        >
          <div className="flex w-full flex-col gap-4 py-5">
            {showIntro && statement && (
              <>
                <Turn speaker="assistant" text={statement} />
                {prompts.length > 0 && (
                  <div className="flex flex-wrap gap-2 pl-11">
                    {prompts.map((prompt) => (
                      <button
                        type="button"
                        key={prompt}
                        disabled={awaitingReply || !viewReady || Boolean(closedNotice)}
                        onClick={() => void submit(prompt)}
                        className="cursor-pointer rounded-full border border-line-strong px-4 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-ember hover:text-ink disabled:opacity-50"
                      >
                        {prompt}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
            {canLoadEarlier && (
              <button
                type="button"
                onClick={loadEarlier}
                className="mx-auto cursor-pointer rounded-full border border-line-strong px-3 py-1 text-[12.5px] text-ink-soft transition-colors hover:text-ink"
              >
                {t("dlg_load_earlier")}
              </button>
            )}
            {items.map((item) => {
              if (item.kind === "gap") {
                return (
                  <button
                    type="button"
                    key={`gap-${item.after}-${item.upTo}`}
                    onClick={() => void fillGap(item)}
                    className="mx-auto cursor-pointer rounded-full border border-line-strong px-3 py-1 text-[12.5px] text-ink-soft transition-colors hover:text-ink"
                  >
                    {t("dlg_load_missing")}
                  </button>
                );
              }
              if (item.kind !== "entry") return null;
              const entry = item.entry;
              if (entry.kind !== "pi.user" && entry.kind !== "pi.assistant") return null;
              const content = textOf((entry.model?.[0] ?? undefined) as Message | undefined);
              if (content === "") return null;
              return (
                <Turn key={`e${entry.id}`} speaker={entry.kind === "pi.user" ? "user" : "assistant"} text={content} />
              );
            })}
            <div aria-live="polite">{draft && <Turn speaker="assistant" text={draft} caret={streaming} />}</div>
          </div>
        </div>

        {selection && (
          <button
            type="button"
            onClick={lookupSelection}
            className="fixed z-50 -translate-x-1/2 -translate-y-full cursor-pointer rounded-full bg-ink px-3 py-1.5 text-[12.5px] text-paper shadow-sm"
            style={{ left: selection.x, top: selection.y - 8 }}
          >
            {t("term_lookup")}「<span className="inline-block max-w-52 truncate align-middle">{selection.text}</span>」
          </button>
        )}

        <footer className="shrink-0 border-t border-line px-4 pt-3 pb-4 md:px-8">
          <div className="flex w-full flex-col gap-2">
            {voice.interim && (
              <p className="truncate rounded-full bg-paper-deep px-4 py-1.5 text-center text-[13px] text-ink-faint">
                {voice.interim}
              </p>
            )}
            {voice.error && (
              <p
                role="alert"
                className="truncate rounded-full bg-flag-wash px-4 py-1.5 text-center text-[13px] text-flag"
              >
                {t(VOICE_ERROR_KEY[voice.error])}
              </p>
            )}
            {error && (
              <Notice
                tone="alert"
                text={t(error.code === "ActivityFinished" ? "dlg_err_finished" : "dlg_error")}
                action={error.code !== "ActivityFinished" ? { label: t("dlg_retry"), onClick: retryLast } : undefined}
              />
            )}
            {ttsFailed && !error && (
              <Notice tone="alert" text={t("dlg_tts_failed")} action={{ label: t("dlg_replay"), onClick: replay }} />
            )}
            {ttsSkipped && !ttsFailed && !error && (
              <Notice text={t("dlg_tts_skipped")} action={{ label: t("dlg_replay"), onClick: replay }} />
            )}
            {closedNotice ? (
              <Notice text={closedNotice} />
            ) : !ready ? (
              <Notice text={connectGraceOver ? t("dlg_offline") : t("dlg_connecting")} />
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label={t("dlg_hold_to_talk")}
                  title={t("dlg_hold_to_talk")}
                  disabled={awaitingReply || !viewReady}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    void voice.start();
                  }}
                  onPointerUp={() => void voice.stop()}
                  onPointerCancel={() => void voice.stop()}
                  onPointerLeave={() => voice.state === "listening" && void voice.stop()}
                  onKeyDown={(event) => {
                    if (event.key === " " || event.key === "Enter") {
                      event.preventDefault();
                      void voice.start();
                    }
                  }}
                  onKeyUp={() => voice.state === "listening" && void voice.stop()}
                  onBlur={() => voice.state === "listening" && void voice.stop()}
                  style={{ touchAction: "none" }}
                  className={cn(
                    "flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors disabled:opacity-50",
                    voice.state === "listening"
                      ? "border-ember bg-ember text-on-ember"
                      : "border-line-strong bg-paper-deep text-ink-soft hover:border-ember-deep hover:text-ink",
                  )}
                >
                  <Mic className="size-4" />
                </button>
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={text}
                  aria-label={t("dlg_input_placeholder")}
                  placeholder={t("dlg_input_placeholder")}
                  disabled={!viewReady}
                  maxLength={2000}
                  onChange={(event) => setText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                    if (event.key === "Enter" && !event.shiftKey) {
                      event.preventDefault();
                      submitText();
                    }
                  }}
                  className="block max-h-[160px] min-h-10 min-w-0 flex-1 resize-none rounded-[20px] border border-line-strong bg-paper-deep px-4 py-2 text-sm leading-6 text-ink outline-none placeholder:text-ink-faint focus:border-ink"
                />
                {awaitingReply ? (
                  <button
                    type="button"
                    onClick={interrupt}
                    aria-label={t("dlg_tap_to_interrupt")}
                    className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-ink text-paper"
                  >
                    <Square className="size-3.5" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={submitText}
                    disabled={!text.trim() || !viewReady}
                    aria-label={t("common_send")}
                    className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-ink text-paper transition-colors hover:bg-ember hover:text-on-ember disabled:opacity-50"
                  >
                    <Send className="size-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        </footer>
      </section>

      <TermPanel ref={panelRef} open={panelOpen} onClose={() => setPanelOpen(false)} />
    </div>
  );
}

function Notice({
  text,
  tone,
  action,
}: {
  text: ReactNode;
  tone?: "alert";
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div
      role={tone === "alert" ? "alert" : "status"}
      className="flex items-center gap-2 rounded-xl border border-line bg-card px-3 py-2 text-[13px] text-ink-soft"
    >
      <span className="min-w-0 flex-1">{text}</span>
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="shrink-0 cursor-pointer rounded-full border border-line-strong px-2.5 py-1 text-[12.5px] text-ember transition-colors hover:border-ember"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}

function Turn({ speaker, text, caret }: { speaker: "user" | "assistant"; text: string; caret?: boolean }) {
  const t = useT();
  const mine = speaker === "user";
  return (
    <div className={cn("anim-rise flex items-start gap-3", mine && "flex-row-reverse")}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-paper-deep font-serif text-sm text-ember">
        {mine ? t("bubble_me") : t("bubble_socrates")}
      </span>
      <p
        className={cn(
          "max-w-[min(80%,56rem)] whitespace-pre-wrap rounded-2xl border border-line px-4 py-2.5 font-serif text-[14.5px] leading-7 text-ink",
          mine ? "bg-ember-wash" : "bg-paper-deep",
          caret && "caret",
        )}
      >
        {text}
      </p>
    </div>
  );
}

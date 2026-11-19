import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Keyboard, MessageCircleQuestionMark, Mic, Send, Square, TextSearch } from "lucide-react";
import { BtwPanel, type BtwPanelHandle } from "@/components/BtwPanel";
import { SidebarToggle, useSidebarOverlay } from "@/components/ChatLayout";
import { SocratesWindow } from "@/components/SocratesCompanion";
import { TermPanel, type TermPanelHandle } from "@/components/TermPanel";
import { cn } from "@/components/ui";
import { textOf, useDialogue } from "@/hooks/useDialogue";
import { useSelectionPopover } from "@/hooks/useSelectionPopover";
import { useElapsed } from "@/hooks/useSubscription";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useT, type MessageKey } from "@/i18n";
import type { Message } from "@earendil-works/pi-ai";

const VOICE_ERROR_KEY: Record<"denied" | "unsupported" | "failed", MessageKey> = {
  denied: "voice_denied",
  unsupported: "voice_unsupported",
  failed: "voice_failed",
};

const onAmplitudeNoop = () => {};

const BTW_COMMAND = /^\/btw(?:\s+([\s\S]*))?$/i;

type SidePanel = "term" | "btw" | null;

const VEIL_MASK = "linear-gradient(to bottom, transparent, black 5rem)";

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
  } = useDialogue(threadId, userId, {
    autoSend,
    onAutoSent,
    onActivityFinished,
    onDisconnect: () => void voice.stop(),
  });

  const [sidePanel, setSidePanel] = useState<SidePanel>(null);
  const panelOpen = sidePanel === "term";
  const setPanelOpen = (open: boolean) => setSidePanel(open ? "term" : null);
  const togglePanel = (panel: Exclude<SidePanel, null>) =>
    setSidePanel((current) => (current === panel ? null : panel));
  const btwRef = useRef<BtwPanelHandle>(null);
  const connectGraceOver = useElapsed(3000);
  const panelRef = useRef<TermPanelHandle>(null);

  const lastTerm = useRef<string | null>(null);
  useLayoutEffect(() => {
    if (openTerm === null || openTerm === undefined) {
      lastTerm.current = null;
      return;
    }
    if (openTerm === lastTerm.current) return;
    lastTerm.current = openTerm;
    setSidePanel("term");
    panelRef.current?.openTerm(openTerm);
    onTermOpened?.();
  }, [openTerm, onTermOpened]);

  const hasEntries = items.some((item) => item.kind === "entry");
  const submit = useCallback(
    (value: string) => {
      const sent = send(value.slice(0, 2000));
      if (sent && !hasEntries) onFirstSend?.(value);
      return sent;
    },
    [send, hasEntries, onFirstSend],
  );

  const onVoiceFinal = useCallback((text: string) => void submit(text), [submit]);
  const voice = useVoiceInput(onVoiceFinal, onAmplitudeNoop);

  const [voiceMode, setVoiceMode] = useState(false);
  const sidebarOverlay = useSidebarOverlay();
  const modeSwitched = useRef(false);
  const attachHold = useCallback((node: HTMLButtonElement | null) => {
    if (!modeSwitched.current || !node) return;
    modeSwitched.current = false;
    node.focus();
  }, []);

  const voiceOverlay = voiceMode && ready && !closedNotice;
  const footerRef = useRef<HTMLElement>(null);
  const [overlayHeight, setOverlayHeight] = useState(0);
  useLayoutEffect(() => {
    const element = footerRef.current;
    if (!voiceOverlay || !element) {
      setOverlayHeight(0);
      return;
    }
    const measure = () => setOverlayHeight(element.offsetHeight);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [voiceOverlay]);

  function switchMode(next: boolean) {
    modeSwitched.current = true;
    if (!next && voice.state === "listening") void voice.stop();
    setVoiceMode(next);
  }

  const [text, setText] = useState("");
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachInput = useCallback((node: HTMLTextAreaElement | null) => {
    inputRef.current = node;
    if (!modeSwitched.current || !node) return;
    modeSwitched.current = false;
    node.focus();
  }, []);
  const scrollRef = useRef<HTMLDivElement>(null);
  const pinnedRef = useRef(true);
  const { selection, clear: clearSelection } = useSelectionPopover(scrollRef);

  function lookupSelection() {
    if (!selection) return;
    setPanelOpen(true);
    panelRef.current?.openTerm(selection.text);
    clearSelection();
  }

  useLayoutEffect(() => {
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
    const command = BTW_COMMAND.exec(text.trim());
    if (command) {
      setSidePanel("btw");
      const question = command[1]?.trim();
      if (question) btwRef.current?.ask(question);
      setText("");
      return;
    }
    if (!text.trim() || awaitingReply || !viewReady) return;
    if (submit(text)) setText("");
  }

  const showIntro = !hasEntries && !draft;

  return (
    <div className="flex min-h-0 flex-1">
      <section className="relative flex min-h-0 min-w-0 flex-1 flex-col">
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
            onClick={() => togglePanel("btw")}
            aria-pressed={sidePanel === "btw"}
            title={t("btw_slash_hint")}
            className={cn(
              "flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors",
              sidePanel === "btw"
                ? "border-ember bg-ember-wash text-ember"
                : "border-line-strong text-ink-soft hover:border-ember-deep hover:text-ink",
            )}
          >
            <MessageCircleQuestionMark className="size-3.5" />
            <span className="hidden sm:inline">{t("btw_panel")}</span>
          </button>
          <button
            type="button"
            onClick={() => togglePanel("term")}
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

        <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
          <SocratesWindow bottomInset={overlayHeight} />
          <div
            ref={scrollRef}
            onScroll={onScroll}
            className={cn("stream-scroll min-h-0 flex-1 overflow-y-auto px-4 md:px-8")}
            style={overlayHeight ? { paddingBottom: overlayHeight } : undefined}
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

        <footer
          ref={footerRef}
          className={cn(
            "px-4 pb-4 md:px-8",
            voiceOverlay ? "absolute inset-x-0 bottom-0 pt-20" : "shrink-0 border-t border-line pt-3",
          )}
        >
          {voiceOverlay && (
            <div
              aria-hidden
              className="absolute inset-0 bg-paper/70 backdrop-blur-xl"
              style={{ maskImage: VEIL_MASK, WebkitMaskImage: VEIL_MASK }}
            />
          )}
          <div className="relative flex w-full flex-col gap-2">
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
            {text.trimStart().startsWith("/") && !closedNotice && ready && (
              <p className="truncate px-4 text-[12.5px] text-ink-faint">{t("btw_slash_hint")}</p>
            )}
            {closedNotice ? (
              <Notice text={closedNotice} />
            ) : !ready ? (
              <Notice text={connectGraceOver ? t("dlg_offline") : t("dlg_connecting")} />
            ) : voiceMode ? (
              <div className="flex flex-col items-center">
                <div
                  className={cn(
                    "relative grid w-full grid-cols-[1fr_auto_1fr] items-center gap-3 pt-2",
                    !sidebarOverlay && "z-[1]",
                  )}
                >
                  <button
                    type="button"
                    onClick={() => switchMode(false)}
                    aria-label={t("dlg_text_mode")}
                    title={t("dlg_text_mode")}
                    className="flex size-10 shrink-0 cursor-pointer items-center justify-center justify-self-end rounded-full border border-line-strong bg-paper-deep text-ink-soft transition-colors hover:border-ember-deep hover:text-ink"
                  >
                    <Keyboard className="size-4" />
                  </button>
                  <button
                    ref={attachHold}
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
                      "flex size-14 shrink-0 cursor-pointer items-center justify-center rounded-full border transition-colors disabled:opacity-50",
                      voice.state === "listening"
                        ? "border-ember bg-ember text-on-ember"
                        : "border-line-strong bg-paper-deep text-ink-soft hover:border-ember-deep hover:text-ink",
                    )}
                  >
                    <Mic className="size-5" />
                  </button>
                  {awaitingReply ? (
                    <button
                      type="button"
                      onClick={interrupt}
                      aria-label={t("dlg_tap_to_interrupt")}
                      title={t("dlg_tap_to_interrupt")}
                      className="flex size-10 shrink-0 cursor-pointer items-center justify-center justify-self-start rounded-full bg-ink text-paper"
                    >
                      <Square className="size-3.5" />
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
                <p className={cn("relative pt-1 text-[12px] text-ink-faint", !sidebarOverlay && "z-[1]")}>
                  {voice.state === "listening" ? t("dlg_listening") : t("dlg_hold_to_talk")}
                </p>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => switchMode(true)}
                  aria-label={t("dlg_voice_mode")}
                  title={t("dlg_voice_mode")}
                  disabled={!viewReady}
                  className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-paper-deep text-ink-soft transition-colors hover:border-ember-deep hover:text-ink disabled:opacity-50"
                >
                  <Mic className="size-4" />
                </button>
                <textarea
                  ref={attachInput}
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
                    disabled={!text.trim() || (!viewReady && !BTW_COMMAND.test(text.trim()))}
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
      <BtwPanel
        ref={btwRef}
        open={sidePanel === "btw"}
        onClose={() => setSidePanel(null)}
        activityId={threadId}
        participantId={userId}
      />
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
      <div
        className={cn(
          "whitespace-pre-wrap font-serif text-[14.5px] leading-7 text-ink",
          mine
            ? "max-w-[min(80%,56rem)] rounded-2xl border border-line bg-ember-wash px-4 py-2.5"
            : "min-w-0 max-w-[56rem] flex-1 pt-0.5",
          caret && "caret",
        )}
      >
        {text}
      </div>
    </div>
  );
}

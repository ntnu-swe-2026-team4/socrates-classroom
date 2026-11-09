import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp, Mic, PanelLeftClose, PanelLeftOpen, Send, TextSearch } from "lucide-react";
import { TermPanel, type TermPanelHandle } from "@/components/TermPanel";
import { SocratesStage, type SocratesExpression, type SocratesHandle } from "@/components/SocratesStage";
import { TopBar, cn } from "@/components/ui";
import { useDialogue } from "@/hooks/useDialogue";
import { usePersistentFlag } from "@/hooks/usePersistentFlag";
import { useSelectionPopover } from "@/hooks/useSelectionPopover";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { useT, type MessageKey } from "@/i18n";

const VOICE_ERROR_KEY: Record<"denied" | "unsupported" | "failed", MessageKey> = {
  denied: "voice_denied",
  unsupported: "voice_unsupported",
  failed: "voice_failed",
};

const onAmplitudeNoop = () => {};

export interface DialogueViewProps {
  activityId: string;
  userId: string;
  eyebrow: string;
  title: string;
  statement?: string;
  prompts?: string[];
  autoSend?: string;
  onAutoSent?: () => void;
  openTerm?: string;
  onTermOpened?: () => void;
  headerActions?: ReactNode;
  closedNotice?: ReactNode;
}

export function DialogueView({
  activityId,
  userId,
  eyebrow,
  title,
  statement,
  prompts = [],
  autoSend,
  onAutoSent,
  openTerm,
  onTermOpened,
  headerActions,
  closedNotice,
}: DialogueViewProps) {
  const t = useT();
  const { messages, draft, phase, error, emotion, ttsFailed, send, retryLast, replay, interrupt } = useDialogue(
    activityId,
    userId,
  );

  const stageRef = useRef<SocratesHandle>(null);
  const [socratesOpen, setSocratesOpen] = usePersistentFlag("socrates_dialogue_panel", true);
  const appliedExpressionRef = useRef<string | null>(null);
  useEffect(() => {
    const transient = phase === "thinking" || phase === "streaming";
    const key = transient ? "__thinking" : (emotion?.emotion ?? "neutral");
    if (appliedExpressionRef.current === key) return;
    appliedExpressionRef.current = key;
    if (transient) {
      stageRef.current?.setExpression("Confused", { loop: true });
      return;
    }
    const map: Record<string, SocratesExpression> = { happy: "Happy", angry: "Angry", confused: "Confused" };
    const name = emotion ? map[emotion.emotion] : undefined;
    stageRef.current?.setExpression(name ?? null, name === undefined ? undefined : { loop: true });
  }, [phase, emotion]);

  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<TermPanelHandle>(null);

  const autoSent = useRef(false);
  const termHandled = useRef(false);
  useEffect(() => {
    if (openTerm && !termHandled.current) {
      termHandled.current = true;
      setPanelOpen(true);
      panelRef.current?.openTerm(openTerm);
      onTermOpened?.();
    }
  }, [openTerm, onTermOpened]);
  useEffect(() => {
    if (autoSend && !autoSent.current && phase === "idle") {
      autoSent.current = true;
      void send(autoSend);
      onAutoSent?.();
    }
  }, [autoSend, phase, send, onAutoSent]);

  const onVoiceFinal = useCallback((text: string) => void send(text), [send]);
  const voice = useVoiceInput(onVoiceFinal, onAmplitudeNoop);

  const [text, setText] = useState("");
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

  function onScroll() {
    const element = scrollRef.current;
    if (!element) return;
    pinnedRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
  }

  const streaming = phase === "streaming";
  const busy = phase !== "idle";
  const status =
    voice.state === "listening"
      ? t("dlg_listening")
      : phase === "thinking"
        ? t("dlg_thinking")
        : phase === "speaking"
          ? t("dlg_speaking")
          : "";

  function submitText() {
    if (!text.trim() || busy) return;
    if (send(text)) setText("");
  }

  return (
    <div className="flex h-dvh min-h-0 flex-col">
      <TopBar
        eyebrow={eyebrow}
        title={title}
        actions={
          <>
            {headerActions}
            {busy && (
              <button
                type="button"
                onClick={interrupt}
                className="h-8 cursor-pointer rounded-full px-3 text-xs text-ink-soft hover:bg-paper-deep hover:text-ink"
              >
                {t("dlg_tap_to_interrupt")}
              </button>
            )}
            <button
              type="button"
              onClick={() => setPanelOpen((v) => !v)}
              aria-pressed={panelOpen}
              title={t("term_panel")}
              className={cn(
                "flex h-8 cursor-pointer items-center gap-1.5 rounded-full border px-3 text-xs transition-colors",
                panelOpen
                  ? "border-ember bg-ember-wash text-ember"
                  : "border-line-strong bg-paper-deep text-ink-soft hover:border-ember-deep hover:text-ink",
              )}
            >
              <TextSearch className="size-3.5" />
              {t("term_panel")}
            </button>
          </>
        }
      />

      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          {socratesOpen && (
            <section className="flex shrink-0 flex-col border-b border-line md:min-h-0 md:w-[320px] md:border-r md:border-b-0 lg:w-[360px]">
              <div className="flex h-11 shrink-0 items-center justify-between border-b border-line pr-2 pl-4 text-[13px] text-ink-soft">
                <span className="flex min-w-0 items-center gap-2">
                  {t("dlg_socrates")}
                  {status && <span className="state-shimmer truncate text-[12px] md:hidden">{status}</span>}
                </span>
                <button
                  type="button"
                  onClick={() => setSocratesOpen(false)}
                  aria-label={t("panel_collapse")}
                  title={t("panel_collapse")}
                  className="flex size-8 cursor-pointer items-center justify-center rounded-lg text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
                >
                  <PanelLeftClose className="hidden size-[17px] md:block" />
                  <ChevronUp className="size-[17px] md:hidden" />
                </button>
              </div>
              <div className="flex flex-col items-center justify-center md:min-h-0 md:flex-1 md:gap-3 md:px-4 md:py-6">
                <div className="relative aspect-square h-36 md:h-auto md:w-full md:max-w-[340px]">
                  <SocratesStage ref={stageRef} speaking={phase === "speaking"} className="absolute inset-0" />
                </div>
                <p className="hidden h-5 text-center text-[12.5px] text-ink-faint md:block">
                  {status ? <span className="state-shimmer">{status}</span> : t("dlg_opening_hint")}
                </p>
              </div>
            </section>
          )}

          <section className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              className={cn(
                "h-11 shrink-0 items-center justify-between gap-2 border-b border-line px-4 text-[13px] text-ink-soft",
                socratesOpen ? "hidden md:flex" : "flex",
              )}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                {!socratesOpen && (
                  <button
                    type="button"
                    onClick={() => setSocratesOpen(true)}
                    aria-label={t("panel_expand")}
                    title={t("panel_expand")}
                    className="-ml-2 flex h-8 cursor-pointer items-center gap-1.5 rounded-lg px-2 text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
                  >
                    <PanelLeftOpen className="hidden size-[17px] md:block" />
                    <ChevronDown className="size-[17px] md:hidden" />
                    <span>{t("dlg_socrates")}</span>
                  </button>
                )}
                <span className={cn(!socratesOpen && "hidden sm:inline")}>{t("dlg_title")}</span>
              </span>
              {status && !socratesOpen && <span className="state-shimmer text-[12px]">{status}</span>}
            </div>

            <div
              ref={scrollRef}
              onScroll={onScroll}
              className="stream-scroll min-h-0 flex-1 overflow-y-auto px-4 sm:px-6"
              aria-busy={busy}
            >
              <div className="mx-auto flex max-w-3xl flex-col gap-4 py-5">
                {messages.length === 0 && statement && (
                  <>
                    <Bubble speaker="assistant" text={statement} />
                    <div className="flex flex-wrap gap-2 pl-11">
                      {prompts.map((prompt) => (
                        <button
                          type="button"
                          key={prompt}
                          disabled={busy}
                          onClick={() => void send(prompt)}
                          className="cursor-pointer rounded-full border border-line-strong px-4 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-ember hover:text-ink disabled:opacity-50"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  </>
                )}
                {messages.map((message) => (
                  <Bubble key={message.id} speaker={message.role} text={message.text} />
                ))}
                <div aria-live="polite">{draft && <Bubble speaker="assistant" text={draft} caret={streaming} />}</div>
              </div>
            </div>

            {selection && (
              <button
                type="button"
                onClick={lookupSelection}
                className="fixed z-50 -translate-x-1/2 -translate-y-full cursor-pointer rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] text-paper shadow-sm"
                style={{ left: selection.x, top: selection.y - 8 }}
              >
                {t("term_lookup")}「
                <span className="inline-block max-w-52 truncate align-middle">{selection.text}</span>」
              </button>
            )}

            <footer className="shrink-0 border-t border-line px-4 pt-3 pb-4 sm:px-6">
              <div className="mx-auto flex max-w-3xl flex-col gap-2">
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
                  <div
                    role="alert"
                    className="flex items-center gap-2 rounded-2xl border border-line bg-card px-4 py-2 text-[13px] text-ink-soft"
                  >
                    <span className="min-w-0 flex-1 truncate">{t(error.code === "ActivityFinished" ? "dlg_err_finished" : "dlg_error")}</span>
                    <button
                      type="button"
                      onClick={retryLast}
                      className="shrink-0 cursor-pointer rounded-full border border-line-strong px-3 py-1 text-[12.5px] text-ember transition-colors hover:border-ember"
                    >
                      {t("dlg_retry")}
                    </button>
                  </div>
                )}
                {ttsFailed && !error && (
                  <div
                    role="alert"
                    className="flex items-center gap-2 rounded-2xl border border-line bg-card px-4 py-2 text-[13px] text-ink-soft"
                  >
                    <span className="min-w-0 flex-1 truncate">{t("dlg_tts_failed")}</span>
                    <button
                      type="button"
                      onClick={replay}
                      className="shrink-0 cursor-pointer rounded-full border border-line-strong px-3 py-1 text-[12.5px] text-ember transition-colors hover:border-ember"
                    >
                      {t("dlg_replay")}
                    </button>
                  </div>
                )}
                {closedNotice ? (
                  <div className="rounded-2xl border border-line bg-card px-4 py-3 text-center text-[13px] text-ink-soft">
                    {closedNotice}
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      aria-label={t("dlg_hold_to_talk")}
                      title={t("dlg_hold_to_talk")}
                      disabled={busy}
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
                    <input
                      value={text}
                      aria-label={t("dlg_input_placeholder")}
                      placeholder={t("dlg_input_placeholder")}
                      onChange={(event) => setText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                        if (event.key === "Enter") submitText();
                      }}
                      className="h-10 min-w-0 flex-1 rounded-full border border-line-strong bg-paper-deep px-4 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ember"
                    />
                    <button
                      type="button"
                      onClick={submitText}
                      disabled={!text.trim() || busy}
                      aria-label={t("common_send")}
                      className="flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-ember text-on-ember transition hover:brightness-110 disabled:opacity-50"
                    >
                      <Send className="size-4" />
                    </button>
                  </div>
                )}
              </div>
            </footer>
          </section>
        </div>

        <TermPanel ref={panelRef} open={panelOpen} onClose={() => setPanelOpen(false)} />
      </div>
    </div>
  );
}

function Bubble({ speaker, text, caret }: { speaker: "user" | "assistant"; text: string; caret?: boolean }) {
  const t = useT();
  const mine = speaker === "user";
  return (
    <div className={cn("anim-rise flex items-start gap-3", mine && "flex-row-reverse")}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-paper-deep font-serif text-sm text-ember">
        {mine ? t("bubble_me") : t("bubble_socrates")}
      </span>
      <p
        className={cn(
          "max-w-[80%] whitespace-pre-wrap rounded-2xl border border-line px-4 py-2.5 font-serif text-[14.5px] leading-7 text-ink",
          mine ? "bg-ember-wash" : "bg-paper-deep",
          caret && "caret",
        )}
      >
        {text}
      </p>
    </div>
  );
}

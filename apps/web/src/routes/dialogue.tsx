import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AmbientGlow } from "@/components/AmbientGlow";
import { TermPanel, type TermPanelHandle } from "@/components/TermPanel";
import { useSelectionPopover } from "@/hooks/useSelectionPopover";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { TextSearch } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { readActivityId } from "@/api/local";
import { SocratesStage, type SocratesHandle } from "@/components/SocratesStage";
import { useDialogue } from "@/hooks/useDialogue";
import { useVoiceInput } from "@/hooks/useVoiceInput";
import { cn } from "@/components/ui";
import { useT, type MessageKey } from "@/i18n";

const VOICE_ERROR_KEY: Record<"denied" | "unsupported" | "failed", MessageKey> = {
  denied: "voice_denied",
  unsupported: "voice_unsupported",
  failed: "voice_failed",
};

const onAmplitudeNoop = () => {};

export const Route = createFileRoute("/dialogue")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { activityId?: string; topic?: string; q?: string; term?: string } => ({
    activityId: typeof search.activityId === "string" ? search.activityId : undefined,
    topic: typeof search.topic === "string" ? search.topic : undefined,
    q: typeof search.q === "string" ? search.q : undefined,
    term: typeof search.term === "string" ? search.term : undefined,
  }),
  beforeLoad: async ({ search, context }) => {
    const me = await context.queryClient.fetchQuery({
      queryKey: ["me"],
      queryFn: () => api.me(),
      staleTime: Infinity,
    });
    if (me?.role === "teacher") throw redirect({ to: "/t/setup" });
    if (!me && !(search.activityId || readActivityId())) throw redirect({ to: "/join" });
  },
  component: DialoguePage,
});

function DialoguePage() {
  const me = useQuery({ queryKey: ["me"], queryFn: () => api.me(), staleTime: Infinity });
  if (!me.data) return <div className="h-dvh" aria-busy="true" />;
  return <DialogueBody userId={me.data.id} />;
}

function DialogueBody({ userId }: { userId: string }) {
  const t = useT();
  const { activityId: activityParam, topic: topicId, q, term } = Route.useSearch();
  const activityId = activityParam ?? readActivityId() ?? "";
  const topicQuery = useQuery({
    queryKey: ["topics"],
    queryFn: () => api.listTopics(),
    staleTime: Infinity,
  });
  const topic = useMemo(
    () => topicQuery.data?.find((item) => item.id === topicId) ?? topicQuery.data?.[0],
    [topicQuery.data, topicId],
  );

  const { messages, draft, phase, error, send, retryLast, interrupt } = useDialogue(activityId, userId);

  const stageRef = useRef<SocratesHandle>(null);
  useEffect(() => {
    if (phase === "thinking") stageRef.current?.setExpression("Confused", { loop: true });
    else stageRef.current?.setExpression(null);
  }, [phase]);

  const [panelOpen, setPanelOpen] = useState(false);
  const panelRef = useRef<TermPanelHandle>(null);
  const navigate = useNavigate();

  const sentFromHome = useRef(false);
  const termHandled = useRef(false);
  useEffect(() => {
    if (term && !termHandled.current) {
      termHandled.current = true;
      setPanelOpen(true);
      panelRef.current?.openTerm(term);
      void navigate({ to: "/dialogue", search: (prev) => ({ ...prev, term: undefined }), replace: true });
    }
  }, [term, navigate]);
  useEffect(() => {
    if (q && !sentFromHome.current && phase === "idle") {
      sentFromHome.current = true;
      void send(q);
      void navigate({ to: "/dialogue", search: (prev) => ({ ...prev, q: undefined }), replace: true });
    }
  }, [q, phase, send, navigate]);

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

  return (
    <div className="relative mx-auto flex h-dvh w-full flex-row">
      <div className="relative mx-auto flex h-full w-full max-w-3xl flex-col px-4 sm:px-6">
        {!panelOpen && (
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            aria-label={t("term_panel")}
            title={t("term_panel")}
            className="absolute top-3 right-4 z-20 flex h-8 w-8 items-center justify-center rounded-full border border-line bg-paper/80 text-ink-faint backdrop-blur transition-colors hover:border-ink-faint hover:text-ink sm:right-6"
          >
            <TextSearch size={16} strokeWidth={1.5} />
          </button>
        )}
        <header className="flex items-center py-3 pl-12 md:pl-0">
          <div className="min-w-0">
            <p className="truncate font-serif text-[17px] font-semibold text-ink">{topic?.title ?? t("dlg_title")}</p>
            <p className="truncate text-[12px] text-ink-faint">{topic?.statement}</p>
          </div>
          <button
            type="button"
            onClick={interrupt}
            aria-label={t("dlg_tap_to_interrupt")}
            className="rounded-full px-3 py-1 text-[12px] text-ink-faint transition-colors hover:bg-paper-deep hover:text-ink"
          >
            {busy ? t("dlg_tap_to_interrupt") : ""}
          </button>
        </header>

        {messages.length === 0 && <AmbientGlow />}

        <div className="relative z-10 mx-auto flex w-full max-w-sm shrink-0 flex-col pb-2">
          <div className="relative aspect-[5/4] w-full">
            <SocratesStage ref={stageRef} speaking={phase === "speaking"} className="absolute inset-0" />
          </div>
          <p className="mt-1 h-5 text-center text-[12.5px] text-ink-faint">
            {voice.state === "listening" && <span className="state-shimmer">{t("dlg_listening")}</span>}
            {phase === "thinking" && <span className="state-shimmer">{t("dlg_thinking")}</span>}
            {phase === "speaking" && <span className="state-shimmer">{t("dlg_speaking")}</span>}
          </p>
        </div>

        <div
          ref={scrollRef}
          onScroll={onScroll}
          className="stream-scroll relative z-10 min-h-0 flex-1 overflow-y-auto"
          aria-busy={busy}
        >
          <div className="flex flex-col gap-5 py-4">
            {messages.map((message) => (
              <Bubble key={message.id} speaker={message.role} text={message.text} />
            ))}
            {messages.length === 0 && topic && (
              <div className="flex flex-col items-center gap-6 py-12 text-center">
                <p className="max-w-md font-serif text-xl font-medium leading-[1.8] text-ink">{topic.statement}</p>
                <div className="flex flex-wrap justify-center gap-2">
                  {topic.prompts.map((prompt) => (
                    <button
                      type="button"
                      key={prompt}
                      onClick={() => void send(prompt)}
                      className="rounded-full border border-line bg-card px-4 py-2 text-[13.5px] text-ink-soft transition-colors hover:border-ember hover:text-ember"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
                <p className="text-[12.5px] text-ink-faint">{t("dlg_opening_hint")}</p>
              </div>
            )}
            {draft && <Bubble speaker="assistant" text={draft} caret={streaming} />}
          </div>
        </div>

        {selection && (
          <button
            type="button"
            onClick={lookupSelection}
            className="fixed z-50 -translate-x-1/2 -translate-y-full rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] text-paper shadow-sm"
            style={{ left: selection.x, top: selection.y - 8 }}
          >
            {t("term_lookup")}「<span className="inline-block max-w-52 truncate align-middle">{selection.text}</span>」
          </button>
        )}

        {voice.interim && (
          <p className="mx-auto max-w-full truncate rounded-full bg-paper-deep px-4 py-1.5 text-center text-[13px] text-ink-faint">
            {voice.interim}
          </p>
        )}

        {voice.error && (
          <p className="mx-auto max-w-full truncate rounded-full bg-paper-deep px-4 py-1.5 text-center text-[13px] text-ember">
            {t(VOICE_ERROR_KEY[voice.error])}
          </p>
        )}

        {error && (
          <div className="mx-auto flex items-center gap-2 rounded-xl border border-line bg-card px-4 py-2 text-[13px] text-ink-soft">
            <span className="min-w-0 flex-1 truncate">{t("dlg_error")}</span>
            <button
              type="button"
              onClick={retryLast}
              className="shrink-0 rounded-full border border-line px-3 py-1 text-[12.5px] text-ember transition-colors hover:border-ember"
            >
              {t("dlg_retry")}
            </button>
          </div>
        )}

        <footer className="sticky bottom-0 z-10 bg-gradient-to-t from-paper via-paper to-transparent pb-4 pt-2">
          <div className="flex items-center gap-2 rounded-full border border-line bg-card p-1.5 pl-5 shadow-sm">
            <input
              value={text}
              placeholder={t("dlg_input_placeholder")}
              onChange={(event) => setText(event.target.value)}
              onKeyDown={(event) => {
                if (event.nativeEvent.isComposing || event.keyCode === 229) return;
                if (event.key === "Enter" && text.trim() && !busy) {
                  void send(text);
                  setText("");
                }
              }}
              className="h-10 min-w-0 flex-1 bg-transparent text-[15px] text-ink placeholder:text-ink-faint focus:outline-none"
            />
            <button
              type="button"
              aria-label={t("dlg_hold_to_talk")}
              disabled={busy}
              onPointerDown={(event) => {
                event.preventDefault();
                void voice.start();
              }}
              onPointerUp={() => void voice.stop()}
              onPointerLeave={() => voice.state === "listening" && void voice.stop()}
              style={{ touchAction: "none" }}
              className={cn(
                "flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-colors",
                voice.state === "listening" ? "bg-ember" : "bg-ember/90 hover:bg-ember-deep",
                busy && "opacity-45",
              )}
            >
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                className="h-5 w-5 fill-none stroke-paper stroke-[2]"
                strokeLinecap="round"
              >
                <rect x="9" y="3" width="6" height="11" rx="3" />
                <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
              </svg>
            </button>
            {text.trim() && !busy && (
              <button
                type="button"
                onClick={() => {
                  void send(text);
                  setText("");
                }}
                aria-label={t("common_send")}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-ink text-paper transition-colors hover:bg-ink-soft"
              >
                <svg
                  aria-hidden
                  viewBox="0 0 24 24"
                  className="h-5 w-5 fill-none stroke-paper stroke-[2]"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M4 12h15M13 6l6 6-6 6" />
                </svg>
              </button>
            )}
          </div>
        </footer>
      </div>

      <TermPanel ref={panelRef} open={panelOpen} onClose={() => setPanelOpen(false)} />
    </div>
  );
}

function Bubble({ speaker, text, caret }: { speaker: "user" | "assistant"; text: string; caret?: boolean }) {
  if (speaker === "user") {
    return (
      <div className="flex justify-end anim-rise">
        <p className="max-w-[78%] rounded-2xl rounded-br-md bg-ember-wash px-4 py-2.5 text-[15px] leading-[1.8] text-ink">
          {text}
        </p>
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3 anim-rise">
      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-ember" aria-hidden />
      <p className={cn("max-w-[88%] whitespace-pre-wrap text-[15.5px] leading-[1.9] text-ink", caret && "caret")}>
        {text}
      </p>
    </div>
  );
}

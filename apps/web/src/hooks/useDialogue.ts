import { useCallback, useMemo, useRef, useState, useSyncExternalStore, useLayoutEffect } from "react";
import { useAgent } from "agents/react";
import { markIntent, speak, stopSpeech } from "@/lib/speech";
import { applyImmutable } from "@earendil-works/chord/delta";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Message } from "@earendil-works/pi-ai";
import { companion } from "@/lib/companion";
import { useOnUnmount } from "@/hooks/useSubscription";
import {
  ConversationTranscript,
  type ConversationView,
  type Cursor,
  type EntryId,
  type EntryRecord,
  type Page,
  type TranscriptItem,
  type TranscriptView,
} from "@earendil-works/pi-durable";
import type { ClientMessage, ServerMessage } from "@server/ws/protocol";

export type DialoguePhase = "idle" | "thinking" | "streaming" | "speaking";
export type DialogueError = { code: string } | null;
export type DialogueEmotion = {
  emotion: string;
  confidence: number;
  probabilities: Record<string, number>;
} | null;

export interface DialogueMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
}

export function textOf(message: Message | undefined): string {
  if (!message) return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function lastAssistantText(view: ConversationView | null): string {
  if (!view) return "";
  for (const entry of [...view.entries].reverse()) {
    if (entry.kind !== "pi.assistant" || intermediateAssistant(entry)) continue;
    const text = textOf(entry.model?.[0]);
    return text;
  }
  return "";
}

export interface WindowedEntry {
  id: number;
  kind: string;
  model?: readonly unknown[];
}

const ANSWER_STOP_REASONS = new Set(["stop", "length"]);

export function intermediateAssistant(entry: WindowedEntry): boolean {
  const message = entry.model?.[0] as { stopReason?: string; content?: readonly { type?: string }[] } | undefined;
  if (message?.stopReason === undefined) return false;
  if (ANSWER_STOP_REASONS.has(message.stopReason)) return false;
  // pi answers a toolUse message that carries no tool calls (malformed provider output ends the run)
  if (message.stopReason === "toolUse" && !(message.content ?? []).some((part) => part.type === "toolCall")) {
    return false;
  }
  return true;
}

export function answered(entries: readonly WindowedEntry[]): boolean {
  return entries.some(
    (entry) =>
      entry.kind === "pi.assistant" &&
      !intermediateAssistant(entry) &&
      textOf(entry.model?.[0] as Message | undefined).trim() !== "",
  );
}

export function runFailureOf(view: ConversationView | null): unknown {
  const live = view?.docs["pi.live"] as { runFailure?: unknown } | undefined;
  return live?.runFailure;
}

function latestEmotionOf(view: ConversationView | null): { id: EntryId; data: DialogueEmotion } | null {
  if (!view) return null;
  for (const entry of [...view.entries].reverse()) {
    if (entry.kind !== "app.emotion") continue;
    return { id: entry.id, data: (entry.data ?? null) as DialogueEmotion };
  }
  return null;
}

export interface DialogueOptions {
  autoSend?: string;
  onAutoSent?: () => void;
  onActivityFinished?: () => void;
  onDisconnect?: () => void;
}

const EXPRESSIONS: Record<string, "Happy" | "Angry" | "Confused"> = {
  happy: "Happy",
  angry: "Angry",
  confused: "Confused",
};

export function liveTextOf(view: ConversationView | null): string {
  if (!view) return "";
  const live = view.docs["pi.live"] as { generation?: { message?: { content?: readonly unknown[] } } } | undefined;
  const content = live?.generation?.message?.content;
  return content === undefined ? "" : textOf({ role: "assistant", content } as Message);
}

export function useDialogue(activityId: string, participantId: string, options?: DialogueOptions) {
  const [view, setView] = useState<ConversationView | null>(null);
  const [phase, setPhase] = useState<DialoguePhase>("idle");
  const [error, setError] = useState<DialogueError>(null);
  const [ttsFailed, setTtsFailed] = useState(false);
  const [ttsSkipped, setTtsSkipped] = useState(false);
  const viewRef = useRef<ConversationView | null>(null);
  const socketRef = useRef<{ send: (data: string) => void; readyState: number; OPEN: number } | null>(null);
  const pendingRef = useRef<string | null>(null);
  const [pendingView, setPendingView] = useState(false);
  const [baseline, setBaseline] = useState<number | null>(null);
  const failedInputRef = useRef<string | null>(null);
  const speechToken = useRef(0);
  const phaseRef = useRef<DialoguePhase>("idle");
  const sentOnceRef = useRef(false);
  const playedEmotionRef = useRef<EntryId | null>(null);
  const [sentAutoSend, setSentAutoSend] = useState<string | null>(null);
  if (sentAutoSend !== null && !options?.autoSend) setSentAutoSend(null);
  const entriesWaiters = useRef(
    new Map<string, { resolve: (page: Page<EntryRecord, Cursor>) => void; reject: (reason: Error) => void }>(),
  );
  const loader = useCallback(
    (query: { minEntryId?: EntryId; maxEntryId?: EntryId; order?: "ascending" | "descending" }, limit: number) => {
      return new Promise<Page<EntryRecord, Cursor>>((resolve, reject) => {
        if (socketRef.current === null || socketRef.current.readyState !== socketRef.current.OPEN) {
          reject(new Error("socket_closed"));
          return;
        }
        const id = crypto.randomUUID();
        entriesWaiters.current.set(id, { resolve, reject });
        socketRef.current.send(JSON.stringify({ type: "entries", id, query, limit } satisfies ClientMessage));
      });
    },
    [],
  );
  const transcriptRef = useRef<ConversationTranscript | null>(null);
  const [transcriptView, setTranscriptView] = useState<TranscriptView | null>(null);
  useLayoutEffect(() => {
    transcriptRef.current = new ConversationTranscript(loader);
    return () => {
      transcriptRef.current = null;
    };
  }, [loader]);

  useOnUnmount(() => {
    speechToken.current += 1;
    stopSpeech("dialogue");
    pendingRef.current = null;
    setBaseline(null);
  });

  function syncEmotion() {
    const latest = latestEmotionOf(viewRef.current);
    if (!latest?.data || latest.id === playedEmotionRef.current) return;
    if (!sentOnceRef.current) {
      playedEmotionRef.current = latest.id;
      return;
    }
    if (phaseRef.current === "thinking" || phaseRef.current === "streaming") return;
    playedEmotionRef.current = latest.id;
    const name = EXPRESSIONS[latest.data.emotion];
    if (name) companion.playExpression(name);
  }

  function adopt(next: ConversationView) {
    viewRef.current = next;
    setView(next);
    const transcript = transcriptRef.current;
    if (transcript) setTranscriptView(transcript.merge(next));
    syncEmotion();
  }

  function speakAnswer(text: string, userInitiated = false) {
    speechToken.current += 1;
    const token = speechToken.current;
    phaseRef.current = "speaking";
    setPhase("speaking");
    setTtsFailed(false);
    setTtsSkipped(false);
    speak("dialogue", text, { userInitiated })
      .then((outcome) => {
        if (token === speechToken.current && outcome === "skipped") setTtsSkipped(true);
      })
      .catch(() => {
        if (token === speechToken.current) setTtsFailed(true);
      })
      .finally(() => {
        if (token === speechToken.current) {
          phaseRef.current = "idle";
          setPhase("idle");
          syncEmotion();
          tryAutoSend();
        }
      });
  }

  function completePending() {
    pendingRef.current = null;
    setPendingView(false);
    setBaseline(null);
    failedInputRef.current = null;
    const text = lastAssistantText(viewRef.current);
    if (text) {
      speakAnswer(text);
    } else {
      phaseRef.current = "idle";
      setPhase("idle");
      syncEmotion();
    }
  }

  function failPending(code: string) {
    pendingRef.current = null;
    setPendingView(false);
    setBaseline(null);
    phaseRef.current = "idle";
    setPhase("idle");
    if (code === "ActivityFinished") options?.onActivityFinished?.();
    setError({ code });
    syncEmotion();
  }

  function arbitrate(entries: readonly WindowedEntry[], full: boolean, windowBefore?: number) {
    if (pendingRef.current === null) return;
    if (baseline !== null && !entries.some((entry) => entry.id === baseline)) {
      const ours = entries.find((entry) => entry.kind === "pi.user" && entry.id > baseline);
      if (ours) {
        setBaseline(ours.id);
        if (answered(entries.slice(entries.indexOf(ours) + 1))) completePending();
        return;
      }
      if (full) {
        if (windowBefore !== undefined && windowBefore > baseline) {
          if (answered(entries)) completePending();
          return;
        }
        if (runFailureOf(viewRef.current)) failPending("llm_unavailable");
      }
      return;
    }
    const index = baseline === null ? -1 : entries.findIndex((entry) => entry.id === baseline);
    const tail = index === -1 ? entries : entries.slice(index + 1);
    if (answered(tail)) {
      completePending();
    } else if (full) {
      if (tail.some((entry) => entry.kind === "pi.assistant" && !intermediateAssistant(entry))) {
        completePending();
      } else {
        if (runFailureOf(viewRef.current)) failPending("llm_unavailable");
      }
    }
  }

  function onFrame(raw: unknown) {
    if (typeof raw !== "string") return;
    let frame: ServerMessage;
    try {
      frame = JSON.parse(raw) as ServerMessage;
    } catch {
      return;
    }
    switch (frame.type) {
      case "view": {
        adopt(frame.view);
        arbitrate(frame.view.entries, true, frame.view.before);
        tryAutoSend();
        return;
      }
      case "ops": {
        const base = viewRef.current;
        if (!base) return;
        let next: ConversationView;
        try {
          next = applyImmutable(base, frame.ops);
        } catch {
          socket.send(JSON.stringify({ type: "watch" } satisfies ClientMessage));
          return;
        }
        adopt(next);
        arbitrate(next.entries, false);
        if (frame.ops.length > 0 && pendingRef.current && liveTextOf(next)) {
          phaseRef.current = "streaming";
          setPhase((current) => (current === "thinking" ? "streaming" : current));
        }
        tryAutoSend();
        return;
      }
      case "result": {
        const waiter = entriesWaiters.current.get(frame.id);
        if (waiter === undefined) return;
        entriesWaiters.current.delete(frame.id);
        if (frame.result && typeof frame.result === "object" && "items" in frame.result) {
          waiter.resolve(frame.result as Page<EntryRecord, Cursor>);
        } else {
          waiter.reject(new Error("entries_result_invalid"));
        }
        return;
      }
      case "error": {
        const waiter = frame.id !== undefined ? entriesWaiters.current.get(frame.id) : undefined;
        if (waiter !== undefined) {
          entriesWaiters.current.delete(frame.id!);
          waiter.reject(new Error("entries_failed"));
          return;
        }
        if (frame.id !== undefined && frame.id !== pendingRef.current) return;
        if (frame.id === undefined && pendingRef.current === null) return;
        failPending(frame.code ?? "llm_unavailable");
        return;
      }
    }
  }

  const socket = useAgent({
    agent: "chat",
    name: `${activityId}:${participantId}`,
    onOpen: (event) => {
      (event.target as WebSocket).send(JSON.stringify({ type: "watch" } satisfies ClientMessage));
      queueMicrotask(() => tryAutoSend());
    },
    onMessage: (event) => onFrame(event.data),
    onConnectionError: () => {
      speechToken.current += 1;
      stopSpeech("dialogue");
    },
    onClose: () => {
      for (const waiter of entriesWaiters.current.values()) waiter.reject(new Error("socket_closed"));
      entriesWaiters.current.clear();
      options?.onDisconnect?.();
    },
  });
  useLayoutEffect(() => {
    socketRef.current = socket;
    return () => {
      socketRef.current = null;
    };
  }, [socket]);

  const subscribe = (notify: () => void) => {
    socket.addEventListener("open", notify);
    socket.addEventListener("close", notify);
    return () => {
      socket.removeEventListener("open", notify);
      socket.removeEventListener("close", notify);
    };
  };

  const socketReady = useSyncExternalStore(
    subscribe,
    () => socket.readyState === socket.OPEN,
    () => false,
  );

  function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || pendingRef.current || !viewRef.current) return false;
    if (socket.readyState !== WebSocket.OPEN) return false;
    markIntent("dialogue");
    speechToken.current += 1;
    stopSpeech("dialogue");
    const id = crypto.randomUUID();
    pendingRef.current = id;
    sentOnceRef.current = true;
    setPendingView(true);
    setBaseline(viewRef.current.entries.at(-1)?.id ?? null);
    failedInputRef.current = trimmed;
    setError(null);
    setTtsFailed(false);
    setTtsSkipped(false);
    phaseRef.current = "thinking";
    setPhase("thinking");
    socket.send(JSON.stringify({ type: "submit", id, input: trimmed } satisfies ClientMessage));
    return true;
  }

  function tryAutoSend() {
    const autoSend = options?.autoSend;
    if (!autoSend || sentAutoSend === autoSend) return;
    if (phaseRef.current === "speaking") return;
    if (send(autoSend.slice(0, 2000))) {
      setSentAutoSend(autoSend);
      options.onAutoSent?.();
    }
  }

  function retryLast() {
    if (pendingRef.current) return;
    const text = failedInputRef.current;
    if (!text) return;
    send(text);
  }

  function replay() {
    if (pendingRef.current) return;
    const last = lastAssistantText(viewRef.current);
    if (!last) return;
    speakAnswer(last, true);
  }

  function interrupt() {
    if (pendingRef.current) {
      socket.send(JSON.stringify({ type: "abort", id: pendingRef.current } satisfies ClientMessage));
      pendingRef.current = null;
      setPendingView(false);
      setBaseline(null);
    }
    speechToken.current += 1;
    stopSpeech("dialogue");
    phaseRef.current = "idle";
    setPhase("idle");
    syncEmotion();
  }

  async function loadEarlier() {
    if (socket.readyState !== WebSocket.OPEN) return;
    const transcript = transcriptRef.current;
    if (!transcript) return;
    try {
      setTranscriptView(await transcript.loadEarlier(BACKGROUND_CONTEXT));
    } catch {
      /* retryable — the transcript clears its in-flight load when the loader settles */
    }
  }

  async function fillGap(gap: Extract<TranscriptItem, { kind: "gap" }>) {
    const transcript = transcriptRef.current;
    if (!transcript) return;
    try {
      setTranscriptView(await transcript.fillGap(gap, BACKGROUND_CONTEXT));
    } catch {
      /* retryable */
    }
  }

  const messages = useMemo(() => {
    const out: DialogueMessage[] = [];
    for (const item of transcriptView?.items ?? []) {
      if (item.kind !== "entry") continue;
      const entry = item.entry as WindowedEntry;
      if (entry.kind !== "pi.user" && entry.kind !== "pi.assistant") continue;
      out.push({
        id: `e${entry.id}`,
        role: entry.kind === "pi.user" ? "user" : "assistant",
        text: textOf((entry.model?.[0] ?? undefined) as Message | undefined),
      });
    }
    return out;
  }, [transcriptView]);

  const draft = useMemo(() => {
    if (!view || phase === "speaking" || phase === "idle") return liveTextOf(view) || "";
    const live = liveTextOf(view);
    if (live) return live;
    const tail = view.entries.at(-1);
    if (
      tail &&
      tail.kind === "pi.assistant" &&
      !intermediateAssistant(tail) &&
      tail.id > (baseline ?? Number.MAX_SAFE_INTEGER)
    ) {
      return textOf((tail.model?.[0] ?? undefined) as Message | undefined);
    }
    return "";
  }, [view, phase, baseline]);

  const emotion = useMemo(() => {
    for (const item of [...(transcriptView?.items ?? [])].reverse()) {
      if (item.kind !== "entry") continue;
      const entry = item.entry;
      if (entry.kind !== "app.emotion") continue;
      return (entry.data ?? null) as DialogueEmotion;
    }
    return null;
  }, [transcriptView]);

  const gaps = useMemo(
    () =>
      (transcriptView?.items.filter((item) => item.kind === "gap") ?? []) as Array<
        Extract<TranscriptItem, { kind: "gap" }>
      >,
    [transcriptView],
  );

  return {
    messages,
    items: (transcriptView?.items ?? []) as TranscriptItem[],
    draft,
    phase,
    error,
    emotion,
    ttsFailed,
    ttsSkipped,
    pending: pendingView,
    viewReady: view !== null,
    canLoadEarlier: transcriptView?.items[0]?.kind === "earlier",
    gaps,
    fillGap,
    loadEarlier,
    send,
    retryLast,
    replay,
    interrupt,
    ready: socketReady,
  };
}

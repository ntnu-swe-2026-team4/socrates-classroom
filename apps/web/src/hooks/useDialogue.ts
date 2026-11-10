import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAgent } from "agents/react";
import { applyImmutable } from "@earendil-works/chord/delta";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Message } from "@earendil-works/pi-ai";
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
import { api } from "@/api";

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

const NO_AMPLITUDE = () => {};

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

interface WindowedEntry {
  id: number;
  kind: string;
  model?: readonly unknown[];
}

const ANSWER_STOP_REASONS = new Set(["stop", "length"]);

function intermediateAssistant(entry: WindowedEntry): boolean {
  const message = entry.model?.[0] as { stopReason?: string; content?: readonly { type?: string }[] } | undefined;
  if (message?.stopReason === undefined) return false;
  if (ANSWER_STOP_REASONS.has(message.stopReason)) return false;
  // pi answers a toolUse message that carries no tool calls (malformed provider output ends the run)
  if (message.stopReason === "toolUse" && !(message.content ?? []).some((part) => part.type === "toolCall")) {
    return false;
  }
  return true;
}

function answered(entries: readonly WindowedEntry[]): boolean {
  return entries.some(
    (entry) =>
      entry.kind === "pi.assistant" &&
      !intermediateAssistant(entry) &&
      textOf(entry.model?.[0] as Message | undefined).trim() !== "",
  );
}

function liveTextOf(view: ConversationView | null): string {
  if (!view) return "";
  const live = view.docs["pi.live"] as { generation?: { message?: { content?: readonly unknown[] } } } | undefined;
  const content = live?.generation?.message?.content;
  return content === undefined ? "" : textOf({ role: "assistant", content } as Message);
}

export function useDialogue(activityId: string, userId: string) {
  const [view, setView] = useState<ConversationView | null>(null);
  const [phase, setPhase] = useState<DialoguePhase>("idle");
  const [error, setError] = useState<DialogueError>(null);
  const [ttsFailed, setTtsFailed] = useState(false);
  const viewRef = useRef<ConversationView | null>(null);
  const socketRef = useRef<{ send: (data: string) => void; readyState: number; OPEN: number } | null>(null);
  const pendingRef = useRef<string | null>(null);
  const [pendingView, setPendingView] = useState(false);
  const baselineRef = useRef<number | null>(null);
  const failedInputRef = useRef<string | null>(null);
  const ttsRef = useRef<AbortController | null>(null);
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
  const transcriptRef = useRef(new ConversationTranscript(loader));
  const [transcriptView, setTranscriptView] = useState<TranscriptView | null>(null);

  useEffect(
    () => () => {
      ttsRef.current?.abort();
      pendingRef.current = null;
      baselineRef.current = null;
    },
    [],
  );

  const adopt = useCallback((next: ConversationView) => {
    viewRef.current = next;
    setView(next);
    setTranscriptView(transcriptRef.current.merge(next));
  }, []);

  const speak = useCallback((text: string) => {
    ttsRef.current?.abort();
    const controller = new AbortController();
    ttsRef.current = controller;
    return api.tts(text, NO_AMPLITUDE, controller.signal);
  }, []);

  const speakAnswer = useCallback(
    (text: string) => {
      setPhase("speaking");
      setTtsFailed(false);
      const speaking = speak(text);
      const controller = ttsRef.current;
      if (!controller) return;
      speaking
        .catch(() => {
          if (!controller.signal.aborted) setTtsFailed(true);
        })
        .finally(() => {
          if (ttsRef.current !== controller) return;
          ttsRef.current = null;
          setPhase("idle");
        });
    },
    [speak],
  );

  const completePending = useCallback(() => {
    pendingRef.current = null;
    setPendingView(false);
    baselineRef.current = null;
    failedInputRef.current = null;
    const text = lastAssistantText(viewRef.current);
    if (text) {
      speakAnswer(text);
    } else {
      setPhase("idle");
    }
  }, [speakAnswer]);

  const failPending = useCallback((code: string) => {
    pendingRef.current = null;
    setPendingView(false);
    baselineRef.current = null;
    setPhase("idle");
    setError({ code });
  }, []);

  const arbitrate = useCallback(
    (entries: readonly WindowedEntry[], full: boolean, windowBefore?: number) => {
      if (pendingRef.current === null) return;
      const baseline = baselineRef.current;
      if (baseline !== null && !entries.some((entry) => entry.id === baseline)) {
        const ours = entries.find((entry) => entry.kind === "pi.user" && entry.id > baseline);
        if (ours) {
          baselineRef.current = ours.id;
          if (answered(entries.slice(entries.indexOf(ours) + 1))) completePending();
          return;
        }
        if (full) {
          if (windowBefore !== undefined && windowBefore > baseline) {
            if (answered(entries)) completePending();
            return;
          }
          failPending("llm_unavailable");
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
        } else if (!tail.some((entry) => entry.kind === "pi.user")) {
          failPending("llm_unavailable");
        } else {
          const live = viewRef.current?.docs["pi.live"] as { runFailure?: unknown } | undefined;
          if (live?.runFailure) failPending("llm_unavailable");
        }
      }
    },
    [completePending, failPending],
  );

  const onFrame = useCallback(
    (raw: unknown) => {
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
          return;
        }
        case "ops": {
          const base = viewRef.current;
          if (!base) return;
          let next: ConversationView;
          try {
            next = applyImmutable(base, frame.ops);
          } catch {
            socketRef.current?.send(JSON.stringify({ type: "watch" } satisfies ClientMessage));
            return;
          }
          adopt(next);
          arbitrate(next.entries, false);
          if (frame.ops.length > 0 && pendingRef.current && liveTextOf(next)) {
            setPhase((current) => (current === "thinking" ? "streaming" : current));
          }
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
    },
    [adopt, arbitrate, failPending],
  );

  const socket = useAgent({
    agent: "chat",
    name: `${activityId}:${userId}`,
    onOpen: (event) => {
      (event.target as WebSocket).send(JSON.stringify({ type: "watch" } satisfies ClientMessage));
    },
    onMessage: (event) => onFrame(event.data),
    onConnectionError: () => {
      ttsRef.current?.abort();
    },
  });
  socketRef.current = socket;

  const subscribe = useCallback(
    (notify: () => void) => {
      socket.addEventListener("open", notify);
      socket.addEventListener("close", notify);
      return () => {
        socket.removeEventListener("open", notify);
        socket.removeEventListener("close", notify);
      };
    },
    [socket],
  );

  const socketReady = useSyncExternalStore(
    subscribe,
    () => socket.readyState === socket.OPEN,
    () => false,
  );

  useEffect(() => {
    const flush = () => {
      for (const waiter of entriesWaiters.current.values()) waiter.reject(new Error("socket_closed"));
      entriesWaiters.current.clear();
    };
    socket.addEventListener("close", flush);
    return () => socket.removeEventListener("close", flush);
  }, [socket]);

  useEffect(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "watch" } satisfies ClientMessage));
    }
  }, [socket]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || pendingRef.current || !viewRef.current) return false;
      if (socket.readyState !== WebSocket.OPEN) return false;
      ttsRef.current?.abort();
      ttsRef.current = null;
      const id = crypto.randomUUID();
      pendingRef.current = id;
      setPendingView(true);
      baselineRef.current = viewRef.current.entries.at(-1)?.id ?? null;
      failedInputRef.current = trimmed;
      setError(null);
      setTtsFailed(false);
      setPhase("thinking");
      socket.send(JSON.stringify({ type: "submit", id, input: trimmed } satisfies ClientMessage));
      return true;
    },
    [socket],
  );

  const retryLast = useCallback(() => {
    if (pendingRef.current) return;
    const text = failedInputRef.current;
    if (!text) return;
    send(text);
  }, [send]);

  const replay = useCallback(() => {
    if (pendingRef.current) return;
    const last = lastAssistantText(viewRef.current);
    if (!last) return;
    speakAnswer(last);
  }, [speakAnswer]);

  const interrupt = useCallback(() => {
    if (pendingRef.current) {
      socket.send(JSON.stringify({ type: "abort", id: pendingRef.current } satisfies ClientMessage));
      pendingRef.current = null;
      setPendingView(false);
      baselineRef.current = null;
    }
    ttsRef.current?.abort();
    ttsRef.current = null;
    setPhase("idle");
  }, [socket]);

  const loadEarlier = useCallback(async () => {
    if (!socketRef.current) return;
    try {
      setTranscriptView(await transcriptRef.current.loadEarlier(BACKGROUND_CONTEXT));
    } catch {
      /* retryable — the transcript clears its in-flight load when the loader settles */
    }
  }, []);

  const fillGap = useCallback(async (gap: Extract<TranscriptItem, { kind: "gap" }>) => {
    try {
      setTranscriptView(await transcriptRef.current.fillGap(gap, BACKGROUND_CONTEXT));
    } catch {
      /* retryable */
    }
  }, []);

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
    const baseline = baselineRef.current;
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
  }, [view, phase]);

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

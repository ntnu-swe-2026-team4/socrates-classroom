import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useAgent } from "agents/react";
import { applyImmutable } from "@earendil-works/chord/delta";
import type { ConversationView } from "@earendil-works/pi-durable";
import type { Message } from "@earendil-works/pi-ai";
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

function textOf(message: Message | undefined): string {
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
    if (entry.kind !== "pi.assistant") continue;
    const text = textOf(entry.model?.[0]);
    return text;
  }
  return "";
}

function emotionOf(view: ConversationView | null): DialogueEmotion {
  if (!view) return null;
  for (const entry of [...view.entries].reverse()) {
    if (entry.kind !== "app.emotion") continue;
    const data = entry.data as DialogueEmotion;
    return data;
  }
  return null;
}

interface WindowedEntry {
  id: number;
  kind: string;
  model?: readonly unknown[];
}

function abortedPartial(entry: WindowedEntry): boolean {
  const message = entry.model?.[0] as { stopReason?: string } | undefined;
  return message?.stopReason === "aborted";
}

function answered(entries: readonly WindowedEntry[]): boolean {
  return entries.some(
    (entry) =>
      entry.kind === "pi.assistant" &&
      !abortedPartial(entry) &&
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
  const pendingRef = useRef<string | null>(null);
  const [pendingView, setPendingView] = useState(false);
  const baselineRef = useRef<number | null>(null);
  const failedInputRef = useRef<string | null>(null);
  const ttsRef = useRef<AbortController | null>(null);
  const entriesWaiters = useRef(new Map<string, (entries: readonly WindowedEntry[]) => void>());
  const [older, setOlder] = useState<readonly WindowedEntry[]>([]);

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
        if (tail.some((entry) => entry.kind === "pi.assistant" && !abortedPartial(entry))) {
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
          const next = applyImmutable(base, frame.ops);
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
          const page = frame.result as { items?: unknown[] } | null;
          const items = Array.isArray(page?.items) ? (page!.items as WindowedEntry[]) : [];
          waiter(items);
          return;
        }
        case "error": {
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

  const loadEarlier = useCallback(() => {
    const before = viewRef.current?.before;
    if (before === undefined || socket.readyState !== WebSocket.OPEN) return;
    const id = crypto.randomUUID();
    const delivered = (entries: readonly WindowedEntry[]) => {
      const page = entries.filter((entry) => entry.kind === "pi.user" || entry.kind === "pi.assistant");
      setOlder((current) => {
        const known = new Set([...current, ...(viewRef.current?.entries ?? [])].map((entry) => entry.id));
        return [...current, ...page.filter((entry) => !known.has(entry.id))];
      });
    };
    entriesWaiters.current.set(id, delivered);
    socket.send(
      JSON.stringify({
        type: "entries",
        id,
        query: { order: "ascending", maxEntryId: before },
        limit: 50,
      } satisfies ClientMessage),
    );
  }, [socket]);

  const { messages, draft } = useMemo(() => {
    const result = { messages: [] as DialogueMessage[], draft: "" };
    if (!view) return result;
    const visible = [...older, ...view.entries].filter(
      (entry) => entry.kind === "pi.user" || entry.kind === "pi.assistant",
    );
    visible.forEach((entry: WindowedEntry, index) => {
      const text = textOf((entry.model?.[0] ?? undefined) as Message | undefined);
      const ours = index === visible.length - 1 && entry.id > (baselineRef.current ?? Number.MAX_SAFE_INTEGER);
      const streaming = ours && (phase === "thinking" || phase === "streaming");
      if (entry.kind === "pi.assistant" && streaming) {
        result.draft = text;
        return;
      }
      result.messages.push({ id: `e${entry.id}`, role: entry.kind === "pi.user" ? "user" : "assistant", text });
    });
    if (!result.draft) result.draft = liveTextOf(view);
    return result;
  }, [older, view, phase]);

  const emotion = useMemo(() => emotionOf(view), [view]);

  return {
    messages,
    draft,
    phase,
    error,
    emotion,
    ttsFailed,
    pending: pendingView,
    viewReady: view !== null,
    canLoadEarlier: view?.before !== undefined,
    loadEarlier,
    send,
    retryLast,
    replay,
    interrupt,
    ready: socketReady,
  };
}

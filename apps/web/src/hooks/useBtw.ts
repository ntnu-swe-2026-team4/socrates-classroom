import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAgent } from "agents/react";
import { applyImmutable } from "@earendil-works/chord/delta";
import type { Message } from "@earendil-works/pi-ai";
import type { ConversationView } from "@earendil-works/pi-durable";
import type { ClientMessage, ServerMessage } from "@server/ws/protocol";
import { answered, intermediateAssistant, liveTextOf, textOf, type DialogueMessage } from "@/hooks/useDialogue";

export type BtwPhase = "idle" | "thinking" | "streaming";

interface StoredSession {
  session: string;
  forkHead: number;
}

function storageKey(activityId: string, userId: string): string {
  return `btw:${activityId}:${userId}`;
}

function readStored(key: string): StoredSession | null {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    return typeof parsed.session === "string" && typeof parsed.forkHead === "number"
      ? { session: parsed.session, forkHead: parsed.forkHead }
      : null;
  } catch {
    return null;
  }
}

function writeStored(key: string, value: StoredSession | null): void {
  try {
    if (value) sessionStorage.setItem(key, JSON.stringify(value));
    else sessionStorage.removeItem(key);
  } catch {
    /* storage unavailable: the side session simply restarts on the next open */
  }
}

/**
 * The side window opens its own socket to the same thread and sends `btw`, which binds that socket to a fork of the
 * root (docs/api-contract.md §5.4). Entries up to the fork point are the main dialogue; only later ones belong here.
 */
export function useBtw(activityId: string, userId: string, enabled: boolean) {
  const key = storageKey(activityId, userId);
  const [view, setView] = useState<ConversationView | null>(null);
  const [phase, setPhase] = useState<BtwPhase>("idle");
  const [error, setError] = useState<{ code: string } | null>(null);
  const [bound, setBound] = useState(false);
  const [forkHead, setForkHead] = useState<number | null>(() => readStored(key)?.forkHead ?? null);
  const viewRef = useRef<ConversationView | null>(null);
  const socketRef = useRef<{ send: (data: string) => void; readyState: number } | null>(null);
  const sessionRef = useRef<string | null>(readStored(key)?.session ?? null);
  const forkHeadRef = useRef<number | null>(forkHead);
  const openIdRef = useRef<string | null>(null);
  const freshRef = useRef(false);
  const pendingRef = useRef<string | null>(null);
  const baselineRef = useRef<number | null>(null);
  const failedInputRef = useRef<string | null>(null);
  const queuedRef = useRef<string | null>(null);
  const submitRef = useRef<(text: string) => boolean>(() => false);

  const open = useCallback((socket: { send: (data: string) => void }, fresh: boolean) => {
    const id = crypto.randomUUID();
    openIdRef.current = id;
    freshRef.current = fresh || sessionRef.current === null;
    setBound(false);
    socket.send(
      JSON.stringify({
        type: "btw",
        id,
        ...(freshRef.current ? {} : { session: sessionRef.current! }),
      } satisfies ClientMessage),
    );
  }, []);

  const finishPending = useCallback((failure?: string) => {
    pendingRef.current = null;
    baselineRef.current = null;
    setPhase("idle");
    if (failure) {
      setError({ code: failure });
    } else {
      failedInputRef.current = null;
    }
  }, []);

  const arbitrate = useCallback(
    (next: ConversationView) => {
      if (pendingRef.current === null) return;
      const baseline = baselineRef.current ?? -1;
      if (answered(next.entries.filter((entry) => entry.id > baseline))) {
        finishPending();
        return;
      }
      const live = next.docs["pi.live"] as { runFailure?: unknown } | undefined;
      if (live?.runFailure) finishPending("llm_unavailable");
    },
    [finishPending],
  );

  const adopt = useCallback(
    (next: ConversationView) => {
      viewRef.current = next;
      setView(next);
      arbitrate(next);
    },
    [arbitrate],
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
          if (freshRef.current && openIdRef.current !== null) {
            const head = frame.view.entries.at(-1)?.id ?? frame.view.before ?? 0;
            forkHeadRef.current = head;
            setForkHead(head);
          }
          adopt(frame.view);
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
          if (pendingRef.current && liveTextOf(next)) {
            setPhase((current) => (current === "thinking" ? "streaming" : current));
          }
          return;
        }
        case "result": {
          if (frame.id !== openIdRef.current) return;
          const result = frame.result as { session?: unknown } | null;
          if (!result || typeof result.session !== "string") return;
          openIdRef.current = null;
          freshRef.current = false;
          sessionRef.current = result.session;
          writeStored(key, { session: result.session, forkHead: forkHeadRef.current ?? 0 });
          setError(null);
          setBound(true);
          const queued = queuedRef.current;
          queuedRef.current = null;
          if (queued) submitRef.current(queued);
          return;
        }
        case "error": {
          if (frame.id !== undefined && frame.id === openIdRef.current) {
            openIdRef.current = null;
            if (frame.code === "UnknownSession" && socketRef.current) {
              sessionRef.current = null;
              writeStored(key, null);
              open(socketRef.current, true);
              return;
            }
            queuedRef.current = null;
            setError({ code: frame.code ?? "llm_unavailable" });
            return;
          }
          if (frame.id !== undefined && frame.id !== pendingRef.current) return;
          if (frame.id === undefined && pendingRef.current === null) return;
          finishPending(frame.code ?? "llm_unavailable");
          return;
        }
      }
    },
    [adopt, finishPending, key, open],
  );

  const socket = useAgent({
    agent: "chat",
    name: `${activityId}:${userId}`,
    enabled,
    onOpen: (event) => open(event.target as WebSocket, false),
    onMessage: (event) => onFrame(event.data),
  });
  socketRef.current = socket;

  useEffect(() => {
    const lost = () => {
      setBound(false);
      if (pendingRef.current) finishPending("llm_unavailable");
    };
    socket.addEventListener("close", lost);
    return () => socket.removeEventListener("close", lost);
  }, [socket, finishPending]);

  const submit = useCallback(
    (text: string) => {
      const trimmed = text.trim().slice(0, 2000);
      if (!trimmed || pendingRef.current || !viewRef.current) return false;
      if (socket.readyState !== WebSocket.OPEN || sessionRef.current === null || openIdRef.current !== null) {
        return false;
      }
      const id = crypto.randomUUID();
      pendingRef.current = id;
      baselineRef.current = viewRef.current.entries.at(-1)?.id ?? null;
      failedInputRef.current = trimmed;
      setError(null);
      setPhase("thinking");
      socket.send(JSON.stringify({ type: "submit", id, input: trimmed } satisfies ClientMessage));
      return true;
    },
    [socket],
  );
  submitRef.current = submit;

  const ask = useCallback(
    (text: string) => {
      if (submit(text)) return true;
      if (pendingRef.current || !text.trim()) return false;
      queuedRef.current = text;
      return true;
    },
    [submit],
  );

  const retryLast = useCallback(() => {
    const text = failedInputRef.current;
    if (text) submit(text);
  }, [submit]);

  const interrupt = useCallback(() => {
    if (!pendingRef.current) return;
    socket.send(JSON.stringify({ type: "abort", id: pendingRef.current } satisfies ClientMessage));
    finishPending();
  }, [socket, finishPending]);

  const newTopic = useCallback(() => {
    if (pendingRef.current || socket.readyState !== WebSocket.OPEN) return;
    setError(null);
    open(socket, true);
  }, [socket, open]);

  const messages = useMemo(() => {
    const out: DialogueMessage[] = [];
    if (!view || forkHead === null) return out;
    for (const entry of view.entries) {
      if (entry.id <= forkHead) continue;
      if (entry.kind !== "pi.user" && entry.kind !== "pi.assistant") continue;
      if (entry.kind === "pi.assistant" && intermediateAssistant(entry)) continue;
      const text = textOf((entry.model?.[0] ?? undefined) as Message | undefined);
      if (!text) continue;
      out.push({ id: `e${entry.id}`, role: entry.kind === "pi.user" ? "user" : "assistant", text });
    }
    return out;
  }, [view, forkHead]);

  const draft = phase === "idle" ? "" : liveTextOf(view);

  return { messages, draft, phase, error, ready: bound, ask, retryLast, interrupt, newTopic };
}

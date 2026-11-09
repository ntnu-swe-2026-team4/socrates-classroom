import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  text: string;
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

export function useDialogue(activityId: string, userId: string) {
  const [view, setView] = useState<ConversationView | null>(null);
  const [phase, setPhase] = useState<DialoguePhase>("idle");
  const [error, setError] = useState<DialogueError>(null);
  const viewRef = useRef<ConversationView | null>(null);
  const pendingRef = useRef<string | null>(null);
  const failedInputRef = useRef<string | null>(null);
  const ttsRef = useRef<AbortController | null>(null);

  useEffect(
    () => () => {
      ttsRef.current?.abort();
      pendingRef.current = null;
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

  const completePending = useCallback(() => {
    pendingRef.current = null;
    failedInputRef.current = null;
    const text = lastAssistantText(viewRef.current);
    if (text) {
      setPhase("speaking");
      const speaking = speak(text);
      const controller = ttsRef.current;
      speaking
        .catch(() => {})
        .finally(() => {
          if (ttsRef.current !== controller) return;
          ttsRef.current = null;
          setPhase("idle");
        });
    } else {
      setPhase("idle");
    }
  }, [speak]);

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
          const last = frame.view.entries.at(-1);
          if (pendingRef.current && last?.kind === "pi.assistant") completePending();
          return;
        }
        case "ops": {
          const base = viewRef.current;
          if (!base) return;
          adopt(applyImmutable(base, frame.ops));
          if (frame.ops.length > 0 && lastAssistantText(viewRef.current)) {
            setPhase((current) => (current === "thinking" ? "streaming" : current));
          }
          return;
        }
        case "result": {
          if (frame.id !== pendingRef.current) return;
          completePending();
          return;
        }
        case "error": {
          if (frame.id !== undefined && frame.id !== pendingRef.current) return;
          pendingRef.current = null;
          setPhase("idle");
          setError({ code: frame.code ?? "llm_unavailable" });
          return;
        }
      }
    },
    [adopt, completePending],
  );

  const socket = useAgent({
    agent: "chat",
    name: `${activityId}:${userId}`,
    onOpen: (event) => {
      (event.target as WebSocket).send(JSON.stringify({ type: "watch" } satisfies ClientMessage));
    },
    onMessage: (event) => onFrame(event.data),
    onConnectionError: () => {
      pendingRef.current = null;
      ttsRef.current?.abort();
      ttsRef.current = null;
      setPhase("idle");
      setError({ code: "llm_unavailable" });
    },
  });

  useEffect(() => {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: "watch" } satisfies ClientMessage));
    }
  }, [socket]);

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || pendingRef.current) return;
      const id = crypto.randomUUID();
      pendingRef.current = id;
      failedInputRef.current = trimmed;
      setError(null);
      setPhase("thinking");
      socket.send(JSON.stringify({ type: "submit", id, input: trimmed } satisfies ClientMessage));
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
    setPhase("speaking");
    const speaking = speak(last);
    const controller = ttsRef.current;
    speaking
      .catch(() => {})
      .finally(() => {
        if (ttsRef.current !== controller) return;
        ttsRef.current = null;
        setPhase("idle");
      });
  }, [speak]);

  const interrupt = useCallback(() => {
    if (pendingRef.current) {
      socket.send(JSON.stringify({ type: "abort", id: pendingRef.current } satisfies ClientMessage));
      pendingRef.current = null;
    }
    ttsRef.current?.abort();
    ttsRef.current = null;
    setPhase("idle");
  }, [socket]);

  const { messages, draft } = useMemo(() => {
    const result = { messages: [] as DialogueMessage[], draft: "" };
    if (!view) return result;
    const visible = view.entries.filter((entry) => entry.kind === "pi.user" || entry.kind === "pi.assistant");
    visible.forEach((entry, index) => {
      const text = textOf(entry.model?.[0]);
      const streaming = index === visible.length - 1 && (phase === "thinking" || phase === "streaming");
      if (entry.kind === "pi.assistant" && streaming) {
        result.draft = text;
        return;
      }
      result.messages.push({ id: `e${entry.id}`, role: entry.kind === "pi.user" ? "user" : "assistant", text });
    });
    return result;
  }, [view, phase]);

  const emotion = useMemo(() => emotionOf(view), [view]);

  return { messages, draft, phase, error, emotion, send, retryLast, replay, interrupt };
}

import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api";

export type DialoguePhase = "idle" | "thinking" | "streaming" | "speaking";
export type DialogueError = { code: string } | null;

const NO_AMPLITUDE = () => {};

export function useDialogue(activityId: string, initialText: string[]) {
  const [messages, setMessages] = useState<{ id: string; role: "user" | "assistant"; text: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<DialoguePhase>("idle");
  const [error, setError] = useState<DialogueError>(null);
  const abortRef = useRef<AbortController | null>(null);
  const lastSentRef = useRef<string | null>(null);

  useEffect(() => {
    setMessages(initialText.map((text, i) => ({ id: `init-${i}`, role: "assistant" as const, text })));
  }, [initialText]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string, isRetry = false) => {
      const trimmed = text.trim();
      if (!trimmed || phase !== "idle") return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      lastSentRef.current = trimmed;
      setMessages((prev) =>
        (isRetry ? prev.slice(0, -1) : prev).concat({ id: crypto.randomUUID(), role: "user", text: trimmed }),
      );
      setPhase("thinking");
      setDraft("");
      setError(null);
      try {
        const message = await api.sendDialogue(
          activityId,
          trimmed,
          (delta) => {
            setPhase((p) => (p === "thinking" ? "streaming" : p));
            setDraft((prev) => prev + delta);
          },
          controller.signal,
        );
        setMessages((prev) => [...prev, message]);
        setDraft("");
        setPhase("speaking");
        await api.tts(message.text, NO_AMPLITUDE, controller.signal);
      } catch (cause) {
        setDraft("");
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError({
          code:
            cause instanceof Error && "code" in cause ? String((cause as { code: unknown }).code) : "llm_unavailable",
        });
      } finally {
        setPhase("idle");
      }
    },
    [activityId, phase],
  );

  const retryLast = useCallback(() => {
    const text = lastSentRef.current;
    if (!text) return;
    lastSentRef.current = null;
    void send(text, true);
  }, [send]);

  const interrupt = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, draft, phase, error, send, retryLast, interrupt };
}

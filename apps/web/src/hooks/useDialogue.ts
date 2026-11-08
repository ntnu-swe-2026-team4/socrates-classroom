import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api";

export type DialoguePhase = "idle" | "thinking" | "streaming" | "speaking";
export type DialogueError = { code: string } | null;

const NO_AMPLITUDE = () => {};

export function useDialogue(
  activityId: string,
  initialHistory: Array<{ id?: string; role: "user" | "assistant"; text: string }>,
) {
  const [messages, setMessages] = useState<{ id: string; role: "user" | "assistant"; text: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<DialoguePhase>("idle");
  const [error, setError] = useState<DialogueError>(null);
  const abortRef = useRef<AbortController | null>(null);
  const inFlightRef = useRef(false);

  useEffect(() => {
    setMessages(
      initialHistory.map((entry, i) => ({ id: entry.id ?? `init-${i}`, role: entry.role, text: entry.text })),
    );
  }, [initialHistory]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string, isRetry = false) => {
      const trimmed = text.trim();
      if (!trimmed || inFlightRef.current) return;
      inFlightRef.current = true;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
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
        inFlightRef.current = false;
        setPhase("idle");
      }
    },
    [activityId],
  );

  const retryLast = useCallback(() => {
    if (inFlightRef.current) return;
    const failed = messages.findLast((message) => message.role === "user");
    if (!failed) return;
    void send(failed.text, true);
  }, [messages, send]);

  const replay = useCallback(() => {
    if (inFlightRef.current) return;
    const last = messages.at(-1);
    if (last?.role !== "assistant") return;
    inFlightRef.current = true;
    const controller = new AbortController();
    abortRef.current = controller;
    setPhase("speaking");
    setError(null);
    api
      .tts(last.text, NO_AMPLITUDE, controller.signal)
      .catch((cause) => {
        if (cause instanceof DOMException && cause.name === "AbortError") return;
        setError({
          code:
            cause instanceof Error && "code" in cause ? String((cause as { code: unknown }).code) : "llm_unavailable",
        });
      })
      .finally(() => {
        inFlightRef.current = false;
        setPhase("idle");
      });
  }, [messages]);

  const interrupt = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, draft, phase, error, send, retryLast, replay, interrupt };
}

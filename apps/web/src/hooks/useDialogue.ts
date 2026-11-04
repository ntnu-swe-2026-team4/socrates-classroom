import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/api";

export type DialoguePhase = "idle" | "thinking" | "streaming" | "speaking";

export function useDialogue(activityId: string, initialText: string[]) {
  const [messages, setMessages] = useState<{ id: string; role: "user" | "assistant"; text: string }[]>([]);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<DialoguePhase>("idle");
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    setMessages(initialText.map((text, i) => ({ id: `init-${i}`, role: "assistant" as const, text })));
  }, [initialText]);

  useEffect(() => () => abortRef.current?.abort(), []);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || phase !== "idle") return;
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: "user", text: trimmed }]);
      setPhase("thinking");
      setDraft("");
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
        await api.tts(message.text, () => {}, controller.signal);
      } catch {
        setDraft("");
      } finally {
        setPhase("idle");
      }
    },
    [activityId, phase],
  );

  const interrupt = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, draft, phase, send, interrupt };
}

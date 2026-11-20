import { api } from "@/api";
import { companion, getCompanion, type SpeechSource } from "@/lib/companion";
import { TTS_MAX_CHARS } from "@socrates/shared";

export type { SpeechSource } from "@/lib/companion";
export type SpeechOutcome = "ended" | "interrupted" | "skipped" | "muted";

export interface SpeechEnv {
  request(text: string, onAmplitude: (value: number) => void, signal: AbortSignal): Promise<void>;
  muted(): boolean;
  setSpeakingSource(source: SpeechSource | null): void;
  announce(): void;
  onRemoteAnnounce(listener: () => void): () => void;
  maxChars(): number;
}

interface ActiveSpeech {
  id: number;
  source: SpeechSource;
  controller: AbortController;
}

const SENTENCE_END = "。．！？!?\n";

function boundedSpeech(text: string, maxChars: number): string {
  const capped = text.slice(0, maxChars);
  if (capped.length === text.length) return capped;
  let cut = -1;
  for (let index = 0; index < capped.length; index += 1) {
    const at = SENTENCE_END.indexOf(capped[index]!);
    if (at >= 0 && (SENTENCE_END[at] === "\n" || capped[index + 1] === undefined || capped[index + 1] === " ")) {
      cut = index;
    }
  }
  return cut > maxChars * 0.5 ? capped.slice(0, cut + 1) : capped;
}

function newTabId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());
}

export const defaultSpeechEnv: SpeechEnv = (() => {
  const tabId = newTabId();
  const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("socrates-speech");
  return {
    request: (text, onAmplitude, signal) => api.tts(text, onAmplitude, signal),
    muted: () => getCompanion().muted,
    setSpeakingSource: (source) => companion.setSpeakingSource(source),
    announce: () => channel?.postMessage({ type: "start", tab: tabId }),
    onRemoteAnnounce: (listener) => {
      if (!channel) return () => {};
      const handler = (event: MessageEvent<{ type?: string; tab?: string }>) => {
        if (event.data?.type === "start" && event.data.tab !== tabId) listener();
      };
      channel.addEventListener("message", handler);
      return () => channel.removeEventListener("message", handler);
    },
    maxChars: () => TTS_MAX_CHARS,
  };
})();

export class SpeechArbiter {
  #intentAt: Record<SpeechSource, number> = { dialogue: 0, assistant: 0 };
  #active: ActiveSpeech | null = null;
  #sequence = 0;
  #detach: () => void;

  constructor(private readonly env: SpeechEnv) {
    this.#detach = env.onRemoteAnnounce(() => this.stop());
  }

  markIntent(source: SpeechSource): void {
    this.#sequence += 1;
    this.#intentAt[source] = this.#sequence;
  }

  stop(source?: SpeechSource): void {
    if (!this.#active || (source && this.#active.source !== source)) return;
    this.#active.controller.abort();
  }

  speak(source: SpeechSource, text: string, options: { userInitiated?: boolean } = {}): Promise<SpeechOutcome> {
    if (options.userInitiated) this.markIntent(source);
    if (this.env.muted()) return Promise.resolve("muted");
    if (
      this.#active &&
      this.#active.source !== source &&
      this.#intentAt[this.#active.source] > this.#intentAt[source]
    ) {
      return Promise.resolve("skipped");
    }
    this.#active?.controller.abort();
    this.#sequence += 1;
    const current: ActiveSpeech = { id: this.#sequence, source, controller: new AbortController() };
    this.#active = current;
    this.env.setSpeakingSource(source);
    this.env.announce();
    return this.env
      .request(boundedSpeech(text, this.env.maxChars()), () => {}, current.controller.signal)
      .then((): SpeechOutcome => (current.controller.signal.aborted ? "interrupted" : "ended"))
      .catch((error: unknown): SpeechOutcome => {
        if (current.controller.signal.aborted) return "interrupted";
        throw error;
      })
      .finally(() => {
        if (this.#active?.id !== current.id) return;
        this.#active = null;
        this.env.setSpeakingSource(null);
      });
  }

  dispose(): void {
    this.#detach();
    this.stop();
  }
}

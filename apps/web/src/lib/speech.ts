import { api } from "@/api";
import { companion, getCompanion, type SpeechSource } from "@/lib/companion";
import { TTS_MAX_CHARS } from "@socrates/shared";

export type { SpeechSource } from "@/lib/companion";
export type SpeechOutcome = "ended" | "interrupted" | "skipped" | "muted";

interface ActiveSpeech {
  id: number;
  source: SpeechSource;
  controller: AbortController;
}

const SENTENCE_END = "。．！？!?\n";

function boundedSpeech(text: string): string {
  const capped = text.slice(0, TTS_MAX_CHARS);
  if (capped.length === text.length) return capped;
  let cut = -1;
  for (let index = 0; index < capped.length; index += 1) {
    const at = SENTENCE_END.indexOf(capped[index]!);
    if (at >= 0 && (SENTENCE_END[at] === "\n" || capped[index + 1] === undefined || capped[index + 1] === " ")) {
      cut = index;
    }
  }
  return cut > TTS_MAX_CHARS * 0.5 ? capped.slice(0, cut + 1) : capped;
}
const intentAt: Record<SpeechSource, number> = { dialogue: 0, assistant: 0 };
const tabId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random());
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("socrates-speech");
let active: ActiveSpeech | null = null;
let sequence = 0;

channel?.addEventListener("message", (event: MessageEvent<{ type?: string; tab?: string }>) => {
  if (event.data?.type === "start" && event.data.tab !== tabId) stopSpeech();
});

export function markIntent(source: SpeechSource): void {
  sequence += 1;
  intentAt[source] = sequence;
}

export function stopSpeech(source?: SpeechSource): void {
  if (!active || (source && active.source !== source)) return;
  active.controller.abort();
}

export function speak(
  source: SpeechSource,
  text: string,
  options: { userInitiated?: boolean } = {},
): Promise<SpeechOutcome> {
  if (options.userInitiated) markIntent(source);
  if (getCompanion().muted) return Promise.resolve("muted");
  if (active && active.source !== source && intentAt[active.source] > intentAt[source]) {
    return Promise.resolve("skipped");
  }
  active?.controller.abort();
  sequence += 1;
  const current: ActiveSpeech = { id: sequence, source, controller: new AbortController() };
  active = current;
  companion.setSpeakingSource(source);
  channel?.postMessage({ type: "start", tab: tabId });
  return api
    .tts(boundedSpeech(text), () => {}, current.controller.signal)
    .then((): SpeechOutcome => (current.controller.signal.aborted ? "interrupted" : "ended"))
    .catch((error: unknown): SpeechOutcome => {
      if (current.controller.signal.aborted) return "interrupted";
      throw error;
    })
    .finally(() => {
      if (active?.id !== current.id) return;
      active = null;
      companion.setSpeakingSource(null);
    });
}

export function speakableText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`#>~|]/g, "")
    .replace(/^\s*[-+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

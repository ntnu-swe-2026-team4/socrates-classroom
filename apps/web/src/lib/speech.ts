import type { SpeechSource } from "@/lib/companion";
import { SpeechArbiter, defaultSpeechEnv, type SpeechOutcome } from "@/lib/speechArbiter";

export type { SpeechSource } from "@/lib/companion";
export type { SpeechOutcome } from "@/lib/speechArbiter";

const arbiter = new SpeechArbiter(defaultSpeechEnv);

export function markIntent(source: SpeechSource): void {
  arbiter.markIntent(source);
}

export function stopSpeech(source?: SpeechSource): void {
  arbiter.stop(source);
}

export function speak(
  source: SpeechSource,
  text: string,
  options: { userInitiated?: boolean } = {},
): Promise<SpeechOutcome> {
  return arbiter.speak(source, text, options);
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

import type { Extension } from "@earendil-works/pi-durable";
import type { Lang } from "@socrates/shared";
import ZH from "../../prompts/socrates.md?raw";
import EN from "../../prompts/socrates.en.md?raw";
import ES from "../../prompts/socrates.es.md?raw";

/**
 * One Socratic prompt per language, written in that language. The Chinese prompt alone (no language line) answered an
 * English-speaking student in Chinese every time (glm-5.3-flash, 2026-11-19); a prompt written in the student's
 * language answers in it.
 */
export const SOCRATES_PROMPTS: Record<Lang, string> = { zh: ZH.trim(), en: EN.trim(), es: ES.trim() };

/** `langOf` is read before each request, so the student's language is the one they are using now. */
export function socratesExtension(langOf: () => Lang | Promise<Lang> = () => "zh"): Extension {
  return {
    name: "socrates",
    sections: [{ key: "preamble", render: async () => SOCRATES_PROMPTS[await langOf()], tag: false }],
  };
}

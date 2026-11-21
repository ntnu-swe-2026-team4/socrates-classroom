import type { Extension } from "@earendil-works/pi-durable";
import type { Lang } from "@socrates/shared";
import ZH from "../../prompts/socrates.md?raw";
import EN from "../../prompts/socrates.en.md?raw";
import ES from "../../prompts/socrates.es.md?raw";

export const SOCRATES_PROMPTS: Record<Lang, string> = { zh: ZH.trim(), en: EN.trim(), es: ES.trim() };

export function socratesExtension(langOf: () => Lang | Promise<Lang> = () => "zh"): Extension {
  return {
    name: "socrates",
    sections: [{ key: "preamble", render: async () => SOCRATES_PROMPTS[await langOf()], tag: false }],
  };
}

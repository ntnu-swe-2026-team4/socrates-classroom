import type { Extension, PromptSection } from "@earendil-works/pi-durable";
import type { Lang } from "@socrates/shared";
import { topicBlock, type Topic } from "../../prompts/assemble";
import ZH from "../../prompts/socrates.md?raw";
import EN from "../../prompts/socrates.en.md?raw";
import ES from "../../prompts/socrates.es.md?raw";

export const SOCRATES_PROMPTS: Record<Lang, string> = { zh: ZH.trim(), en: EN.trim(), es: ES.trim() };

export type TopicSource = () => Promise<Topic | null>;

export function topicSection(topicOf: TopicSource): PromptSection {
  return {
    key: "topic",
    render: async () => {
      const topic = await topicOf();
      return topic ? topicBlock(topic.title, topic.statement) : undefined;
    },
    tag: false,
  };
}

export function socratesExtension(
  langOf: () => Lang | Promise<Lang> = () => "zh",
  topicOf: TopicSource = async () => null,
): Extension {
  return {
    name: "socrates",
    sections: [
      { key: "preamble", render: async () => SOCRATES_PROMPTS[await langOf()], tag: false },
      topicSection(topicOf),
    ],
  };
}

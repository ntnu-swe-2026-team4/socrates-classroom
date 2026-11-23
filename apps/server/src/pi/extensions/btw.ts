import BTW_RAW from "../../prompts/btw.md?raw";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Extension } from "@earendil-works/pi-durable";
import type { PiHarness } from "agents/harness/pi";
import { BTW_THINKING_LEVEL } from "../agents/profiles";
import { topicSection, type TopicSource } from "./socrates";

export class NothingToForkError extends Error {
  constructor() {
    super("The dialogue has no entries to fork from yet");
    this.name = "NothingToFork";
  }
}

export function btwExtension(topicOf: TopicSource = async () => null): Extension {
  return {
    name: "btw",
    sections: [{ key: "btw", render: () => BTW_RAW.trim(), tag: false }, topicSection(topicOf)],
  };
}

/**
 * The fork sees the root's transcript up to its newest entry, but its own entries live only in the fork, so nothing
 * said in the side window reaches the root's model context or the report transcript.
 */
export async function forkBtw(harness: PiHarness, btw: Extension): Promise<string> {
  const pi = await harness.pi();
  const root = await pi.root(BACKGROUND_CONTEXT);
  const newest = (await root.entries({}, 1, undefined, BACKGROUND_CONTEXT)).items[0];
  if (!newest) throw new NothingToForkError();
  const fork = await root.fork(
    newest.id,
    { ownership: { kind: "ownerless" }, agent: { extensions: [btw], thinkingLevel: BTW_THINKING_LEVEL } },
    BACKGROUND_CONTEXT,
  );
  return String(fork.id);
}

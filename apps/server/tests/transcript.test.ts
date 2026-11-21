import type { EntryRecord } from "@earendil-works/pi-durable";
import { describe, expect, it } from "vitest";
import { readTranscript } from "../src/do/chat";
import { collapseViolations } from "../src/do/report-runner";

function entry(id: number, kind: string, data?: Record<string, unknown>, text?: string): EntryRecord {
  return {
    id: id as EntryRecord["id"],
    conversationId: 1 as EntryRecord["conversationId"],
    kind,
    ...(text === undefined ? {} : { model: [{ role: "user", content: text }] }),
    ...(data === undefined ? {} : { data }),
  } as EntryRecord;
}

describe("readTranscript (transcript() is the raw entry scan)", () => {
  it("counts a turn per user entry and keeps every violation entry", () => {
    const read = readTranscript([
      entry(1, "pi.user", undefined, "怎麼證明我存在"),
      entry(2, "app.violation", { type: "coding", excerpt: "寫作業" }),
      entry(3, "pi.assistant", undefined, "先問你自己"),
      entry(4, "app.violation", { type: "coding", excerpt: "寫作業" }),
    ]);

    expect(read.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(read.violations).toEqual([
      { turn: 1, type: "coding", excerpt: "寫作業" },
      { turn: 1, type: "coding", excerpt: "寫作業" },
    ]);
  });

  it("attributes a violation to the turn it arrives in", () => {
    const read = readTranscript([
      entry(1, "pi.user", undefined, "第一題"),
      entry(2, "pi.user", undefined, "第二題"),
      entry(3, "app.violation", { type: "math", excerpt: "2+2" }),
    ]);

    expect(read.violations).toEqual([{ turn: 2, type: "math", excerpt: "2+2" }]);
  });

  it("falls back to a generic type when the entry carries none", () => {
    const read = readTranscript([entry(1, "pi.user", undefined, "嗨"), entry(2, "app.violation", {})]);

    expect(read.violations).toEqual([{ turn: 1, type: "other", excerpt: "" }]);
  });
});

describe("collapseViolations (the report layer keeps one slice per turn/type/excerpt)", () => {
  it("keeps the first of identical slices and preserves the rest", () => {
    const collapsed = collapseViolations([
      { turn: 1, type: "coding", excerpt: "寫作業" },
      { turn: 1, type: "coding", excerpt: "寫作業" },
      { turn: 1, type: "math", excerpt: "寫作業" },
      { turn: 2, type: "coding", excerpt: "寫作業" },
    ]);

    expect(collapsed).toEqual([
      { turn: 1, type: "coding", excerpt: "寫作業" },
      { turn: 1, type: "math", excerpt: "寫作業" },
      { turn: 2, type: "coding", excerpt: "寫作業" },
    ]);
  });

  it("leaves an already-distinct list untouched", () => {
    const slices = [
      { turn: 1, type: "coding" as const, excerpt: "a" },
      { turn: 2, type: "injection" as const, excerpt: "b" },
    ];

    expect(collapseViolations(slices)).toEqual(slices);
  });
});

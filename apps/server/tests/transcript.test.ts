import { describe, expect, it } from "vitest";
import { readTranscript } from "../src/do/chat";
import { collapseViolations } from "../src/do/report-runner";
import { entryFixture as entry } from "./helpers";

describe("readTranscript (transcript() is the raw entry scan)", () => {
  it("counts a turn per user entry and keeps every violation entry", () => {
    const read = readTranscript([
      entry({ id: 1, kind: "pi.user", text: "怎麼證明我存在" }),
      entry({ id: 2, kind: "app.violation", data: { type: "coding", excerpt: "寫作業" } }),
      entry({ id: 3, kind: "pi.assistant", text: "先問你自己" }),
      entry({ id: 4, kind: "app.violation", data: { type: "coding", excerpt: "寫作業" } }),
    ]);

    expect(read.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    expect(read.violations).toEqual([
      { turn: 1, type: "coding", excerpt: "寫作業" },
      { turn: 1, type: "coding", excerpt: "寫作業" },
    ]);
  });

  it("attributes a violation to the turn it arrives in", () => {
    const read = readTranscript([
      entry({ id: 1, kind: "pi.user", text: "第一題" }),
      entry({ id: 2, kind: "pi.user", text: "第二題" }),
      entry({ id: 3, kind: "app.violation", data: { type: "math", excerpt: "2+2" } }),
    ]);

    expect(read.violations).toEqual([{ turn: 2, type: "math", excerpt: "2+2" }]);
  });

  it("falls back to a generic type when the entry carries none", () => {
    const read = readTranscript([
      entry({ id: 1, kind: "pi.user", text: "嗨" }),
      entry({ id: 2, kind: "app.violation", data: {} }),
    ]);

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

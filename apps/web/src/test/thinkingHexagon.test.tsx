import type { ThinkingIndicators } from "@socrates/shared";
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThinkingHexagon } from "@/components/ThinkingHexagon";
import { dictionaries, setLocale } from "@/i18n";
import {
  THINKING_CODES,
  type ThinkingGoal,
  indicatorsToGoals,
  reachOf,
  ringPoints,
  shapePoints,
  spoke,
} from "@/lib/thinking";

const zh = dictionaries["zh-TW"];
const goalRow = (code: string) => document.querySelector(`[data-thinking-goal="${code}"]`) as HTMLElement;

beforeEach(() => setLocale("zh-TW"));
afterEach(cleanup);

describe("thinking geometry", () => {
  it("puts the first axis straight up and spreads the rest evenly", () => {
    const [x, y] = spoke(0, 6, 100);
    expect(x).toBeCloseTo(0);
    expect(y).toBeCloseTo(-100);
    const [x3, y3] = spoke(3, 6, 100);
    expect(x3).toBeCloseTo(0);
    expect(y3).toBeCloseTo(100);
    expect(ringPoints(4, 10).split(" ")).toHaveLength(4);
  });

  it("reaches further for a higher level and never collapses to the centre", () => {
    expect(reachOf(0)).toBeGreaterThan(0);
    expect(reachOf(1)).toBeGreaterThan(reachOf(0));
    expect(reachOf(2)).toBeGreaterThan(reachOf(1));
    expect(reachOf(3)).toBe(1);
    const goals: ThinkingGoal[] = [
      { code: "a", level: 3 },
      { code: "b", level: 0 },
      { code: "c", level: 2 },
    ];
    expect(shapePoints(goals, 100).split(" ")[0]).toBe("0.00,-100.00");
  });

  it("maps backend ThinkingIndicators to six ordered ThinkingGoals", () => {
    const indicators: ThinkingIndicators = {
      c1: { level: 0, turns: [], evidence: "" },
      c2: { level: 1, turns: [2], evidence: "回到題目條件。" },
      s1: { level: 2, turns: [4, 6], evidence: "提出可套用到同類情境的規則。" },
      s2: { level: 3, turns: [5], evidence: "說明理由如何推導到判斷。" },
      a1: { level: 1, turns: [7], evidence: "提到對方也有道理。" },
      a2: { level: 0, turns: [], evidence: "" },
    };
    const goals = indicatorsToGoals(indicators);
    expect(goals.map((goal) => goal.code)).toEqual([...THINKING_CODES]);
    expect(goals[2]).toEqual({
      code: "S1",
      level: 2,
      turns: [4, 6],
      evidence: "提出可套用到同類情境的規則。",
    });
    expect(goals[3]).toEqual({
      code: "S2",
      level: 3,
      turns: [5],
      evidence: "說明理由如何推導到判斷。",
    });
  });
});

describe("ThinkingHexagon", () => {
  const goals: ThinkingGoal[] = [
    { code: "C1", level: 0, turns: [], evidence: "" },
    { code: "C2", level: 1, turns: [2], evidence: "回到題目條件。" },
    { code: "S1", level: 2, turns: [4, 6], evidence: "提出可套用到同類情境的規則。" },
    { code: "S2", level: 3, turns: [5], evidence: "說明理由如何推導到判斷。" },
    { code: "A1", level: 1, turns: [7], evidence: "提到對方也有道理。" },
    { code: "A2", level: 0, turns: [], evidence: "" },
  ];

  it("draws one axis per goal and shows level words, criteria, evidence, and turns", () => {
    render(<ThinkingHexagon goals={goals} />);
    expect(document.querySelector("[data-thinking-chart]")?.getAttribute("data-thinking-chart")).toBe("6");
    expect(document.querySelector("[data-thinking-shape]")?.getAttribute("points")?.split(" ")).toHaveLength(6);
    expect(within(goalRow("C1")).getByText(zh.thinking_level_0)).toBeTruthy();
    expect(within(goalRow("C2")).getByText(zh.thinking_level_1)).toBeTruthy();
    expect(within(goalRow("S1")).getByText(zh.thinking_level_2)).toBeTruthy();
    expect(within(goalRow("S2")).getByText(zh.thinking_level_3)).toBeTruthy();
    expect(within(goalRow("S1")).getByText(zh.thinking_s1_criterion)).toBeTruthy();
    expect(within(goalRow("S1")).getByText("提出可套用到同類情境的規則。")).toBeTruthy();
    expect(within(goalRow("S1")).getByText(/4、6/)).toBeTruthy();
    expect(within(goalRow("C1")).queryByText(/第/)).toBeNull();
  });

  it("follows however many goals the analysis sends, with unknown codes shown as given", () => {
    render(
      <ThinkingHexagon
        goals={[
          { code: "C1", level: 3 },
          { code: "X9", level: 1 },
          { code: "S2", level: 0 },
          { code: "A1", level: 2 },
        ]}
      />,
    );
    expect(document.querySelector("[data-thinking-chart]")?.getAttribute("data-thinking-chart")).toBe("4");
    expect(within(goalRow("X9")).getAllByText("X9").length).toBeGreaterThan(0);
  });

  it("draws nothing with fewer than three goals", () => {
    const { container } = render(<ThinkingHexagon goals={goals.slice(0, 2)} />);
    expect(container.firstChild).toBeNull();
  });
});

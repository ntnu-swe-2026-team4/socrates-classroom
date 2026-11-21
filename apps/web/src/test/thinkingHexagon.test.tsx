import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThinkingHexagon } from "@/components/ThinkingHexagon";
import { dictionaries, setLocale } from "@/i18n";
import {
  THINKING_CODES,
  type ThinkingGoal,
  reachOf,
  ringPoints,
  sampleThinking,
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
    expect(reachOf(2)).toBe(1);
    const goals: ThinkingGoal[] = [
      { code: "a", level: 2 },
      { code: "b", level: 0 },
      { code: "c", level: 1 },
    ];
    expect(shapePoints(goals, 100).split(" ")[0]).toBe("0.00,-100.00");
  });

  it("gives the same sample for the same seed, one entry per goal", () => {
    const first = sampleThinking("學生 3");
    expect(first).toEqual(sampleThinking("學生 3"));
    expect(first.map((goal) => goal.code)).toEqual([...THINKING_CODES]);
    expect(first.every((goal) => [0, 1, 2].includes(goal.level))).toBe(true);
  });
});

describe("ThinkingHexagon", () => {
  const goals: ThinkingGoal[] = [
    { code: "C1", level: 0 },
    { code: "C2", level: 1 },
    { code: "S1", level: 2, turns: [4, 6] },
    { code: "S2", level: 2 },
    { code: "A1", level: 1 },
    { code: "A2", level: 0 },
  ];

  it("draws one axis per goal and names each level in words", () => {
    render(<ThinkingHexagon goals={goals} />);
    expect(document.querySelector("[data-thinking-chart]")?.getAttribute("data-thinking-chart")).toBe("6");
    expect(document.querySelector("[data-thinking-shape]")?.getAttribute("points")?.split(" ")).toHaveLength(6);
    expect(within(goalRow("C1")).getByText(zh.thinking_level_0)).toBeTruthy();
    expect(within(goalRow("C2")).getByText(zh.thinking_level_1)).toBeTruthy();
    expect(within(goalRow("S1")).getByText(zh.thinking_level_2)).toBeTruthy();
    expect(within(goalRow("S1")).getByText(zh.thinking_s1_criterion)).toBeTruthy();
    expect(within(goalRow("S1")).getByText(/4、6/)).toBeTruthy();
    expect(document.querySelector("[data-thinking-sample]")).toBeNull();
  });

  it("says so when the data is a sample", () => {
    render(<ThinkingHexagon goals={goals} sample />);
    expect(screen.getByText(zh.thinking_sample)).toBeTruthy();
  });

  it("follows however many goals the analysis sends, with unknown codes shown as given", () => {
    render(
      <ThinkingHexagon
        goals={[
          { code: "C1", level: 2 },
          { code: "X9", level: 1 },
          { code: "S2", level: 0 },
          { code: "A1", level: 1 },
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

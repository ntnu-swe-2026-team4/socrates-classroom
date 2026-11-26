import type { Indicator, ThinkingIndicators } from "@socrates/shared";

export type ThinkingLevel = Indicator["level"];

export interface ThinkingGoal {
  code: string;
  level: ThinkingLevel;
  turns?: readonly number[];
  evidence?: string;
}

export const THINKING_CODES = ["C1", "C2", "S1", "S2", "A1", "A2"] as const;
export type ThinkingCode = (typeof THINKING_CODES)[number];
export const MIN_GOALS = 3;

const LEVEL_REACH: Record<ThinkingLevel, number> = { 0: 0.22, 1: 0.48, 2: 0.74, 3: 1 };

const INDICATOR_ENTRIES: ReadonlyArray<readonly [ThinkingCode, keyof ThinkingIndicators]> = [
  ["C1", "c1"],
  ["C2", "c2"],
  ["S1", "s1"],
  ["S2", "s2"],
  ["A1", "a1"],
  ["A2", "a2"],
];

export const reachOf = (level: ThinkingLevel) => LEVEL_REACH[level];

export function spoke(index: number, count: number, radius: number): readonly [number, number] {
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

export function ringPoints(count: number, radius: number): string {
  return Array.from({ length: count }, (_, index) => {
    const [x, y] = spoke(index, count, radius);
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  }).join(" ");
}

export function shapePoints(goals: readonly ThinkingGoal[], radius: number): string {
  return goals
    .map((goal, index) => {
      const [x, y] = spoke(index, goals.length, radius * reachOf(goal.level));
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

export function indicatorsToGoals(indicators: ThinkingIndicators): ThinkingGoal[] {
  return INDICATOR_ENTRIES.map(([code, key]) => {
    const { level, turns, evidence } = indicators[key];
    return { code, level, turns, evidence };
  });
}

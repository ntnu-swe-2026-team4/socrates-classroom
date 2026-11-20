export type ThinkingLevel = 0 | 1 | 2;

export interface ThinkingGoal {
  code: string;
  level: ThinkingLevel;
  turns?: number[];
}

export const THINKING_CODES = ["C1", "C2", "S1", "S2", "A1", "A2"] as const;
export const MIN_GOALS = 3;

const LEVEL_REACH: Record<ThinkingLevel, number> = { 0: 0.28, 1: 0.64, 2: 1 };

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

function hash(text: string): number {
  let value = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

export function sampleThinking(seed: string): ThinkingGoal[] {
  return THINKING_CODES.map((code) => ({ code, level: (hash(`${seed}:${code}`) % 3) as ThinkingLevel }));
}

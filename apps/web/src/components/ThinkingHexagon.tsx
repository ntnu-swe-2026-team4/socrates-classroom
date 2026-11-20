import { useId } from "react";
import { cn } from "@/components/ui";
import { type MessageKey, useT } from "@/i18n";
import {
  MIN_GOALS,
  type ThinkingGoal,
  type ThinkingLevel,
  reachOf,
  ringPoints,
  shapePoints,
  spoke,
} from "@/lib/thinking";

const PANEL = "rounded-2xl border border-line bg-card";
const DIVIDER = "border-t border-line";
const NOTICE = "rounded-lg border border-dashed border-line-strong";
const SIZE = 300;
const RADIUS = 98;
const LABEL_REACH = 1.2;
const LEVELS: ThinkingLevel[] = [0, 1, 2];
const LEVEL_KEYS: Record<ThinkingLevel, MessageKey> = {
  0: "thinking_level_0",
  1: "thinking_level_1",
  2: "thinking_level_2",
};
const GOAL_KEYS: Record<string, { name: MessageKey; criterion: MessageKey }> = {
  C1: { name: "thinking_c1_name", criterion: "thinking_c1_criterion" },
  C2: { name: "thinking_c2_name", criterion: "thinking_c2_criterion" },
  S1: { name: "thinking_s1_name", criterion: "thinking_s1_criterion" },
  S2: { name: "thinking_s2_name", criterion: "thinking_s2_criterion" },
  A1: { name: "thinking_a1_name", criterion: "thinking_a1_criterion" },
  A2: { name: "thinking_a2_name", criterion: "thinking_a2_criterion" },
};

export function ThinkingHexagon({ goals, sample = false }: { goals: readonly ThinkingGoal[]; sample?: boolean }) {
  const t = useT();
  const titleId = useId();
  if (goals.length < MIN_GOALS) return null;
  const nameOf = (goal: ThinkingGoal) => {
    const keys = GOAL_KEYS[goal.code];
    return keys ? t(keys.name) : goal.code;
  };

  return (
    <section aria-labelledby={titleId} className={cn(PANEL, "flex flex-col overflow-hidden")}>
      <header className="p-5">
        <h2 id={titleId} className="font-serif text-lg font-semibold text-ink">
          {t("thinking_title")}
        </h2>
        <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">{t("thinking_hint")}</p>
        {sample && (
          <p data-thinking-sample className={cn(NOTICE, "mt-3 px-3 py-2 text-[12.5px] leading-relaxed text-ink-soft")}>
            {t("thinking_sample")}
          </p>
        )}
      </header>

      <div className={cn(DIVIDER, "grid md:grid-cols-[minmax(0,19rem)_minmax(0,1fr)]")}>
        <div className="flex items-center justify-center bg-paper p-3">
          <svg
            viewBox={`${-SIZE / 2} ${-SIZE / 2} ${SIZE} ${SIZE}`}
            role="img"
            aria-label={t("thinking_chart_label", { n: goals.length })}
            data-thinking-chart={goals.length}
            className="block w-full max-w-[19rem]"
          >
            {LEVELS.map((level) => (
              <polygon
                key={level}
                points={ringPoints(goals.length, RADIUS * reachOf(level))}
                className="fill-none stroke-line-strong"
                strokeWidth={1}
                strokeDasharray={level === 2 ? undefined : "2 4"}
              />
            ))}
            {goals.map((goal, index) => {
              const [x, y] = spoke(index, goals.length, RADIUS);
              return <line key={goal.code} x2={x} y2={y} className="stroke-line" strokeWidth={1} />;
            })}
            <polygon
              points={shapePoints(goals, RADIUS)}
              data-thinking-shape
              className="fill-ember-wash stroke-ink"
              strokeWidth={1.6}
              strokeLinejoin="round"
            />
            {goals.map((goal, index) => {
              const [x, y] = spoke(index, goals.length, RADIUS * reachOf(goal.level));
              const [lx, ly] = spoke(index, goals.length, RADIUS * LABEL_REACH);
              return (
                <g key={goal.code}>
                  <circle cx={x} cy={y} r={3.2} className="fill-ink" />
                  <text
                    x={lx}
                    y={ly}
                    textAnchor={lx > 8 ? "start" : lx < -8 ? "end" : "middle"}
                    dominantBaseline={ly > 8 ? "hanging" : ly < -8 ? "auto" : "middle"}
                    className="fill-ink-soft text-[12px]"
                  >
                    {nameOf(goal)}
                  </text>
                </g>
              );
            })}
          </svg>
        </div>

        <ul className="flex flex-col border-t border-line md:border-l md:border-t-0">
          {goals.map((goal, index) => {
            const keys = GOAL_KEYS[goal.code];
            return (
              <li
                key={goal.code}
                data-thinking-goal={goal.code}
                data-thinking-level={goal.level}
                className={cn("px-4 py-3", index > 0 && DIVIDER)}
              >
                <p className="flex items-center gap-2 text-[13.5px] text-ink">
                  <span className="font-medium">{nameOf(goal)}</span>
                  <span className="text-[12px] text-ink-faint">{goal.code}</span>
                  <span className="ml-auto flex items-center gap-2 text-[12.5px] text-ink-soft">
                    <span aria-hidden className="flex gap-0.5">
                      {LEVELS.slice(1).map((step) => (
                        <span
                          key={step}
                          className={cn("size-2 border border-ink", goal.level >= step ? "bg-ink" : "bg-transparent")}
                        />
                      ))}
                    </span>
                    {t(LEVEL_KEYS[goal.level])}
                  </span>
                </p>
                {keys && <p className="mt-1 text-[12.5px] leading-relaxed text-ink-faint">{t(keys.criterion)}</p>}
                {goal.turns && goal.turns.length > 0 && (
                  <p className="mt-0.5 text-[12px] text-ink-faint">
                    {t("report_turn_ref", { turns: goal.turns.join("、") })}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

export type AvatarState = "idle" | "listening" | "thinking" | "speaking";

export function AvatarStage({
  state,
  amplitude,
  size = 112,
}: {
  state: AvatarState;
  amplitude: number;
  size?: number;
}) {
  const cssVar = { ["--amp" as string]: amplitude.toFixed(3) };
  return (
    <div
      className="relative shrink-0 select-none"
      style={{ ...cssVar, width: size, height: size } as React.CSSProperties}
      role="img"
      aria-label={`socrates-${state}`}
    >
      <svg viewBox="0 0 96 96" className="h-full w-full" role="img" aria-label={`socrates ${state}`}>
        <title>{`socrates ${state}`}</title>
        <circle cx="48" cy="48" r="45" className="fill-none stroke-line" strokeWidth="1" />
        {state === "listening" && (
          <circle cx="48" cy="48" r="45" className="stroke-ember avatar-listening fill-none" strokeWidth="1.5" />
        )}
        {state === "thinking" && (
          <circle
            cx="48"
            cy="48"
            r="41"
            className="fill-none stroke-ink-faint avatar-thinking"
            strokeWidth="1.5"
            strokeDasharray="3 11"
            strokeLinecap="round"
          />
        )}
        {state === "speaking" && (
          <g>
            {[0, 1, 2, 3].map((i) => (
              <rect
                key={i}
                x={43 + i * 4}
                y={84 - Math.round(4 + amplitude * 14 * (i % 2 === 0 ? 1 : 0.7))}
                width="2"
                height={Math.round(4 + amplitude * 14 * (i % 2 === 0 ? 1 : 0.7))}
                rx="1"
                className="fill-ember"
              />
            ))}
          </g>
        )}
        <g className={state === "idle" ? "fill-ink-soft avatar-idle" : "fill-ink-soft"}>
          <circle cx="48" cy="38" r="11.5" />
          <path d="M24 82 C28 62 38 56 48 56 C58 56 68 62 72 82 Z" />
        </g>
        {state === "thinking" && (
          <text x="48" y="20" textAnchor="middle" className="fill-ink-faint" fontSize="7">
            ···
          </text>
        )}
      </svg>
    </div>
  );
}

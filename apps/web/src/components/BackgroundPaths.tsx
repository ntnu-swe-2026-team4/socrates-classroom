import { useEffect, useId, useRef } from "react";

const paths = [
  "M-160 196C42 74 189 80 346 185s236 132 377 30 250-151 412-59 240 168 466 68",
  "M-180 296C8 167 174 144 339 251s228 152 379 55 249-159 399-77 264 178 486 80",
  "M-150 397C36 270 198 224 353 322s229 173 381 79 245-166 402-92 265 181 482 92",
  "M-160 502C31 366 197 309 357 406s230 185 386 96 248-174 409-101 260 177 476 101",
  "M-160 606C31 471 203 398 364 496s235 190 390 112 250-175 408-108 257 162 474 103",
  "M-140 713C40 582 213 491 372 589s237 185 393 112 254-162 409-101 250 148 462 93",
  "M-120 824C53 695 221 588 382 687s241 178 396 107 258-149 410-93 243 133 449 82",
  "M-100 934C69 806 234 683 394 784s244 168 399 101 259-136 410-86 236 117 434 71",
];

type Props = { variant?: "hero" | "story" | "login"; mirrored?: boolean };

/** Shared atmosphere, with fewer and quieter paths behind the story. */
export function BackgroundPaths({ variant = "login", mirrored = false }: Props) {
  const svg = useRef<SVGSVGElement>(null);
  const gradientId = useId();
  useEffect(() => {
    const el = svg.current!;
    let inView = false;
    const sync = () => { el.dataset.running = String(inView && !document.hidden); };
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); }, { root: el.closest("#site-scroll"), threshold: .15 });
    observer.observe(el);
    document.addEventListener("visibilitychange", sync);
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", sync); };
  }, []);
  return (
    <svg
      ref={svg}
      className={`background-paths background-paths--${variant}${mirrored ? " is-mirrored" : ""}`}
      viewBox="0 0 1440 900"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="#b3813a" stopOpacity="0.12" />
          <stop offset="48%" stopColor="#b3813a" stopOpacity="0.72" />
          <stop offset="100%" stopColor="#66794f" stopOpacity="0.18" />
        </linearGradient>
      </defs>
      {paths.filter((_, i) => variant === "login" || (variant === "hero" ? i > 0 && i < 7 : i % 2 === 0)).map((d, i) => (
        <g key={d}>
          <path className="background-path-base" d={d} pathLength="1" />
          <path
            className="background-path-tracer"
            stroke={`url(#${gradientId})`}
            d={d}
            pathLength="1"
            style={{ animationDelay: `${i * .12}s` }}
          />
        </g>
      ))}
    </svg>
  );
}

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { cn } from "@/components/ui";
import { LANGS, setLocale, useI18n, type Locale, type MessageKey } from "@/i18n";
import { normalizeJoinCode } from "@/lib/joinCode";
import { createFrameLoop } from "@/lib/frameLoop";
import { onReducedMotionChange } from "@/lib/motion";

export const Route = createFileRoute("/")({
  component: ComicLanding,
});

const ASSET_VERSION = "23";
const SCENE_SHIFT = 3;
const asset = (name: string) => `/story/${name}.webp?v=${ASSET_VERSION}`;

interface SpriteSheet {
  src: string;
  width: number;
  height: number;
}

interface SheetPair {
  small: SpriteSheet;
  large: SpriteSheet;
}

const WALK: SheetPair = {
  small: { src: asset("walk-sm"), width: 480, height: 288 },
  large: { src: asset("walk"), width: 800, height: 480 },
};
const FEET: SheetPair = {
  small: { src: asset("feet"), width: 480, height: 197 },
  large: { src: asset("feet"), width: 480, height: 197 },
};
const LEGS: SheetPair = {
  small: { src: asset("legs"), width: 480, height: 200 },
  large: { src: asset("legs"), width: 480, height: 200 },
};
const TURN: SheetPair = {
  small: { src: asset("turn-sm"), width: 400, height: 400 },
  large: { src: asset("turn"), width: 600, height: 600 },
};
const DESERT: SheetPair = {
  small: { src: asset("desert-sm"), width: 480, height: 300 },
  large: { src: asset("desert"), width: 800, height: 500 },
};
const HEAD: SheetPair = {
  small: { src: asset("head-spin-sm"), width: 280, height: 280 },
  large: { src: asset("head-spin"), width: 400, height: 400 },
};
const EYE_SOCKETS = [
  { x: 0.2586, y: 0.608 },
  { x: 0.7619, y: 0.6009 },
] as const;
const IRIS = { size: 0.118, reachX: 0.6, reachY: 0.1 } as const;
const TURN_TIMING = { frames: 24, columns: 6, fillMs: 1500, drainMs: 650 } as const;
const HEAD_SPIN = { frames: 36, columns: 6, idle: 0.22, fast: 2.3, wakeAfter: 2.2 } as const;
const LANG_SHORT: Record<Locale, string> = { "zh-TW": "中", en: "EN", es: "ES" };
const PLATE = "flex h-9 items-stretch border-2 border-comic-ink bg-comic-paper text-comic-ink";
const PLATE_FOCUS = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vermilion";
const TAG_REST: { x: number; y: number } = { x: 0.5, y: 0.8 };
const PAINT_MS = 30;
const FRAME = "border-[3px] border-comic-ink";
const FLAME_HEIGHT = "h-[clamp(170px,30vw,420px)]";
const TAG_BUTTON =
  "absolute top-0 left-0 size-[88px] -translate-x-1/2 -translate-y-1/2 cursor-pointer touch-none rounded-full transition-opacity duration-300 select-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-vermilion";
const TAG_FACE =
  "flex size-full items-center justify-center rounded-full border-2 border-comic-ink bg-comic-paper text-center text-[11.5px] leading-tight font-bold tracking-[0.18em] whitespace-pre-line text-comic-ink transition-transform duration-200";

const FIGURES = {
  hero: { ratio: 0.9833, anchor: 0.1889, scale: 1.09 },
  youth_a: { ratio: 0.969, anchor: 0.2015, scale: 1 },
  youth_b: { ratio: 1.0357, anchor: 0.1299, scale: 1 },
  woman_a: { ratio: 1.019, anchor: 0.236, scale: 1 },
  woman_b: { ratio: 0.9381, anchor: 0.1688, scale: 1 },
} as const;
type FigureKey = keyof typeof FIGURES;

const CAST: Array<{ figure: FigureKey; x: number; y: number }> = [
  { figure: "woman_a", x: 0.46, y: 0.45 },
  { figure: "youth_b", x: 0.6, y: 0.52 },
  { figure: "woman_b", x: 0.4, y: 0.6 },
  { figure: "youth_a", x: 0.61, y: 0.79 },
  { figure: "woman_a", x: 0.74, y: 0.83 },
  { figure: "hero", x: 0.48, y: 0.81 },
];

const ENGINEERS = [
  { key: "eng1", x: 0.1479, y: 0.9896, ratio: 0.3692, anchor: 0.4705, scale: 1.052 },
  { key: "eng2", x: 0.3378, y: 0.9221, ratio: 0.3231, anchor: 0.4459, scale: 1.03 },
  { key: "eng3", x: 0.4786, y: 0.9612, ratio: 0.3308, anchor: 0.4719, scale: 1.075 },
  { key: "eng4", x: 0.6089, y: 0.9055, ratio: 0.3654, anchor: 0.4868, scale: 0.985 },
  { key: "eng5", x: 0.7657, y: 0.95, ratio: 0.3308, anchor: 0.517, scale: 0.963 },
] as const;
const SAND = { horizon: 0.5702, slope: 0.5947, near: 0.992, far: 0.9, grip: 14 } as const;

const CROWD = [
  { id: 0, x: 0.2471, y: 0.9989, ratio: 0.2915, anchor: 0.4634, scale: 1.009 },
  { id: 1, x: 0.6582, y: 0.9531, ratio: 0.3178, anchor: 0.5163, scale: 1.01 },
  { id: 2, x: 0.535, y: 0.8309, ratio: 0.3733, anchor: 0.4037, scale: 1.009 },
  { id: 3, x: 0.3489, y: 0.7714, ratio: 0.4187, anchor: 0.5388, scale: 1.009 },
  { id: 4, x: 0.6368, y: 0.7371, ratio: 0.4155, anchor: 0.4341, scale: 1.008 },
  { id: 5, x: 0.4646, y: 0.7029, ratio: 0.3834, anchor: 0.5743, scale: 1.01 },
  { id: 6, x: 0.5618, y: 0.6834, ratio: 0.3483, anchor: 0.4274, scale: 1.01 },
  { id: 7, x: 0.5032, y: 0.6537, ratio: 0.381, anchor: 0.4922, scale: 1.096 },
] as const;
const CROWD_FLOOR = { horizon: 0.454, slope: 0.8775 } as const;
const CROWD_VOICES: Partial<Record<number, { lines: MessageKey[]; tilt: string }>> = {
  0: { lines: ["comic_q1", "comic_q1b", "comic_q1c"], tilt: "-rotate-3" },
  5: { lines: ["comic_q2", "comic_q2b", "comic_q2c"], tilt: "rotate-2" },
  4: { lines: ["comic_q3", "comic_q3b", "comic_q3c"], tilt: "-rotate-1" },
};
const IRIS_COLOURS = ["blue", "grey", "ochre"] as const;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const clamp01 = (value: number) => clamp(value, 0, 1);
const smooth = (value: number) => {
  const x = clamp01(value);
  return x * x * (3 - 2 * x);
};
const pickSheet = (pair: SheetPair) => (window.innerWidth < 720 ? pair.small : pair.large);
const prefersStill = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
const hasFinePointer = () => window.matchMedia?.("(hover: hover) and (pointer: fine)").matches ?? false;
const figureHeight = (y: number) => (y < 0.66 ? 0.0704 + (y - 0.3938) * 0.155 : 0.1115 + (y - 0.66) * 0.34);
const stageHalfWidth = (y: number) => (y < 0.66 ? 0.19 + (y - 0.39) * 0.5 : 0.455);
const engineerHeight = (y: number) => SAND.slope * (y - SAND.horizon);
const crowdHeight = (y: number) => CROWD_FLOOR.slope * (y - CROWD_FLOOR.horizon);

function loadSheet(image: HTMLImageElement, src: string, onReady: () => void) {
  let done = false;
  const finish = () => {
    if (done) return;
    done = true;
    onReady();
  };
  image.decoding = "async";
  image.src = src;
  if (typeof image.decode !== "function") {
    image.onload = finish;
    return;
  }
  image.decode().then(finish, () => {
    if (image.complete && image.naturalWidth > 0) finish();
    else image.onload = finish;
  });
}

function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function whenNear(node: Element, margin: string, onNear: () => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    onNear();
    return () => {};
  }
  const watcher = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      watcher.disconnect();
      onNear();
    },
    { rootMargin: margin },
  );
  watcher.observe(node);
  return () => watcher.disconnect();
}

function whileVisible(node: Element, margin: string, onChange: (visible: boolean) => void): () => void {
  if (typeof IntersectionObserver === "undefined") {
    onChange(true);
    return () => {};
  }
  const watcher = new IntersectionObserver((entries) => onChange(entries.some((entry) => entry.isIntersecting)), {
    rootMargin: margin,
  });
  watcher.observe(node);
  return () => watcher.disconnect();
}

function Caption({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <figcaption
      className={cn(
        "absolute z-20 max-w-[min(78vw,340px)] border-2 border-comic-ink bg-comic-paper px-3 py-2 text-[12.5px] leading-relaxed font-medium tracking-wide text-comic-ink md:text-[13.5px]",
        className,
      )}
    >
      {children}
    </figcaption>
  );
}

function Panel({
  src,
  ratio,
  className,
  children,
}: {
  src: string;
  ratio: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <figure data-panel className={cn("relative", className)}>
      <div className={cn("overflow-hidden bg-comic-paper", FRAME)} style={{ aspectRatio: ratio }}>
        <img
          data-scene="1.12"
          src={asset(src)}
          alt=""
          loading="lazy"
          decoding="async"
          className="size-full object-cover"
        />
      </div>
      {children}
    </figure>
  );
}

function LoopCanvas({
  sheets,
  frames,
  columns,
  fps,
  className,
}: {
  sheets: SheetPair;
  frames: number;
  columns: number;
  fps: number;
  className?: string;
}) {
  const attach = useCallback(
    (view: HTMLCanvasElement | null) => {
      if (!view) return;
      const context = view.getContext("2d");
      if (!context) return;
      const sheet = pickSheet(sheets);
      view.width = sheet.width;
      view.height = sheet.height;
      const image = new Image();
      let still = prefersStill();
      let ready = false;
      let visible = false;
      let started = 0;
      let drawn = -1;

      const draw = (index: number) => {
        if (index === drawn) return;
        drawn = index;
        context.drawImage(
          image,
          (index % columns) * sheet.width,
          Math.floor(index / columns) * sheet.height,
          sheet.width,
          sheet.height,
          0,
          0,
          sheet.width,
          sheet.height,
        );
      };
      const tick = createFrameLoop((now: number) => {
        if (!started) started = now;
        draw(Math.floor(((now - started) / 1000) * fps) % frames);
        return visible;
      });
      const sync = () => {
        if (!ready) return;
        if (drawn < 0) draw(0);
        if (!still && visible) tick.wake();
      };
      let asked = false;
      const unwatch = whileVisible(view, "50% 0px", (next) => {
        visible = next;
        if (visible && !asked) {
          asked = true;
          loadSheet(image, sheet.src, () => {
            ready = true;
            sync();
          });
        }
        sync();
      });
      const unwatchMotion = onReducedMotionChange((next) => {
        still = next;
        if (next) {
          tick.stop();
          draw(0);
        } else {
          sync();
        }
      });
      return () => {
        unwatch();
        unwatchMotion();
        tick.stop();
      };
    },
    [sheets, frames, columns, fps],
  );

  return <canvas ref={attach} className={className} />;
}

function Inset({
  ratio,
  className,
  depth = 1.7,
  children,
}: {
  ratio: string;
  className?: string;
  depth?: number;
  children: ReactNode;
}) {
  return (
    <div
      data-float
      data-depth={depth}
      className={cn("absolute z-10 overflow-hidden bg-comic-paper", FRAME, className)}
      style={{ aspectRatio: ratio }}
    >
      {children}
    </div>
  );
}

function EyesInset({ label }: { label: string }) {
  const [colour, setColour] = useState(0);

  const attach = useCallback((view: HTMLButtonElement | null) => {
    if (!view) return;
    const irises = Array.from(view.querySelectorAll<HTMLElement>("[data-iris]"));
    let still = prefersStill();
    const gaze = { x: 0, y: 0 };
    const want = { x: 0, y: 0 };
    let visible = false;
    let lastInput = Number.NEGATIVE_INFINITY;

    const tick = createFrameLoop((now: number) => {
      const idle = now - lastInput > 2600;
      if (idle && !still) {
        want.x = 0.92 * Math.sin(now / 1500);
        want.y = 0.5 * Math.sin(now / 2300);
      }
      gaze.x += (want.x - gaze.x) * 0.14;
      gaze.y += (want.y - gaze.y) * 0.14;
      const shift = `translate(${(-50 + gaze.x * IRIS.reachX * 100).toFixed(1)}%,${(-50 + gaze.y * IRIS.reachY * 100).toFixed(1)}%)`;
      for (const iris of irises) iris.style.transform = shift;
      const settled = Math.abs(want.x - gaze.x) < 0.002 && Math.abs(want.y - gaze.y) < 0.002;
      return visible && (!still || !settled);
    });
    const wake = () => {
      if (visible) tick.wake();
    };
    const onPointer = (event: PointerEvent) => {
      const rect = view.getBoundingClientRect();
      want.x = clamp((event.clientX - (rect.left + rect.width / 2)) / Math.max(1, window.innerWidth * 0.4), -1, 1);
      want.y = clamp((event.clientY - (rect.top + rect.height / 2)) / Math.max(1, window.innerHeight * 0.5), -1, 1);
      lastInput = performance.now();
      wake();
    };
    const unwatch = whileVisible(view, "40% 0px", (next) => {
      visible = next;
      wake();
    });
    const unwatchMotion = onReducedMotionChange((next) => {
      still = next;
      if (!next) wake();
    });
    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("pointerdown", onPointer, { passive: true });
    return () => {
      unwatch();
      unwatchMotion();
      tick.stop();
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
    };
  }, []);

  const mask = `url(${asset("eyes-mask")})`;
  return (
    <button
      ref={attach}
      type="button"
      aria-label={label}
      title={label}
      onClick={() => setColour((colour + 1) % IRIS_COLOURS.length)}
      className="relative block size-full cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vermilion"
    >
      <img
        src={asset("eyes-base")}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover"
      />
      <div
        className="absolute inset-0"
        style={{ maskImage: mask, WebkitMaskImage: mask, maskSize: "100% 100%", WebkitMaskSize: "100% 100%" }}
      >
        {EYE_SOCKETS.map((socket) => (
          <img
            key={socket.x}
            data-iris
            src={asset(`eyes-iris-${IRIS_COLOURS[colour]}`)}
            alt=""
            loading="lazy"
            className="absolute aspect-square will-change-transform"
            style={{
              left: `${socket.x * 100}%`,
              top: `${socket.y * 100}%`,
              width: `${IRIS.size * 100}%`,
              transform: "translate(-50%,-50%)",
            }}
          />
        ))}
      </div>
      <img
        src={asset("eyes-lid")}
        alt=""
        loading="lazy"
        decoding="async"
        className="absolute inset-0 size-full object-cover"
      />
    </button>
  );
}

function CursorTag({
  layer,
  tag,
  label,
  ariaLabel,
  pressed,
  hidden = false,
}: {
  layer: RefObject<HTMLSpanElement | null>;
  tag: RefObject<HTMLButtonElement | null>;
  label: string;
  ariaLabel: string;
  pressed: boolean;
  hidden?: boolean;
}) {
  return (
    <span
      ref={layer}
      className="pointer-events-none absolute inset-0 will-change-transform"
      style={{ transform: `translate3d(${TAG_REST.x * 100}%,${TAG_REST.y * 100}%,0)` }}
    >
      <button
        ref={tag}
        type="button"
        aria-label={ariaLabel}
        tabIndex={hidden ? -1 : 0}
        className={cn(TAG_BUTTON, hidden ? "pointer-events-none opacity-0" : "pointer-events-auto")}
      >
        <span className={cn(TAG_FACE, pressed && "scale-[0.28]")}>
          <span className={cn("transition-opacity duration-150", pressed && "opacity-0")}>{label}</span>
        </span>
      </button>
    </span>
  );
}

function WindCanvas({ seed, className }: { seed: number; className?: string }) {
  const attach = useCallback(
    (view: HTMLCanvasElement | null) => {
      if (!view) return;
      const context = view.getContext("2d");
      if (!context) return;
      const ink = getComputedStyle(view).color;
      let still = prefersStill();
      const random = seeded(seed);
      const gusts = Array.from({ length: 5 }, (_, index) => ({
        start: index * 0.9 + random() * 1.2,
        span: 1.5 + random() * 1.3,
        rest: 0.9 + random() * 2.6,
        lane: random(),
        bow: (random() - 0.5) * 0.03,
        lines: Array.from({ length: 3 + Math.floor(random() * 3) }, (_, row) => ({
          row: row - 2 + (random() - 0.5) * 0.5,
          lead: random() * 0.5,
          length: 0.18 + random() * 0.3,
          weight: 0.5 + random() * 0.8,
        })),
      }));
      const STEPS = 8;
      let visible = false;

      const draw = (time: number) => {
        const width = view.width;
        const height = view.height;
        const density = width / Math.max(1, view.clientWidth);
        context.clearRect(0, 0, width, height);
        context.fillStyle = ink;
        for (const gust of gusts) {
          const cycle = gust.span + gust.rest;
          const since = time - gust.start;
          const local = ((since % cycle) + cycle) % cycle;
          if (local > gust.span) continue;
          const lane = (gust.lane + Math.abs(Math.floor(since / cycle)) * 0.381) % 1;
          const progress = local / gust.span;
          for (const line of gust.lines) {
            const length = line.length * width;
            const head = -length + (width + length) * (progress * (1 + line.lead) - line.lead / 2);
            if (head > width || head + length < 0) continue;
            const base = (0.06 + lane * 0.88) * height + line.row * Math.max(0.016 * height, 7 * density);
            const edge: Array<[number, number, number]> = [];
            for (let step = 0; step <= STEPS; step += 1) {
              const s = step / STEPS;
              const swell = Math.sin(Math.PI * s);
              edge.push([head + length * s, base + gust.bow * height * swell, line.weight * density * swell ** 0.7]);
            }
            context.beginPath();
            for (const [x, y, half] of edge) context.lineTo(x, y - half);
            for (let step = STEPS; step >= 0; step -= 1) {
              const [x, y, half] = edge[step]!;
              context.lineTo(x, y + half);
            }
            context.closePath();
            context.fill();
          }
        }
      };
      let painted = 0;
      const tick = createFrameLoop((now: number) => {
        if (now - painted >= PAINT_MS) {
          painted = now;
          draw(now / 1000);
        }
        return visible && !still;
      });
      const wake = () => {
        if (visible && !still) tick.wake();
      };
      const resize = () => {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.min(1100, Math.round(view.clientWidth * ratio));
        view.width = width;
        view.height = Math.round((width * view.clientHeight) / Math.max(1, view.clientWidth));
        draw(still ? 2.4 : performance.now() / 1000);
      };
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
      observer?.observe(view);
      resize();
      const unwatch = whileVisible(view, "20% 0px", (next) => {
        visible = next;
        wake();
      });
      const unwatchMotion = onReducedMotionChange((next) => {
        still = next;
        if (next) {
          tick.stop();
          draw(2.4);
        } else {
          wake();
        }
      });
      return () => {
        observer?.disconnect();
        unwatch();
        unwatchMotion();
        tick.stop();
      };
    },
    [seed],
  );

  return (
    <canvas
      ref={attach}
      aria-hidden
      data-wind
      className={cn("pointer-events-none absolute inset-0 size-full text-comic-ink", className)}
    />
  );
}

function AgoraStage({ children }: { children?: ReactNode }) {
  const attach = useCallback((board: HTMLDivElement | null) => {
    if (!board) return;
    const actors = Array.from(board.querySelectorAll<HTMLElement>("[data-actor]"));
    const releases = actors.map((node) => {
      const figure = FIGURES[node.dataset.figure as FigureKey];
      let pointer = -1;
      let grabX = 0;
      let grabY = 0;
      const onDown = (event: PointerEvent) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const box = node.getBoundingClientRect();
        grabX = event.clientX - (box.left + box.width * figure.anchor);
        grabY = event.clientY - box.bottom;
        pointer = event.pointerId;
        try {
          node.setPointerCapture(pointer);
        } catch {}
        node.dataset.held = "true";
        event.preventDefault();
      };
      const onMove = (event: PointerEvent) => {
        if (event.pointerId !== pointer) return;
        const rect = board.getBoundingClientRect();
        const y = clamp((event.clientY - grabY - rect.top) / rect.height, 0.4, 0.93);
        const half = stageHalfWidth(y);
        const x = clamp((event.clientX - grabX - rect.left) / rect.width, 0.5 - half, 0.5 + half);
        node.style.left = `${(x * 100).toFixed(2)}%`;
        node.style.top = `${(y * 100).toFixed(2)}%`;
        node.style.height = `${(figureHeight(y) * figure.scale * 100).toFixed(2)}%`;
        node.style.zIndex = String(Math.round(y * 100));
      };
      const onUp = (event: PointerEvent) => {
        if (event.pointerId !== pointer) return;
        pointer = -1;
        delete node.dataset.held;
      };
      node.addEventListener("pointerdown", onDown);
      node.addEventListener("pointermove", onMove);
      node.addEventListener("pointerup", onUp);
      node.addEventListener("pointercancel", onUp);
      return () => {
        node.removeEventListener("pointerdown", onDown);
        node.removeEventListener("pointermove", onMove);
        node.removeEventListener("pointerup", onUp);
        node.removeEventListener("pointercancel", onUp);
      };
    });
    return () => {
      for (const release of releases) release();
    };
  }, []);

  return (
    <figure className="relative left-1/2 w-[var(--joint)] -translate-x-1/2">
      <div
        className="relative bg-comic-paper [clip-path:polygon(12%_0,88%_0,100%_100%,0_100%)]"
        style={{ aspectRatio: "1100 / 1320" }}
      >
        <div ref={attach} data-scene className="absolute inset-0">
          <img
            src={asset("agora-plate")}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
          {CAST.map((actor) => {
            const figure = FIGURES[actor.figure];
            return (
              <img
                key={`${actor.figure}-${actor.x}`}
                data-actor
                data-figure={actor.figure}
                src={asset(`fig-${actor.figure}`)}
                alt=""
                draggable={false}
                className="absolute w-auto max-w-none cursor-grab touch-none select-none data-[held=true]:cursor-grabbing"
                style={{
                  left: `${actor.x * 100}%`,
                  top: `${actor.y * 100}%`,
                  height: `${figureHeight(actor.y) * figure.scale * 100}%`,
                  aspectRatio: String(figure.ratio),
                  transform: `translate(${-figure.anchor * 100}%,-100%)`,
                  zIndex: Math.round(actor.y * 100),
                }}
              />
            );
          })}
          <WindCanvas seed={5} className="z-[200]" />
        </div>
      </div>
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        fill="none"
        className="pointer-events-none absolute inset-0 size-full overflow-visible"
      >
        <polyline
          points="0,100 12,0 88,0 100,100"
          strokeWidth={3}
          strokeLinejoin="miter"
          vectorEffect="non-scaling-stroke"
          className="stroke-comic-ink"
        />
      </svg>
      {children}
    </figure>
  );
}

function DesertStage({ children }: { children?: ReactNode }) {
  const attach = useCallback((board: HTMLDivElement | null) => {
    if (!board) return;
    const unwatch = whileVisible(board, "10% 0px", (visible) => {
      board.dataset.live = String(visible);
    });
    const releases = Array.from(board.querySelectorAll<HTMLElement>("[data-engineer]")).map((node) => {
      const spec = ENGINEERS.find((item) => item.key === node.dataset.engineer);
      const body = node.querySelector<HTMLElement>("[data-body]");
      if (!spec || !body) return () => {};
      let pointer = -1;
      let grabX = 0;
      let grabY = 0;
      const place = (event: PointerEvent) => {
        const rect = board.getBoundingClientRect();
        const x = clamp((event.clientX - grabX - rect.left) / rect.width, 0.04, 0.96);
        const feet = (event.clientY - grabY - rect.top) / rect.height;
        const ground = clamp(feet, SAND.far, SAND.near);
        const lift = Math.max(SAND.grip, (ground - feet) * rect.height + SAND.grip);
        node.style.left = `${(x * 100).toFixed(2)}%`;
        node.style.top = `${(ground * 100).toFixed(2)}%`;
        node.style.height = `${(engineerHeight(ground) * spec.scale * 100).toFixed(2)}%`;
        node.style.zIndex = String(Math.round(ground * 1000));
        body.style.transform = `translate3d(0,${(-lift).toFixed(1)}px,0)`;
      };
      const onDown = (event: PointerEvent) => {
        if (event.pointerType === "mouse" && event.button !== 0) return;
        const box = node.getBoundingClientRect();
        grabX = event.clientX - (box.left + box.width * spec.anchor);
        grabY = event.clientY - box.bottom;
        pointer = event.pointerId;
        try {
          node.setPointerCapture(pointer);
        } catch {}
        node.dataset.held = "true";
        place(event);
        event.preventDefault();
      };
      const onMove = (event: PointerEvent) => {
        if (event.pointerId === pointer) place(event);
      };
      const onUp = (event: PointerEvent) => {
        if (event.pointerId !== pointer) return;
        pointer = -1;
        delete node.dataset.held;
        body.style.transform = "";
      };
      node.addEventListener("pointerdown", onDown);
      node.addEventListener("pointermove", onMove);
      node.addEventListener("pointerup", onUp);
      node.addEventListener("pointercancel", onUp);
      return () => {
        node.removeEventListener("pointerdown", onDown);
        node.removeEventListener("pointermove", onMove);
        node.removeEventListener("pointerup", onUp);
        node.removeEventListener("pointercancel", onUp);
      };
    });
    return () => {
      unwatch();
      for (const release of releases) release();
    };
  }, []);

  return (
    <figure className="relative left-1/2 -mt-px w-[min(100vw,1400px)] -translate-x-1/2">
      <div className="bg-comic-ink px-[3px] pb-[3px] [clip-path:polygon(calc(50%_-_var(--joint)/2)_0,calc(50%_+_var(--joint)/2)_0,100%_100%,0_100%)]">
        <div
          className="relative overflow-hidden bg-comic-paper [clip-path:polygon(calc(50%_-_var(--joint)/2_+_3px)_0,calc(50%_+_var(--joint)/2_-_3px)_0,calc(100%_-_1px)_100%,1px_100%)]"
          style={{ aspectRatio: "8 / 5" }}
        >
          <div ref={attach} data-scene className="absolute inset-0">
            <img
              src={asset("desert-poster")}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full object-cover"
            />
            <LoopCanvas sheets={DESERT} frames={24} columns={6} fps={10} className="absolute inset-0 size-full" />
            <WindCanvas seed={23} />
            <img
              src={asset("desert-statue")}
              alt=""
              loading="lazy"
              decoding="async"
              className="pointer-events-none absolute inset-0 size-full object-cover"
            />
            {ENGINEERS.map((engineer) => (
              <div
                key={engineer.key}
                data-engineer={engineer.key}
                className="group absolute cursor-grab touch-none select-none data-[held=true]:cursor-grabbing"
                style={{
                  left: `${engineer.x * 100}%`,
                  top: `${engineer.y * 100}%`,
                  height: `${engineerHeight(engineer.y) * engineer.scale * 100}%`,
                  aspectRatio: String(engineer.ratio),
                  transform: `translate(${-engineer.anchor * 100}%,-100%)`,
                  zIndex: Math.round(engineer.y * 1000),
                }}
              >
                <span
                  aria-hidden
                  className="pointer-events-none absolute bottom-0 left-[40%] h-[5%] w-[190%] origin-left translate-y-1/2 -rotate-[7deg] rounded-[50%] bg-comic-ink/30"
                />
                <div
                  data-body
                  className="absolute inset-0 transition-transform duration-300 ease-in group-data-[held=true]:transition-none"
                >
                  <div className="anim-struggle size-full overflow-hidden">
                    <img
                      src={asset(engineer.key)}
                      alt=""
                      draggable={false}
                      className="anim-stride block h-full w-[1200%] max-w-none"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <span
        aria-hidden
        className="pointer-events-none absolute -top-[5px] right-[calc(50%_-_var(--joint)/2_+_3px)] left-[calc(50%_-_var(--joint)/2_+_3px)] h-[10px] bg-comic-paper"
      />
      {children}
    </figure>
  );
}

function CrowdVoice({ lines, tilt }: { lines: MessageKey[]; tilt: string }) {
  const { t } = useI18n();
  const [index, setIndex] = useState(0);
  return (
    <span className="absolute bottom-full left-1/2 block -translate-x-1/2 pb-3">
      <button
        type="button"
        data-voice
        title={t("comic_next_line")}
        onClick={() => setIndex((index + 1) % lines.length)}
        className={cn(
          "relative block cursor-pointer border-2 border-comic-ink bg-comic-paper px-2.5 py-1 text-[12px] font-semibold whitespace-nowrap text-comic-ink hover:bg-comic-ink hover:text-comic-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-vermilion md:px-3.5 md:py-2 md:text-[15px]",
          tilt,
        )}
      >
        <span aria-live="polite">{t(lines[index] ?? lines[0]!)}</span>
        <svg aria-hidden viewBox="0 0 16 12" className="absolute top-full left-1/2 -mt-[2px] h-3 w-4 -translate-x-1/2">
          <path
            d="M1 0L7 11 15 0"
            strokeWidth={2}
            strokeLinejoin="round"
            className="fill-comic-paper stroke-comic-ink"
          />
        </svg>
      </button>
    </span>
  );
}

function CrowdStage({ children }: { children?: ReactNode }) {
  return (
    <figure data-panel className="relative">
      <div className={cn("relative overflow-hidden bg-comic-paper", FRAME)} style={{ aspectRatio: "1400 / 875" }}>
        <div data-scene className="absolute inset-0">
          <img
            src={asset("crowd-plate")}
            alt=""
            loading="lazy"
            decoding="async"
            className="absolute inset-0 size-full object-cover"
          />
          {CROWD.map((person) => {
            const voice = CROWD_VOICES[person.id];
            return (
              <div
                key={person.id}
                data-crowd={person.id}
                className="absolute select-none"
                style={{
                  left: `${person.x * 100}%`,
                  top: `${person.y * 100}%`,
                  height: `${crowdHeight(person.y) * person.scale * 100}%`,
                  aspectRatio: String(person.ratio),
                  transform: `translate(${-person.anchor * 100}%,-100%)`,
                  zIndex: Math.round(person.y * 1000),
                }}
              >
                <img
                  src={asset(`crowd-${person.id}`)}
                  alt=""
                  loading="lazy"
                  decoding="async"
                  draggable={false}
                  className="pointer-events-none block size-full"
                />
                {voice && <CrowdVoice lines={voice.lines} tilt={voice.tilt} />}
              </div>
            );
          })}
        </div>
      </div>
      {children}
    </figure>
  );
}

function InkFlames({ flip = false }: { flip?: boolean }) {
  const attach = useCallback(
    (view: HTMLCanvasElement | null) => {
      if (!view) return;
      const context = view.getContext("2d");
      if (!context) return;
      const ink = getComputedStyle(view).color;
      let still = prefersStill();
      const random = seeded(flip ? 29 : 17);
      const lines: Array<{ phase: number; jitter: number; rate: number; nudge: number; ticks: number[] }> = [];
      const STEPS = 16;
      const TIERS = 4;
      let pitch = 8;
      let density = 1;
      let visible = false;

      const draw = (time: number) => {
        const width = view.width;
        const height = view.height;
        const count = Math.ceil(width / pitch) + 1;
        while (lines.length < count) {
          lines.push({
            phase: random() * 6.28,
            jitter: random(),
            rate: 0.7 + random() * 0.9,
            nudge: random() - 0.5,
            ticks: Array.from({ length: TIERS + 1 }, () => random()),
          });
        }
        context.clearRect(0, 0, width, height);
        context.fillStyle = ink;
        const lead = height * 0.1;
        const row = height * 0.055;
        for (let index = 0; index < count; index += 1) {
          const line = lines[index]!;
          const x = (index + 0.5 + line.nudge * 0.28) * pitch;
          const u = x / width;
          const roll = 0.5 + 0.5 * Math.sin(u * 7.3 + time * 0.5 + 1.7 * Math.sin(u * 2.9 - time * 0.23));
          const ripple = 0.5 + 0.5 * Math.sin(u * 31 - time * 1.1 + line.phase * 0.4);
          const lick = 0.5 + 0.5 * Math.sin(time * 2.4 * line.rate + line.phase);
          const start = lead + height * (0.24 * roll + 0.1 * ripple + 0.2 * line.jitter ** 2.2 + 0.035 * lick);
          const drift = u * 11 + line.phase * 0.16;
          const girth = 0.15 + 0.13 * line.ticks[TIERS]!;
          const edge: Array<[number, number, number]> = [];
          for (let step = 0; step <= STEPS; step += 1) {
            const s = step / STEPS;
            const y = start + (height - start) * s;
            const sway = pitch * (0.34 - 0.2 * s) * Math.sin((y / density) * 0.036 - time * 2.7 + drift);
            const swell = 0.045 * Math.sin((y / density) * 0.021 + line.phase + time * 0.9);
            edge.push([
              x + sway,
              y,
              pitch * (girth * Math.min(1, s * 9) + 0.2 * s + 0.24 * smooth((s - 0.45) / 0.55) + swell),
            ]);
          }
          context.beginPath();
          for (const [cx, y, half] of edge) context.lineTo(cx - half, y);
          for (let step = STEPS; step >= 0; step -= 1) {
            const [cx, y, half] = edge[step]!;
            context.lineTo(cx + half, y);
          }
          context.closePath();
          context.fill();
          let cursor = start;
          for (let tier = 0; tier < TIERS; tier += 1) {
            const chance = line.ticks[tier]!;
            const reach = row * (0.95 - tier * 0.17) * (0.45 + 0.75 * line.ticks[tier + 1]!) * (0.75 + 0.25 * lick);
            cursor -= row * (0.3 + 0.55 * chance) + reach;
            if (cursor < 0) break;
            if (chance < 0.1 + tier * 0.17) continue;
            const half = pitch * girth * (0.95 - tier * 0.17);
            const lean = pitch * 0.3 * Math.sin((cursor / density) * 0.036 - time * 2.7 + drift);
            context.fillRect(x + lean - half, cursor, half * 2, reach);
          }
        }
        context.fillRect(0, height - 3 * density, width, 3 * density + 1);
      };
      let painted = 0;
      const tick = createFrameLoop((now: number) => {
        if (now - painted >= PAINT_MS) {
          painted = now;
          draw(now / 1000);
        }
        return visible && !still;
      });
      const wake = () => {
        if (visible && !still) tick.wake();
      };
      const resize = () => {
        const ratio = Math.min(window.devicePixelRatio || 1, 2);
        const width = Math.min(1600, Math.round(view.clientWidth * ratio));
        view.width = width;
        view.height = Math.round((width * view.clientHeight) / Math.max(1, view.clientWidth));
        density = width / Math.max(1, view.clientWidth);
        pitch = (view.clientWidth < 720 ? 6 : 7.5) * density;
        draw(performance.now() / 1000);
      };
      const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
      observer?.observe(view);
      resize();
      const unwatch = whileVisible(view, "20% 0px", (next) => {
        visible = next;
        wake();
      });
      const unwatchMotion = onReducedMotionChange((next) => {
        still = next;
        if (next) tick.stop();
        else wake();
      });
      return () => {
        observer?.disconnect();
        unwatch();
        unwatchMotion();
        tick.stop();
      };
    },
    [flip],
  );

  return (
    <canvas
      ref={attach}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-x-0 w-full text-comic-ink",
        FLAME_HEIGHT,
        flip ? "top-[calc(100%-2px)] -scale-y-100" : "bottom-[calc(100%-2px)]",
      )}
    />
  );
}

function Tornado({ label, ariaLabel, onAwake }: { label: string; ariaLabel: string; onAwake: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const probe = useRef<HTMLSpanElement>(null);
  const layer = useRef<HTMLSpanElement>(null);
  const tag = useRef<HTMLButtonElement>(null);
  const [pressed, setPressed] = useState(false);
  const awake = useRef(onAwake);
  useLayoutEffect(() => {
    awake.current = onAwake;
  });

  const attach = useCallback((frame: HTMLDivElement | null) => {
    if (!frame) return;
    const view = canvas.current;
    const swatch = probe.current;
    const follower = layer.current;
    const button = tag.current;
    const context = view?.getContext("2d");
    if (!view || !swatch || !follower || !button || !context) return;
    const colours = getComputedStyle(swatch);
    const ink = colours.backgroundColor;
    const paper = colours.color;
    const ochre = colours.borderTopColor;
    const red = colours.outlineColor;
    const sheet = pickSheet(HEAD);
    const image = new Image();
    let still = prefersStill();
    const random = seeded(11);
    const spike = () => {
      const kind = random();
      if (kind < 0.38) return (random() - 0.5) * 0.2;
      if (kind < 0.72) return -(0.18 + random() * 0.62);
      return 0.25 + random() * 0.95;
    };
    const streaks = Array.from({ length: 210 }, () => ({
      left: spike(),
      right: spike(),
      phaseLeft: random() * 6.28,
      phaseRight: random() * 6.28,
      rate: 0.5 + random() * 1.6,
    }));
    const arcs = Array.from({ length: 34 }, () => ({
      v: 0.08 + random() * 0.84,
      reach: 0.9 + random() * 1.7,
      angle: random() * 6.28,
      speed: 0.7 + random() * 0.9,
      length: 0.3 + random() * 1.1,
      width: 0.8 + random() * 2,
    }));
    const flecks = Array.from({ length: 16 }, () => ({
      v: 0.14 + random() * 0.72,
      reach: 0.9 + random() * 1.4,
      angle: random() * 6.28,
      speed: 0.8 + random() * 0.8,
      size: 0.5 + random(),
      red: random() < 0.4,
    }));
    const spot = { ...TAG_REST };
    const aim = { ...TAG_REST };
    let ready = false;
    let visible = false;
    let holding = false;
    let last = 0;
    let rotation = 0;
    let spin = still ? 0 : HEAD_SPIN.idle;
    let heading = 0;
    let held = 0;
    let painted = 0;

    const profile = (v: number, time: number, unit: number, width: number) => {
      const lick = 1 + 0.08 * Math.sin(v * 10 + time * 1.9) + 0.045 * Math.sin(v * 25 + time * 3.1);
      const taper = smooth((1 - v) / 0.14);
      const flare = 1 + 1.1 * (1 - smooth(v / 0.3));
      return {
        half: unit * (0.2 - 0.085 * v) * lick * taper * flare,
        centre: width / 2 + unit * 0.035 * Math.sin(v * 4.2 + time * 0.6),
      };
    };

    const draw = (time: number) => {
      const width = view.width;
      const height = view.height;
      const density = width / Math.max(1, frame.clientWidth);
      const unit = Math.min(width, height * 1.55);
      context.globalCompositeOperation = "source-over";
      context.fillStyle = ink;
      context.fillRect(0, 0, width, height);
      context.fillStyle = paper;
      const band = height / streaks.length;
      streaks.forEach((streak, index) => {
        const v = (index + 0.5) / streaks.length;
        const { half, centre } = profile(v, time, unit, width);
        if (half < 0.5) return;
        const tuft = 0.45 + 0.55 * (0.5 + 0.5 * Math.sin(v * 16 + time * 0.9));
        const beat = time * 2.1 * streak.rate + rotation * 1.3 * streak.rate;
        const left = centre - half * (1 + streak.left * tuft * (0.62 + 0.38 * Math.sin(streak.phaseLeft + beat)));
        const right = centre + half * (1 + streak.right * tuft * (0.62 + 0.38 * Math.sin(streak.phaseRight + beat)));
        const from = Math.max(left, width * 0.06);
        const to = Math.min(right, width * 0.94);
        if (to - from > 0.5) context.fillRect(from, index * band, to - from, band + 0.7);
      });
      const sweep = (front: boolean) => {
        context.globalCompositeOperation = "difference";
        context.strokeStyle = paper;
        context.lineCap = "round";
        for (const arc of arcs) {
          const start = arc.angle - rotation * arc.speed;
          if (Math.sin(start + arc.length / 2) > 0 !== front) continue;
          const { half, centre } = profile(arc.v, time, unit, width);
          const radius = Math.max(unit * 0.05, half * arc.reach);
          context.lineWidth = arc.width * density;
          context.beginPath();
          context.ellipse(centre, arc.v * height, radius, radius * 0.17, -0.05, start, start + arc.length);
          context.stroke();
        }
        context.globalCompositeOperation = "source-over";
      };
      sweep(false);
      if (ready) {
        const size = Math.min(height * 0.56, width * 0.5);
        const index = ((Math.round(heading / 10) % HEAD_SPIN.frames) + HEAD_SPIN.frames) % HEAD_SPIN.frames;
        const level = height > width ? 0.52 : 0.46;
        const { centre } = profile(level, time, unit, width);
        context.drawImage(
          image,
          (index % HEAD_SPIN.columns) * sheet.width,
          Math.floor(index / HEAD_SPIN.columns) * sheet.height,
          sheet.width,
          sheet.height,
          centre - size / 2,
          height * level - size * 0.52 + Math.sin(time * 1.3) * size * 0.02,
          size,
          size,
        );
      }
      sweep(true);
      for (const fleck of flecks) {
        const angle = fleck.angle - rotation * fleck.speed;
        const { half, centre } = profile(fleck.v, time, unit, width);
        const radius = Math.max(unit * 0.05, half * fleck.reach);
        const size = fleck.size * 5 * density;
        context.save();
        context.translate(centre + Math.cos(angle) * radius, fleck.v * height + Math.sin(angle) * radius * 0.17);
        context.rotate(angle * 2);
        context.fillStyle = fleck.red ? red : ochre;
        context.fillRect(-size, -size * 0.45, size * 2, size * 0.9);
        context.restore();
      }
    };

    const tick = createFrameLoop((now: number) => {
      const elapsed = Math.min(0.05, (now - last) / 1000);
      last = now;
      const rest = still ? 0 : HEAD_SPIN.idle;
      spin += ((holding ? HEAD_SPIN.fast : rest) - spin) * Math.min(1, elapsed * (holding ? 1.6 : 0.55));
      rotation += spin * elapsed;
      if (holding && held < HEAD_SPIN.wakeAfter) {
        held += elapsed;
        if (held >= HEAD_SPIN.wakeAfter) awake.current();
      }
      const turning = Math.max(0, spin - 0.45);
      if (turning > 0.02) {
        heading += turning * elapsed * 58;
      } else {
        const front = Math.round(heading / 360) * 360;
        heading += (front - heading) * Math.min(1, elapsed * 2.5);
      }
      spot.x += (aim.x - spot.x) * 0.18;
      spot.y += (aim.y - spot.y) * 0.18;
      follower.style.transform = `translate3d(${(spot.x * 100).toFixed(2)}%,${(spot.y * 100).toFixed(2)}%,0)`;
      if (now - painted >= (spin > rest + 0.3 ? PAINT_MS / 2 : PAINT_MS)) {
        painted = now;
        draw(now / 1000);
      }
      const settling =
        holding || spin > rest + 0.01 || Math.abs(aim.x - spot.x) > 0.001 || Math.abs(aim.y - spot.y) > 0.001;
      return visible && (!still || settling);
    });
    const wake = () => {
      if (tick.running() || !visible) return;
      last = performance.now();
      tick.wake();
    };
    const resize = () => {
      const ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      const width = Math.min(1280, Math.round(frame.clientWidth * ratio));
      view.width = width;
      view.height = Math.round((width * frame.clientHeight) / Math.max(1, frame.clientWidth));
      draw(performance.now() / 1000);
    };
    let asked = false;
    const load = () => {
      if (asked) return;
      asked = true;
      loadSheet(image, sheet.src, () => {
        ready = true;
        draw(performance.now() / 1000);
      });
    };
    const start = () => {
      holding = true;
      setPressed(true);
      wake();
    };
    const stop = () => {
      if (!holding) return;
      holding = false;
      setPressed(false);
      wake();
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const rect = frame.getBoundingClientRect();
      aim.x = clamp01((event.clientX - rect.left) / rect.width);
      aim.y = clamp01((event.clientY - rect.top) / rect.height);
      wake();
    };
    const onLeave = () => {
      aim.x = TAG_REST.x;
      aim.y = TAG_REST.y;
      stop();
      wake();
    };
    const onFrameDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button === 0) start();
    };
    const onTagDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      try {
        button.setPointerCapture(event.pointerId);
      } catch {}
      start();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key !== "Enter" && event.key !== " ") || event.repeat) return;
      event.preventDefault();
      start();
    };
    const noMenu = (event: Event) => event.preventDefault();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(resize);
    observer?.observe(frame);
    resize();
    const unwatch = whileVisible(frame, "30% 0px", (next) => {
      visible = next;
      if (visible) {
        load();
        wake();
      }
    });
    frame.addEventListener("pointermove", onMove);
    frame.addEventListener("pointerleave", onLeave);
    frame.addEventListener("pointerdown", onFrameDown);
    frame.addEventListener("pointerup", stop);
    button.addEventListener("pointerdown", onTagDown);
    button.addEventListener("pointerup", stop);
    button.addEventListener("pointercancel", stop);
    button.addEventListener("keydown", onKeyDown);
    button.addEventListener("keyup", stop);
    button.addEventListener("blur", stop);
    button.addEventListener("contextmenu", noMenu);
    const unwatchMotion = onReducedMotionChange((next) => {
      still = next;
      if (!next) wake();
    });
    return () => {
      observer?.disconnect();
      unwatch();
      unwatchMotion();
      tick.stop();
      frame.removeEventListener("pointermove", onMove);
      frame.removeEventListener("pointerleave", onLeave);
      frame.removeEventListener("pointerdown", onFrameDown);
      frame.removeEventListener("pointerup", stop);
      button.removeEventListener("pointerdown", onTagDown);
      button.removeEventListener("pointerup", stop);
      button.removeEventListener("pointercancel", stop);
      button.removeEventListener("keydown", onKeyDown);
      button.removeEventListener("keyup", stop);
      button.removeEventListener("blur", stop);
      button.removeEventListener("contextmenu", noMenu);
    };
  }, []);

  return (
    <div ref={attach} className="relative aspect-[3/5] cursor-pointer overflow-hidden select-none md:aspect-[16/10]">
      <canvas ref={canvas} className="absolute inset-0 size-full" />
      <span
        ref={probe}
        aria-hidden
        className="hidden border-t border-comic-ochre bg-comic-ink text-comic-paper outline-vermilion"
      />
      <CursorTag layer={layer} tag={tag} label={label} ariaLabel={ariaLabel} pressed={pressed} />
    </div>
  );
}

function HoldTurn({
  label,
  ariaLabel,
  intro,
  caption,
}: {
  label: string;
  ariaLabel: string;
  intro: ReactNode;
  caption: ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const layer = useRef<HTMLSpanElement>(null);
  const tag = useRef<HTMLButtonElement>(null);
  const [pressed, setPressed] = useState(false);
  const [done, setDone] = useState(false);

  const attach = useCallback((frame: HTMLDivElement | null) => {
    if (!frame) return;
    const view = canvas.current;
    const follower = layer.current;
    const button = tag.current;
    const context = view?.getContext("2d");
    if (!view || !follower || !button || !context) return;
    const sheet = pickSheet(TURN);
    view.width = sheet.width;
    view.height = sheet.height;
    const image = new Image();
    const spot = { ...TAG_REST };
    const aim = { ...TAG_REST };
    let ready = false;
    let holding = false;
    let finished = false;
    let progress = 0;
    let drawn = -1;
    let last = 0;

    const draw = () => {
      if (!ready) return;
      const index = Math.round(progress * (TURN_TIMING.frames - 1));
      if (index === drawn) return;
      drawn = index;
      context.drawImage(
        image,
        (index % TURN_TIMING.columns) * sheet.width,
        Math.floor(index / TURN_TIMING.columns) * sheet.height,
        sheet.width,
        sheet.height,
        0,
        0,
        sheet.width,
        sheet.height,
      );
    };
    const tick = createFrameLoop((now: number) => {
      const elapsed = Math.min(64, now - last);
      last = now;
      if (holding && !finished) {
        progress = Math.min(1, progress + elapsed / TURN_TIMING.fillMs);
        if (progress === 1) {
          finished = true;
          holding = false;
          setPressed(false);
          setDone(true);
        }
      } else if (!finished && progress > 0) {
        progress = Math.max(0, progress - elapsed / TURN_TIMING.drainMs);
      }
      spot.x += (aim.x - spot.x) * 0.18;
      spot.y += (aim.y - spot.y) * 0.18;
      draw();
      follower.style.transform = `translate3d(${(spot.x * 100).toFixed(2)}%,${(spot.y * 100).toFixed(2)}%,0)`;
      const settled = Math.abs(aim.x - spot.x) < 0.001 && Math.abs(aim.y - spot.y) < 0.001;
      return holding || (!finished && progress > 0) || !settled;
    });
    const wake = () => {
      if (tick.running()) return;
      last = performance.now();
      tick.wake();
    };
    let asked = false;
    const load = () => {
      if (asked) return;
      asked = true;
      loadSheet(image, sheet.src, () => {
        ready = true;
        draw();
      });
    };
    const start = () => {
      load();
      if (finished || !ready) return;
      holding = true;
      setPressed(true);
      wake();
    };
    const stop = () => {
      if (!holding) return;
      holding = false;
      setPressed(false);
      wake();
    };
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const rect = frame.getBoundingClientRect();
      aim.x = clamp01((event.clientX - rect.left) / rect.width);
      aim.y = clamp01((event.clientY - rect.top) / rect.height);
      wake();
    };
    const onLeave = () => {
      aim.x = TAG_REST.x;
      aim.y = TAG_REST.y;
      stop();
      wake();
    };
    const onFrameDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse" && event.button === 0) start();
    };
    const onTagDown = (event: PointerEvent) => {
      if (event.pointerType === "mouse") return;
      try {
        button.setPointerCapture(event.pointerId);
      } catch {}
      start();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.key !== "Enter" && event.key !== " ") || event.repeat) return;
      event.preventDefault();
      start();
    };
    const noMenu = (event: Event) => event.preventDefault();
    const unwatch = whenNear(frame, "100% 0px", load);
    frame.addEventListener("pointermove", onMove);
    frame.addEventListener("pointerleave", onLeave);
    frame.addEventListener("pointerdown", onFrameDown);
    frame.addEventListener("pointerup", stop);
    button.addEventListener("pointerdown", onTagDown);
    button.addEventListener("pointerup", stop);
    button.addEventListener("pointercancel", stop);
    button.addEventListener("keydown", onKeyDown);
    button.addEventListener("keyup", stop);
    button.addEventListener("blur", stop);
    button.addEventListener("contextmenu", noMenu);
    return () => {
      unwatch();
      tick.stop();
      frame.removeEventListener("pointermove", onMove);
      frame.removeEventListener("pointerleave", onLeave);
      frame.removeEventListener("pointerdown", onFrameDown);
      frame.removeEventListener("pointerup", stop);
      button.removeEventListener("pointerdown", onTagDown);
      button.removeEventListener("pointerup", stop);
      button.removeEventListener("pointercancel", stop);
      button.removeEventListener("keydown", onKeyDown);
      button.removeEventListener("keyup", stop);
      button.removeEventListener("blur", stop);
      button.removeEventListener("contextmenu", noMenu);
    };
  }, []);

  return (
    <figure data-panel className="relative mx-auto w-full max-w-[660px]">
      {(["left", "right"] as const).map((side) => (
        <img
          key={side}
          data-float
          data-depth="-0.6"
          data-column={side}
          src={asset("column")}
          alt=""
          loading="lazy"
          className={cn(
            "pointer-events-none absolute -top-[9%] h-[118%] w-auto max-w-none",
            side === "left" ? "-left-[17%]" : "-right-[17%] -scale-x-100",
          )}
        />
      ))}
      <div className="relative rounded-full border-[3px] border-comic-ink bg-comic-paper p-[3.5%]">
        <div
          ref={attach}
          className="relative aspect-square cursor-pointer overflow-hidden rounded-full border-[3px] border-comic-ink bg-comic-ochre select-none"
        >
          <div data-scene className="absolute inset-0">
            <img
              src={asset("turn-poster")}
              alt=""
              loading="lazy"
              decoding="async"
              className="absolute inset-0 size-full object-cover"
            />
            <canvas ref={canvas} className="absolute inset-0 size-full" />
            <img
              src={asset("turn-final")}
              alt=""
              loading="lazy"
              className={cn(
                "absolute inset-0 size-full object-cover transition-opacity duration-300",
                done ? "opacity-100" : "opacity-0",
              )}
            />
          </div>
          <CursorTag layer={layer} tag={tag} label={label} ariaLabel={ariaLabel} pressed={pressed} hidden={done} />
        </div>
      </div>
      <Caption className="top-[11%] -left-1 md:-left-12">{intro}</Caption>
      <Caption
        className={cn(
          "top-[58%] right-0 max-w-[66%] transition-opacity duration-500 md:top-[42%] md:right-auto md:left-[76%] md:w-max md:max-w-[min(440px,calc(50vw_-_190px))]",
          done ? "opacity-100" : "opacity-0",
        )}
      >
        {caption}
      </Caption>
    </figure>
  );
}

function ComicLanding() {
  const { t, locale } = useI18n();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [awake, setAwake] = useState(false);
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const attach = useCallback((root: HTMLDivElement | null) => {
    scrollerRef.current = root;
    if (!root) return;
    const scenes = Array.from(root.querySelectorAll<HTMLElement>("[data-scene]")).map((node) => ({
      node,
      scale: Number(node.dataset.scene) || 1.07,
    }));
    for (const scene of scenes) scene.node.style.transform = `scale(${scene.scale})`;
    const layers = Array.from(root.querySelectorAll<HTMLElement>("[data-layer]")).map((node) => ({
      node,
      depth: Number(node.dataset.depth ?? 0),
      lift: Number(node.dataset.lift ?? 0),
      fade: node.dataset.fade !== undefined,
    }));
    const bar = root.querySelector<HTMLElement>("[data-bar]");
    const title = root.querySelector<HTMLElement>("[data-title]");
    let still = prefersStill();
    let shifts = !still && hasFinePointer();
    if (shifts) for (const scene of scenes) scene.node.style.willChange = "transform";
    const pointer = { x: 0, y: 0 };
    const eased = { x: 0, y: 0 };

    const render = createFrameLoop(() => {
      const height = root.clientHeight;
      const range = root.scrollHeight - height;
      const p = range > 0 ? clamp01(root.scrollTop / range) : 0;
      if (bar) bar.style.transform = `scaleX(${p.toFixed(4)})`;
      if (still) return false;
      eased.x += (pointer.x - eased.x) * 0.1;
      eased.y += (pointer.y - eased.y) * 0.1;
      if (root.scrollTop < height * 1.2) {
        const lift = clamp01(root.scrollTop / height);
        for (const layer of layers) {
          layer.node.style.transform = `translate3d(${(eased.x * layer.depth).toFixed(1)}px,calc(${(eased.y * layer.depth * 0.6).toFixed(1)}px + ${(lift * layer.lift * 100).toFixed(2)}%),0)`;
          if (layer.fade) layer.node.style.opacity = (1 - clamp01(lift * 1.6)).toFixed(3);
        }
      }
      if (!shifts) return false;
      const dx = (-eased.x * SCENE_SHIFT).toFixed(2);
      const dy = (-eased.y * SCENE_SHIFT).toFixed(2);
      for (const scene of scenes) scene.node.style.transform = `translate3d(${dx}%,${dy}%,0) scale(${scene.scale})`;
      return Math.abs(pointer.x - eased.x) > 0.002 || Math.abs(pointer.y - eased.y) > 0.002;
    });
    const schedule = render.wake;
    const onPointer = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
      schedule();
    };
    const unwatch = title
      ? whileVisible(title, "0px", (visible) => {
          title.dataset.live = String(visible);
        })
      : () => {};
    const unwatchMotion = onReducedMotionChange((next) => {
      still = next;
      shifts = !next && hasFinePointer();
      schedule();
    });
    root.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("pointermove", onPointer, { passive: true });
    schedule();
    return () => {
      unwatch();
      unwatchMotion();
      root.removeEventListener("scroll", schedule);
      window.removeEventListener("pointermove", onPointer);
      render.stop();
    };
  }, []);

  const skipToEnd = () => {
    const root = scrollerRef.current;
    root?.scrollTo({ top: root.scrollHeight, behavior: prefersStill() ? "auto" : "smooth" });
  };
  const join = () => {
    const normalized = normalizeJoinCode(code);
    if (normalized) void navigate({ to: "/join/$code", params: { code: normalized } });
  };

  return (
    <div ref={attach} className="h-dvh overflow-x-hidden overflow-y-auto bg-comic-paper text-comic-ink">
      <header className="fixed inset-x-0 top-0 z-30 flex h-16 items-center px-4 md:px-6">
        <div className={PLATE}>
          <span className="flex w-9 items-center justify-center bg-comic-ink font-serif text-[19px] leading-none text-comic-paper">
            {t("app_mark")}
          </span>
          <span className="flex items-center px-3 text-[12px] font-bold tracking-[0.34em] uppercase max-[359px]:hidden">
            {t("brand_name")}
          </span>
        </div>
        <span className="flex-1" />
        <nav className={PLATE}>
          <button
            type="button"
            data-skip
            aria-label={t("comic_skip")}
            title={t("comic_skip")}
            onClick={skipToEnd}
            className={cn(
              "flex cursor-pointer items-center gap-1.5 border-r-2 border-comic-ink px-2.5 text-[12px] font-bold tracking-[0.14em] whitespace-nowrap hover:bg-comic-ink hover:text-comic-paper",
              PLATE_FOCUS,
            )}
          >
            <svg aria-hidden viewBox="0 0 12 14" fill="none" className="h-3.5 w-3 stroke-current" strokeWidth={2}>
              <path d="M6 0v9M1.5 5.5 6 10l4.5-4.5M1 13h10" />
            </svg>
            <span className="hidden md:inline">{t("comic_skip")}</span>
          </button>
          <fieldset aria-label={t("settings_lang")} className="flex items-center px-2">
            {LANGS.map((lang, index) => (
              <span key={lang.code} className="flex items-center">
                {index > 0 && (
                  <span aria-hidden className="px-0.5 text-[11px] text-comic-ink/30">
                    /
                  </span>
                )}
                <button
                  type="button"
                  lang={lang.code}
                  title={lang.label}
                  aria-label={lang.label}
                  aria-pressed={locale === lang.code}
                  onClick={() => setLocale(lang.code)}
                  className={cn(
                    "cursor-pointer px-1.5 py-1 text-[12px] tracking-[0.08em]",
                    PLATE_FOCUS,
                    locale === lang.code
                      ? "font-bold text-comic-ink"
                      : "font-medium text-comic-ink/45 hover:text-vermilion",
                  )}
                >
                  {LANG_SHORT[lang.code]}
                </button>
              </span>
            ))}
          </fieldset>
          <Link
            to="/login"
            className={cn(
              "group flex items-center gap-2 border-l-2 border-comic-ink px-3.5 text-[12.5px] font-bold tracking-[0.2em] whitespace-nowrap hover:bg-comic-ink hover:text-comic-paper",
              PLATE_FOCUS,
            )}
          >
            <span aria-hidden className="size-[7px] bg-vermilion" />
            {t("login_title")}
          </Link>
        </nav>
      </header>
      <div data-bar aria-hidden className="fixed inset-x-0 top-0 z-40 h-1 origin-left scale-x-0 bg-vermilion" />

      <section data-title className="relative h-dvh overflow-hidden bg-comic-night">
        <div data-layer data-depth="16" className="absolute -inset-[7%] will-change-transform">
          <img src={asset("title-strokes")} alt="" className="anim-wind size-full object-cover opacity-60" />
        </div>
        <div data-layer data-depth="-28" className="absolute -inset-[9%] will-change-transform">
          <img
            src={asset("title-strokes")}
            alt=""
            className="anim-wind-slow size-full -scale-x-100 object-cover opacity-30"
          />
        </div>
        <div
          data-layer
          data-depth="-12"
          data-lift="-0.3"
          data-fade
          className="absolute inset-0 flex items-center justify-center will-change-transform"
        >
          <h1 className="w-[min(70vw,560px)] -translate-y-[14%] md:-translate-y-[26%]">
            <img src={asset("title-logo")} alt={t("brand_name")} className="anim-title block w-full" />
          </h1>
        </div>
        <div
          data-layer
          data-depth="26"
          data-lift="-1.5"
          className="absolute inset-x-[-5%] bottom-0 h-[min(30dvh,30vw)] will-change-transform"
        >
          <img src={asset("title-skyline")} alt="" className="anim-skyline block size-full object-cover object-top" />
          <div className="absolute inset-x-0 top-[98%] h-dvh bg-comic-paper" />
        </div>
        <p
          data-layer
          data-depth="0"
          data-fade
          className="absolute inset-x-0 bottom-5 flex items-center justify-center gap-2 text-[12px] font-medium tracking-[0.3em] text-comic-ink"
        >
          {t("comic_scroll")} ↓
        </p>
      </section>

      <main className="relative z-10 mx-auto w-full max-w-[1180px] px-4 md:px-8">
        <section className="relative pt-[clamp(120px,22vh,260px)]">
          <figure data-panel className="relative">
            <div className={cn("relative overflow-hidden bg-comic-paper", FRAME)} style={{ aspectRatio: "5 / 3" }}>
              <div data-scene className="absolute inset-0">
                <img src={asset("walk-poster")} alt="" className="absolute inset-0 size-full object-cover" />
                <LoopCanvas sheets={WALK} frames={24} columns={6} fps={10} className="absolute inset-0 size-full" />
              </div>
            </div>
            <Inset
              ratio="1000 / 317"
              depth={2.2}
              className="-right-1 -bottom-12 w-[66%] md:-right-6 md:-bottom-20 md:w-[47%]"
            >
              <EyesInset label={t("comic_eyes_label")} />
            </Inset>
            <Caption className="-bottom-32 left-2 md:bottom-8 md:-left-8">{t("comic_1")}</Caption>
          </figure>
        </section>

        <section className="relative pt-[clamp(190px,30vh,340px)]">
          <figure data-panel data-feet className="relative w-[78%] md:ml-[5%] md:w-[46%]">
            <div className={cn("overflow-hidden bg-comic-paper", FRAME)} style={{ aspectRatio: "480 / 197" }}>
              <div data-scene className="size-full">
                <LoopCanvas sheets={FEET} frames={24} columns={6} fps={10} className="block size-full" />
              </div>
            </div>
          </figure>
        </section>

        <section className="relative pt-[clamp(170px,28vh,340px)]">
          <div
            data-panel
            className="relative [--joint:min(1080px,calc(100vw_-_2rem))] md:[--joint:min(1080px,calc(100vw_-_4rem))]"
          >
            <AgoraStage>
              <Caption className="top-[3%] -left-1 md:-left-6">{t("comic_2")}</Caption>
              <Caption className="top-[31%] -right-1 md:top-[9%] md:-right-6">{t("comic_3")}</Caption>
            </AgoraStage>
            <DesertStage>
              <div className="absolute top-0 right-1 z-20 w-[62%] -translate-y-1/2 md:right-[max(6px,calc(50%_-_var(--joint)/2_-_6%))] md:w-[min(38%,520px)]">
                <div
                  data-float
                  data-depth="1.6"
                  data-ruins
                  className={cn("relative overflow-hidden bg-comic-ochre", FRAME)}
                  style={{ aspectRatio: "1200 / 480" }}
                >
                  <img
                    src={asset("ruins")}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="absolute inset-0 size-full object-cover"
                  />
                  <WindCanvas seed={41} />
                </div>
                <Caption className="-top-5 -left-3 md:-left-8">{t("comic_band")}</Caption>
              </div>
              <div className="absolute top-[26%] left-1 z-20 w-[40%] md:top-[15%] md:left-[max(6px,calc(50%_-_var(--joint)/2_-_7%))] md:w-[min(30%,420px)]">
                <div
                  data-float
                  data-depth="2"
                  data-legs
                  className={cn("overflow-hidden bg-comic-paper", FRAME)}
                  style={{ aspectRatio: "480 / 200" }}
                >
                  <LoopCanvas sheets={LEGS} frames={24} columns={6} fps={10} className="block size-full" />
                </div>
              </div>
              <Caption className="right-2 -bottom-12 md:right-[3%] md:-bottom-6">{t("comic_desert")}</Caption>
            </DesertStage>
          </div>
        </section>
      </main>

      <section className="relative -mt-[clamp(84px,19vw,230px)] mb-[clamp(170px,30vw,420px)] bg-comic-ink pt-[clamp(44px,12vw,150px)]">
        <InkFlames />
        <figure className="relative mx-auto w-full max-w-[1180px] px-0 md:px-8">
          <Tornado label={t("comic_spin")} ariaLabel={t("comic_spin_label")} onAwake={() => setAwake(true)} />
          <Caption className="top-[118px] left-3 md:top-[130px] md:left-10">{t("comic_4")}</Caption>
          <Caption
            className={cn(
              "right-3 bottom-3 font-serif text-[15px] transition-opacity duration-700 md:right-10 md:text-[18px]",
              awake ? "opacity-100" : "opacity-0",
            )}
          >
            {t("comic_revived")}
          </Caption>
        </figure>
        <InkFlames flip />
      </section>

      <main className="relative mx-auto w-full max-w-[1180px] px-4 pb-[clamp(140px,24vh,280px)] md:px-8">
        <section className="relative pt-[clamp(110px,18vh,220px)]">
          <CrowdStage>
            <Caption className="-top-5 left-3 md:-left-8">{t("comic_5")}</Caption>
          </CrowdStage>
        </section>

        <section className="relative pt-[clamp(220px,40vh,460px)]">
          <HoldTurn
            label={t("comic_hold")}
            ariaLabel={t("comic_hold_label")}
            intro={
              <>
                <span className="block">{t("comic_6")}</span>
                <span className="block">{t("comic_7")}</span>
              </>
            }
            caption={
              <>
                <span className="block font-serif text-[15px] md:text-[17px]">{t("comic_8_quote")}</span>
                <span className="mt-1 block font-normal">{t("comic_8")}</span>
              </>
            }
          />
        </section>
      </main>

      <section className="relative overflow-hidden bg-vermilion text-comic-paper">
        <span aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-comic-ink" />
        <div className="mx-auto grid w-full max-w-[1180px] items-center gap-8 px-4 py-20 md:grid-cols-2 md:px-8">
          <div>
            <h2 className="font-serif text-[clamp(20px,2.6vw,26px)] leading-snug font-semibold">
              {t("story_end_title")}
            </h2>
            <div className="mt-8 flex flex-col items-start gap-3">
              <button
                type="button"
                onClick={() => void navigate({ to: "/login" })}
                className="cursor-pointer border-[3px] border-comic-ink bg-comic-ink px-7 py-3 text-[15px] font-semibold text-comic-paper hover:bg-comic-paper hover:text-comic-ink"
              >
                {t("landing_start")} →
              </button>
              <form
                className="flex w-full max-w-xs items-stretch"
                onSubmit={(event) => {
                  event.preventDefault();
                  join();
                }}
              >
                <input
                  value={code}
                  aria-label={t("join_code_label")}
                  placeholder={t("login_code_placeholder")}
                  autoCapitalize="none"
                  onChange={(event) => setCode(event.target.value)}
                  className="min-w-0 flex-1 border-[3px] border-r-0 border-comic-ink bg-comic-paper px-3 py-2 text-[14px] text-comic-ink placeholder:text-comic-ink/50 focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={!code.trim()}
                  className="cursor-pointer border-[3px] border-comic-ink bg-comic-paper px-4 text-[13.5px] font-semibold text-comic-ink disabled:cursor-default disabled:opacity-60"
                >
                  {t("login_code_go")}
                </button>
              </form>
            </div>
          </div>
          <Panel src="end" ratio="1400 / 875" />
        </div>
      </section>
    </div>
  );
}

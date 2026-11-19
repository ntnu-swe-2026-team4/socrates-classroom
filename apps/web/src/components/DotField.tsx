import { useCallback } from "react";
import { cn } from "@/components/ui";
import { createFrameLoop } from "@/lib/frameLoop";
import { onReducedMotionChange } from "@/lib/motion";

const PITCH = 12;
const RADIUS = 1.45;
const LEVELS = 16;
const FRAME_MS = 50;

interface Dot {
  x: number;
  y: number;
  speed: number;
  phase: number;
  amp: number;
}

export function DotField({ className }: { className?: string }) {
  const attach = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let dots: Dot[] = [];
    let width = 0;
    let height = 0;
    const buckets: Dot[][] = Array.from({ length: LEVELS }, () => []);

    const build = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (w === width && h === height) return;
      width = w;
      height = h;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const cols = Math.ceil(w / PITCH);
      const rows = Math.ceil(h / PITCH);
      dots = [];
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          dots.push({
            x: c * PITCH + PITCH / 2,
            y: r * PITCH + PITCH / 2,
            speed: 0.25 + Math.random() * 0.65,
            phase: Math.random() * Math.PI * 2,
            amp: 0.2 + Math.random() * 0.25,
          });
        }
      }
    };

    const draw = (t: number) => {
      for (const bucket of buckets) bucket.length = 0;
      for (const dot of dots) {
        const pulse = 0.5 + 0.5 * Math.sin(t * dot.speed + dot.phase);
        const swell = 0.65 + 0.35 * Math.sin(t * 0.17 + dot.x * 0.0021 + dot.y * 0.0016);
        const level = Math.round(dot.amp * pulse * pulse * swell * 2 * (LEVELS - 1));
        if (level > 0) buckets[Math.min(level, LEVELS - 1)]?.push(dot);
      }
      const style = getComputedStyle(canvas);
      const gain = Number.parseFloat(style.getPropertyValue("--ht-dot-gain")) || 1;
      ctx.fillStyle = style.color;
      ctx.clearRect(0, 0, width, height);
      buckets.forEach((bucket, level) => {
        if (!bucket.length) return;
        ctx.globalAlpha = (gain * level) / (2 * (LEVELS - 1));
        ctx.beginPath();
        for (const dot of bucket) {
          ctx.moveTo(dot.x + RADIUS, dot.y);
          ctx.arc(dot.x, dot.y, RADIUS, 0, Math.PI * 2);
        }
        ctx.fill();
      });
    };

    build();
    const observer = new ResizeObserver(() => {
      build();
      if (still) draw(0);
    });
    observer.observe(canvas);
    const themeObserver = new MutationObserver(() => {
      if (still) draw(0);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

    const start = performance.now();
    let last = Number.NEGATIVE_INFINITY;
    const loop = createFrameLoop((now: number) => {
      if (now - last >= FRAME_MS) {
        last = now;
        draw((now - start) / 1000);
      }
      return true;
    });
    if (still) draw(0);
    else loop.wake();
    const unwatchMotion = onReducedMotionChange((next) => {
      still = next;
      if (next) {
        loop.stop();
        draw(0);
      } else {
        loop.wake();
      }
    });

    return () => {
      unwatchMotion();
      loop.stop();
      observer.disconnect();
      themeObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={attach}
      aria-hidden
      className={cn("pointer-events-none absolute inset-0 block size-full text-ht-dot", className)}
    />
  );
}

import { useCallback } from "react";
import { inkFromColor } from "@/components/StoaField";
import { cn } from "@/components/ui";
import { createFrameLoop } from "@/lib/frameLoop";
import { onReducedMotionChange } from "@/lib/motion";

const SCALE = 1.5;
const BED_HEIGHT = 0.12;
const GRAINS_PER_PIXEL = 0.22;
const PUSH_RADIUS = 44 / SCALE;
const PUSH_RATE = 0.3;
const RETURN_SECONDS = 1.1;

export interface Grains {
  x0: Float32Array;
  rise: Float32Array;
  v: Float32Array;
}

export function createGrains(W: number, H: number, random: () => number = Math.random): Grains {
  const n = Math.round(W * H * BED_HEIGHT * GRAINS_PER_PIXEL);
  const grains: Grains = { x0: new Float32Array(n), rise: new Float32Array(n), v: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    const rise = 1 - Math.cbrt(random());
    grains.x0[i] = random() * W;
    grains.rise[i] = rise;
    grains.v[i] = ((1.2 + 4.8 * rise) * (0.75 + 0.5 * random())) / SCALE;
  }
  return grains;
}

export function placeGrains(
  grains: Grains,
  W: number,
  floor: number,
  t: number,
  visit: (index: number, x: number, y: number) => void,
): void {
  const bed = floor * BED_HEIGHT;
  for (let i = 0; i < grains.x0.length; i++) {
    const x = ((((grains.x0[i] ?? 0) + t * (grains.v[i] ?? 0)) % W) + W) % W;
    visit(i, x, floor - (grains.rise[i] ?? 0) * bed);
  }
}

export function Quicksand({ className }: { className?: string }) {
  const attach = useCallback((canvas: HTMLCanvasElement | null) => {
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    let ink = inkFromColor(getComputedStyle(canvas).color);
    let W = 0;
    let H = 0;
    let grains: Grains | null = null;
    let img: ImageData | null = null;
    let buf = new Uint32Array(0);
    let ox = new Float32Array(0);
    let oy = new Float32Array(0);
    let floorElement: Element | null = null;
    let clock = 0;
    const pointer = { x: 0, y: 0, active: false };
    const client = { x: 0, y: 0, active: false };

    const floorOf = (rect: DOMRect) => {
      if (!floorElement?.isConnected) floorElement = canvas.parentElement?.querySelector("[data-sand-floor]") ?? null;
      const top = floorElement?.getBoundingClientRect().top;
      return top === undefined ? H : Math.min(H, ((top - rect.top) * H) / (rect.height || 1));
    };

    const draw = (t: number, dt: number) => {
      if (!grains || !img) return;
      clock = t;
      const rect = canvas.getBoundingClientRect();
      const floor = floorOf(rect);
      const px = ((client.x - rect.left) * W) / (rect.width || 1);
      const py = ((client.y - rect.top) * H) / (rect.height || 1);
      pointer.active = client.active && Math.hypot(px - pointer.x, py - pointer.y) > 0.25;
      pointer.x = px;
      pointer.y = py;
      const keep = Math.exp(-dt / RETURN_SECONDS);
      const push = 1 - (1 - PUSH_RATE) ** (dt * 60);
      buf.fill(0);
      placeGrains(grains, W, floor, t, (i, x, y) => {
        let dx = (ox[i] ?? 0) * keep;
        let dy = (oy[i] ?? 0) * keep;
        if (pointer.active) {
          const ax = x + dx - pointer.x;
          const ay = y + dy - pointer.y;
          const d2 = ax * ax + ay * ay;
          if (d2 < PUSH_RADIUS * PUSH_RADIUS) {
            const d = Math.sqrt(d2) || 0.001;
            const step = (PUSH_RADIUS - d) * push;
            dx += (ax / d) * step;
            dy += (ay / d) * step;
          }
        }
        ox[i] = dx;
        oy[i] = dy;
        const gx = (x + dx) | 0;
        const gy = Math.min(y + dy, floor - 1) | 0;
        if (gx >= 0 && gy >= 0 && gx < W && gy < H) buf[gy * W + gx] = ink;
      });
      ctx.putImageData(img, 0, 0);
    };

    const rebuild = () => {
      const nextW = Math.round(canvas.clientWidth / SCALE);
      const nextH = Math.round(canvas.clientHeight / SCALE);
      if (nextW < 2 || nextH < 2 || (nextW === W && nextH === H)) return;
      W = nextW;
      H = nextH;
      canvas.width = W;
      canvas.height = H;
      img = ctx.createImageData(W, H);
      buf = new Uint32Array(img.data.buffer);
      grains = createGrains(W, H);
      ox = new Float32Array(grains.x0.length);
      oy = new Float32Array(grains.x0.length);
      draw(clock, 0);
    };

    const track = (event: PointerEvent) => {
      client.x = event.clientX;
      client.y = event.clientY;
      client.active = true;
    };
    const release = () => {
      client.active = false;
    };

    const observer = new ResizeObserver(() => {
      rebuild();
      if (still) draw(clock, 0);
    });
    observer.observe(canvas);
    const themeObserver = new MutationObserver(() => {
      ink = inkFromColor(getComputedStyle(canvas).color);
      if (still) draw(clock, 0);
    });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    rebuild();

    const start = performance.now();
    let last = start;
    const loop = createFrameLoop((now: number) => {
      draw((now - start) / 1000, Math.min(0.05, (now - last) / 1000));
      last = now;
      return !still;
    });
    const listen = () => {
      window.addEventListener("pointermove", track, { passive: true });
      window.addEventListener("pointerdown", track, { passive: true });
      document.documentElement.addEventListener("pointerleave", release);
      window.addEventListener("blur", release);
    };
    const unlisten = () => {
      window.removeEventListener("pointermove", track);
      window.removeEventListener("pointerdown", track);
      document.documentElement.removeEventListener("pointerleave", release);
      window.removeEventListener("blur", release);
      release();
    };
    if (!still) {
      listen();
      loop.wake();
    }
    const unwatchMotion = onReducedMotionChange((next) => {
      still = next;
      if (next) {
        unlisten();
        return;
      }
      listen();
      last = performance.now();
      loop.wake();
    });

    return () => {
      unwatchMotion();
      unlisten();
      loop.stop();
      observer.disconnect();
      themeObserver.disconnect();
    };
  }, []);

  return (
    <canvas
      ref={attach}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-0 block size-full text-ht-dot opacity-25 [image-rendering:pixelated]",
        className,
      )}
    />
  );
}

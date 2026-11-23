import { useCallback } from "react";
import { cn } from "@/components/ui";
import { createFrameLoop } from "@/lib/frameLoop";
import { onReducedMotionChange } from "@/lib/motion";

const clamp = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

const MAX_COLUMNS = 4;
const COLUMN_DIAMETER = 73;
const COLUMN_MIN_PITCH = 140;
const WIDE_DIAMETER_RATIO = 0.118;

export function colonnadeLayout(width: number) {
  return {
    count: Math.min(MAX_COLUMNS, Math.floor(width / COLUMN_MIN_PITCH)),
    diameter: Math.max(COLUMN_DIAMETER, width * WIDE_DIAMETER_RATIO),
  };
}

function buildColonnade(W: number, H: number, LW: number) {
  const g = new Float32Array(W * H);
  const put = (px: number, py: number, d: number) => {
    const x = px | 0;
    const y = py | 0;
    if (x >= 0 && y >= 0 && x < W && y < H) g[y * W + x] = clamp(d, 0, 1);
  };
  const lam = (u: number) => clamp(Math.cos(Math.asin(clamp(u, -1, 1)) + 0.7), 0, 1);
  const cylD = (u: number) => 0.06 + 0.7 * (1 - lam(u));
  const ring = (c: number, y: number, half: number, fn: (u: number, x: number) => number) => {
    for (let x = Math.floor(c - half); x <= Math.ceil(c + half); x++) {
      const u = (x - c) / half;
      if (u >= -1 && u <= 1) put(x, y, fn(u, x));
    }
  };
  const { count: n, diameter: D0 } = colonnadeLayout(LW);
  const D1 = D0 * 0.86;
  const capH = 31;
  const baseH = 32;
  const sTop = capH;
  const sBot = H - baseH;
  for (let i = 0; i < n; i++) {
    const c = (LW * (i + 0.5)) / n;
    for (let y = sTop; y < sBot; y++) {
      const t = (y - sTop) / (sBot - sTop);
      const half = (D1 + (D0 - D1) * t ** 0.65) / 2;
      ring(c, y, half, (u) => {
        const th = Math.asin(u);
        const ph = ((((th / Math.PI) * 12 + 0.5) % 1) + 1) % 1;
        let d = cylD(u);
        if (ph < 0.17) d *= 0.45;
        else {
          const q = (ph - 0.17) / 0.83;
          d += 0.1 + 0.16 * Math.sin(Math.PI * q) * (0.4 + q);
        }
        if (u < -0.92) d = Math.max(d, 0.6);
        if (u > 0.86) d -= 0.18;
        return d;
      });
    }
    for (let y = sTop - 1; y < sTop + 2; y++)
      ring(c, y, D1 / 2 + 1.5, (u) => cylD(u) * 0.8 + (y === sTop + 1 ? 0.2 : 0));
    for (let y = 26; y < 29; y++)
      ring(c, y, D1 / 2 + 2.5, (u, x) => {
        const k = (((x - c) % 6) + 6) % 6;
        const bead = k < 4 && Math.hypot(k - 1.5, y - 27) < 1.7;
        return bead ? cylD(u) * 0.7 : 0.78;
      });
    const ew = D0 * 0.5;
    for (let y = 14; y < 26; y++)
      ring(c, y, ew, (u, x) => {
        const k = ((((x - c + 4) % 8) + 8) % 8) - 4;
        const v = (y - 19.5) / 5.6;
        if ((k / 2.9) ** 2 + v * v < 1)
          return 0.05 + 0.75 * (1 - lam(u)) * (0.6 + 0.4 * Math.abs(v)) + (k > 1.6 ? 0.15 : 0);
        if (Math.abs(Math.abs(k) - 4) < 0.6 && y > 16) return 0.9;
        return 0.62;
      });
    const aw = D0 * 0.82;
    const cw = D0 * 0.74;
    for (let y = 0; y < 14; y++)
      for (let x = Math.floor(c - aw); x <= Math.ceil(c + aw); x++) {
        const dx = (x - c) / cw;
        const sag = 11 + 2.5 * (1 - Math.min(1, dx * dx));
        if (y < 4) put(x, y, 0.08 + 0.28 * ((x - c + aw) / (2 * aw)));
        else if (y === 4) put(x, y, 0.85);
        else if (Math.abs(dx) <= 1) {
          if (y < sag - 0.5) put(x, y, 0.1 + 0.18 * ((x - c + cw) / (2 * cw)) + (y === 5 ? 0.25 : 0));
          else if (y < sag + 1) put(x, y, 0.85);
        }
      }
    for (const sx of [-1, 1]) {
      const vx = c + sx * D0 * 0.62;
      const vy = 18;
      const R = D0 * 0.3;
      for (let y = Math.floor(vy - R - 1); y <= vy + R + 1; y++)
        for (let x = Math.floor(vx - R - 1); x <= vx + R + 1; x++) {
          const dd = Math.hypot(x - vx, y - vy);
          if (dd > R + 0.5) continue;
          const a = (Math.atan2(y - vy, (x - vx) * sx) + Math.PI) / (2 * Math.PI);
          const turns = Math.floor(3 * (1 - dd / R) - a + 1e-6);
          let best = 99;
          for (let k = turns - 1; k <= turns + 1; k++) {
            const rs = R * (1 - (k + a) / 3);
            if (rs > 0) best = Math.min(best, Math.abs(dd - rs));
          }
          let d = sx < 0 ? 0.06 : 0.34;
          d += 0.25 * clamp((x - vx) / R, -1, 1) * 0.5;
          if (best < 0.75) d = 0.92;
          if (dd > R - 0.8) d = 0.85;
          if (dd < 2.2) d = 0.95;
          put(x, y, d);
        }
    }
    let y = sBot;
    const parts: Array<[number, number, "f" | "t" | "s" | "p"]> = [
      [2, D0 / 2 + 1.5, "f"],
      [6, D0 / 2 + 6, "t"],
      [1, D0 / 2 + 3, "f"],
      [4, D0 / 2 + 2, "s"],
      [1, D0 / 2 + 4, "f"],
      [8, D0 / 2 + 9, "t"],
      [10, D0 / 2 + 12, "p"],
    ];
    for (const [h, half, kind] of parts) {
      for (let j = 0; j < h; j++, y++) {
        if (kind === "p") {
          for (let x = Math.floor(c - half); x <= Math.ceil(c + half); x++) {
            const f = (x - c + half) / (2 * half);
            let d = j === 0 ? 0.04 : 0.12 + 0.5 * f;
            if (j === 1) d = 0.75;
            if (x <= c - half + 0.5) d = 0.65;
            put(x, y, d);
          }
        } else
          ring(c, y, half, (u) => {
            if (kind === "s") return 0.72 + 0.15 * (1 - lam(u));
            if (kind === "f") return cylD(u) * 0.9 + 0.12;
            const v = Math.sin((Math.PI * (j + 0.5)) / h);
            let d = cylD(u) * (1.3 - 0.75 * v) + (j / h) * 0.18;
            if (j === h - 1) d = Math.max(d, 0.7);
            return d;
          });
      }
    }
  }
  for (let i = 0; i < W * H; i++) if (g[i] > 0) g[i] = Math.min(1, g[i] * 1.2 + 0.14);
  const hx: number[] = [];
  const hy: number[] = [];
  for (let yy = 0; yy < H; yy++)
    for (let xx = 0; xx < W; xx++) {
      const i = yy * W + xx;
      const v = g[i];
      const on = v >= 0.5;
      const e = v - (on ? 1 : 0);
      if (on) {
        hx.push(xx);
        hy.push(yy);
      }
      if (xx + 1 < W) g[i + 1] += (e * 7) / 16;
      if (yy + 1 < H) {
        if (xx > 0) g[i + W - 1] += (e * 3) / 16;
        g[i + W] += (e * 5) / 16;
        if (xx + 1 < W) g[i + W + 1] += e / 16;
      }
    }
  return { hx, hy };
}

function inkFromColor(color: string): number {
  const [r = 0, g = 0, b = 0] = (color.match(/\d+(\.\d+)?/g) ?? []).map(Number);
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

interface Field {
  W: number;
  H: number;
  ctx: CanvasRenderingContext2D;
  img: ImageData;
  buf: Uint32Array;
  hx: number[];
  hy: number[];
  sx: Float32Array;
  sy: Float32Array;
  ph: Float32Array;
  st: Float32Array;
  ax: Float32Array;
  per: Float32Array;
  ws: Float32Array;
  fx: Float32Array;
  fy: Float32Array;
  fp: Float32Array;
  fv: Float32Array;
  fl: Float32Array;
  fs: Float32Array;
  ox: Float32Array;
  oy: Float32Array;
  cox: Float32Array;
  coy: Float32Array;
}

interface Pointer {
  x: number;
  y: number;
  active: boolean;
}

const PUSH_RADIUS = 25;
const PUSH_RATE = 0.3;
const RIGHT_HALF_DENSITY = 2;
const RETURN_SECONDS = 1.1;

function createField(cv: HTMLCanvasElement, reserve: number): Field | null {
  const W = Math.max(2, Math.round(cv.clientWidth / 2));
  const H = Math.max(2, Math.round(cv.clientHeight / 2));
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");
  if (!ctx) return null;
  const img = ctx.createImageData(W, H);
  const { hx, hy } = buildColonnade(W, H, Math.max(160, W - reserve / 2));
  const R = Math.random;
  const gs = () => (R() + R() + R() - 1.5) * 1.4;
  const core = hx.length;
  for (let k = 0, haze = Math.round(core * 0.18); k < haze; k++) {
    const j = (R() * core) | 0;
    const s = 3 + R() * 12;
    hx.push(hx[j] + gs() * s);
    hy.push(hy[j] + gs() * s * 0.8);
  }
  const n = hx.length;
  const f: Field = {
    W,
    H,
    ctx,
    img,
    buf: new Uint32Array(img.data.buffer),
    hx,
    hy,
    sx: new Float32Array(n),
    sy: new Float32Array(n),
    ph: new Float32Array(n),
    st: new Float32Array(n),
    ax: new Float32Array(n),
    per: new Float32Array(n),
    ws: new Float32Array(n),
    fx: new Float32Array(0),
    fy: new Float32Array(0),
    fp: new Float32Array(0),
    fv: new Float32Array(0),
    fl: new Float32Array(0),
    fs: new Float32Array(0),
    ox: new Float32Array(n),
    oy: new Float32Array(n),
    cox: new Float32Array(0),
    coy: new Float32Array(0),
  };
  for (let i = 0; i < n; i++) {
    const far = R() < 0.5;
    const a = R() * 6.283;
    const r = 8 + R() * 30;
    f.sx[i] = far ? R() * W : hx[i] + Math.cos(a) * r;
    f.sy[i] = far ? R() * H : hy[i] + Math.sin(a) * r * 0.7;
    f.ph[i] = R() * 6.283;
    f.ax[i] = (R() - 0.5) * 40;
    f.per[i] = 25 + R() * 45;
    f.st[i] = R();
    f.ws[i] = 0.6 + R() * 1.6;
  }
  const base = Math.round((W * H) / 62);
  const m = base + Math.round((base / 2) * (RIGHT_HALF_DENSITY - 1));
  f.fx = new Float32Array(m);
  f.fy = new Float32Array(m);
  f.fp = new Float32Array(m);
  f.fv = new Float32Array(m);
  f.cox = new Float32Array(m);
  f.coy = new Float32Array(m);
  f.fl = new Float32Array(m);
  f.fs = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const right = i >= base;
    f.fl[i] = right ? W / 2 : 0;
    f.fs[i] = right ? W - W / 2 : W;
    f.fx[i] = f.fl[i] + R() * f.fs[i];
    f.fy[i] = R() * H;
    f.fp[i] = R() * 6.283;
    f.fv[i] = 0.015 + R() * 0.0875;
  }
  return f;
}

function displace(ox: Float32Array, oy: Float32Array, i: number, x: number, y: number, pointer: Pointer, push: number) {
  if (!pointer.active) return;
  const dx = x + ox[i] - pointer.x;
  const dy = y + oy[i] - pointer.y;
  const d2 = dx * dx + dy * dy;
  if (d2 >= PUSH_RADIUS * PUSH_RADIUS) return;
  const d = Math.sqrt(d2) || 0.001;
  const step = (PUSH_RADIUS - d) * push;
  ox[i] += (dx / d) * step;
  oy[i] += (dy / d) * step;
}

function drawField(f: Field, t: number, ink: number, pointer: Pointer, dt: number) {
  const { W, H, buf, ox, oy, cox, coy } = f;
  buf.fill(0);
  const keep = Math.exp(-dt / RETURN_SECONDS);
  const push = 1 - (1 - PUSH_RATE) ** (dt * 60);
  const win = 0.1;
  for (let i = 0; i < f.hx.length; i++) {
    const hx = f.hx[i];
    const hy = f.hy[i];
    const q = f.ph[i];
    const w = f.ws[i];
    const wa = 0.5 + 0.5 * Math.sin(t * 0.55 + hx * 0.018 - hy * 0.012);
    const wb = 0.5 + 0.5 * Math.sin(t * 0.37 - hx * 0.011 - hy * 0.021 + 2);
    const amp = 0.25 + 1.5 * wa ** 4 + 0.9 * wb ** 4;
    const sway = 0.9 * Math.sin(t * 0.21 + hy * 0.019) + 0.5 * Math.sin(t * 0.13 - hy * 0.007 + hx * 0.01);
    let x = hx + sway + amp * Math.sin(t * w + q);
    let y = hy + amp * 0.8 * Math.cos(t * w * 0.8 + q * 1.7);
    const p = (t / f.per[i] + f.st[i]) % 1;
    if (p < win) {
      const e = 0.5 - 0.5 * Math.cos((2 * Math.PI * p) / win);
      const fx = f.sx[i] + 8 * Math.sin(t * 0.17 + q) + 3 * Math.sin(t * 0.41 + q * 2.1);
      const fy = f.sy[i] + 6 * Math.cos(t * 0.13 + q * 1.3) + 3 * Math.sin(t * 0.37 + q);
      const arc = Math.sin(Math.PI * e) * f.ax[i];
      x += (fx - x) * e + arc;
      y += (fy - y) * e - arc * 0.5;
    }
    ox[i] *= keep;
    oy[i] *= keep;
    displace(ox, oy, i, x, y, pointer, push);
    x = (x + ox[i] + 0.5) | 0;
    y = (y + oy[i] + 0.5) | 0;
    if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = ink;
  }
  for (let i = 0; i < f.fx.length; i++) {
    const q = f.fp[i];
    const v = f.fv[i];
    if (Math.sin(t * (0.4 + v * 0.6) + q * 3) < -0.7) continue;
    const left = f.fl[i];
    const span = f.fs[i];
    let x = (f.fx[i] - left + t * v * Math.cos(q) + 6 * Math.sin(t * 0.01375 + q)) % span;
    let y = (f.fy[i] + t * v * 0.6 * Math.sin(q) + 5 * Math.cos(t * 0.01125 + q * 1.7)) % H;
    if (x < 0) x += span;
    x += left;
    if (y < 0) y += H;
    cox[i] *= keep;
    coy[i] *= keep;
    displace(cox, coy, i, x, y, pointer, push);
    x = (x + cox[i]) | 0;
    y = (y + coy[i]) | 0;
    if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = ink;
  }
  f.ctx.putImageData(f.img, 0, 0);
}

export function StoaField({ reserve, className }: { reserve: number; className?: string }) {
  const attach = useCallback(
    (cv: HTMLCanvasElement | null) => {
      if (!cv) return;
      let still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      let ink = inkFromColor(getComputedStyle(cv).color);
      const t0 = performance.now();
      const pointer: Pointer = { x: 0, y: 0, active: false };
      const client = { x: 0, y: 0, active: false };
      const track = (event: PointerEvent) => {
        client.x = event.clientX;
        client.y = event.clientY;
        client.active = true;
      };
      const release = () => {
        client.active = false;
      };
      let field: Field | null = null;
      const rebuild = () => {
        const W = Math.round(cv.clientWidth / 2);
        const H = Math.round(cv.clientHeight / 2);
        if (W < 2 || H < 2 || (field && field.W === W && field.H === H)) return;
        field = createField(cv, reserve);
        if (field && still) drawField(field, 0, ink, pointer, 0);
      };
      const observer = new ResizeObserver(rebuild);
      observer.observe(cv);
      const themeObserver = new MutationObserver(() => {
        ink = inkFromColor(getComputedStyle(cv).color);
        if (field && still) drawField(field, 0, ink, pointer, 0);
      });
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
      rebuild();
      window.addEventListener("pointermove", track, { passive: true });
      window.addEventListener("pointerdown", track, { passive: true });
      document.documentElement.addEventListener("pointerleave", release);
      window.addEventListener("blur", release);
      let last = t0;
      const loop = createFrameLoop((now: number) => {
        if (field) {
          const rect = cv.getBoundingClientRect();
          const x = ((client.x - rect.left) * field.W) / (rect.width || 1);
          const y = ((client.y - rect.top) * field.H) / (rect.height || 1);
          pointer.active = client.active && rect.width > 0 && Math.hypot(x - pointer.x, y - pointer.y) > 0.25;
          pointer.x = x;
          pointer.y = y;
          drawField(field, (now - t0) / 1000, ink, pointer, Math.min(0.05, (now - last) / 1000));
        }
        last = now;
        return !still;
      });
      loop.wake();
      const unwatchMotion = onReducedMotionChange((next) => {
        still = next;
        if (!next) loop.wake();
      });
      return () => {
        unwatchMotion();
        observer.disconnect();
        themeObserver.disconnect();
        loop.stop();
        window.removeEventListener("pointermove", track);
        window.removeEventListener("pointerdown", track);
        document.documentElement.removeEventListener("pointerleave", release);
        window.removeEventListener("blur", release);
      };
    },
    [reserve],
  );

  return (
    <canvas
      ref={attach}
      aria-hidden
      className={cn(
        "pointer-events-none fixed top-0 left-0 block h-dvh w-screen text-comic-graphite [image-rendering:pixelated]",
        className,
      )}
    />
  );
}

import { mulberry32 } from "./sim.js";

export interface ClusterResult {
  assignments: number[];
  centroids: number[][];
  inertia: number;
}

export function kmeans(
  points: number[][],
  kInput: number,
  {
    restarts: restartsInput = 10,
    maxIter = 60,
    seed = 42,
  }: { restarts?: number; maxIter?: number; seed?: number } = {},
): ClusterResult {
  const n = points.length;
  if (n === 0) return { assignments: [], centroids: [], inertia: 0 };
  const k = Math.max(1, Math.min(kInput, n));
  const dim = points[0]!.length;
  const restarts = Math.max(1, restartsInput);
  const rng = mulberry32(seed);
  let best: ClusterResult | null = null;

  for (let r = 0; r < restarts; r++) {
    const centroids: number[][] = [points[(rng() * n) | 0]!.slice()];
    while (centroids.length < k) {
      const dists = new Float64Array(n);
      let total = 0;
      for (let i = 0; i < n; i++) {
        let minD = Infinity;
        for (const c of centroids) {
          let s = 0;
          for (let d = 0; d < dim; d++) {
            const t = points[i]![d]! - c[d]!;
            s += t * t;
          }
          if (s < minD) minD = s;
        }
        dists[i] = minD;
        total += minD;
      }
      let target = rng() * total;
      let idx = n - 1;
      for (let i = 0; i < n; i++) {
        target -= dists[i]!;
        if (target <= 0) {
          idx = i;
          break;
        }
      }
      centroids.push(points[idx]!.slice());
    }

    const assignments = new Array<number>(n).fill(0);
    for (let iter = 0; iter < maxIter; iter++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        let bestC = 0;
        let bestD = Infinity;
        for (let c = 0; c < k; c++) {
          let s = 0;
          for (let d = 0; d < dim; d++) {
            const t = points[i]![d]! - centroids[c]![d]!;
            s += t * t;
          }
          if (s < bestD) {
            bestD = s;
            bestC = c;
          }
        }
        if (assignments[i] !== bestC) {
          assignments[i] = bestC;
          moved = true;
        }
      }

      const sums = Array.from({ length: k }, () => new Float64Array(dim));
      const counts = new Array<number>(k).fill(0);
      for (let i = 0; i < n; i++) {
        counts[assignments[i]!]!++;
        const s = sums[assignments[i]!]!;
        for (let d = 0; d < dim; d++) s[d] += points[i]![d]!;
      }
      for (let c = 0; c < k; c++) {
        if (counts[c] === 0) {
          centroids[c] = points[(rng() * n) | 0]!.slice();
        } else {
          centroids[c] = Array.from(sums[c]!, (v) => v / counts[c]!);
        }
      }
      if (!moved && iter > 0) break;
    }

    let inertia = 0;
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let d = 0; d < dim; d++) {
        const t = points[i]![d]! - centroids[assignments[i]!]![d]!;
        s += t * t;
      }
      inertia += s;
    }
    if (!best || inertia < best.inertia) best = { assignments, centroids, inertia };
  }

  return best!;
}

export function elbowCurve(points: number[][], maxK = 8): { k: number; inertia: number }[] {
  const curve: { k: number; inertia: number }[] = [];
  for (let k = 1; k <= Math.min(maxK, points.length); k++) {
    const { inertia } = kmeans(points, k, { restarts: 6, maxIter: 40 });
    curve.push({ k, inertia });
  }
  return curve;
}

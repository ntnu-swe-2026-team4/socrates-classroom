// @ts-nocheck
/* =========================================================
   立場星圖 — 純資料層（沒有 DOM、沒有 three.js，可以直接在 Node 測試）

   - 每個議題有自己的「價值軸」（由老師在辯論活動裡設定）
   - 每位同學有一條隨「對話輪次」漂移的軌跡：history[t][axisKey] ∈ [-1, 1]
   - 分群用 k-means++（多次重啟取最佳），並且在時間軸播放時對齊前後兩次的群編號，
     避免顏色跳來跳去
   ========================================================= */

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 字串 → 32 位元種子（同一議題永遠得到同一張星圖） */
export function hashSeed(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/* 配色取自網站本身的調色盤（青銅 / 鋼藍 / 橄欖 / 酒紅），深淺色背景上都看得清楚 */
export const AXIS_COLORS = ['#c9a15a', '#6f95c9', '#7ea56a', '#cc6f5c'];

/* 分群色：跟軸色刻意錯開，避免「這個群是不是那個軸」的誤會 */
export const CLUSTER_PALETTE = ['#d9855a', '#5fae8e', '#7a8fd6', '#c9a15a', '#b27ac0', '#5ab1c2'];

/* ---------------- k-means ---------------- */

export function kmeans(points, k, { restarts = 10, maxIter = 60, seed = 42 } = {}) {
  const n = points.length;
  if (n === 0) return { assignments: [], centroids: [], inertia: 0 };
  k = Math.max(1, Math.min(k, n));
  const dim = points[0].length;
  const rng = mulberry32(seed);
  let best = null;

  for (let r = 0; r < restarts; r++) {
    const centroids = [points[(rng() * n) | 0].slice()];
    while (centroids.length < k) {
      const dists = new Float64Array(n);
      let total = 0;
      for (let i = 0; i < n; i++) {
        let minD = Infinity;
        for (const c of centroids) {
          let s = 0;
          for (let d = 0; d < dim; d++) {
            const t = points[i][d] - c[d];
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
        target -= dists[i];
        if (target <= 0) { idx = i; break; }
      }
      centroids.push(points[idx].slice());
    }

    const assignments = new Array(n).fill(0);
    for (let iter = 0; iter < maxIter; iter++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        let bestC = 0, bestD = Infinity;
        for (let c = 0; c < k; c++) {
          let s = 0;
          for (let d = 0; d < dim; d++) {
            const t = points[i][d] - centroids[c][d];
            s += t * t;
          }
          if (s < bestD) { bestD = s; bestC = c; }
        }
        if (assignments[i] !== bestC) { assignments[i] = bestC; moved = true; }
      }
      const sums = Array.from({ length: k }, () => new Float64Array(dim));
      const counts = new Array(k).fill(0);
      for (let i = 0; i < n; i++) {
        counts[assignments[i]]++;
        for (let d = 0; d < dim; d++) sums[assignments[i]][d] += points[i][d];
      }
      for (let c = 0; c < k; c++) {
        centroids[c] = counts[c] === 0
          ? points[(rng() * n) | 0].slice()
          : Array.from(sums[c], (v) => v / counts[c]);
      }
      if (!moved && iter > 0) break;
    }

    let inertia = 0;
    for (let i = 0; i < n; i++) {
      for (let d = 0; d < dim; d++) {
        const t = points[i][d] - centroids[assignments[i]][d];
        inertia += t * t;
      }
    }
    if (!best || inertia < best.inertia) best = { assignments, centroids, inertia };
  }
  return best;
}

/**
 * 把新一次分群的編號，對齊到上一次（貪婪最近匹配），
 * 讓時間軸播放時同一群維持同一個顏色。
 */
export function alignClusters(prev, next) {
  if (!prev || prev.centroids.length !== next.centroids.length) return next;
  const k = next.centroids.length;
  const d2 = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) * (v - b[i]), 0);
  const pairs = [];
  for (let i = 0; i < k; i++) for (let j = 0; j < k; j++) pairs.push([d2(next.centroids[i], prev.centroids[j]), i, j]);
  pairs.sort((a, b) => a[0] - b[0]);
  const map = new Array(k).fill(-1); // next 的 i → 對齊後的編號 j
  const usedJ = new Set();
  for (const [, i, j] of pairs) {
    if (map[i] === -1 && !usedJ.has(j)) { map[i] = j; usedJ.add(j); }
  }
  const centroids = new Array(k);
  next.centroids.forEach((c, i) => { centroids[map[i]] = c; });
  return {
    assignments: next.assignments.map((a) => map[a]),
    centroids,
    inertia: next.inertia,
  };
}

/**
 * 依群心自動命名，例如「偏 本性・動機」。
 * activeAxes：目前顯示中的軸；centroid 依 [x,y,z] 槽位排列，slotIdx 為各軸對應的槽位索引。
 */
export function labelCluster(centroid, activeAxes, slotIdx, t) {
  // t：翻譯函式（元件傳入）；沒給就原樣輸出中文
  const T = t || ((k, v) => (v ? k.replace(/\{(\w+)\}/g, (m, n) => (n in v ? v[n] : m)) : k));
  const parts = [];
  activeAxes.forEach((ax, i) => {
    const v = centroid[slotIdx[i]];
    if (Math.abs(v) >= 0.28) parts.push(T(v > 0 ? ax.right : ax.left));
  });
  return parts.length ? T('偏 {labels}', { labels: parts.slice(0, 3).join(T('・')) }) : T('居中派');
}

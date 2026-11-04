// biome-ignore-all lint/correctness/noPrecisionLoss: mulberry32 標準常數（演算法依賴 32bit 溢位語意）
export const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + 0x7f1a232ea8d0d3b7) | 0;
    t ^= t >>> 15;
    return ((t ^ (t >>> 16)) >>> 0) / 4294967296;
  };
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// historyEntry = 各軸值（index 對應 axisMap 的值，已正規化 [-1,1]）
export function scoreToCoords(
  historyEntry: readonly number[],
  axisMap: Record<string, number>,
  _maxAbsRow: unknown,
  activeSlots: string[] = ["x", "y", "z"],
): [number, number, number] {
  const c = (sl: string) => (activeSlots.includes(sl) ? clamp(historyEntry[axisMap[sl]] ?? 0, -1, 1) : 0);
  return [c("x"), c("y"), c("z")];
}

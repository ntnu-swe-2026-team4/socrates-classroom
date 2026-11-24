import { expect, test } from "vitest";
import { createGrains, placeGrains } from "@/components/Quicksand";

function seeded(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const W = 400;
const H = 300;
const FLOOR = 240;
const grains = createGrains(W, H, seeded(7));

function positions(t: number) {
  const xs: number[] = [];
  const ys: number[] = [];
  placeGrains(grains, W, FLOOR, t, (_, x, y) => {
    xs.push(x);
    ys.push(y);
  });
  return { xs, ys };
}

test("the sand rests on the floor and thickens toward it", () => {
  const { ys } = positions(0);
  const share = (from: number, to: number) => ys.filter((y) => y >= from && y < to).length / ys.length;
  expect(ys.every((y) => y <= FLOOR && y >= FLOOR * 0.88)).toBe(true);
  expect(share(FLOOR - 10, FLOOR + 1)).toBeGreaterThan(share(FLOOR - 20, FLOOR - 10));
});

test("the sand only flows sideways", () => {
  const before = positions(0);
  const after = positions(12);
  expect(after.ys).toEqual(before.ys);
  expect(after.xs.some((x, i) => Math.abs(x - (before.xs[i] ?? x)) > 1)).toBe(true);
  expect(after.xs.every((x) => x >= 0 && x < W)).toBe(true);
});

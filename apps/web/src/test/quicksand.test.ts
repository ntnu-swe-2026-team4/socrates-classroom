import { expect, test } from "vitest";
import { createGrains, displaceGrain, placeGrains, pushRates } from "@/components/Quicksand";

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

function mean(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

test("the sand rests on the floor and thickens toward it", () => {
  const { ys } = positions(0);
  const share = (from: number, to: number) => ys.filter((y) => y >= from && y < to).length / ys.length;
  expect(ys.every((y) => y <= FLOOR && y >= FLOOR * 0.88)).toBe(true);
  expect(share(FLOOR - 10, FLOOR + 1)).toBeGreaterThan(share(FLOOR - 20, FLOOR - 10));
});

test("the sand flows one way, faster near the surface than at the floor", () => {
  const dt = 0.5;
  const before = positions(0);
  const after = positions(dt);
  const travel = after.xs.map((x, i) => (x - (before.xs[i] ?? 0) + W) % W);
  expect(travel.every((d) => d > 0 && d < W / 2)).toBe(true);
  expect(after.xs.every((x) => x >= 0 && x < W)).toBe(true);
  const surface = travel.filter((_, i) => (before.ys[i] ?? FLOOR) < FLOOR - FLOOR * 0.06);
  const bottom = travel.filter((_, i) => (before.ys[i] ?? 0) >= FLOOR - FLOOR * 0.02);
  expect(surface.length).toBeGreaterThan(0);
  expect(bottom.length).toBeGreaterThan(0);
  expect(mean(surface)).toBeGreaterThan(mean(bottom) * 1.5);
});

test("the pointer pushes nearby grains away and leaves distant ones alone", () => {
  const ox = new Float32Array(2);
  const oy = new Float32Array(2);
  const frame = { pointer: { x: 110, y: 100, active: true }, ...pushRates(1 / 60) };
  displaceGrain(ox, oy, 0, 100, 100, frame);
  displaceGrain(ox, oy, 1, 300, 100, frame);
  expect(ox[0]).toBeLessThan(-1);
  expect(Math.abs(oy[0] ?? 0)).toBeLessThan(1e-6);
  expect(ox[1]).toBe(0);
  expect(oy[1]).toBe(0);
});

test("pushed grains settle back once the pointer leaves, at any frame rate", () => {
  const settle = (fps: number, seconds: number) => {
    const ox = Float32Array.of(20);
    const oy = Float32Array.of(-10);
    const frame = { pointer: { x: 0, y: 0, active: false }, ...pushRates(1 / fps) };
    for (let f = 0; f < fps * seconds; f++) displaceGrain(ox, oy, 0, 100, 100, frame);
    return Math.hypot(ox[0] ?? 0, oy[0] ?? 0);
  };
  expect(settle(60, 1)).toBeLessThan(Math.hypot(20, 10));
  expect(settle(60, 1)).toBeCloseTo(settle(30, 1), 3);
  expect(settle(60, 6)).toBeLessThan(0.1);
});

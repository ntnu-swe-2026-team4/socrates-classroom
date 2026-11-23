import { expect, test } from "vitest";
import { colonnadeLayout } from "@/components/StoaField";

test.each([
  [100, 0],
  [160, 1],
  [279, 1],
  [280, 2],
  [420, 3],
  [559, 3],
  [560, 4],
  [940, 4],
])("a %i px colonnade holds %i columns", (width, count) => {
  expect(colonnadeLayout(width).count).toBe(count);
});

test("columns keep their size while the colonnade narrows", () => {
  const full = colonnadeLayout(620).diameter;
  for (const width of [560, 420, 280, 160]) expect(colonnadeLayout(width).diameter).toBe(colonnadeLayout(560).diameter);
  expect(Math.abs(full - colonnadeLayout(560).diameter)).toBeLessThan(1);
  expect(colonnadeLayout(940).diameter).toBeGreaterThan(full);
});

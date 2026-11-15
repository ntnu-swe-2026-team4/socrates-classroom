import { expect, test } from "vitest";
import { pageBounds, pageCount, sortRows } from "@/lib/table";

test("sorting is stable, direction-aware and uses natural order for text", () => {
  const rows = [
    { name: "Class 10", n: 2 },
    { name: "Class 2", n: 2 },
    { name: "Class 1", n: 5 },
  ];
  const accessors = { name: (row: (typeof rows)[number]) => row.name, n: (row: (typeof rows)[number]) => row.n };
  const collator = new Intl.Collator("en", { numeric: true });
  expect(sortRows(rows, { key: "name", dir: "asc" }, accessors, collator).map((row) => row.name)).toEqual([
    "Class 1",
    "Class 2",
    "Class 10",
  ]);
  expect(sortRows(rows, { key: "n", dir: "desc" }, accessors, collator).map((row) => row.name)).toEqual([
    "Class 1",
    "Class 10",
    "Class 2",
  ]);
  expect(sortRows(rows, undefined, accessors, collator)).toEqual(rows);
  expect(sortRows(rows, { key: "missing", dir: "asc" }, accessors, collator)).toEqual(rows);
});

test("page bounds are 1-based, clamp at the end and are empty for no rows", () => {
  expect(pageCount(0, 10)).toBe(1);
  expect(pageCount(25, 10)).toBe(3);
  expect(pageBounds(25, 1, 10)).toEqual({ from: 1, to: 10 });
  expect(pageBounds(25, 3, 10)).toEqual({ from: 21, to: 25 });
  expect(pageBounds(0, 1, 10)).toEqual({ from: 0, to: 0 });
});

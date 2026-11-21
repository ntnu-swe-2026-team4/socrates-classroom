import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const SRC_ROOT = join(import.meta.dirname, "../../");
const ALLOWED_FILES = new Set([join(SRC_ROOT, "api/queries.ts"), join(SRC_ROOT, "api/me.ts")]);

const PATTERNS: [RegExp, string][] = [
  [/queryKey: *\[/, "inline queryKey literal"],
  [/getQueryData\(\[/, "getQueryData with literal key"],
  [/setQueryData\(\[/, "setQueryData with literal key"],
  [/ensureQueryData\(\{ *queryKey: *\[/, "ensureQueryData with literal key"],
  [/invalidateQueries\(\{ *queryKey: *\[/, "invalidateQueries with literal key"],
];

function walk(dir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "test") continue;
      entries.push(...walk(path));
    } else if (/\.(ts|tsx)$/.test(name)) {
      entries.push(path);
    }
  }
  return entries;
}

test("#277: every query key comes from a queryOptions factory (api/queries.ts, api/me.ts)", () => {
  const violations: string[] = [];
  for (const path of walk(SRC_ROOT)) {
    if (ALLOWED_FILES.has(path)) continue;
    const lines = readFileSync(path, "utf8").split("\n");
    for (const [pattern, label] of PATTERNS) {
      lines.forEach((line, index) => {
        if (pattern.test(line)) violations.push(`${path.replace(SRC_ROOT, "")}:${index + 1} ${label}: ${line.trim()}`);
      });
    }
  }
  expect(
    violations.join("\n") || "no violations",
    [
      "Literal query keys are drift: one rename away from a silent cache split.",
      "Define the query in api/queries.ts (or api/me.ts) and reference *.queryKey at the call site.",
      "The biome-plugin-tanstack-query preset flags most of these; this ratchet makes the invariant absolute.",
      "Violations:",
      ...violations,
    ].join("\n"),
  ).toBe("no violations");
});

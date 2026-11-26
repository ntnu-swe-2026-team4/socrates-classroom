import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";

const SRC_ROOT = join(import.meta.dirname, "../../");
const SELF = join(import.meta.dirname, "use-effect.test.ts");

const PATTERNS: [RegExp, string][] = [[/\buseEffect\b/, "useEffect identifier"]];

function walk(dir: string): string[] {
  const entries: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      entries.push(...walk(path));
    } else if (/\.(ts|tsx)$/.test(name)) {
      entries.push(path);
    }
  }
  return entries;
}

test("#188: no useEffect anywhere in apps/web/src (biome only catches named imports)", () => {
  const violations: string[] = [];
  for (const path of walk(SRC_ROOT)) {
    if (path === SELF) continue;
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
      "Biome's noRestrictedImports importNames only flags named imports, so `React.useEffect`",
      "or `useEffect as x` slip past the lint gate; this ratchet makes the ban absolute.",
      "Effects belong in src/hooks/useSubscription.ts or the shared rAF loop in src/lib/frameLoop.ts.",
      "Violations:",
      ...violations,
    ].join("\n"),
  ).toBe("no violations");
});

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { byCodeUnit } from "@socrates/shared";
import { expect, test } from "vitest";

const REPO_ROOT = join(import.meta.dirname, "../../../../../");
const WALK_ROOTS = ["apps", "packages"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".cloudflare", ".git", "public"]);
const LINTABLE_EXTENSIONS = /\.(ts|tsx|js|jsx|css|json|jsonc|yml|yaml)$/;

const WHITELIST_PATHS: ReadonlyArray<readonly [string, string]> = [
  ["apps/web/src/components/DialogueView.tsx", "lint/correctness/useExhaustiveDependencies"],
  ["apps/web/src/components/ProviderKeys.tsx", "lint/a11y/useKeyWithClickEvents"],
  ["apps/web/src/components/ProviderKeys.tsx", "lint/a11y/noStaticElementInteractions"],
  ["apps/web/src/components/StanceConstellation.tsx", "lint/nursery/useReactCompiler"],
  ["apps/web/src/components/StanceConstellation.tsx", "lint/a11y/useSemanticElements"],
  ["apps/web/src/components/StanceConstellation.tsx", "lint/a11y/useSemanticElements"],
  ["apps/web/src/components/ui.tsx", "lint/a11y/useKeyWithClickEvents"],
  ["apps/web/src/components/ui.tsx", "lint/a11y/noStaticElementInteractions"],
  ["apps/web/src/components/ui.tsx", "lint/a11y/noLabelWithoutControl"],
  ["apps/web/src/routes/report.$id.tsx", "lint/suspicious/noArrayIndexKey"],
];

const SUPPRESSION_PATTERN =
  /biome-ignore(?:-all|-start|-end)?\s+((?:lint|assist|syntax)\/[a-z0-9]+\/[a-zA-Z]+(?:\([^)]*\))?)/g;

function walk(dir: string): string[] {
  const paths: string[] = [];
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      paths.push(...walk(path));
    } else if (LINTABLE_EXTENSIONS.test(name)) {
      paths.push(path);
    }
  }
  return paths;
}

test("#293 step 3: biome-ignore suppressions are frozen to the whitelist — adding or removing one MUST edit this test", () => {
  const found: string[] = [];
  for (const root of WALK_ROOTS) {
    for (const path of walk(join(REPO_ROOT, root))) {
      for (const line of readFileSync(path, "utf-8").split("\n")) {
        for (const match of line.matchAll(SUPPRESSION_PATTERN)) {
          found.push(`${path.slice(REPO_ROOT.length).replace(/\\/g, "/")}: ${match[1]}`);
        }
      }
    }
  }

  const expected = WHITELIST_PATHS.map(([file, rule]) => `${file}: ${rule}`);
  const unexpected = found.filter((entry) => !expected.includes(entry));
  const stale = expected.filter((entry) => !found.includes(entry));

  expect(unexpected, `new suppressions MUST replace a real fix — found outside the whitelist`).toEqual([]);
  expect(stale, `whitelist entries no longer matching a live suppression MUST be pruned`).toEqual([]);
  expect(found.sort(byCodeUnit), `frozen count (whitelist: ${WHITELIST_PATHS.length})`).toEqual(
    expected.sort(byCodeUnit),
  );
});

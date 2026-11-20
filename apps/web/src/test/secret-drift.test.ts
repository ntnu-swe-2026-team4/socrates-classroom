import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const script = resolve(import.meta.dirname, "../../dev/check-secret-drift.ts");

function checkSecretDrift(
  current: Record<string, { type: string }>,
  baseline: Record<string, { type: string }>,
  secretsFileContent?: string,
) {
  const directory = mkdtempSync(join(tmpdir(), "secret-drift-"));
  directories.push(directory);
  const manifest = join(directory, "worker.config.json");
  const baseConfig = join(directory, "baseline.mjs");
  const secretsFile = join(directory, "secrets.env");
  writeFileSync(manifest, JSON.stringify({ env: current }));
  writeFileSync(baseConfig, `export default () => ({ worker: { env: ${JSON.stringify(baseline)} } });`);
  if (secretsFileContent !== undefined) writeFileSync(secretsFile, secretsFileContent);
  return spawnSync(
    process.execPath,
    [script, manifest, baseConfig, ...(secretsFileContent === undefined ? [] : [secretsFile])],
    {
      encoding: "utf8",
      env: { PATH: process.env.PATH ?? "", AUTH_SECRET: "", NEW_SECRET: "" },
    },
  );
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("PR secret drift warning", () => {
  it("warns about a newly required secret missing from the CI environment", () => {
    const result = checkSecretDrift(
      { AUTH_SECRET: { type: "secret" }, NEW_SECRET: { type: "secret" } },
      { AUTH_SECRET: { type: "secret" } },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning");
    expect(result.stdout).toContain("NEW_SECRET");
    expect(result.stdout).not.toContain("AUTH_SECRET");
  });

  it("accepts a new secret supplied by a secrets file", () => {
    const result = checkSecretDrift(
      { AUTH_SECRET: { type: "secret" }, NEW_SECRET: { type: "secret" } },
      { AUTH_SECRET: { type: "secret" } },
      "NEW_SECRET=provided\n",
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});

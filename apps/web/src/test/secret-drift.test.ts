import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
const script = resolve(import.meta.dirname, "../../dev/check-secret-drift.ts");

function checkSecretDrift(
  current: Record<string, { type: string }>,
  values: Record<string, string> = {},
  secretsFileContent?: string,
) {
  const directory = mkdtempSync(join(tmpdir(), "secret-drift-"));
  directories.push(directory);
  const manifest = join(directory, "worker.config.json");
  const secretsFile = join(directory, "secrets.env");
  writeFileSync(manifest, JSON.stringify({ env: current }));
  if (secretsFileContent !== undefined) writeFileSync(secretsFile, secretsFileContent);
  return spawnSync(process.execPath, [script, manifest, ...(secretsFileContent === undefined ? [] : [secretsFile])], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "", ...values },
  });
}

afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

describe("PR secret drift warning", () => {
  it("warns when an existing required secret has no value", () => {
    const result = checkSecretDrift({ AUTH_SECRET: { type: "secret" } });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("AUTH_SECRET");
  });

  it("warns about any missing required secret even when known secrets have CI values", () => {
    const result = checkSecretDrift(
      { AUTH_SECRET: { type: "secret" }, NEW_SECRET: { type: "secret" } },
      { AUTH_SECRET: "ci-only-placeholder" },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("::warning");
    expect(result.stdout).toContain("NEW_SECRET");
    expect(result.stdout).not.toContain("AUTH_SECRET");
  });

  it("accepts a required secret supplied by a secrets file", () => {
    const result = checkSecretDrift(
      { AUTH_SECRET: { type: "secret" }, NEW_SECRET: { type: "secret" } },
      { AUTH_SECRET: "ci-only-placeholder" },
      "NEW_SECRET=provided\n",
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("emits no warning when all declared secrets have CI values", () => {
    const result = checkSecretDrift(
      {
        AUTH_SECRET: { type: "secret" },
        SEED_TOKEN: { type: "secret" },
        BYOK_ENC_KEY: { type: "secret" },
        GOOGLE_CLIENT_ID: { type: "text" },
      },
      {
        AUTH_SECRET: "ci-only-placeholder",
        SEED_TOKEN: "ci-only-placeholder",
        BYOK_ENC_KEY: "ci-only-placeholder",
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
  });
});

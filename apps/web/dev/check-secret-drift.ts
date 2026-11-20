import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

const [manifestPath, baselinePath, secretsPath] = process.argv.slice(2);
if (!manifestPath || !baselinePath) throw new Error("Expected a worker config manifest and a baseline config path");

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { env: Record<string, { type: string }> };
const baselineModule = await import(pathToFileURL(resolve(baselinePath)).href);
const baseline = await baselineModule.default({ mode: "production", isPreview: false });
const baselineEnv = baseline.worker.env as Record<string, { type: string }>;
const secrets = secretsPath ? parseEnv(await readFile(secretsPath, "utf8")) : {};

for (const [name, binding] of Object.entries(manifest.env)) {
  if (
    binding.type !== "secret" ||
    baselineEnv[name]?.type === "secret" ||
    process.env[name]?.trim() ||
    secrets[name]?.trim()
  )
    continue;
  console.log(
    `::warning file=apps/web/cloudflare.config.ts,title=New required secret::${name} is required by this PR build but has no value in PR CI; ensure the production secrets file supplies it before merging.`,
  );
}

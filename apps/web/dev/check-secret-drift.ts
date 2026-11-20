import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const [manifestPath, secretsPath] = process.argv.slice(2);
if (!manifestPath) throw new Error("Expected a worker config manifest path");

const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { env: Record<string, { type: string }> };
const secrets = secretsPath ? parseEnv(await readFile(secretsPath, "utf8")) : {};

for (const [name, binding] of Object.entries(manifest.env)) {
  if (binding.type !== "secret" || process.env[name]?.trim() || secrets[name]?.trim()) continue;
  console.log(
    `::warning file=apps/web/cloudflare.config.ts,title=Missing required secret::${name} is declared as a required secret but has no value in the CI environment or secrets file.`,
  );
}

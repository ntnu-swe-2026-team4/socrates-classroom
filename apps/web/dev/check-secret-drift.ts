import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";

const [manifestPath, secretsPath] = process.argv.slice(2);
if (!manifestPath) throw new Error("Expected a worker config manifest path");

const manifestRaw: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
const secrets = secretsPath ? parseEnv(await readFile(secretsPath, "utf8")) : {};

if (typeof manifestRaw !== "object" || manifestRaw === null || Array.isArray(manifestRaw)) {
  throw new Error("Manifest is not an object");
}
for (const [name, bindingRaw] of Object.entries(manifestRaw)) {
  if (name !== "env" || typeof bindingRaw !== "object" || bindingRaw === null) continue;
  for (const [bindingName, binding] of Object.entries(bindingRaw)) {
    if (typeof binding !== "object" || binding === null) continue;
    if (Reflect.get(binding, "type") !== "secret" || process.env[bindingName]?.trim() || secrets[bindingName]?.trim()) {
      continue;
    }
    console.log(
      `::warning file=apps/web/cloudflare.config.ts,title=Missing required secret::${bindingName} is declared as a required secret but has no value in the CI environment or secrets file.`,
    );
  }
}

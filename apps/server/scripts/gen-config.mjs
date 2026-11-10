import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const raw = readFileSync(join(root, "providers.config.yaml"), "utf8");
const data = parse(raw);
const json = JSON.stringify(data, null, 2);
const body = `import { GatewayConfigSchema, type GatewayConfig } from "./gateway-schema";

// Generated from providers.config.yaml (build time); rerun scripts/gen-config.mjs after editing the YAML
const CONFIG = ${json} as unknown;

export const gatewayConfig: GatewayConfig = GatewayConfigSchema.parse(CONFIG);
`;
writeFileSync(join(root, "src/gateway/config.gen.ts"), body);
console.log("gen ok");

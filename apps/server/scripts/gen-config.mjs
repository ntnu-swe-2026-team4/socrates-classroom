import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";

const raw = readFileSync("providers.config.yaml", "utf8");
const data = parse(raw);
const json = JSON.stringify(data, null, 2);
const body = `import { RoutingConfigSchema, type RoutingConfig } from "./routing-schema";

// Generated from providers.config.yaml (build time); rerun scripts/gen-config.mjs after editing the YAML
const CONFIG = ${json} as unknown;

export const routingConfig: RoutingConfig = RoutingConfigSchema.parse(CONFIG);
`;
writeFileSync("src/routing/config.gen.ts", body);
console.log("gen ok");

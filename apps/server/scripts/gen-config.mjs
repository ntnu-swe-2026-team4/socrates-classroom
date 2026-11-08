import { readFileSync, writeFileSync } from "node:fs";
import { parse } from "yaml";

const raw = readFileSync("providers.config.yaml", "utf8");
const data = parse(raw);
const json = JSON.stringify(data, null, 2);
const body = `import { RoutingConfigSchema, type RoutingConfig } from "./routing-schema";

// 由 providers.config.yaml 產生（build-time）；改 YAML 後重跑 scripts/gen-config.mjs
const CONFIG = ${json} as unknown;

export const routingConfig: RoutingConfig = RoutingConfigSchema.parse(CONFIG);
`;
writeFileSync("src/providers/config.gen.ts", body);
console.log("gen ok");

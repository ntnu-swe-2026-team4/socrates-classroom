/**
 * cf CLI（beta）設定：單一 Worker（API + 前端 assets + PiAgent DO）。
 * 取代 wrangler.jsonc；cf 指令需 Node ≥ 22.23（Bun 不支援載入本檔）。
 */
import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
  worker: {
    name: "socrates-classroom",
    entrypoint: "./apps/server/src/index.ts",
    compatibilityDate: "2026-11-01",
    compatibilityFlags: ["nodejs_compat"],
    observability: { enabled: true },
    env: {
      DB: bindings.d1({ name: "socrates" }),
      UPLOADS: bindings.r2({ name: "socrates-uploads" }),
      AI: bindings.ai({ dev: { remote: true } }),
      PiAgent: bindings.durableObject({ worker: "socrates-classroom", exportName: "PiAgent" }),
      ActivityEvents: bindings.durableObject({ worker: "socrates-classroom", exportName: "ActivityEvents" }),
      // vars
      PUBLIC_BASE_URL: bindings.text(""),
      COOKIE_SECURE: bindings.text("true"),
      CORS_ORIGINS: bindings.text(""),
      LLM_PROVIDER: bindings.text("pool"),
      DGX_BASE_URL: bindings.text(""),
      SEED_TOKEN: bindings.text(""),
      // secrets：實際值由 cf deploy --secrets-file 或 wrangler secret put 提供
      OPENCODE_API_KEY: bindings.secret(),
      OPENROUTER_API_KEY: bindings.secret(),
      ZAI_API_KEY: bindings.secret(),
      BYOK_ENC_KEY: bindings.secret(),
    },
    exports: {
      PiAgent: exports.durableObject({ storage: "sqlite" }),
      ActivityEvents: exports.durableObject({ storage: "sqlite" }),
    },
  },
});

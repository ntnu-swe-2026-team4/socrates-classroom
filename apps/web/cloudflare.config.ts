/**
 * cf CLI（beta）設定：單一 Worker（API + 前端 assets + PiAgent DO）。
 * 本檔位於 apps/web（vite root，plugin 由此讀取）；Worker 原始碼在 apps/server。
 * dev（vite dev）以 loadEnv 讀 .env* 覆寫 text bindings；build/deploy（production）用 fallback。
 */
import { loadEnv } from "vite";
import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig(({ mode }) => {
  const local = mode === "development" ? loadEnv(mode, import.meta.dirname, "") : {};
  const text = (key: string, fallback: string) => bindings.text(local[key] ?? fallback);

  return {
    worker: {
      name: "socrates-classroom",
      entrypoint: "../server/src/index.ts",
      compatibilityDate: "2026-11-01",
      compatibilityFlags: ["nodejs_compat"],
      observability: { enabled: true },
      env: {
        DB: bindings.d1({ name: "socrates", id: "d1db0ca1-1111-4000-8000-000000000001" }),
        UPLOADS: bindings.r2({ name: "socrates-uploads" }),
        ...(process.env.CF_REMOTE_AI === "true" ? { AI: bindings.ai({ dev: { remote: true } }) } : {}),
        PiAgent: bindings.durableObject({ worker: "socrates-classroom", exportName: "PiAgent" }),
        ActivityEvents: bindings.durableObject({ worker: "socrates-classroom", exportName: "ActivityEvents" }),
        PUBLIC_BASE_URL: text("PUBLIC_BASE_URL", ""),
        COOKIE_SECURE: text("COOKIE_SECURE", "true"),
        CORS_ORIGINS: text("CORS_ORIGINS", ""),
        LLM_PROVIDER: text("LLM_PROVIDER", "pool"),
        DGX_BASE_URL: text("DGX_BASE_URL", ""),
        SEED_TOKEN: text("SEED_TOKEN", ""),
        OPENCODE_API_KEY: bindings.secret(),
        OPENROUTER_API_KEY: bindings.secret(),
        ZAI_API_KEY: bindings.secret(),
        BYOK_ENC_KEY: bindings.secret(),
      },
      assets: { notFoundHandling: "single-page-application" },
      exports: {
        PiAgent: exports.durableObject({ storage: "sqlite" }),
        ActivityEvents: exports.durableObject({ storage: "sqlite" }),
      },
    },
  };
});

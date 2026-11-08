/*
 * cf CLI (beta) config: single Worker (API + web assets + PiAgent DO).
 * Lives in apps/web (vite root, plugin reads it here); Worker source is apps/server.
 * dev (vite dev) reads .env* via loadEnv to override text bindings; build/deploy (production) use fallback.
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
        ...(local.CF_REMOTE_AI === "true" || process.env.CF_REMOTE_AI === "true"
          ? { AI: bindings.ai({ dev: { remote: true } }) }
          : { AI: bindings.ai({}) }),
        PiAgent: bindings.durableObject({ worker: "socrates-classroom", exportName: "PiAgent" }),
        ActivityEvents: bindings.durableObject({ worker: "socrates-classroom", exportName: "ActivityEvents" }),
        Coordinator: bindings.durableObject({ worker: "socrates-classroom", exportName: "Coordinator" }),
        ReportJob: bindings.durableObject({ worker: "socrates-classroom", exportName: "ReportJob" }),
        PUBLIC_BASE_URL: text("PUBLIC_BASE_URL", ""),
        COOKIE_SECURE: text("COOKIE_SECURE", "true"),
        LLM_PROVIDER: text("LLM_PROVIDER", "pool"),
        DGX_BASE_URL: text("DGX_BASE_URL", ""),
        SEED_TOKEN: bindings.secret(),
        TTS_MODEL: text("TTS_MODEL", "@cf/myshell-ai/melotts"),
        OPENCODE_API_KEY: bindings.secret(),
        OPENROUTER_API_KEY: bindings.secret(),
        AUTH_SECRET: bindings.secret(),
        BYOK_ENC_KEY: bindings.secret(),
      },
      assets: { notFoundHandling: "single-page-application" },
      exports: {
        PiAgent: exports.durableObject({ storage: "sqlite" }),
        ActivityEvents: exports.durableObject({ storage: "sqlite" }),
        Coordinator: exports.durableObject({ storage: "sqlite" }),
        ReportJob: exports.durableObject({ storage: "sqlite" }),
      },
    },
  };
});

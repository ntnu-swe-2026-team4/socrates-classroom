/*
 * cf CLI (beta) config: single Worker (API + web assets + Chat/ReportRunner DOs).
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
        Chat: bindings.durableObject({ worker: "socrates-classroom", exportName: "Chat" }),
        ReportRunner: bindings.durableObject({ worker: "socrates-classroom", exportName: "ReportRunner" }),
        PUBLIC_BASE_URL: text("PUBLIC_BASE_URL", ""),
        COOKIE_SECURE: text("COOKIE_SECURE", "true"),
        LLM_PROVIDER: text("LLM_PROVIDER", "mock"),
        DGX_BASE_URL: text("DGX_BASE_URL", ""),
        SEED_TOKEN: bindings.secret(),
        TTS_MODEL: text("TTS_MODEL", "@cf/myshell-ai/melotts"),
        AUTH_SECRET: bindings.secret(),
        BYOK_ENC_KEY: bindings.secret(),
      },
      assets: { notFoundHandling: "single-page-application" },
      exports: {
        Chat: exports.durableObject({ storage: "sqlite" }),
        ReportRunner: exports.durableObject({ storage: "sqlite" }),
      },
    },
  };
});

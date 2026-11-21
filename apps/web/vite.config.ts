import { execSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig, loadEnv, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

function autoMigrate(): Plugin {
  return {
    name: "d1-auto-migrate",
    configureServer() {
      execSync("pnpm migrate", { stdio: "inherit", cwd: import.meta.dirname });
    },
  };
}

const DEV_SECRETS = [
  ["AUTH_SECRET", "login, register and every session path return 500"],
  ["BYOK_ENC_KEY", "teacher key endpoints (/settings/keys*) return 500"],
] as const;

function devSecretWarning(): Plugin {
  return {
    name: "dev-secret-warning",
    configureServer(server) {
      const warn = (env: Record<string, string | undefined>, source: string, note: string) => {
        const missing = DEV_SECRETS.filter(([key]) => !env[key]);
        if (missing.length === 0) return;
        const lines = missing.map(([key, effect]) => `  ${key} — ${effect}`).join("\n");
        server.config.logger.warn(
          `[dev] missing secrets in apps/web/${source}:${note}\n${lines}\n[dev] fix: openssl rand -base64 32, paste into apps/web/${source}, restart pnpm dev\n[dev] the UI and landing page still work without them.`,
        );
      };
      const devVarsPath = path.join(import.meta.dirname, ".dev.vars");
      if (existsSync(devVarsPath)) {
        warn(
          parseDotenv(readFileSync(devVarsPath, "utf8")),
          ".dev.vars",
          ' (it wholesale replaces the .env files — see docs/cf.md "Secrets")',
        );
        return;
      }
      warn({ ...loadEnv(server.config.mode, import.meta.dirname, ""), ...process.env }, ".env.local", "");
    },
  };
}

function parseDotenv(text: string): Record<string, string> {
  const env: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/.exec(line.trim());
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

export default defineConfig({
  assetsInclude: ["**/*.glb"],
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react({ compiler: true }),
    tailwindcss(),
    devSecretWarning(),
    autoMigrate(),
    cloudflare(),
  ],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  build: { target: "es2022" },
  server: { port: 5173, strictPort: true },
});

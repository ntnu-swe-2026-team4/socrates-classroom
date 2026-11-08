import { execSync } from "node:child_process";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";
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

export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react({ compiler: true }),
    tailwindcss(),
    autoMigrate(),
    cloudflare(),
  ],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  build: { target: "es2022" },
  server: { port: 5173 },
});

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  build: { target: "es2022" },
  server: {
    port: 5173,
    // 後端（cf dev，Hono Worker）預設在 8787；可用 VITE_API_TARGET 覆寫
    proxy: { "/api": { target: process.env.VITE_API_TARGET ?? "http://localhost:8787", changeOrigin: true } },
  },
});

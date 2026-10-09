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
    // 後端（Bun + Hono）預設在 8000，開發時由 Vite 代理，前端不用處理 CORS
    proxy: { "/api": { target: "http://localhost:8000", changeOrigin: true } },
  },
});

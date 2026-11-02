import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { cloudflare } from "@cloudflare/vite-plugin";

const webDir = path.resolve(import.meta.dirname, "../web");

export default defineConfig({
  plugins: [react(), tailwindcss(), cloudflare()],
  resolve: { alias: { "@": path.resolve(webDir, "src") } },
  publicDir: path.resolve(webDir, "public"),
  build: { target: "es2022" },
  environments: {
    client: {
      build: { rollupOptions: { input: path.resolve(webDir, "index.html") } },
    },
  },
});

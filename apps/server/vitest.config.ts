import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-plugin";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.vitest.jsonc" },
      isolatedStorage: false,
    } as never),
  ],
  test: {
    fsModuleCache: false,
    hookTimeout: 120_000,
    globalSetup: ["./tests/global-setup.ts"],
  },
});

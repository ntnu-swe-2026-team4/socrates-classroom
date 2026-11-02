import { defineConfig } from "vitest/config";
import { cloudflareTest } from "@cloudflare/vitest-pool-workers";

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.vitest.jsonc" },
      // 原 bun 測試套件是循序耦合設計（前面測試建資料、後面測試沿用），
      // 關閉 per-test storage 隔離以維持原語意
      isolatedStorage: false,
    } as never),
  ],
});

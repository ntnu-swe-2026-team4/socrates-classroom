import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { configDefaults, defineConfig } from "vitest/config";

const wrangler = { configPath: "./wrangler.vitest.jsonc" };
const reportTests = ["tests/invite.test.ts", "tests/report.test.ts", "tests/rest.test.ts", "tests/test-mode.test.ts"];

export default defineConfig({
  test: {
    fsModuleCache: false,
    hookTimeout: 120_000,
    globalSetup: ["./tests/global-setup.ts"],
    projects: [
      {
        plugins: [cloudflareTest({ wrangler })],
        test: {
          name: "workers",
          exclude: [...configDefaults.exclude, ...reportTests],
        },
      },
      {
        plugins: [cloudflareTest({ wrangler, miniflare: { bindings: { FAUX_TOKENS_PER_SECOND: "0" } } })],
        test: {
          name: "reports",
          include: reportTests,
        },
      },
    ],
  },
});

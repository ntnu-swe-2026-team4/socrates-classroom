/**
 * cf CLI（beta）的專案設定：取代 wrangler.jsonc。
 * 注意：載入本檔需要 Node ≥ 22.23，Bun 不支援——所有 cf 指令請用 node 跑。
 * 對照 docs/cf-migration.md 第四節的「目標形狀」；此處是最小探索版。
 */
import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
  worker: {
    name: "socrates-pi-agent",
    entrypoint: "./src/server.ts",
    compatibilityDate: "2026-11-01",
    compatibilityFlags: ["nodejs_compat"],
    observability: { enabled: true },
    bindings: {
      // Workers AI（含 GLM：@cf/zai-org/glm-4.7-flash 等）。
      // dev.remote 讓本機 `cf dev` 也打真實的 Workers AI，本機不用模型金鑰。
      AI: bindings.ai({ dev: { remote: true } }),
      // 同一個 Worker 內的 DO binding：API 藉此取得對話 agent 的 stub。
      PiAgent: bindings.durableObject({ worker: "socrates-pi-agent", exportName: "PiAgent" }),
    },
    exports: {
      // 取代 wrangler 的 migrations：new_sqlite_classes → sqlite storage。
      // Pi 的 transcript / inbox / 任務表（pi_*）就存在這顆 DO SQLite 裡。
      PiAgent: exports.durableObject({ storage: "sqlite" }),
    },
  },
});

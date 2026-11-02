# Cloudflare 部署與 Pi Durable 整合調查

> 調查日期：2026-11 ｜ 分支：`explore/cf-pi-durable` ｜ 狀態：調查報告，尚未實作
> 目標：把整套「詰問 · 蘇格拉底對話教室」（前端 + 後端 + SQLite + 上傳 + LLM 對話）部署到 Cloudflare，並用 Pi Durable（`PiHarness`）作為 LLM 框架的核心。

## TL;DR

1. **整套系統可以全上 Cloudflare**：一個 Worker（Hono API + 前端靜態資產）+ **D1**（SQLite 資料庫）+ **R2**（上傳檔案）+ **Durable Object**（Pi Durable 對話引擎）+ **Workers AI** 的 GLM 模型。
2. **LLM 框架**：用 Agents SDK 的 `PiHarness`（Durable Object Lifecycle capability）取代 `server/src/services/llm.ts` 手寫的 SSE／timeout／重試（約 250 行）。對話變成 durable session：斷線、重新部署、物件被驅逐都會從 checkpoint 續跑。`llm/prompts/socrates.md` 變成 Pi extension 的 system prompt section，LLM 組照舊「改檔案就好」。
3. **模型**：建議 Pi 預設用 Workers AI 的 `@cf/zai-org/glm-4.7-flash`（免 API key）。自家 GLM Coding Plan key 繼續可用（Worker 直連 `api.z.ai`），但 **AI Gateway 的原生 provider 清單沒有智譜/Z.AI**，自家 key 走不了 gateway。
4. **CLI：用新的 `cf`（beta）＋ `cloudflare.config.ts`，不要新開 wrangler 設定檔**。注意：`cf` 載入設定檔需要 **Node ≥ 22.23，不支援 Bun**；本機與 CI 的 `cf` 指令都要用 node 跑。`wrangler tail`（看 log）與單一 secret（`wrangler secret put`）目前仍需 wrangler。

---

## 一、現況盤點 → Cloudflare 對應

| 模組 | 現況 | Cloudflare 對應 | 改動量 |
|---|---|---|---|
| 前端 React + Vite SPA | `frontend/dist`（`frontend/container.md` 的 Docker 只是打包靜態站） | 同一個 Worker 的 **Static Assets**（`notFoundHandling: "single-page-application"`、`/api/*` 先走 Worker 程式） | 幾乎零：build 產物直接掛，Dockerfile 可淘汰 |
| API（Hono） | `Bun.serve`（`server/src/index.ts`） | Workers **原生支援 Hono**：`export default { fetch: app.fetch }`；SSE 的 `ReadableStream` 串流同樣可用 | 小：改啟動方式、config 注入改 bindings |
| SQLite | `bun:sqlite`（`db.ts` + `migrations/*.sql`） | **D1**。SQL 本身不動（D1 就是 SQLite）；`db.query().run()` → `env.DB.prepare().bind().run()`、`tx()` → `env.DB.batch()`；migration 改 `cf d1` 指令 | **中（最大單一改動）**：改寫 `db.ts` helpers，路由層多半不動 |
| 上傳檔案 | `Bun.write` 寫磁碟（`services/files.ts`，上限 50MB） | **R2** bucket binding（`put/get/delete`，走 `file.stream()`）；50MB 在 Worker request body 上限內（免費 100MB／付費 500MB） | 小 |
| `llm/` 設定層 | `node:fs` 讀檔 + mtime 熱重載（`config.ts`、`services/llm.ts`） | build-time `?raw` import（改檔後重新部署）；之後可改存 KV/R2 + admin API 恢復熱更新 | 小（行為微降級，見風險一節） |
| 環境變數 | `process.env` | `vars`（公開值）+ secrets（`GLM_API_KEY` 等，用 `cf deploy --secrets-file` 或 `wrangler secret put`） | 小 |
| SSE 對話 | `services/dialogue.ts` 手寫 ReadableStream SSE | Workers 支援 SSE；Phase 2 起搬進 Durable Object（見第三節） | 小 → 中 |
| in-memory 限流/鎖 | `dialogue.ts` 的 `Map`/`Set` | isolate 會隨時重置 → 搬進對話 DO（天然單點序列化）或用 Rate Limiting binding | 小 |
| seed / migrate 腳本 | `bun src/scripts/*.ts` | `cf d1 execute <DB> --file seed.sql`（或 D1 migrations 指令） | 小 |
| 測試 | `bun test` | 純邏輯測試（如 `EmotionSplitter`）留 bun/vitest；需要 Worker runtime 的整合測試用 `@cloudflare/vitest-pool-workers` | 中 |

`auth.ts` 用的是 Web Crypto（`crypto.randomUUID()`）+ Hono cookie helper，**可直接上 Workers**，不用改演算法。

## 二、GLM 在 Cloudflare 的三條路（2026-10 查證）

| 路線 | 內容 | 優點 | 限制 |
|---|---|---|---|
| **A. Workers AI GLM（建議為 Pi 預設）** | `env.AI.run("@cf/zai-org/glm-4.7-flash")`；經 `agents/models/pi-ai` 的 `createAI` 變成 Pi 的 Model | 免 GLM API key；AI binding 一等公民；Pi Durable 官方範例同款；有日誌與計費 | glm-4.7-flash 約 $0.0605/M input、$0.40/M output；`glm-5.3`（1M context）需 Workers **付費方案** |
| **B. 自家 GLM key（Coding Plan / BigModel）** | Worker `fetch` 直連 `api.z.ai` 或 `open.bigmodel.cn`，請求體跟現在完全一樣 | 現有 key／額度照用；`thinking: { type: "disabled" }` 等 GLM 專屬參數照送 | key 放 secret；拿不到 gateway 的快取／日誌；Pi Durable 不吃這種自訂 OpenAI 相容端點（pi-ai 的路由會把 model object 導去 gateway 的 provider-native endpoint，而 provider 清單裡沒有智譜） |
| **C. AI Gateway** | 統一入口：快取、日誌、限流、Unified Billing | 觀測與省錢 | **provider-native 清單（Anthropic、OpenAI、DeepSeek、Groq…共 23 家）不含智譜/Z.AI**，自家 GLM key 無法 BYOK 上 gateway |

結論：
- **Pi 對話引擎用 A**（`defaults: { model: ai("@cf/zai-org/glm-4.7-flash") }`），之後想升級情境換 model id 即可。
- **過渡期非對話功能**（`routes/activities.ts` 的 `completeJson` 結構化輸出）先用 B 直連，維持現有 GLM 額度。
- 若想統一觀測：Workers AI 也可走 AI Gateway REST 的 **`/ai/v1/chat/completions`（OpenAI 相容端點）**——現有 `glmText` 的 SSE 解析幾乎只要換 baseUrl 與 token 就能接上。

## 三、Pi Durable 怎麼「完成我們的 LLM 系統」

現有對話鏈路：`dialogueSse` → `socraticStream` → `glmText`（手寫 fetch SSE、60s idle timeout、GLM 錯誤碼分類 1111–1114 額度／1302–1305 限流、`EmotionSplitter`、成功才寫 D1）。

Pi 接管後的對應：

| 現有實作 | Pi Durable 對應 |
|---|---|
| `glmText` 手寫 SSE 解析、timeout | Pi 的 model task：stream resume、每回合 checkpoint |
| 重試與錯誤分類（`llm_rate_limited`/`llm_unavailable`） | `settings.retry`（指數退避，如 `maxRetries: 5, baseDelayMs: 1000`）+ `settings.afterFailedRun` |
| `dialogue.ts` 的 lock / rate Map | DO 本身單執行緒 + Pi inbox 排隊：學生追問可用 follow-up（排隊）或 `steer`（插進正在跑的回合） |
| 對話歷史存在 D1 | Pi transcript 存在 DO 自己的 SQLite（`pi_` 開頭的表）；**最終回覆仍寫回 D1**（`save` callback），`docs/api-contract.md` 契約不變 |
| `llm/prompts/socrates.md` | registry extension 的 `sections`（LLM 組改檔 → 重新部署即生效） |
| `EmotionSplitter` | 原樣保留，放在應用層 view／SSE adapter |
| `LLM_PROVIDER=mock` | 保留為離線開發與測試；雲上走 Workers AI |

**DO 拓撲**：一個對話執行緒（archive 對話 / activity 對話 / discussion 訊息串）= 一個 DO instance（`env.PiAgent.idFromName(threadId)`），用 root session `"1"`。每個學生各自的對話各自一個 DO instance，互不干擾；單一教室規模完全在 D1／DO 額度內。

**前端兩條接法**：
1. **SSE adapter（前端零改動，過渡期首選）**：DO 內把 `session.events()`（snapshot + 批次）轉回現有 `delta` / `emotion` / `done` / `error` SSE 事件，`dialogueSse` 的 API 形狀不變。
2. **WebSocket + snapshot（官方玩法，Phase 3）**：像 agents 範例那樣用 `WebSockets` + client outbox（`operationId` 去重）。斷線重連、頁面 mid-turn reload 自動補 snapshot；免費獲得 follow-up 與 steer 兩種輸入模式，很適合「課堂上學生追問」。

## 四、cloudflare.config.ts 全站範例（目標形狀）

```ts
import { bindings, defineConfig, exports } from "cf/config";

export default defineConfig({
  worker: {
    name: "socrates-classroom",
    entrypoint: "./server/src/worker.ts",
    compatibilityDate: "2026-11-01",
    compatibilityFlags: ["nodejs_compat"],
    assets: { notFoundHandling: "single-page-application", runWorkerFirst: ["/api/*"] },
    bindings: {
      DB: bindings.d1({ name: "socrates" }),
      UPLOADS: bindings.r2({ name: "socrates-uploads" }),
      AI: bindings.ai({ dev: { remote: true } }), // 本機 dev 也打真實 Workers AI（GLM）
      PiAgent: bindings.durableObject({ worker: "socrates-classroom", exportName: "PiAgent" }),
    },
    exports: {
      // 取代 wrangler 的 migrations：new_sqlite_classes → exports.durableObject({ storage: "sqlite" })
      PiAgent: exports.durableObject({ storage: "sqlite" }),
    },
    observability: { enabled: true },
  },
});
```

開發／部署流程：

```bash
npm install -g cf        # 或 npx cf（需要 Node ≥ 22.23；Bun 不能載 cloudflare.config.ts）
cf auth login            # 與 wrangler login 憑證分開，第一次要做
cf dev                   # 本機開發（AI binding 遠端打真的 GLM）
cf deploy                # 部署 Worker + assets + D1 + R2 + DO
npx wrangler tail socrates-classroom   # cf 還不能看 log，暫用 wrangler
```

CI 用 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`（`cf` 與 `wrangler` 都讀這兩個變數）。

## 五、分階段部署計畫

| 階段 | 內容 | 產出 |
|---|---|---|
| **Phase 0：整套先上線**（1–2 天） | `bun:sqlite` → D1、`Bun.write` → R2、`llm/` 檔改 build-time import、`index.ts` 改 Workers export、前端掛 assets。LLM 仍直連 GLM（B 路線） | 現有功能全部在 CF 跑，域名上線，前端 Dockerfile 淘汰 |
| **Phase 1：對話 DO 化** | 新增 `PiAgent` DO，把 `dialogueSse` 搬進 DO；Hono 端點轉發。llm.ts 原樣搬 | 對話有 durable 鎖與序列化，限流/併發問題消失 |
| **Phase 2：PiHarness 接管** | DO 內換 `PiHarness` + Workers AI GLM；`session.events()` → SSE adapter。prompt 進 extension section | 手寫 SSE/重試碼退役；對話可恢復、可排隊、可重試 |
| **Phase 3：加值** | WebSocket + outbox（前端改吃 snapshot）、follow-up/steer、tools（題庫查詢、班級上下文）、AI Gateway 快取與日誌、Workers Builds（push 自動部署） | 完整 agent 化的課堂對話 |

## 六、風險與注意事項

- **`cf` 是 beta**（1.0.0-beta.26）：`cloudflare.config.ts` 格式在 stable 前可能變；`cf` 載設定檔 **不支援 Bun**（engines: node ^22.23 || ^24.22 || ^26.12）。
- **模型計費**：`glm-5.3` 與 Durable Objects 的進階功能需 Workers 付費方案（$5/月起）；D1 免費額度（5GB、每日 5M 列讀取）對課堂規模綽綽有餘。
- **prompt 熱重載降級**：mtime 重載機制在 Workers 不存在，改 prompt 需重新部署（`llm/README.md` 的迭代慣例要更新）；Phase 3 可用 KV + admin route 恢復「改檔即生效」。
- **Pi 已知限制**（官方文件）：alarm 單次最長 15 分鐘（我們回覆 ≤3 句話，無虞）、無 tool approval 機制、event stream 無 cursor 續傳（重連靠 snapshot）、DO 內背景任務最多晚 30 秒被察覺。
- **`workers.dev` 域名在中國不通**：教學場景若學生在中國，要綁自有網域（CF 中國網路需企業方案，一般綁域名即可大部分可用）。
- **版本錨定**：`agents@0.32.0` ↔ `@earendil-works/pi-*@~1.4.0`（每個 agents 版本只對應一個 Pi minor 版本）；升級時兩邊要一起看。

## 七、原始出處

- Pi harness（Agents SDK）：https://developers.cloudflare.com/agents/harnesses/pi/
- 官方完整範例（WebSocket + workspace）：https://github.com/cloudflare/agents/tree/main/examples/next/harnesses/pi
- Pi extensions（tools / system prompt）：https://developers.cloudflare.com/agents/harnesses/pi/extensions/
- `agents/models/pi-ai`（Workers AI + AI Gateway）：https://developers.cloudflare.com/agents/models/pi-ai/
- Workers AI 的 GLM 模型頁（glm-4.7-flash / glm-5.3）：https://developers.cloudflare.com/ai/models/%40cf/zai-org/glm-5.3/
- AI Gateway provider 清單（無智譜）：https://developers.cloudflare.com/ai-gateway/usage/providers/
- cf CLI（beta 發布公告）：https://blog.cloudflare.com/cloudflare-cf-cli-launch/
- `cloudflare.config.ts` 設定參考：https://developers.cloudflare.com/cf/projects/cloudflare-config/
- cf for Wrangler users（遷移對照表）：https://developers.cloudflare.com/cf/wrangler/
- npm 版本查證（2026-11）：`agents@0.32.0`、`@earendil-works/pi-durable@1.4.0`、`@cloudflare/computer@0.8.0`、`wrangler@4.156.1`、`cf@1.0.0-beta.26`

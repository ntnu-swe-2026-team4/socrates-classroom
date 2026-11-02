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

## 二、GLM 在 Cloudflare 的四條路（2026-11 修訂）

| 路線 | 內容 | 優點 | 限制 |
|---|---|---|---|
| **A. Workers AI GLM（建議為 Pi 預設）** | `env.AI.run("@cf/zai-org/glm-4.7-flash")`；經 `agents/models/pi-ai` 的 `createAI` 變成 Pi 的 Model | 免 GLM API key；AI binding 一等公民；Pi Durable 官方範例同款；有日誌與計費 | glm-4.7-flash 約 $0.0605/M input、$0.40/M output；`glm-5.3`（1M context）需 Workers **付費方案** |
| **B. 自家 GLM key（Coding Plan / BigModel）** | Worker `fetch` 直連 `api.z.ai` 或 `open.bigmodel.cn`，請求體跟現在完全一樣 | 現有 key／額度照用；`thinking: { type: "disabled" }` 等 GLM 專屬參數照送 | key 放 secret；拿不到 gateway 的快取／日誌 |
| **B′. Pi Durable 直掛自家 GLM key（2026-11 修正新增）** | pi-ai **內建 `zai` provider**（`api: "openai-completions"`、`baseUrl: https://api.z.ai/api/coding/paas/v4`——跟我們 `llm/providers/models.json` 完全同源）與 `zai-coding-cn`（`open.bigmodel.cn/api/coding/paas/v4`）；`models.setProvider(zaiProvider())` + `ZAI_API_KEY` secret 即可 | **Pi 對話可以用既有 Coding Plan 額度**，不必綁 Workers AI；跟 A 可並存互為 fallback | pi 內建的兩個 zai provider 都標明是 Coding Plan 端點（需訂閱）；一般（非 plan）BigModel key 要用 models.json 自訂 endpoint 掛；`thinking` 等 GLM 專屬參數 pi 的 openai-completions 實作不一定會送，需實測 |
| **C. AI Gateway** | 統一入口：快取、日誌、限流、Unified Billing | 觀測與省錢 | **provider-native 清單（Anthropic、OpenAI、DeepSeek、Groq…共 23 家）不含智譜/Z.AI**，自家 GLM key 無法 BYOK 上 gateway |

### 課堂併發與官方用量（2026-11 查證）

| Provider | 官方用量限制 | 官方併發 | 課堂角色 |
|---|---|---|---|
| GLM Coding Plan Global | 5 小時 + 每週雙窗口（credits 制：Lite 2,000/5h・10,000/週、Pro 12,000・60,000、Max 28,000・140,000；離峰五折、峰時〔週一～五 14:00–18:00 UTC+8〕GLM-5.3-Flash 為 0.4×/1.2×）| **不公布數字**：官方只說「Max > Pro > Lite、動態調整」，建議 Lite 單專案、Pro 1–2、Max 2+；社群實測 Lite/Pro ≈ **1 併發**（超過回 429 Too much concurrency）、Max 動態可到約 30，且 2026-01 有 5→2→1 收緊紀錄 | 開發／老師個人助理。**整班共用一把 key 違反「訂閱僅限訂閱者」政策**，有風控（限速/凍結）風險 |
| OpenCode Go（`opencode-go`） | 官方有公布**每模型請求量估算**（依典型用量換算）：Go $10/月 — GLM-5.3-Flash **6,320 req/5h**・15,790/週・31,580/月、GLM-5.3 220/5h；Go Plus $40/月 — Flash **18,960/5h**、GLM-5.3 1,760/5h；Go Teams $20/人/月（每人獨立額度）。有峰離峰倍率（如 DeepSeek 峰時 01:00–04:00・06:00–10:00 UTC） | 未公布數字；官方要求自報 user-agent + 每對話固定 `x-opencode-session`（cache 親和），設計上就是多工作階段；濫用會被監控 | 溢位 / fallback；額度對蘇格拉底對話非常充足 |
| CF Workers AI | 文字生成預設 **300 req/min**；需付費方案的模型（如 GLM）標準計費 **20 req/min**、預付 AI Gateway credits **50 req/min**（每帳號每模型） | = RPM 上限（每個串流算一請求） | 免 key、零政策風險的底線；但 20/min 對整班爆發偏低，要吃預付 credits 才夠 |
| 自架 DGX Spark ×2（GLM-5.3-Flash EXL3，1M ctx） | token 無上限、資料不出門 | **4 併發**（團隊實測） | 課堂主力：4 併發 + 佇列；爆發期學生排隊數秒，零邊際成本 |

**建議的 provider pool**：自架（4 併發，全局併發閘 + 佇列）→ 溢位 `opencode-go` → 再溢位 Coding Plan（遵守 1–2 併發、離峰加強）→ Workers AI 壓底（RPM 上限）。pi-ai 的 fallback 鏈 + Pi Durable inbox 天然排隊（`whenBusy` follow-up）正好承接這個拓撲；應用層保留現有每人 20 req/min 限流。

結論（2026-11 修正）：
- **Pi 對話引擎首選 A**（`defaults: { model: ai("@cf/zai-org/glm-4.7-flash") }`）：免 key、計費透明；**但 B′ 同樣是一等公民**——pi-ai 內建 zai provider，想用既有 Coding Plan 額度就切 `zaiProvider()`，兩者甚至可以做 fallback 鏈。先前「Pi Durable 不吃自訂 OpenAI 相容端點」的說法僅適用於 `agents` 的 `createAI` wrapper 路由，不適用於 pi-ai 自己的 Models registry，特此修正。
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

## 七、CI/CD 與架構重構（全套上 CF 的目標形狀）

### CI/CD（GitHub Actions 為主線）

目前 repo 沒有任何 workflow（`.github/` 只有 CODEOWNERS），等於從零建，直接採 cf 官方 CI 模式（「build 一次、dry-run 驗證、同一個產物部署」）：

| Workflow | 觸發 | 步驟 |
|---|---|---|
| `ci.yml` | PR | bun install → typecheck → test → frontend build → `npx cf build` → `npx cf deploy --prebuilt --mode production --dry-run`（部署驗證不需 secrets，fork PR 安全） |
| `deploy.yml` | push `main` | `npx cf build` → `cf d1 migrations apply <DB_ID> --dir server/migrations` → `npx cf deploy --prebuilt --mode production`（只有這步拿 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`） |

- `cf` 裝成 devDependency 鎖版本（`npx cf` 會跑專案內的 copy），CI 與本機同版
- runner 用 Node 22（cf 載 `cloudflare.config.ts` 不支援 Bun）；裝依賴、跑測試仍用 bun，兩個 setup 並存
- staging / production：`--mode` + `cloudflare.config.ts` 的 `switch (ctx.mode)`，D1／R2／DO 各環境一組資源
- PR 可以加 `--mode preview` 出預覽網址（`ctx.isPreview` 分支）；不想每個 PR 都花部署額度的話，只 dry-run 也可。另一條官方路是 `cf previews deploy`——在 GitHub Actions 會自動拿 branch 名稱當 preview 名，部署到隔離的 Worker Preview URL
- 不採 Workers Builds（CF 的 git 整合）當主線：**它目前不支援 cf 專案**——文件明確說 Worker name 要匹配 wrangler 設定檔的 `name`，完全沒提 `cloudflare.config.ts`；cf 官方的 CI/CD 配合方式就是自管 GitHub Actions 純 steps（見下方「官方 action 現況」）

#### 官方 action 現況（2026-11 查證）

- **`cloudflare/wrangler-action@v4`**（官方維護，約 2k stars）：存在，但它是 **wrangler 專用**——`command` 只吃 wrangler 子指令、讀 `wrangler.jsonc`/`wrangler.toml`，不吃 `cloudflare.config.ts`。想用它等於回到 wrangler 路線。它對 package manager 支援齊全（`packageManager: npm|pnpm|yarn|bun`）、有 `deployment-url` 等 outputs。
- **`cf` CLI 沒有專屬官方 action**（搜尋會撞到的 `cf-cli-action` 是 Cloud Foundry 的，別誤用）。cf 的官方 CD 範本就是上表的純 steps：`cf` 鎖在 devDependencies、`npx cf` 跑專案內版本，版本一致性由 lockfile 保證，不需要 action 那層封裝。
- **完全不想寫 workflow 的官方選項**：Workers Builds（Cloudflare 儀表板連 GitHub，push 即自動 build+deploy，PR 有 preview URL）——零 YAML，但 monorepo 的觸發條件與測試閘門控制力弱，適合當方案 B。
- **結論：走 cf 路線就用純 steps**（這正是官方欽定方式）；wrangler-action 只有在改回 wrangler 設定檔路線時才用。

#### Bun 的去留

「不能用 Bun」的實際範圍只有一件事：**`cf` 指令不能用 Bun runtime 執行**（載入 `cloudflare.config.ts` 會直接報錯）。`cf` 的 bin 是 `#!/usr/bin/env node`——機器上有 Node ≥ 22.23 的話，`bun run deploy` 觸發的 `cf` 照樣跑在 Node 上。會炸的只有三種用法：`bun cf`、全域用 `bun add --global cf` 安裝、機器只裝 Bun 沒裝 Node。

而且全面丟掉 Bun 的成本幾乎為零，因為 server 的 Bun 綁定只有 3 個 API call（`bun:sqlite`、`Bun.write`、`Bun.file`）——**這三個在 Phase 0 無論如何都會被 D1／R2 取代**，不是丟 Bun 的額外成本。剩下的是平替：`bun install` → `npm`（root package.json 的 workspaces 本來就是標準語法）、`bun test` → vitest（整合測試本來就要 vitest-pool-workers）、`@types/bun` 移除。Bun 剩餘的價值只剩安裝速度。

**建議：Phase 0 順手全 Node 化**（npm workspaces + vitest），一套 runtime 貫穿本機與 CI，少一個心智負擔；要保留 Bun 也完全可行，只要團隊約定 cf 指令走 Node。

### 架構重構目標

```
socrates-classroom/
├── apps/
│   ├── web/        # 前端 React（build 產物 → Worker assets）
│   └── server/     # Hono Worker：API + PiAgent DO
├── packages/
│   ├── shared/     # API 契約型別（取代 frontend/src/api/types.ts 手寫複本）
│   └── llm/        # 現有 llm/ 原樣升級（prompts + models.json → build-time import）
└── .github/workflows/
```

四個 refactor 重點（依賴順序）：

1. **db.ts D1 adapter**：保留 `one/all/run/tx` 介面、底層換 D1（`tx()` → `env.DB.batch()`），路由層幾乎不動——這是 Phase 0 的主體。
2. **型別共享 + Hono RPC**：`hono/client` 讓前端直接 `client.classrooms.$get()` 型別安全呼叫，消滅手寫 `api.ts` 與 `types.ts` 複本；契約永遠同步，前端 mock 模式保留給離線開發。
3. **對話領域收進 DO**：`dialogue.ts` 的 lock／rate／SSE glue → `PiAgent` DO methods + events adapter（即 Phase 1–2 的形狀）。
4. **測試統一 vitest**：Worker 整合測試用 `@cloudflare/vitest-pool-workers`（真實 runtime、真 bindings），純邏輯（`EmotionSplitter` 等）一起搬，CI 一條指令。

### 工時估算

| 項目 | 估算 |
|---|---|
| Phase 0：D1/R2 移植 + assets 上線 | 1–2 天 |
| CI/CD 兩條 workflow + staging 資源 | 1 天 |
| db.ts adapter + 對話 DO 化（Phase 1–2） | 3–4 天 |
| Hono RPC + shared types 重構 | 2–3 天 |
| 測試遷移與補整合測試 | 1–2 天 |
| 緩衝（cf beta 變動、D1 行為差異） | 1–2 天 |

總計約 **1.5–2 週全隊工時**。順序：先 Phase 0 + CI 上線（系統已在 CF 跑），再從容做 refactor——兩者解耦，不會「大爆炸重寫」。

### Lock-in 評估

- **帶得走**：SQL schema、Hono 程式、React 前端、`llm/` 的 prompts（這些本來就是通用的）
- **鎖定 CF**：D1 API、R2、DO/PiHarness（最大 lock-in，但 pi transcript 是標準 SQLite 表可匯出）、Workers AI GLM
- 對課堂專案：鎖定成本可接受，換到的是零維運（無 Docker、無 VM、免費額度足夠全班使用）

## 八、原始出處

- Pi AI providers（CLI 層，含 ZAI Coding Plan Global/China）：https://pi.dev/docs/latest/providers
- pi.dev 自訂 provider / models.json：https://pi.dev/docs/latest/custom-provider
- OpenCode Go 官方用量（每模型請求估算表）：https://opencode.ai/docs/go/
- pi × OpenCode Go/Zend 整合：https://opencode.ai/v2/docs/console/harnesses/pi/
- pi-ai library 層內建 zai / zai-coding-cn provider：以 `explore/pi-agent/node_modules/@earendil-works/pi-ai/dist/providers/zai.js` 原始碼查證
- Pi harness（Agents SDK）：https://developers.cloudflare.com/agents/harnesses/pi/
- 官方完整範例（WebSocket + workspace）：https://github.com/cloudflare/agents/tree/main/examples/next/harnesses/pi
- Pi extensions（tools / system prompt）：https://developers.cloudflare.com/agents/harnesses/pi/extensions/
- `agents/models/pi-ai`（Workers AI + AI Gateway）：https://developers.cloudflare.com/agents/models/pi-ai/
- Workers AI 的 GLM 模型頁（glm-4.7-flash / glm-5.3）：https://developers.cloudflare.com/ai/models/%40cf/zai-org/glm-5.3/
- AI Gateway provider 清單（無智譜）：https://developers.cloudflare.com/ai-gateway/usage/providers/
- cf CLI 在 CI（官方 workflow 範本）：https://developers.cloudflare.com/cf/ci/
- cf CLI（beta 發布公告）：https://blog.cloudflare.com/cloudflare-cf-cli-launch/
- `cloudflare.config.ts` 設定參考：https://developers.cloudflare.com/cf/projects/cloudflare-config/
- cf for Wrangler users（遷移對照表）：https://developers.cloudflare.com/cf/wrangler/
- npm 版本查證（2026-11）：`agents@0.32.0`、`@earendil-works/pi-durable@1.4.0`、`@cloudflare/computer@0.8.0`、`wrangler@4.156.1`、`cf@1.0.0-beta.26`

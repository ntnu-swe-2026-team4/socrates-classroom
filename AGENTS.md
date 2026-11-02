# AGENTS.md — 詰問 · 蘇格拉底對話教室

課堂辯論平台：Cloudflare Workers（Hono）+ React SPA + D1/R2 + Pi Durable 對話引擎。繁體中文為主要語言。

## Setup commands

```bash
pnpm install                        # 必須用 pnpm（Node ≥ 22.23；cf CLI 不支援 Bun）
pnpm --filter @socrates/server dev  # 後端 cf dev → http://localhost:8787
pnpm dev:web                        # 前端 Vite → http://localhost:5173（代理 /api）
pnpm test                           # vitest-pool-workers（真 Worker runtime）
pnpm lint && pnpm typecheck         # 送 PR 前必須全綠
```

## 結構與資料流

- `apps/server` — 唯一 Worker：Hono API + `PiAgent`/`ActivityEvents` 兩個 Durable Object
- `apps/web` — React SPA（打包後掛在同一 Worker 的 Static Assets）
- `packages/shared` — API 契約型別（單一真相；改型別 = server 與 web 一起同步）
- `packages/llm` — 提示詞（`prompts/socrates.md` 建置期注入 system prompt，改檔 → 重新部署即生效）
- 資料：D1（`apps/server/migrations/`）、上傳在 R2

## Code style

- Biome 全責格式與 lint：`pnpm lint`（不通過不要送 PR）、`pnpm format` 自動修
- TypeScript strict；D1 存取一律走 `src/db/d1.ts` 的 `one/all/run/batch`（`$named` 參數會自動轉位置參數）

## Testing

- `pnpm test` = vitest-pool-workers（真 runtime + 本地 D1/R2/DO，LLM 用 mock provider）
- 改對話/路由邏輯時：`tests/api.test.ts` 的 SSE 契約（`delta/emotion/done/error`）不可破壞
- 單跑一個測試：`pnpm --filter @socrates/server exec vitest run -t "測試名稱"`

## Boundaries

- **Never** 把學生流量路由到白名單以外的模型（ZDR 規則，見 `apps/server/AGENTS.md`）
- **Never** 在 AI Gateway 開 logging/caching（會留存學生對話內容，破壞 ZDR）
- **Never** 把任何 API key 放進 `apps/web`（前端打包可見）
- **Ask first** 才可以：改 `docs/api-contract.md` 涵蓋的 API 形狀、新增 Cloudflare bindings、動 `PiHarness` 的 settings
- 部署（`cf deploy`）一律由 CI（`deploy.yml`）執行，不要在本機手動部署

## 部署與 CLI

- 用 **cf CLI**（`cloudflare.config.ts` 在 `apps/server/`），不用 wrangler 設定檔
- cf 指令需要 **Node ≥ 22.23 且不支援 Bun**；在 `apps/server/` 目錄下執行
- `wrangler` 只作為 cf 的建置後端與 `wrangler tail` 存在

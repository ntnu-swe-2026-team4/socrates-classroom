# AGENTS.md — apps/server（Hono Worker + Pi Durable）

本目錄是唯一 Worker：Hono API + `PiAgent`/`ActivityEvents` Durable Objects + provider pool。
Root 的規則全部適用；以下是本目錄的差異與深水區。

## 指令

```bash
pnpm dev        # cf dev（Worker + 本地 D1/R2；AI binding remote）
pnpm test       # vitest-pool-workers：真 runtime + 本地 D1/R2/DO
pnpm typecheck  # TS7 strict + @cloudflare/workers-types
pnpm exec cf build   # 驗證可打包（產出 .cloudflare/output/）
node scripts/seed.mjs  # 灌示範資料（需 SEED_TOKEN）
```

## 架構界線

- `src/do/pi-agent.ts`（PiHarness）**不直接認識 HTTP**：對話由 routes 轉 RPC 進來，SSE 是它輸出的契約
- `src/providers/whitelist.ts` 是模型白名單的唯一真相——新增 provider 前先讀 `docs/providers.md` 的 ZDR 規則
- `src/db/d1.ts` 的 `prepare()` 會把 `$named` 轉位置參數：SQL 維持 `$named` 寫法即可
- 交易語意：`db.batch()` 是唯一原子性來源（D1 沒有互動式交易）

## Boundaries

- **Never** 修改 SSE 事件形狀（`delta/emotion/done/error`）——`docs/api-contract.md` 契約凍結，前端零改動是設計目標
- **Never** 讓 `saveTurn`（D1 寫回）失敗時吞掉錯誤——對話有寫進 pi transcript 但沒寫 D1 = 資料不一致
- **Always** 對 pi 的 `submit` 先掛 `session.events()` 再 submit（順序顛倒會漏掉瞬時完成的 run——已經踩過）
- **Ask first**：改 `PiHarness` settings（retry/afterFailedRun）、新增 DO、換 `@earendil-works/pi-*` 版本（agents↔pi 有版本配對鎖：agents@0.32 ↔ pi@1.4）

## 測試慣例

- 整合測試在 `tests/api.test.ts`：循序耦合（前面測試建資料、後面沿用），`isolatedStorage: false` 是刻意的
- 測試用 `wrangler.vitest.jsonc`（不是 cloudflare.config.ts）＋ mock provider；compat date 是 2026-08-06（pool-workers 的 workerd 上限）
- LLM 相關斷言只驗「有 done、有 emotion、文字非空」，不驗內容

# explore/pi-agent — Pi Durable 最小探索 scaffold

用 cf CLI（beta）+ `cloudflare.config.ts` + Workers AI GLM 跑起第一顆 Pi Durable agent。
完整調查與遷移計畫見 [`docs/cf-migration.md`](../../docs/cf-migration.md)。

這個資料夾**完全獨立於主系統**（自己的 `package.json`），玩壞了刪掉重來就好。

## 前置

1. **Node ≥ 22.23**：`cf` 載入 `cloudflare.config.ts` 不支援 Bun（repo 主系統用 Bun 沒關係，cf 指令另外用 node 跑）。
2. `npm install -g cf`（或每次 `npx cf`），然後 `cf auth login`（與 wrangler login 憑證分開）。
3. Cloudflare 帳號；本機 `cf dev` 的 AI binding 會遠端打真的 Workers AI（免模型 key，用量計入你的帳號）。

## 安裝與執行

```bash
cd explore/pi-agent
bun install        # 裝依賴用 bun 沒問題
bun run dev        # = cf dev，本機 Worker + 遠端 Workers AI
bun run deploy     # = cf deploy，部署到你的 Cloudflare
```

## 試玩

```bash
# 本機（cf dev 會給你 localhost port）
curl -X POST localhost:PORT/api/ask -H 'Content-Type: application/json' \
  -d '{"prompt":"我覺得誠實比較重要","thread":"t1"}'

# 部署後（workers.dev 域名）
curl -X POST https://socrates-pi-agent.<你的子網域>.workers.dev/api/ask \
  -H 'Content-Type: application/json' -d '{"prompt":"我覺得誠實比較重要","thread":"t1"}'
```

同一個 `thread` 名稱會續用同一份對話記錄（存在 DO 的 SQLite，斷線/重部署不丟）；
換一個 `thread` 就是新對話。

## 看對話內部

```bash
npx wrangler tail socrates-pi-agent        # 看 log（cf 還不能 tail）
cf cli search "durable object"             # 找 cf 指令
```

## 對照主系統（這個 scaffold 在驗證什麼）

| scaffold                          | 主系統對應                                                                   | Phase |
| --------------------------------- | ---------------------------------------------------------------------------- | ----- |
| `PiAgent` DO + `PiHarness`        | `server/src/services/llm.ts` 手寫 SSE/重試的替代                             | 2     |
| `PREAMBLE` 寫死在 `src/server.ts` | 讀 `llm/prompts/socrates.md`（build-time `?raw` import）                     | 2     |
| `defaults.model` Workers AI GLM   | `llm/providers/models.json` 的 provider 設定層                               | 2     |
| `/api/ask` 等完整回覆             | `dialogueSse` SSE 串流（DO 內用 `session.events()` 轉回 delta/emotion/done） | 1→2   |
| 無資料庫                          | D1（對話記錄照 API 契約寫回）                                                | 0     |

## 已知限制

- `cf` 是 beta：`cloudflare.config.ts` 格式可能變；`wrangler tail`、單一 secret 仍需 wrangler。
- Workers AI `glm-4.7-flash` 免費額度每日有上限，超過走付費；`glm-5.3`（1M context）需付費方案。
- 這個 scaffold 沒有 WebSocket、沒有 workspace/exec 工具——那是官方完整範例（`examples/next/harnesses/pi`）的範圍，Phase 3 再接。

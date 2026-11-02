# 本地開發（Local Development）

> 指令與前置需求的 SSOT。架構見 [`architecture.md`](./architecture.md)；cf CLI 細節見 [`cf.md`](./cf.md)。

## 快速開始

```bash
pnpm install
prek install                        # git pre-commit hooks
pnpm dev                        # 單一全栈 dev server（SPA HMR + Worker + 本地 D1/R2）:5173
pnpm migrate                        # 本地 D1 套 schema（首次必跑；見下方「本地資料庫」）
pnpm seed                           # 灌示範資料（需 .dev.vars 設 SEED_TOKEN）
```

示範帳號：老師 `林老師`、學生 `訪客`（示範登入：選身分＋姓名即可）。

## 不需要 Cloudflare 帳號

預設情況（`CF_REMOTE_AI` 未設）**整個開發流程不需要 CF 帳號**：

- D1 / R2 / Durable Objects 都是本地模擬，資料存在 `apps/web/.cloudflare/state/`
- 對話功能在 `.dev.vars` 設 `DGX_BASE_URL=http://100.102.84.36:8888/v1` 即可用自架 DGX Spark（純 HTTP，不經 CF）

只有 `CF_REMOTE_AI=true`（用 Workers AI 作對話 fallback）時才需要 `cf login`。

## 本地資料庫

- Schema 的 SSOT 是 `apps/server/migrations/*.sql`——production 由 CI 套同一批檔案
- `pnpm migrate` = `cf d1 migrations apply <DB_ID> --local --persist-to .cloudflare/state`——`--persist-to` 必須對準 dev server 的 state 目錄（否則會寫到 `~/.config/cloudflare/state`，dev server 看不到）
- `<DB_ID>` 是 `cloudflare.config.ts` 裡 `bindings.d1({ id })` 宣告的固定 UUID，與指令保持一致
- **Persistence scope 陷阱**：改 `cloudflare.config.ts`（bindings、compat date、flags）會讓本地資料「消失」——這是 scope 隨 config hash 變化的正常行為，重跑 `pnpm migrate` 即可

## 對話功能（LLM）在本地

`.dev.vars`（gitignored，範本見 `.env.example`）三選一：

| 方式            | 設定                                        | 費用                                          |
| --------------- | ------------------------------------------- | --------------------------------------------- |
| 自架 DGX Spark  | `DGX_BASE_URL=http://100.102.84.36:8888/v1` | 0 元（團隊硬體，Tailscale 內）                |
| GLM Coding Plan | `LLM_PROVIDER=dev` ＋ `ZAI_API_KEY=<token>` | 自己的訂閱額度（dev-only 條款，不進學生流量） |
| Workers AI      | `CF_REMOTE_AI=true` ＋ `cf login`           | 免費 Neurons 額度                             |

都不設時對話回 `llm_unavailable`，其他功能不受影響。

## 常見問題

- **`pnpm dev` 要求 Cloudflare 授權** → 有人設了 `CF_REMOTE_AI=true` 或 shell 有殘留 env；unset 即可
- **seed 失敗「請設定 SEED_TOKEN」** → `.dev.vars` 加 `SEED_TOKEN=dev-seed`（與腳本環境變數一致）
- **改 config 後資料不見** → 見上「Persistence scope 陷阱」

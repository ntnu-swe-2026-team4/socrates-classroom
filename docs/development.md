# 本地開發（Local Development）

> 指令與前置需求的 SSOT。架構見 [`architecture.md`](./architecture.md)；cf CLI 細節見 [`cf.md`](./cf.md)。

## 快速開始

完整 quickstart（安裝 → seed → 登入）見 [README](../README.md#quickstart)。本文件記 dev 專屬細節：

- Node 26 由 `devEngines`（root `package.json`）保證：`pnpm install` 自動下載對應 runtime；shell 互動（`node`／`cf` 直呼）用 [fnm](https://github.com/Schniz/fnm) 等 version manager（`eval "$(fnm env --use-on-cd --shell zsh)"`）

- `pnpm dev` 啟動時**自動套用 D1 migrations**（vite `configureServer` 跑 `pnpm migrate`，冪等約 1s）；手動 `pnpm migrate` 等價
- `pnpm seed` 需要 **dev server 運行中**；SEED_TOKEN 自動讀 `apps/web/.env.local`（或環境變數）。在 `LLM_PROVIDER=mock`（預設）或設了 `DGX_BASE_URL` 時可用；灌入老師帳號＋兩間含進行中活動的教室

## 不需要 Cloudflare 帳號

預設情況（`CF_REMOTE_AI` 未設）**整個開發流程不需要 CF 帳號**：

- D1 / R2 / Durable Objects 都是本地模擬，資料存在 `apps/web/.cloudflare/state/`
- 對話功能：`CF_REMOTE_AI=true`＋非 mock `LLM_PROVIDER` ＋ `cf auth login` → 本地 workerd 的 AI binding 打真實 Workers AI（ZDR ✓）

只有 `CF_REMOTE_AI=true`（用 Workers AI 作對話 fallback）時才需要 `cf login`。

## 本地資料庫

- Schema 的 SSOT 是 `apps/server/migrations/*.sql`——production 由 CI 套同一批檔案
- `pnpm migrate` = `cf d1 migrations apply <DB_ID> --local --persist-to .cloudflare/state`——`--persist-to` 必須對準 dev server 的 state 目錄（否則會寫到 `~/.config/cloudflare/state`，dev server 看不到）
- `<DB_ID>` 是 `cloudflare.config.ts` 裡 `bindings.d1({ id })` 宣告的固定 UUID，與指令保持一致
- **Persistence scope 陷阱**：改 `cloudflare.config.ts`（bindings、compat date、flags）會讓本地資料「消失」——這是 scope 隨 config hash 變化的正常行為，重啟 dev（自動 migrate）或手動 `pnpm migrate` 即可

## 對話功能（LLM）在本地

`.env.local`（gitignored，範本見 `.env.example`；僅 dev 讀取——build/deploy 用 config 預設，生產設定走 `cf deploy --secrets-file`）。預設 `LLM_PROVIDER=mock`（離線 faux 模型，零帳號）——要真對話，三選一：

| 方式          | 設定                                      | 費用                            |
| ------------- | ----------------------------------------- | ------------------------------- |
| 離線 mock     | 預設（`LLM_PROVIDER=mock`，無需設定）     | 0 元（faux 腳本回覆，非真 LLM） |
| CF Workers AI | `CF_REMOTE_AI=true`（需 `cf auth login`） | Workers AI 計費（neurons）      |
| Workers AI    | `CF_REMOTE_AI=true` ＋ `cf login`         | 免費 Neurons 額度               |

都不設真 LLM 時用 mock；`pnpm seed` 在 mock 和 DGX 模式下都可用（`DGX_BASE_URL` 目前僅開 seed 閘門——dgx 腿已隨 provider block 暫時移除，設定 URL 不會註冊模型腿）。

## 常見問題

- **`pnpm dev` 要求 Cloudflare 授權** → 有人設了 `CF_REMOTE_AI=true` 或 shell 有殘留 env；unset 即可
- **seed 失敗「找不到 SEED_TOKEN」** → `.env.local` 不存在或沒有 `SEED_TOKEN` 行；**改了 `.env.local` 要重啟 dev**（server 只在啟動時載入）
- **seed「連不上」** → dev server 沒起來（`pnpm dev` 先跑）；或 seed 跑在 dev 前面
- **改 config 後資料不見** → 見上「Persistence scope 陷阱」
- **報告部分成功變成 failed（本地）** → 舊版五支 migration 時代的本地 DB 還留著舊 CHECK（cf 以檔名記帳，合併後的 `001_init.sql` 會被跳過）；刪除 `apps/web/.cloudflare/state/` 重來即可。production 不受影響（從未用舊 migration 建過）

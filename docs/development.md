# 本地開發（Local Development）

> 本地開發細節的 SSOT；quickstart 見 [README](../README.md#quickstart)。核對日期：2026-11-19，`integration/web-next-142`（PR #155，尚未合併）。架構見 [`architecture.md`](./architecture.md)；cf CLI 細節見 [`cf.md`](./cf.md)。

## 快速開始

完整 quickstart（安裝 → seed → 登入）見 [README](../README.md#quickstart)。本文件記 dev 專屬細節：

- Node 26 由 `devEngines`（root `package.json`）保證：`pnpm install` 自動下載對應 runtime；shell 互動（`node`／`cf` 直呼）用 [fnm](https://github.com/Schniz/fnm) 等 version manager（`eval "$(fnm env --use-on-cd --shell zsh)"`）

- `pnpm dev` 啟動時**自動套用 D1 migrations**（vite `configureServer` 跑 `pnpm migrate`，冪等約 1s）；手動 `pnpm migrate` 等價
- `pnpm seed` 需要 **dev server 運行中**；SEED_TOKEN 自動讀 `apps/web/.env.local`（或環境變數）。server 端設了 `SEED_TOKEN` 且 `ENVIRONMENT=dev` 時才可用（與 LLM 模式無關）；灌入固定 fixture：8 個帳號、3 個系統題、2 間教室

## 不需要 Cloudflare 帳號

預設情況（`CF_REMOTE_AI` 未設）**整個開發流程不需要 CF 帳號**：

- 本專案的 D1／Durable Objects 是本地模擬，資料存在 `apps/web/.cloudflare/state/`；目前沒有 R2 binding
- 不需要 CF 帳號不等於不需要本機 session secrets；先依 [quickstart](../README.md#quickstart) 設定
- 對話功能：`CF_REMOTE_AI=true`＋非 mock `LLM_PROVIDER` ＋ `cf auth login` → 本地 workerd 的 AI binding 打真實 Workers AI（ZDR ✓）

使用 `CF_REMOTE_AI=true` 打 Workers AI 時需 `cf auth login`；使用外部 DGX 端點則需要該端點可連線，與 CF 帳號無關。

## 本地資料庫

- Schema 的 SSOT 是 `apps/server/migrations/*.sql`——production 由 CI 套同一批檔案
- `pnpm migrate` = `cf d1 migrations apply <DB_ID> --local --persist-to .cloudflare/state`——`--persist-to` 必須對準 dev server 的 state 目錄（否則會寫到 `~/.config/cloudflare/state`，dev server 看不到）
- `<DB_ID>` 是 `cloudflare.config.ts` 裡 `bindings.d1({ id })` 宣告的固定 UUID，與指令保持一致
- 先前已套過 web-next 舊編號／拆分版 migrations 的**可拋棄本機 DB**，切換本分支後需重建；先停止 dev 並備份需要的資料，再移開 `apps/web/.cloudflare/state/`，重新 `pnpm dev`＋`pnpm seed`。這會重建本機 D1／DO，不是只改 migration ledger
- 全新空 DB 可直接依序套用 `001–008`，不需要額外重建。production 保留 `001–007` 再前向套 `008`，不能照本機重建流程處理；風險見 [`cf.md`](./cf.md#cicd)
- 修改 config 後若看不到原本資料，先確認 persistence 路徑與使用中的 DB，再決定是否重建；不要直接刪除可能仍需保留的資料

## Fixture 與 dev 操作台（#130）

- Fixture 的 SSOT 是 `apps/server/src/seed.ts`：8 個**固定 id、固定名稱、共用密碼 `demo-demo`** 的帳號（1 管理員、2 老師、5 學生；陳老師同時是「高二哲學選修 A」的成員）、3 個系統題、2 間教室（「高二哲學選修 A」3 位成員、「倫理學讀書會」空班級），每間教室各有一個進行中的活動
- `pnpm seed` → `POST /api/dev/seed`（需 `SEED_TOKEN`＋`ENVIRONMENT=dev`）：冪等 upsert（以 id／email／教室名稱找既有 row），重跑不會改 id、不會動既有對話資料；fixture 不含任何 transcript
- `/dev/accounts`：列出 fixture 帳號，每列「以此身分開啟」（`POST /api/dev/login` 發 session，不需密碼）與班級／邀請連結入口。切換會覆蓋目前 session；要同時扮演多個角色請開無痕視窗
- 管理員帳號帶 `is_admin`＋`can_manage_classes`（#131）：目前入口為 `/admin?tab=users`，可建立帳號、停用／復用並管理教師權限；舊 `/admin/users` 頁已移除。授權與 session 語義見 [`accounts.md`](./accounts.md)
- `POST /api/dev/login` 會把 fixture 的 `is_admin` 校正回 spec；`can_manage_classes` 不校正——那可能正是審查中手動提權的結果。要整份重來就是 `pnpm seed`

### `ENVIRONMENT` binding

`/api/dev/*` 只在 `ENVIRONMENT=dev` 時可用，其餘環境回 404（server 的 dev gate）。SPA 的 `/dev/accounts` route 仍會打包，production 顯示不可用提示，不列 fixture 或密碼。`cloudflare.config.ts` 的預設：`pnpm dev` = `dev`、build/deploy = `production`；dev `.env.local` 可覆寫（空值視同未設）。build／dry-run 不是 runtime gate 的驗證，gate 由 `tests/dev.test.ts` 測試。

## 對話功能（LLM）在本地

`.env.local` 為 gitignored dev 設定；build/deploy 的 text bindings 使用 config 預設，runtime secrets 的 CI 通道見 [`cf.md`](./cf.md#secrets)。預設 `LLM_PROVIDER=mock` 走離線 faux 模型；它不免除 session secrets。

| 方式         | 設定與限制                                                                                                                             |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------- |
| 離線 mock    | `LLM_PROVIDER=mock`；無真實 LLM 呼叫                                                                                                   |
| 真實 gateway | `LLM_PROVIDER` 改為非 `mock` 值；DGX leg 需設定可連線的 `DGX_BASE_URL`；Workers AI leg 在本機需 `CF_REMOTE_AI=true` 與 `cf auth login` |

只設 `CF_REMOTE_AI=true` 不會把 mock 對話切成真實 LLM；可用 legs、fallback 與費用依 [`providers.md`](./providers.md)，不要把無可用模型誤認為會自動切回 mock。`pnpm seed` 與 LLM 模式無關。

- **fixture 帳號被改壞** → 重跑 `pnpm seed`：fixture 帳號（含密碼 `demo-demo`）與教室會被 upsert 回固定值，id 不變

## 常見問題

- **`pnpm dev` 要求 Cloudflare 授權** → 有人設了 `CF_REMOTE_AI=true` 或 shell 有殘留 env；unset 即可
- **seed 失敗「找不到 SEED_TOKEN」** → `.env.local` 不存在或沒有 `SEED_TOKEN` 行；**改了 `.env.local` 要重啟 dev**（server 只在啟動時載入）
- **seed「連不上」** → dev server 沒起來（`pnpm dev` 先跑）；或 seed 跑在 dev 前面
- **登入／註冊回 500** → 先確認 `AUTH_SECRET` 非空並重啟；範本與啟動提示的剩餘修復歸 #137，不恢復 dev fallback secret
- **切分支後 duplicate column／migration 衝突、資料不見** → 見上「本地資料庫」；確認備份與 persistence 路徑後才重建可拋棄的本機資料，不套用到 production

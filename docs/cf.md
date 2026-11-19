# Cloudflare CLI（cf）參考

> cf 是 Cloudflare 的新一代 CLI（beta，2026-09 起），取代 wrangler：設定檔為 `cloudflare.config.ts`（TypeScript），指令輸出以 JSON 為主。
> 全端專案（vite root + `cloudflare.config.ts`）在 `apps/web/`——所有 cf 專案指令都在該目錄執行；Worker 原始碼在 `apps/server/`（由 entrypoint 指回）。
> 專案設定核對：2026-11-19，`integration/web-next-142`（PR #155，尚未合併）。分支內容不代表 production 已部署；部署狀態與風險見下方 [CI/CD](#cicd)。

## 目錄

- [安裝與登入](#安裝與登入)
- [常用指令](#常用指令)
- [cloudflare.config.ts（本專案實際使用的鍵）](#cloudflareconfigts)
- [開發（cf dev）](#開發cf-dev)
- [建置與部署](#建置與部署)
- [D1 migrations](#d1-migrations)
- [Secrets](#secrets)
- [workspaces 限制（重要）](#workspaces-限制重要)
- [與 wrangler 的關係](#與-wrangler-的關係)
- [CI/CD](#cicd)
- [疑難排解](#疑難排解)

## 安裝與登入

```bash
npm install -g cf      # 需要 Node ≥ 26.12（devEngines 使 pnpm 指令自動用 Node 26；cf 本身不吃 Bun）
cf auth login          # 瀏覽器授權；與 wrangler login 的憑證互相獨立
cf --version
```

- **Bun 不能載入 `cloudflare.config.ts`**——cf 指令必須以 Node 執行
- CI／無人環境用 `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`（不吃 `cf auth login` 的憑證）

## 常用指令

| 指令                                      | 作用                                                                        |
| ----------------------------------------- | --------------------------------------------------------------------------- |
| `pnpm dev`                                | 本專案執行 Vite＋Cloudflare plugin：SPA HMR + Worker + 本地 D1／DO（:5173） |
| `cf build`                                | 建置一次，產出標準 Build Output（`.cloudflare/output/v0/`）                 |
| `cf deploy --prebuilt`                    | 部署先前建置的產物（配合 build-once 流程）                                  |
| `cf deploy --dry-run`                     | 驗證建置，不上傳、不需要金鑰（fork PR 安全）                                |
| `cf previews deploy`                      | 以分支名部署 Worker Preview（PR 預覽）                                      |
| `cf d1 migrations apply <DB> --dir <DIR>` | 套用 D1 migrations（預設遠端；`--local` 本機）                              |
| `cf d1 execute <DB> --local --file <SQL>` | 本機執行 SQL                                                                |
| `cf cli search "<描述>"`                  | 用自然語言找指令                                                            |

指令太多記不住時：`cf cli search "create a D1 database"`。

## cloudflare.config.ts

`apps/web/cloudflare.config.ts`——TypeScript 設定，取代 `wrangler.jsonc`。本專案使用的鍵：

| 鍵                                 | 本專案值                                                                        |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `worker.entrypoint`                | `../server/src/index.ts`（Worker 原始碼在 apps/server）                         |
| `worker.compatibilityDate / Flags` | `2026-11-01` / `nodejs_compat`                                                  |
| `worker.env.DB`                    | `bindings.d1({ name: "socrates", id: <固定 UUID> })`                            |
| `worker.env.AI`                    | `bindings.ai({})`（dev 設 `CF_REMOTE_AI=true` 時 `dev.remote: true`）           |
| `worker.env.Chat / ReportRunner`   | `bindings.durableObject({ worker, exportName })`                                |
| `worker.exports`                   | `exports.durableObject({ storage: "sqlite" })`——**取代 wrangler 的 migrations** |
| `worker.env.*`（text/secret）      | vars 與 secrets 宣告（dev 用 `loadEnv` 讀 `.env.local` override）               |

注意：

- `cf` 搜尋「目前目錄往根目錄」**最近的** `cloudflare.config.ts`——在 `apps/web/` 下執行就會找到它
- 本專案以 `mode === "development"` 區分 dev；其餘 mode 使用 production 預設，尚未宣告獨立 staging 資源

## 開發（cf dev）

本專案以 `pnpm dev` 啟動 Vite（`@cloudflare/vite-plugin`）+ 本地 workerd：D1／DO 是本地模擬、`AI` binding 可透過 `dev.remote` 打真實 Workers AI。本地 secrets 與 LLM 模式見 [`development.md`](./development.md)。

- 單一 server：`http://localhost:5173`（SPA 與 `/api` 同源，workerd 跑在 vite 內）
- 首次啟動 D1 是空的：`pnpm seed`（走 `POST /api/dev/seed`，需 `SEED_TOKEN` 與 `ENVIRONMENT=dev`）
- `cf dev` 會偵測 `cloudflare.config.ts` 的變更

## 建置與部署

正式部署只走 [Deploy workflow](../.github/workflows/deploy.yml)，不手動 deploy。workflow 在 `apps/web/` 依序執行以下步驟；這是現行 pipeline 的說明，不是可略過部署風險的操作指引：

```bash
pnpm exec cf build
pnpm exec cf d1 migrations apply "$D1_DATABASE_ID" --dir ../server/migrations
pnpm exec cf deploy --prebuilt --mode production --secrets-file .env.production.local
```

- build once，deploy 使用同一份 `.cloudflare/output` 產物；本專案尚未配置獨立 staging
- `--secrets-file`（dotenv 格式）是 secrets 的唯一通道——首次部署**必須**先備妥（見下方 Secrets），否則 `AUTH_SECRET` 未設，登入/對話全部 500；cf 會對值做 `$VAR`/`${VAR}` 環境變數展開，secret 值請避免含 `$`
- dry-run 驗證（免憑證，fork PR 安全）：`cf deploy --prebuilt --mode production --dry-run`
- 前端是同一 Worker 的 Static Assets——不需要另外的靜態部署
- push `main` 會啟動 Deploy workflow；失敗不等於 workflow 已停用，也不會自動撤回先前成功的 D1 migration

## D1 migrations

```bash
# 本機（dev server 的本地 D1；pnpm dev 已自動套）
pnpm migrate     # = cf d1 migrations apply <固定 DB_ID> --local --persist-to .cloudflare/state
# 遠端（production；CI 的 deploy.yml 會做）
cf d1 migrations apply $D1_DATABASE_ID --dir ../server/migrations   # 在 apps/web/ 下執行
```

Schema 的 SSOT 是 `apps/server/migrations/*.sql`（`001_init.sql` 起依序前向套用）；本地與遠端由同一批檔案驅動。production 已部署（2026-11-10 起），schema 變更一律新增前向 migration，不得改寫已套用的檔案。D1 不允許關閉 foreign keys，`DROP TABLE` 父表會觸發 `ON DELETE CASCADE`——重建被參照的表須先備份、由葉節點往上 drop、重建後依序回填（`tests/migrations.test.ts` 驗證資料不流失）。

## Secrets

本專案 secrets（`cloudflare.config.ts` 宣告為 `bindings.secret()`）：

| Secret                 | 用途                                                                                                          | 產生方式                                  |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| `AUTH_SECRET`          | HMAC session cookie 簽章（必填，缺了 fail-fast）                                                              | `openssl rand -base64 32`                 |
| `BYOK_ENC_KEY`         | teacher keys 的 AES-GCM 金鑰（必填，缺了 fail-fast）                                                          | `openssl rand -base64 32`                 |
| `SEED_TOKEN`           | `POST /api/dev/seed` 閘門；production 另由 `ENVIRONMENT` 禁用 dev endpoints，但 config 仍宣告 required secret | 任意亂數                                  |
| `GOOGLE_CLIENT_SECRET` | Google OAuth；目前 production 無條件 required，缺值會阻擋 deploy（#167）                                      | 見 [`google-oauth.md`](./google-oauth.md) |

Runtime secrets 由 CI 的 `PROD_SECRETS_FILE`（dotenv）在 deploy step 傳給 `--secrets-file`；不要放入 `VITE_*` 或已追蹤檔案。Google client ID、callback、dev／production 設定差異與輪替流程的 SSOT 是 [`google-oauth.md`](./google-oauth.md)。**「Google 選用」是 runtime 設計，不代表目前缺少 Google secret 的 production deploy 能成功**；修復歸 [#167](https://github.com/ntnu-swe-2026-team4/socrates-classroom/issues/167)。

平台 LLM 憑證不在 secrets——provider 憑證走 `providers.config.yaml` 宣告的 env 名（`workersAuthContext` 只解析 YAML 裡宣告的名字）；teacher keys 是老師自填、加密落 D1。**注意**：`--secrets-file` 只上傳 secrets，不設 text bindings——`DGX_BASE_URL` 等 text bindings 的 production 值來自 config 本身（預設空＝該腿跳過）。完整規則與新增 provider 腿的步驟見 [`providers.md`](./providers.md) §設定與運維。

## workspaces 限制（重要）

cf（beta）在 **npm/pnpm workspace 子目錄**的依賴解析有限：「Worker package 自己的 `node_modules`」才算數，**hoisted 到 workspace root 不算**。

- 本專案的解法：**pnpm workspaces**——pnpm 的 per-package node_modules（symlink 隔離）讓各 package 自然擁有自己的依賴；worker 打包時 vite 沿著原始碼位置（`apps/server`）解析模組
- 這也是 Cloudflare 官方 monorepo 文件以 pnpm workspaces 為首的原因
- 附帶症狀：cf 會警告「No lock file has been detected in the current working directory」——可忽略（lockfile 在 repo 根）

## 與 wrangler 的關係

- `wrangler.jsonc` / `wrangler.toml` **不再使用**；設定一律寫在 `cloudflare.config.ts`
- wrangler 仍是 devDependency，角色有二：
  1. cf 在「非 Vite 專案」的內建打包後端（本專案已改走 Vite，不經此路）
  2. `npx wrangler tail socrates-classroom`（cf 尚無法看即時 log）

secrets 管理一律走 `cf deploy --secrets-file`（見上方 Secrets）——wrangler 的 `secret put` 是備用通道。

## CI/CD

見 [CI workflow](../.github/workflows/ci.yml)（PR：lint → yamllint → config-drift → typecheck → test → build → dry-run，免憑證）與 [Deploy workflow](../.github/workflows/deploy.yml)（push main：品質閘門 → build once → D1 migrations → deploy）。CI 的 dry-run 不代表 production secrets 已設齊。

### PR #155 的部署狀態與 migration 風險

2026-11-19 核對 [#167](https://github.com/ntnu-swe-2026-team4/socrates-classroom/issues/167) 的部署紀錄：production Worker 停在 #143，D1 已套用 `007_user_identities`；後續 deploy 在 required Google secret 檢查失敗。這是該 issue 記錄的狀態，不是本文件更新時重新查驗遠端資源的結果。

本分支保留 production 的 `001–007`，尚未部署的 web-next schema 合併為 `008_web_next.sql`。**008 在 migration step 即套用，不會等 Worker deploy 成功**，而且會刪除 `users.role` 與搬移後的 `teacher_keys`。舊 Worker 仍使用這些 schema，若 migration 成功、deploy 失敗，可能留下不相容的 DB／Worker 配對。

因此「CD 失敗中」不能當作安全的部署閘門。#167 同時追蹤 secrets／client ID 接線、解凍前檢查與上述相容性風險；本文件不宣稱已解凍或可安全套用 008。本機資料重建條件見 [`development.md`](./development.md#本地資料庫)。

## 疑難排解

| 症狀                                                   | 原因／解法                                                  |
| ------------------------------------------------------ | ----------------------------------------------------------- |
| `cloudflare.config.ts loading is not supported on Bun` | 用 Node ≥ 26.12 執行 cf（`npx cf`、不要 `bun cf`）          |
| `wrangler is declared … but is not installed`          | 專案依賴沒裝：`pnpm install`（在 repo 根）                  |
| `No lock file has been detected …`                     | workspace 提醒，可忽略（lockfile 在 repo 根）               |
| `More than one account available …`                    | 設 `CLOUDFLARE_ACCOUNT_ID` 或 config 的 `accountId`         |
| 部署後 AI 沒回應                                       | secrets 未上（`wrangler secret list` 檢查）或 pool 全段 429 |

## 來源

- cf CLI（beta 公告、指令總覽）：https://blog.cloudflare.com/cloudflare-cf-cli-launch/ 、https://developers.cloudflare.com/cf/
- cf 在 CI：https://developers.cloudflare.com/cf/ci/
- `cloudflare.config.ts` 參考：https://developers.cloudflare.com/cf/projects/cloudflare-config/
- cf for Wrangler users（遷移對照）：https://developers.cloudflare.com/cf/wrangler/

## 上線前檢查（新環境）

- [ ] GitHub repo secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`D1_DATABASE_ID`、`PROD_SECRETS_FILE`；後者須涵蓋 config 實際宣告的 required secrets（見 [Secrets](#secrets)），不能沿用只有三項的舊清單
- [ ] 先處理 #167 的設定與 migration 相容性風險；現行 workflow 到 deploy step 才檢查 `PROD_SECRETS_FILE`，缺值仍可能已改動 DB
- [ ] Google 的 client ID 與 secret 必須分別接到 build config／deploy，設定與驗收見 [`google-oauth.md`](./google-oauth.md#3-正式環境)
- [ ] 網域：config 綁定 `socrates.g36maid.dev`；若部署到不同的 Cloudflare 帳號，需擁有該網域或另議

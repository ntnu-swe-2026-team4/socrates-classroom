# Cloudflare CLI（cf）參考

> cf 是 Cloudflare 的新一代 CLI（beta，2026-09 起），取代 wrangler：設定檔為 `cloudflare.config.ts`（TypeScript），指令輸出以 JSON 為主。
> 全端專案（vite root + `cloudflare.config.ts`）在 `apps/web/`——所有 cf 專案指令都在該目錄執行；Worker 原始碼在 `apps/server/`（由 entrypoint 指回）。

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

| 指令                                      | 作用                                                        |
| ----------------------------------------- | ----------------------------------------------------------- |
| `cf dev` ＝ `pnpm dev`                    | 單一全端 dev server：SPA HMR + Worker + 本地 D1/R2（:5173） |
| `cf build`                                | 建置一次，產出標準 Build Output（`.cloudflare/output/v0/`） |
| `cf deploy --prebuilt`                    | 部署先前建置的產物（配合 build-once 流程）                  |
| `cf deploy --dry-run`                     | 驗證建置，不上傳、不需要金鑰（fork PR 安全）                |
| `cf previews deploy`                      | 以分支名部署 Worker Preview（PR 預覽）                      |
| `cf d1 migrations apply <DB> --dir <DIR>` | 套用 D1 migrations（預設遠端；`--local` 本機）              |
| `cf d1 execute <DB> --local --file <SQL>` | 本機執行 SQL                                                |
| `cf cli search "<描述>"`                  | 用自然語言找指令                                            |

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
- 檔案內容可用 imports／函式／`switch (ctx.mode)` 做環境差異（staging/production）

## 開發（cf dev）

`cf dev` = Vite（`@cloudflare/vite-plugin`）+ 本地 workerd：D1/R2 是本地模擬、`AI` binding 以 `dev.remote` 打真實 Workers AI。

- 單一 server：`http://localhost:5173`（SPA 與 `/api` 同源，workerd 跑在 vite 內）
- 首次啟動 D1 是空的：`pnpm seed`（走 `POST /api/dev/seed`，需 `SEED_TOKEN`）
- `cf dev` 會偵測 `cloudflare.config.ts` 的變更

## 建置與部署

官方「建置一次、部署同一產物」流程（也是本專案 CI 的做法）。指令一律在 `apps/web/` 下執行（`pnpm deploy` ＝ `pnpm --filter @socrates/web deploy` 等價）：

```bash
cf auth login                                  # 一次性（CI 用 API token，見下）
cf build                                       # 產出 .cloudflare/output（client assets + worker bundle）
cf d1 migrations apply $D1_DATABASE_ID --dir ../server/migrations   # 遠端 D1（未套過才需要）
cf deploy --prebuilt --mode production --secrets-file .env.production.local
```

- `--mode` 配 `cloudflare.config.ts` 的 `switch (ctx.mode)`：staging／production 各自的資源
- `--secrets-file`（dotenv 格式）是 secrets 的唯一通道——首次部署**必須**先備妥（見下方 Secrets），否則 `AUTH_SECRET` 未設，登入/對話全部 500；cf 會對值做 `$VAR`/`${VAR}` 環境變數展開，secret 值請避免含 `$`
- dry-run 驗證（免憑證，fork PR 安全）：`cf deploy --prebuilt --mode production --dry-run`
- 前端是同一 Worker 的 Static Assets——不需要另外的靜態部署
- 團隊日常部署走 CI（push main）；手動 deploy 僅用於緊急修補——先確認本地 HEAD 與 main 一致

## D1 migrations

```bash
# 本機（dev server 的本地 D1；pnpm dev 已自動套）
pnpm migrate     # = cf d1 migrations apply <固定 DB_ID> --local --persist-to .cloudflare/state
# 遠端（production；CI 的 deploy.yml 會做）
cf d1 migrations apply $D1_DATABASE_ID --dir ../server/migrations   # 在 apps/web/ 下執行
```

Schema 的 SSOT 是 `apps/server/migrations/*.sql`（`001_init.sql` 起依序編號）；本地與遠端由同一批檔案驅動。

## Secrets

本專案 secrets（`cloudflare.config.ts` 宣告為 `bindings.secret()`）：

| Secret         | 用途                                                 | 產生方式                  |
| -------------- | ---------------------------------------------------- | ------------------------- |
| `AUTH_SECRET`  | HMAC session cookie 簽章（必填，缺了 fail-fast）     | `openssl rand -base64 32` |
| `BYOK_ENC_KEY` | teacher keys 的 AES-GCM 金鑰（必填，缺了 fail-fast） | `openssl rand -base64 32` |
| `SEED_TOKEN`   | `POST /api/dev/seed` 閘門（production 留空即可禁用） | 任意亂數                  |

OAuth 第三方登入的 bindings **目前未宣告**在 `cloudflare.config.ts`（雲端設定維持原版），因此三家登入皆停用；啟用方式見下方 [OAuth 登入](#oauth-登入googlefacebookapple選用)。

```bash
# 一次上傳（dotenv 格式；.env.production.local 不會進 dev/git）
cf deploy --prebuilt --mode production --secrets-file .env.production.local
```

### OAuth 登入（Google／Facebook／Apple，選用）

> **目前狀態：未啟用。** server 端（`routes/oauth.ts`）已實作，但 `apps/web/cloudflare.config.ts` 尚未宣告下表的 bindings。要啟用某一家，需在 `worker.env` 加入該家的 public id（`bindings.text`）與 secret（`bindings.secret()`——注意 secret 宣告後即為 required，dev 未提供會啟動失敗），並在 CI build 環境提供 public id、在 `PROD_SECRETS_FILE` 加入 secret。

三家皆為選用：某家的值**全部**設齊才會在 `GET /api/auth/providers` 回 `true`、登入頁按鈕才可按；未設則 `/api/auth/oauth/<provider>/start` 直接 302 回 `/login?error=oauth_unavailable`。

| 名稱                   | 類型         | 用途／取得方式                                                                                                                                                                         |
| ---------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GOOGLE_CLIENT_ID`     | text binding | Google Cloud Console → APIs & Services → Credentials → Create OAuth client ID（type：Web application）；OAuth consent screen 需含 scope `openid`、`email`、`profile`                   |
| `GOOGLE_CLIENT_SECRET` | secret       | 同上 OAuth client 的 client secret                                                                                                                                                     |
| `FACEBOOK_APP_ID`      | text binding | Meta for Developers → 建立 App（use case：Facebook Login）→ App settings → Basic 的 App ID；permissions 需 `email`、`public_profile`                                                   |
| `FACEBOOK_APP_SECRET`  | secret       | 同頁的 App Secret                                                                                                                                                                      |
| `APPLE_CLIENT_ID`      | text binding | Apple Developer → Certificates, Identifiers & Profiles → Identifiers → **Services ID**（例 `dev.g36maid.socrates.web`），勾選 Sign in with Apple 並設定 domain 與 Return URL           |
| `APPLE_TEAM_ID`        | text binding | Apple Developer 帳號 Membership 頁的 Team ID（10 碼）                                                                                                                                  |
| `APPLE_KEY_ID`         | text binding | Keys → 建立啟用 Sign in with Apple 的 key 後顯示的 Key ID（10 碼）                                                                                                                     |
| `APPLE_PRIVATE_KEY`    | secret       | 上述 key 下載的 `.p8` 全文（PKCS8 PEM；只能下載一次）。Worker 以 WebCrypto ECDSA P-256 現場簽 ES256 JWT 當 client_secret（效期 300 秒），不需事先產生；dotenv 內可用字面 `\n` 取代換行 |

各家須登記的 callback（redirect URI）——值為 `${PUBLIC_BASE_URL}/api/auth/oauth/<provider>/callback`（`PUBLIC_BASE_URL` 空則用 request origin），必須逐字相符：

| Provider | Production callback                                             | 登記位置                                                                |
| -------- | --------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Google   | `https://socrates.g36maid.dev/api/auth/oauth/google/callback`   | OAuth client 的 Authorized redirect URIs                                |
| Facebook | `https://socrates.g36maid.dev/api/auth/oauth/facebook/callback` | Facebook Login → Settings → Valid OAuth Redirect URIs                   |
| Apple    | `https://socrates.g36maid.dev/api/auth/oauth/apple/callback`    | Services ID → Configure → Domains `socrates.g36maid.dev` 與 Return URLs |

注意事項：

- **public id 是 text binding、不是 secret**：dev 讀 `.env`／`.env.local`；production 由 `cf build --mode production` 當下的 process environment 帶入（`--secrets-file` 不設 text bindings，見下段）——CI 需在 build 步驟提供這五個變數（GitHub Actions repo variables 即可，非機密）。
- **secret 只在對應 public id 非空時才宣告**（`bindings.secret()` 是 required secret，缺值時 dev 啟動報 `Missing required secrets`、deploy 亦會缺值）：設了 `GOOGLE_CLIENT_ID` 就必須在 `.env.local` 或 `--secrets-file` 裡一併提供 `GOOGLE_CLIENT_SECRET`，Facebook／Apple 同理。
- **本機測試**：`.env` 的 `PUBLIC_BASE_URL` 留空（用 request origin），並在 Google／Facebook 額外登記 `http://localhost:5173/api/auth/oauth/<provider>/callback`；Apple 不接受 `localhost` 與非 HTTPS 的 Return URL，需透過 HTTPS tunnel 測。
- **Apple 用 `response_mode=form_post`**：callback 是 Apple 網域發起的 cross-site POST，因此 state cookie `socrates_oauth` 為 `SameSite=None; Secure; HttpOnly`（`Path=/api/auth/oauth`、10 分鐘、HMAC 以 `AUTH_SECRET` 簽章）；`SameSite=Lax` 的 session cookie 在這個 POST 上不會送出，所以 guest 的 in-place upgrade 所需的 guest id 在 start 時就記進 state cookie。
- **Apple `id_token` 不驗簽**：token 是 Worker 以 client_secret 透過 TLS 直接向 `https://appleid.apple.com/auth/token` 換得（非經瀏覽器轉交），來源已由 TLS 保證，故只檢查 `iss`／`aud`，不抓 Apple JWKS 驗簽。Google 與 Facebook 同理以 access token 向 userinfo／Graph API 取 profile。
- Facebook Graph API 版本固定於 `apps/server/src/routes/oauth.ts` 的 `FACEBOOK_VERSION`（目前 `v24.0`）；Meta 約兩年淘汰一版，到期前需更新。

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

見 [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)（PR：lint → yamllint → config-drift → typecheck → test → build → dry-run，免憑證）與 [`deploy.yml`](../.github/workflows/deploy.yml)（push main：全閘門 → build once → D1 migrations → deploy；只有 migrations/deploy 兩步拿 `CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID`/`D1_DATABASE_ID`）。Secrets 注入走 deploy 指令的 `--secrets-file`——CI 端即上表三個 secrets，由 repo secrets 或環境管理。

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

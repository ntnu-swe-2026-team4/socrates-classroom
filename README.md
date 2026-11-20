# 詰問 · 蘇格拉底對話教室

以蘇格拉底式詰問為核心的課堂平台：學生與 AI 蘇格拉底一對一對話，老師開課堂、發議題、看逐人與全班報告，立場星圖視覺化。

**執行在 Cloudflare Workers 上**：一個 Worker（Hono API + React 靜態資產）、D1（SQLite）、Durable Object（**Pi Durable** 對話引擎）。對話模型走 gateway（`providers.config.yaml` 定義的 provider 鏈：自架 DGX 端點（GLM-5.3-Flash）→ Workers AI 託管 GLM，全 ZDR；老師 key 可插自有 provider；詳見 [`docs/providers.md`](docs/providers.md)）。

## Quickstart

需要 **Node.js 26**（devEngines 由 pnpm 自動下載對應 runtime；shell 互動用 [fnm](https://github.com/Schniz/fnm) 等 version manager）與 **pnpm ≥ 12**（`corepack enable` 或 `npm i -g pnpm`）。

```bash
pnpm install
pnpm dev                                      # 自動套 D1 migrations → http://localhost:5173
```

`.env.local` 除兩個 secret 外皆 optional——沒有任何設定檔也能起 UI 與 landing（預設 `LLM_PROVIDER=mock`，離線 faux 模型）。要**登入**（`/login`、`/dev/accounts`、`/admin`）則必須有 `AUTH_SECRET`，缺了的話每個發 session 的端點都回 500 `internal_error`：

```bash
cp apps/web/.env.example apps/web/.env.local
openssl rand -base64 32     # 貼進 .env.local 的 AUTH_SECRET=
```

| Secret         | dev 缺值的後果                                             | 何時必填          |
| -------------- | ---------------------------------------------------------- | ----------------- |
| `AUTH_SECRET`  | 登入、註冊、任何發 session 的路徑全部 500 `internal_error` | 要登入就必填      |
| `BYOK_ENC_KEY` | 只有 `/settings/keys*` 相關端點 500                        | 要測 teacher keys |

其餘 text bindings 與 override（`ENVIRONMENT`、`LLM_PROVIDER`、`SEED_TOKEN`…）見 `.env.example` 註解。改完 `.env.local` 要重啟 dev（server 啟動時載入一次）；缺 secret 時 `pnpm dev` 啟動會直接印出警告。

另開一個終端機灌示範資料：

```bash
pnpm seed                                     # 需要 dev server 運行中；SEED_TOKEN 自動讀 .env.local
```

示範資料（fixture）：8 個固定帳號（共用密碼 `demo-demo`，id 固定所以重跑 seed 不會變）＋ 2 間教室（高二哲學選修 A 含 3 位成員、倫理學讀書會空班）。`pnpm seed` 後開 `/dev/accounts` 就能一鍵切換身分（免密碼）；該頁與 `/api/dev/*` 只在 `ENVIRONMENT=dev` 時存在。對話功能的 LLM 設定三選一見 [`docs/development.md`](docs/development.md)。

選配——git pre-commit hooks（需先安裝 [prek](https://github.com/j178/prek)：`pipx install prek` 或 `uv tool install prek`）：

```bash
prek install
```

## 部署

```bash
cd apps/web
cf auth login
cf build                            # 一次建置 client + worker（.cloudflare/output）
cf d1 migrations apply $D1_DATABASE_ID --dir ../server/migrations
cf deploy --prebuilt                # 用同一份建置產物部署
```

CI/CD：GitHub Actions（[`.github/workflows/ci.yml`](.github/workflows/ci.yml) PR 檢查 + dry-run、[`deploy.yml`](.github/workflows/deploy.yml) push main 自動部署）。Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`D1_DATABASE_ID`；runtime secrets（`AUTH_SECRET`、`BYOK_ENC_KEY`、`SEED_TOKEN`——詳見 [`docs/cf.md`](docs/cf.md) §Secrets）走 `cf deploy --secrets-file`。

## 開發

| 指令（專案根目錄） | 作用                                                              |
| ------------------ | ----------------------------------------------------------------- |
| `pnpm dev`         | 單一全端 dev server（SPA HMR + Worker + 本地 D1，:5173）          |
| `pnpm test`        | vitest（server：真 workerd + D1 + DO；web：jsdom；mock provider） |
| `pnpm typecheck`   | server 與 web 的 TypeScript 檢查                                  |
| `pnpm lint`        | Biome 檢查（`pnpm format` 自動修）                                |
| `pnpm migrate`     | 本地 D1 migrations                                                |
| `pnpm seed`        | 灌示範資料（需 dev server 運行中）                                |
| `pnpm deploy`      | 部署到 Cloudflare（apps/web）                                     |

## 結構

```
apps/
├── web/        # React + Vite 前端（TanStack file routes；打包後掛在 Worker 的 Static Assets）
└── server/     # Hono Worker：API + Chat/ReportRunner Durable Objects + gateway
    ├── src/do/         # Chat（PiHarness 宿主）、ReportRunner（alarm 驅動報告）
    ├── src/gateway/    # provider gateway：YAML 設定、ledger cooldown、鏈走訪
    ├── src/pi/         # extensions（socrates/avatar/judgment/websearch）＋agent profiles
    ├── src/db/         # D1 adapter（$named → 位置參數自動轉換）
    └── migrations/     # D1 migrations（pnpm dev 自動套；cf d1 migrations apply 用於 production）
packages/
└── shared/     # 前後端共用契約 schema（zod，單一真相）
```

- **對話引擎**：`PiHarness`（Agents SDK）跑在 Durable Object——transcript、重試、崩潰恢復由 pi 管理；對話走 WebSocket（view＋chord ops），契約與 [`docs/api-contract.md`](docs/api-contract.md) §5 一致。
- **LLM 設定層**：提示詞在 `apps/server/src/prompts/`，模型路由在 `apps/server/providers.config.yaml`（build-time 編譯）；規則與查證詳見 [`docs/providers.md`](docs/providers.md)。
- 沒有金鑰也能開發：`LLM_PROVIDER=mock`（測試預設）用離線 faux 模型。

## 文件（每份 = 一個領域的 SSOT）

- [`docs/feature.md`](docs/feature.md) — 功能總覽：功能 ↔ 路由 ↔ 頁面
- [`docs/api-contract.md`](docs/api-contract.md) — API 契約：請求/回覆格式
- [`docs/architecture.md`](docs/architecture.md) — 架構：系統設計與決策
- [`docs/providers.md`](docs/providers.md) — LLM providers：端點、用量、併發、ZDR
- [`docs/cf.md`](docs/cf.md) — Cloudflare CLI 使用
- [`docs/pi.md`](docs/pi.md) — Pi Durable（PiHarness）使用
- 維護文件的規則見 [`docs/AGENTS.md`](docs/AGENTS.md)
- 貢獻流程（issue 慣例、issue-first、PR 規範與文件同步）見 [CONTRIBUTING.md](CONTRIBUTING.md)

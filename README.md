# 詰問 · 蘇格拉底對話教室

以蘇格拉底式詰問為核心的課堂平台：學生與 AI 蘇格拉底一對一對話，老師開課堂、發議題、看逐人與全班報告，立場分佈視覺化。

> 本文件描述 `integration/web-next-142`（PR #155）的分支現況，核對日期 2026-11-19；不代表 production 已部署。現存功能與限制見 [`docs/feature.md`](docs/feature.md)，部署狀態見 [`docs/cf.md`](docs/cf.md#cicd)。

**執行在 Cloudflare Workers 上**：一個 Worker（Hono API + React 靜態資產）、D1（SQLite）、Durable Object（**Pi Durable** 對話引擎）。對話模型走 gateway（`providers.config.yaml` 定義的 provider 鏈：自架 DGX 端點（GLM-5.3-Flash）→ Workers AI 託管 GLM，全 ZDR；老師 key 可插自有 provider；詳見 [`docs/providers.md`](docs/providers.md)）。

## Quickstart

需要 **Node.js 26**（devEngines 由 pnpm 自動下載對應 runtime；shell 互動用 [fnm](https://github.com/Schniz/fnm) 等 version manager）與 **pnpm ≥ 12**（`corepack enable` 或 `npm i -g pnpm`）。

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local
openssl rand -base64 32
openssl rand -base64 32
```

僅在尚無 `.env.local` 時複製，勿覆蓋自己的設定。將兩次產生的值分別填入該檔的 `AUTH_SECRET` 與 `BYOK_ENC_KEY`，保留本機 `SEED_TOKEN`。這是 server runtime 設定，檔案已 gitignore；不要放進 `VITE_*` 或 commit。

**能載入 UI 不等於能登入**：`AUTH_SECRET` 缺值時 session 簽發會失敗，BYOK 加密另需 `BYOK_ENC_KEY`；範本中的「All optional」尚未修正，啟動警告等剩餘工作由 [#137](https://github.com/ntnu-swe-2026-team4/socrates-classroom/issues/137) 追蹤。預設 `LLM_PROVIDER=mock` 只免除真實 LLM 設定，不免除帳號 secrets。

```bash
pnpm dev
```

啟動會自動套本機 D1 migrations，開啟 `http://localhost:5173`；修改 `.env.local` 後需重啟。已跑過舊版 web-next migrations 的本機資料，先看 [`development.md` 的重建條件](docs/development.md#本地資料庫)。

另開一個終端機灌示範資料：

```bash
pnpm seed                                     # 需要 dev server 運行中；SEED_TOKEN 自動讀 .env.local
```

`pnpm seed` 後開 `/dev/accounts` 可用固定 fixture 一鍵切換身分（免密碼）；fixture 清單、dev gate 與 LLM 設定見 [`docs/development.md`](docs/development.md)。production 的 `/api/dev/*` 回 404；SPA 的 `/dev/accounts` route 仍存在，只顯示不可用提示，不提供帳號資料。

選配——git pre-commit hooks（需先安裝 [prek](https://github.com/j178/prek)：`pipx install prek` 或 `uv tool install prek`）：

```bash
prek install
```

## 部署

正式部署只走 GitHub Actions，不手動 deploy：[CI workflow](.github/workflows/ci.yml) 執行 PR 檢查＋dry-run，[Deploy workflow](.github/workflows/deploy.yml) 在 push main 後依序 build、D1 migrations、deploy。

**合併不等於部署成功，deploy 失敗也不會撤回已套用的 migration。** PR #155 的部署限制、required secrets 與 008 相容性風險見 [`docs/cf.md` §CI/CD](docs/cf.md#cicd)；Google 接線由 #167 追蹤。

## 開發

| 指令（專案根目錄） | 作用                                                              |
| ------------------ | ----------------------------------------------------------------- |
| `pnpm dev`         | 單一全端 dev server（SPA HMR + Worker + 本地 D1，:5173）          |
| `pnpm test`        | vitest（server：真 workerd + D1 + DO；web：jsdom；mock provider） |
| `pnpm typecheck`   | server 與 web 的 TypeScript 檢查                                  |
| `pnpm lint`        | Biome 檢查（`pnpm format` 自動修）                                |
| `pnpm migrate`     | 本地 D1 migrations                                                |
| `pnpm seed`        | 灌示範資料（需 dev server 運行中）                                |
| `pnpm deploy`      | package 提供的 cf deploy wrapper；正式部署仍只走 CI，不手動執行   |

## 結構

| 路徑                      | 職責                                        |
| ------------------------- | ------------------------------------------- |
| `apps/web`                | React SPA、Vite、Worker build/deploy config |
| `apps/server/src/do`      | Chat／ReportRunner Durable Objects          |
| `apps/server/src/pi`      | 模型接線、extensions、agent profiles        |
| `apps/server/src/gateway` | provider policy、ledger、chain walk         |
| `apps/server/src/db`      | D1 adapter                                  |
| `apps/server/migrations`  | 本機與 production 使用的 schema migrations  |
| `packages/shared`         | 前後端共用 zod schema 與型別                |

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

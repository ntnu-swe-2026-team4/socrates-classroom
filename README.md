# 詰問 · 蘇格拉底對話教室

以蘇格拉底式詰問為核心的課堂辯論平台：與 AI 蘇格拉底單人對話、四階段課堂辯論（調查 → 提純 → 比賽 → 結果）、**多人討論**（老師出一題，同學各自跟 AI 對話，老師看全班討論成果）、立場星圖視覺化。

**執行在 Cloudflare Workers 上**：一個 Worker（Hono API + React 靜態資產）、D1（SQLite）、R2（上傳檔案）、Durable Object（**Pi Durable** 對話引擎）。對話模型走可切換的 provider pool（自架 GPU 端點 → OpenCode Go → OpenRouter → Workers AI，全 ZDR；詳見 [`docs/providers.md`](docs/providers.md)）。

## Quickstart

需要 **Node.js ≥ 26.12**（2026-10 安全版；cf CLI 不支援 Bun）。

```bash
npm install

# 本機開發（Worker + 本地 D1/R2；AI binding 遠端打真實模型）
npx cf dev                          # apps/web；單一全栈 dev server :5173


```

第一次啟動：D1 是空的，灌示範資料（教室：高二哲學選修 A、倫理學讀書會）：

```bash
cd apps/server
SEED_TOKEN=dev-token npm run seed    # 需在 .dev.vars 設 SEED_TOKEN=dev-token
```

示範帳號：老師 `林老師`、學生 `訪客`（示範登入：選身分 + 輸入姓名即可）。

## 部署

```bash
npm install -g cf        # 或使用專案 devDependency 的 npx cf
cf auth login

cd apps/server
cf deploy                # Worker + assets + D1 + R2 + DO
npx cf d1 migrations apply socrates --dir migrations   # 首次／schema 變更時
```

CI/CD：GitHub Actions（[`.github/workflows/ci.yml`](.github/workflows/ci.yml) PR 檢查 + dry-run、[`deploy.yml`](.github/workflows/deploy.yml) main 自動部署）。Secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`；runtime keys（`OPENCODE_API_KEY`、`OPENROUTER_API_KEY`、`BYOK_ENC_KEY`）用 `cf deploy --secrets-file` 或 `wrangler secret put`。

## 開發

| 指令（專案根目錄）  | 作用                                                          |
| ------------------- | ------------------------------------------------------------- |
| `npm run dev:web`   | 單一全栈 dev server（SPA HMR + Worker + 本地 D1/R2，:5173）   |
| `npm test`          | vitest（Worker runtime：路由 + D1 + 對話 SSE，mock provider） |
| `npm run typecheck` | server 與 web 的 TypeScript 檢查                              |
| `npm run build`     | 前端打包（`apps/web/dist`）                                   |
| `npm run migrate`   | 本地 D1 migrations                                            |
| `npm run cf:deploy` | 部署到 Cloudflare                                             |

## 結構

```
apps/
├── web/        # React + Vite 前端（打包後掛在 Worker 的 Static Assets）
└── server/     # Hono Worker：API + PiAgent Durable Object + provider pool
    ├── src/do/         # PiAgent（PiHarness）、ActivityEvents（活動事件扇出）
    ├── src/providers/  # provider pool、ZDR 白名單、學生 BYOK
    ├── src/db/         # D1 adapter（$named → 位置參數自動轉換）
    └── migrations/     # D1 migrations（cf d1 migrations apply）
packages/
├── shared/     # 前後端共用契約型別
└── llm/        # 提示詞與 provider 設定（LLM 組改檔即部署生效）
```

- **對話引擎**：`PiHarness`（Agents SDK）跑在 Durable Object——transcript、排隊、重試、崩潰恢復由 pi 管理；前端對話 API 契約（SSE：`delta/emotion/done/error`）與 [`docs/api-contract.md`](docs/api-contract.md) 一致。
- **LLM 設定層**：提示詞在 `packages/llm/prompts/`，模型路由在 `apps/server/src/providers/`；規則與查證詳見 [`docs/providers.md`](docs/providers.md)。
- 沒有金鑰也能開發：`LLM_PROVIDER=mock`（測試預設）用離線 faux 模型。

## 文件（每份 = 一個領域的 SSOT）

- [`docs/feature.md`](docs/feature.md) — 功能總覽：功能 ↔ 路由 ↔ 頁面
- [`docs/api-contract.md`](docs/api-contract.md) — API 契約：請求/回覆格式
- [`docs/architecture.md`](docs/architecture.md) — 架構：系統設計與決策
- [`docs/providers.md`](docs/providers.md) — LLM providers：端點、用量、併發、ZDR
- [`docs/cf.md`](docs/cf.md) — Cloudflare CLI 使用
- [`docs/pi.md`](docs/pi.md) — Pi Durable（PiHarness）使用
- 維護文件的規則見 [`docs/AGENTS.md`](docs/AGENTS.md)

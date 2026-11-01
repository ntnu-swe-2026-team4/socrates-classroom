# 詰問 · 蘇格拉底對話教室

以蘇格拉底式詰問為核心的課堂辯論平台：與 AI 蘇格拉底單人對話、四階段課堂辯論（調查 → 提純 → 比賽 → 結果）、**多人討論**（老師出一題，同學各自跟 AI 對話，老師看全班討論成果）、立場星圖視覺化。

前端是 React + Vite，後端是 **Bun + Hono + SQLite**（`bun:sqlite`，不需要 Docker 或外部資料庫）。

> 前端組另外提供選用的 **Dockerfile**（見 [`./frontend/container.md`](./frontend/container.md)），僅用來把前端打包成靜態網站的容器；後端不需要任何容器或外部資料庫。

## Quickstart

需要 **Bun** 1.2 以上（<https://bun.sh>）。前端與後端（`server/`）都用 Bun。

```bash
bun install
bun run dev:server   # 後端 → http://localhost:8000（第一次啟動自動建立 SQLite + 示範資料）
bun run dev          # 前端 → http://localhost:5173
```

前端預設是 `VITE_API_MODE=mock`（內建示範資料，不需要後端）。要接真後端，把 `frontend/.env` 設成：

```bash
VITE_API_MODE=http
```

Vite 開發伺服器會把 `/api` 代理到 `http://localhost:8000`，不需要處理 CORS。

沒有 GLM key 時，在 `server/.env` 設 `LLM_PROVIDER=mock`，對話會用規則式回覆，其餘功能（教室、辯論、討論、計分）都可以完整操作。
要接真的 AI（GLM），把 `GLM_API_KEY` 放進 `server/.env`（絕對不要放前端）。

| 指令（在專案根目錄） | 作用 |
|---|---|
| `bun run dev` | 前端開發伺服器 |
| `bun run dev:server` | 後端開發伺服器（Bun + Hono，:8000） |
| `bun run build` | 前端型別檢查 + 打包（`frontend/dist/`） |
| `bun run typecheck` | 前端與後端 TypeScript 型別檢查 |
| `bun run test` | 後端 API 測試（`server/tests`） |
| `bun run migrate` | 套用 SQLite migrations |
| `bun run seed` | 建立示範資料（資料庫已有使用者時會跳過） |

## 資料庫

使用 **SQLite**，預設檔案 `server/data/socrates.db`（gitignored），上傳檔案在 `server/data/uploads/`。
不需要 Docker 或外部資料庫服務；第一次啟動會自動跑 migration 並建立示範教室。

備份：停止服務後複製 `server/data/socrates.db`（WAL 模式也可能有 `-wal` / `-shm` 檔）。

## 示範帳號

登入目前是契約指定的示範版（選學生／老師 + 姓名）：

- 老師：`林老師`（高二哲學選修 A、倫理學讀書會）
- 學生：`訪客`（已加入高二哲學選修 A）
- 學生邀請碼：`LOGIC3`（可直接加入）、`ETHIC5`（需老師審核）

## 文件

- [`docs/frontend.md`](docs/frontend.md) — 前端導覽：檔案位置、功能 ↔ API 對照、詳細啟動教學
- [`docs/api-contract.md`](docs/api-contract.md) — 前後端 API 契約
- [`server/README.md`](server/README.md) — 後端架構、環境變數、目錄、測試與設計重點
- [`llm/README.md`](llm/README.md) — 提示詞與 LLM 供應商設定

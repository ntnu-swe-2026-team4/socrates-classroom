# 詰問 · 蘇格拉底對話教室

以蘇格拉底式詰問為核心的課堂辯論平台：與 AI 蘇格拉底單人對話、四階段課堂辯論（調查 → 提純 → 比賽 → 結果）、**多人討論**（老師出一題，同學各自跟 AI 對話，老師看全班討論成果）、立場星圖視覺化。

> 前端組另外提供選用的 **Dockerfile**（見 [`./frontend/container.md`](./frontend/container.md)），僅用來把前端打包成靜態網站的容器；後端不需要任何容器或外部資料庫。

## Quickstart

需要 **Bun** 1.2 以上（<https://bun.sh>）。前端與後端（`server/`，Bun + Hono）都用 Bun。

```bash
bun install
bun run dev     # → http://localhost:5173（mock 模式，不需後端）
```

| 指令（在專案根目錄） | 作用 |
|---|---|
| `bun run dev` | 前端開發伺服器 |
| `bun run build` | 型別檢查 + 打包（`frontend/dist/`） |
| `bun run typecheck` | TypeScript 型別檢查 |

後端資料庫（後端 scaffold #23 完成後需要）：`docker compose up -d`（Postgres 17）。

## 文件

- [`docs/frontend.md`](docs/frontend.md) — 前端導覽：檔案位置、功能 ↔ API 對照、詳細啟動教學
- [`docs/api-contract.md`](docs/api-contract.md) — 前後端 API 契約

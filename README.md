# 詰問 · 蘇格拉底對話教室

以蘇格拉底式詰問為核心的課堂辯論平台：與 AI 蘇格拉底單人對話、四階段課堂辯論（調查 → 提純 → 比賽 → 結果）、立場星圖視覺化。

## Quickstart

需要：**Bun** 1.2 以上（[安裝](https://bun.sh)）

```bash
bun install    # 安裝依賴（workspace 全部）
bun run dev    # 前端開發伺服器 → http://localhost:5173（mock 模式，不需後端）
```

| 指令 | 作用 |
|---|---|
| `bun run dev` | 前端開發伺服器 |
| `bun run build` | 型別檢查 + 打包（`frontend/dist/`） |
| `bun run typecheck` | TypeScript 型別檢查 |

後端資料庫（後端 scaffold #23 完成後需要）：`docker compose up -d`（Postgres 17）。

## 文件

- [`docs/frontend.md`](docs/frontend.md) — 前端導覽：檔案位置、功能 ↔ API 對照、詳細啟動教學
- [`docs/api-contract.md`](docs/api-contract.md) — 前後端 API 契約

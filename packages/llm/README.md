# llm/ — LLM 設定層（zero-code by design）

所有權：`@ntnu-swe-2026-team4/llm`

本目錄不放置應用程式碼。後端（`server/`，Bun + Hono）直接呼叫 GLM（智譜 Z.ai）的 OpenAI 相容 API
（ADR-0001），提示詞與模型清單由這個目錄提供；LLM 組改檔案即可調整行為，不用改後端程式碼。

| 路徑                    | 內容                                                             | 議題 |
| ----------------------- | ---------------------------------------------------------------- | ---- |
| `prompts/`              | 對話引擎提示詞契約（階段 1 蘇格拉底六原則、情緒標記、收尾協議）  | #27  |
| `providers/models.json` | GLM 的 baseUrl、預設模型與可選模型；`mock` 為離線開發用 provider | #26  |

> 全部可用 provider（自架 DGX Spark、OpenCode Go、Coding Plan、Workers AI、OpenRouter、BYOK）的端點、用量、併發與 ZDR 查證，詳見 [`docs/providers.md`](../docs/providers.md)。

## 後端如何使用（Cloudflare 版）

- `prompts/socrates.md` 在建置期以 Text import 進 `PiAgent` Durable Object 的 system prompt section；改檔後重新部署即生效。
- 模型路由在 `apps/server/src/providers/`（pool 白名單 + fallback），不再是單一 baseUrl；完整 provider 表與 ZDR 規則見 [`../../docs/providers.md`](../../docs/providers.md)。
- 金鑰以 Cloudflare secrets 管理（`OPENCODE_API_KEY`／`OPENROUTER_API_KEY`／`ZAI_API_KEY` 僅開發）；學生自帶 key 走 BYOK（加密存 D1）。
- 對話引擎是 Pi Durable（`apps/server/src/do/pi-agent.ts`）：transcript／排隊／重試／恢復由 pi 管理，歷史仍寫回 D1（`archive_messages` / `activity_dialogue` / `discussion_messages`）。

## 迭代慣例

改 `prompts/` 後，下一次對話請求就會使用新內容（mtime 自動重載）；`providers/models.json` 在後端啟動時讀取，改完需重啟後端。兩者都不需要改程式碼。

# llm/ — LLM 設定層（zero-code by design）

所有權：`@ntnu-swe-2026-team4/llm`

本目錄不放置應用程式碼。後端（`server/`，Bun + Hono）直接呼叫 OpenRouter 的 OpenAI 相容 API
（ADR-0001），提示詞與模型清單由這個目錄提供；LLM 組改檔案即可調整行為，不用改後端程式碼。

| 路徑 | 內容 | 議題 |
|---|---|---|
| `prompts/` | 對話引擎提示詞契約（階段 1 蘇格拉底六原則、情緒標記、收尾協議） | #27 |
| `providers/models.json` | OpenRouter 預設模型與可選模型；`mock` 為離線開發用 provider | #26 |

## 後端如何使用

- `server/src/services/llm.ts` 讀 `prompts/socrates.md` 注入 `system`；檔案 mtime 改變時會自動重新載入，不用重啟。
- 模型 id 的優先順序：`OPENROUTER_MODEL` 環境變數 → `providers/models.json` 的 `providers.openrouter.defaultModel` → 內建預設。
- API key 只放在 `server/.env` 的 `OPENROUTER_API_KEY`；沒有 key 時對話端點回 `503`，其他功能照常。
- `LLM_PROVIDER=mock` 時使用規則式回覆（不呼叫網路），供本機開發與 `bun test` 使用。
- 對話歷史存在 SQLite（`archive_messages` / `activity_dialogue` / `discussion_messages`），不使用 pi session JSONL 快取。

## 迭代慣例

改 `prompts/` 後，下一次對話請求就會使用新內容（mtime 自動重載）；`providers/models.json` 在後端啟動時讀取，改完需重啟後端。兩者都不需要改程式碼。

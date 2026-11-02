# llm/ — LLM 設定層（zero-code by design）

所有權：`@ntnu-swe-2026-team4/llm`

本目錄不放置應用程式碼。後端（`server/`，Bun + Hono）直接呼叫 GLM（智譜 Z.ai）的 OpenAI 相容 API
（ADR-0001），提示詞與模型清單由這個目錄提供；LLM 組改檔案即可調整行為，不用改後端程式碼。

| 路徑 | 內容 | 議題 |
|---|---|---|
| `prompts/` | 對話引擎提示詞契約（階段 1 蘇格拉底六原則、情緒標記、收尾協議） | #27 |
| `prompts/lookup.md` | 名詞查詢的 system prompt：只根據白名單來源、句尾標 [n]、依名詞類型安排、150 字內；沒有相關來源時只回「資料不足」 | — |
| `lookup/search.json` | 名詞查詢的搜尋設定：搜尋服務（`provider`：`exa` / `keenable` / `duckduckgo` 免 key，`tavily` 要 key；可寫陣列當備援順序）、查詢模板、筆數、片段長度、逾時、網域白名單（`domains.zh`）；流程見 [`docs/api-contract.md`](../docs/api-contract.md)「名詞查詢」 | — |
| `providers/models.json` | GLM 的 baseUrl、預設模型與可選模型；`mock` 為離線開發用 provider | #26 |

## 後端如何使用

- `server/src/services/llm.ts` 讀 `prompts/socrates.md` 注入 `system`；檔案 mtime 改變時會自動重新載入，不用重啟。
- 端點：`GLM_BASE_URL` 環境變數 → `providers/models.json` 的 `providers.glm.baseUrl` → 內建預設（Coding Plan：`https://api.z.ai/api/coding/paas/v4`；一般 API：`https://open.bigmodel.cn/api/paas/v4`）。
- 模型 id 的優先順序：`GLM_MODEL` 環境變數 → `providers/models.json` 的 `providers.glm.defaultModel` → 內建預設。
- API key 只放在 `server/.env` 的 `GLM_API_KEY`；沒有 key 時對話端點回 `503`，其他功能照常。
- 對話請求固定帶 `thinking: { type: "disabled" }`（回覆三句話以內，關掉思考讓第一個字早點出現）；要改回來就改 `server/src/services/llm.ts`。
- `LLM_PROVIDER=mock` 時使用規則式回覆（不呼叫網路），供本機開發與 `bun test` 使用。
- `server/src/services/lookup.ts` 讀 `prompts/lookup.md`（mtime 自動重載）與 `lookup/search.json`（每次查詢重新讀取），搜尋服務由 `search.json` 的 `provider` 決定，可寫字串或陣列（依序嘗試，失敗就換下一個）：`exa`（Exa 公開 MCP 端點）、`keenable`（Keenable 公開 API）、`duckduckgo`（讀 DuckDuckGo 的 HTML 結果頁）都免 key 但有頻率限制；`tavily` 需要 `TAVILY_API_KEY`。預設 `["exa", "keenable", "duckduckgo"]`，整理用同一個 GLM 模型（`temperature: 0.2`）。
- 對話歷史存在 SQLite（`archive_messages` / `activity_dialogue` / `discussion_messages`），不使用 pi session JSONL 快取。

## 迭代慣例

改 `prompts/` 或 `lookup/search.json` 後，下一次請求就會使用新內容；`providers/models.json` 在後端啟動時讀取，改完需重啟後端。兩者都不需要改程式碼。

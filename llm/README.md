# llm/ — LLM 設定層（zero-code by design）

所有權：`@ntnu-swe-2026-team4/llm`

本目錄不放置應用程式碼：pi SDK 以 in-process 形式內嵌於 `server/`（ADR-0005 形式 C），
LLM team 在此維護提示詞與供應商設定。

| 路徑 | 內容 | 議題 |
|---|---|---|
| `prompts/` | 對話引擎提示詞契約（階段 1 蘇格拉底六原則、收尾協議） | #27 |
| `providers/` | `models.json`：OpenRouter / 自架 / mock 三 provider（ADR-0001 OpenAI 相容） | #26 |
| `sessions/` | pi session JSONL 快取（gitignored，PG 為事實來源可重建） | #26 |

迭代慣例：改提示詞檔即生效（`systemPromptOverride` 讀檔注入），不需改後端程式碼。

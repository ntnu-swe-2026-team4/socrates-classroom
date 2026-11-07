# llm/ — LLM 設定層（zero-code by design）

所有權：`@ntnu-swe-2026-team4/llm`

蘇格拉底對話：後端（`server/`，Bun + Hono）直接呼叫 GLM（智譜 Z.ai）的 OpenAI 相容 API
（ADR-0001），提示詞與模型清單由這個目錄提供；LLM 組改檔案即可調整行為，不用改後端程式碼。

報告（#74）：這個目錄附帶讓任務跑起來的程式（`runtime/`），後端呼叫 `llm.classReport()`、`llm.studentReport()`，見下面〈報告怎麼呼叫〉。LLM 組改 `tasks/` 底下的 prompt，呼叫方式不變。

| 路徑                                           | 內容                                                                       | 議題 |
| ---------------------------------------------- | -------------------------------------------------------------------------- | ---- |
| `prompts/`                                     | 對話引擎提示詞契約（階段 1 蘇格拉底六原則、情緒標記、收尾協議）            | #27  |
| `providers/models.json`                        | GLM 的 baseUrl、預設模型與可選模型；`mock` 為離線開發用 provider           | #26  |
| `index.ts`、`runtime/`                         | 讓任務跑起來的程式：組 prompt、呼叫模型、檢查輸出格式；後端只 import 入口  | #74  |
| `tasks/class-report/`、`tasks/student-report/` | 群體報告、單人報告：`task.ts`（輸入、輸出格式）＋ `prompts/`               | #74  |
| `devtools/bundle.ts`                           | 把 prompt 和 `models.json` 打包成 `dist/worker.ts`（Workers 沒有檔案系統） | #74  |

> 全部可用 provider（自架 DGX Spark、OpenCode Go、Coding Plan、Workers AI、OpenRouter、BYOK）的端點、用量、併發與 ZDR 查證，詳見 [`docs/providers.md`](../docs/providers.md)。

## 後端如何使用（Cloudflare 版）

- `prompts/socrates.md` 在建置期以 Text import 進 `PiAgent` Durable Object 的 system prompt section；改檔後重新部署即生效。
- 模型路由在 `apps/server/src/providers/`（pool 白名單 + fallback），不再是單一 baseUrl；完整 provider 表與 ZDR 規則見 [`../../docs/providers.md`](../../docs/providers.md)。
- 金鑰以 Cloudflare secrets 管理（`OPENCODE_API_KEY`／`OPENROUTER_API_KEY`／`ZAI_API_KEY` 僅開發）；學生自帶 key 走 BYOK（加密存 D1）。
- 對話引擎是 Pi Durable（`apps/server/src/do/pi-agent.ts`）：transcript／排隊／重試／恢復由 pi 管理，歷史仍寫回 D1（`archive_messages` / `activity_dialogue` / `discussion_messages`）。

## 報告怎麼呼叫（#74）

```ts
import { llm, LLMError } from "<到 packages/llm 的路徑>/dist/worker.ts"; // 不在 Workers 上（例如測試）可以 import index.ts

// 群體報告：立場軸、每位學生的落點、全班整理
const classReport = await llm.classReport({ title, statement, students: [{ id: "S01", transcript }], locale });
// 單人報告的論點總結（主張、理由、張力）；立場落點用 classReport 的，違規切片直接讀 violations 表
const { report } = await llm.studentReport({ title, statement, transcript, locale });
```

- `transcript`：一位學生的對話，一行一則：`AI：…`、`學生（1）：…`，學生的話依序編號
- `id`：學生代號，不放真名
- `locale`：報告用的預設語言（例：`zh-TW`、`en`），不給就用繁體中文
- 輸入、輸出的完整格式寫在各自的 `tasks/<任務>/task.ts`（`input`、`output`）
- 輸出格式不對時會退回重問，最多 2 次；還是不對就丟 `LLMError`（`code: "llm_no_result"`）

**部署前打包**：Workers 沒有檔案系統，要先執行 `pnpm --filter @socrates/llm bundle` 產生 `dist/worker.ts`。`dist/` 不進 git；prompt 改了要重新打包。Workers 要開 `nodejs_compat`（`apps/web/cloudflare.config.ts` 已經開了）。

**連線**：照 `providers/models.json`，環境變數可以蓋過：`GLM_API_KEY`（必要）、`GLM_MODEL`、`GLM_BASE_URL`；`LLM_PROVIDER=mock` 不呼叫模型，回 `task.ts` 的範例輸出。也可以呼叫時傳後端自己的設定：`llm.classReport(input, { connection: { baseUrl, apiKey, model } })`。

**錯誤**：一律丟 `LLMError`，`code` 是 `llm_invalid_input`（輸入不符合 `task.ts`）、`llm_not_configured`（沒有 key）、`llm_rate_limited`、`llm_unavailable`、`llm_timeout`、`llm_no_result`。

## 迭代慣例

改 `prompts/` 後，下一次對話請求就會使用新內容（mtime 自動重載）；`providers/models.json` 在後端啟動時讀取，改完需重啟後端。兩者都不需要改程式碼。

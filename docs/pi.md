# Pi Durable（PiHarness）參考

> 本專案的對話引擎。pi 負責 agent 迴圈的一切：transcript、輸入排程（follow-up/steer）、模型呼叫、工具、重試、崩潰恢復；本專案只負責「把請求送進去、把事件接出來、把結果寫回 D1」。
> 上游：pi（https://pi.dev）由 Earendil 開發；Workers 整合由 Cloudflare Agents SDK 提供（`agents/harness/pi`）。

## 目錄

- [版本配對鎖（重要）](#版本配對鎖重要)
- [在本專案的架構位置](#在本專案的架構位置)
- [核心模型：session / submit / events / wait](#核心模型session--submit--events--wait)
- [順序陷阱：先掛事件再 submit](#順序陷阱先掛事件再-submit)
- [設定（settings）](#設定settings)
- [模型（models）與 provider](#模型models與-provider)
- [恢復與崩潰](#恢復與崩潰)
- [測試（faux provider）](#測試faux-provider)
- [已知限制](#已知限制)
- [來源](#來源)

## 版本配對鎖（重要）

**`agents` 的每個版本只對應一個 pi minor 版本。** 本專案錨定：

| 套件                                             | 版本      |
| ------------------------------------------------ | --------- |
| `agents`                                         | `^0.32.0` |
| `@earendil-works/pi-durable` / `pi-ai` / `chord` | `~1.4.0`  |

升級時兩邊必須一起評估（pi 1.5 已發布，但 agents 尚未跟進——**不要單獨升 pi**）。

## 在本專案的架構位置

```
apps/server/src/do/pi-agent.ts   # PiAgent Durable Object
├─ PiHarness                     # pi 的本體：storage 用 DO 自己的 SQLite（pi_* 表）
├─ registry                      # extension：system prompt（packages/llm/prompts/socrates.md）
├─ providers/pool.ts             # models registry（白名單 fallback 鏈）
└─ dialogue()                    # 本專案的 RPC 入口：SSE 轉換 + D1 寫回
```

- 一個對話執行緒 = 一個 DO instance：`env.PiAgent.idFromName(`${scope}:${id}`)`
- pi 的資料放在 DO SQLite 的 `pi_*` 表——與 D1 的產品資料（對話記錄、成績）**分離**
- DO 建構時 `buildPool(env)` 組出 models registry；`defaults.model` = 鏈首，每輪再用 `session.setModel()` 指到當前健康的 provider

## 核心模型：session / submit / events / wait

```ts
const session = harness.session(); // root session（id "1"）
const stream = await session.events(); // AgentEventStream：snapshot + 每 commit 一批
const receipt = await session.submit(text); // durably 入隊（回 operationId）
const result = await session.wait(receipt.operationId); // { status: "done" | "unanswered", ... }
const entries = await session.messages(); // EntryRecord[]（最終真相）
```

- `submit` 先落盤再執行——同一 session 的後續輸入自動排隊（`whenBusy: "queue"`），`steer()` 則插進當前回合
- `wait()` 回覆 `{ status: "done" | "unanswered", reason? }`；`unanswered` 代表模型失敗且重試用盡（例如 `no_model`、`model_error`）
- `session.setModel(model)` 可在 submit 前換模型（本專案用它做健康優先選路）
- `session.messages()` 回 `EntryRecord[]`：`kind`（如 `pi.user` / `pi.assistant`）+ `model?: Message[]`——**最終文字從這裡拿**，delta 只是串流 UX

## 順序陷阱：先掛事件再 submit

`session.events()` 的串流**不重播歷史**。若先 `submit` 再 `start()` 監聽，瞬時完成的 run（mock、快取命中）會什麼都收不到——本專案踩過。正確順序：

```
events = await session.events()      // ① 先拿串流
stream.start(handleBatches)          // ② 先開始消費
receipt = await session.submit(...)  // ③ 再送出
result  = await session.wait(...)    // ④ 等結算
// ⑤ 收尾前再讀一次 messages() 補齐最終文字
```

`AgentEvent` 的文字增量在 `message_update.changes[]` 的 `{ type: "text_delta", delta }`。

## 設定（settings）

`Harness.open()` 的 `settings`（見 `do/pi-agent.ts`）：

| 鍵               | 本專案值                                              | 意義                                                              |
| ---------------- | ----------------------------------------------------- | ----------------------------------------------------------------- |
| `retry`          | `{ enabled: true, maxRetries: 5, baseDelayMs: 1000 }` | 模型請求指數退避：1/2/4/8/16 秒                                   |
| `afterFailedRun` | `"continue"`                                          | run 失敗後，排隊中的輸入接續執行（`keep`／`withdraw` 為其他選項） |

睡覺中的任務（退避等待）靠 `onWake` 喚醒——`PiHarness` 把它接上 DO 的 alarm，物件其他時間可休眠。

## 模型（models）與 provider

- `models = createModels()` + `models.setProvider(provider)`：pi-ai 內建 40+ provider 目錄（`getBuiltinModel(provider, id)`）
- 本專案的 registry 組合見 `apps/server/src/providers/pool.ts`（白名單 fallback 鏈）
- 自訂 OpenAI 相容端點（自架 DGX Spark）：`createProvider({ api: openAICompletionsApi(), auth: { apiKey: { resolve: async () => ({ auth: { apiKey: key } }) } } })`
- **BYOK**：`@earendil-works/pi-ai/providers/all` 的 builtin 目錄 + 學生 key 組出 per-request provider（`getBuiltinModels(providerId)` 提供完整模型清單；API-key 類 provider 皆可，OAuth 類除外）

## 恢復與崩潰

- DO 被驅逐／崩潰／重新部署 → 鬧鐘重啟物件 → pi 從最後 checkpoint 續跑
- 模型串流中斷：保留已收到的部分、重新呼叫
- `replay: "safe"` 的工具可安全重跑；其餘工具回「中斷結果」給模型自行決定
- 連續崩潰 `restartLimit`（預設 5）次 → 任務 **parked**：`pending()` 顯示 parked，`session.retry()` 重跑
- `onReport` 會收到 pi 的內部報告（本專案 `console.warn` 出去）

## 測試（faux provider）

`LLM_PROVIDER=mock` 時 `pool.ts` 註冊 pi-ai 的 faux provider：

```ts
const handle = fauxProvider({});
models.setProvider(handle.provider);
handle.setResponses([() => fauxAssistantMessage([fauxText("[neutral] …")])]);
```

測試斷言只驗形狀（done / emotion / 非空文字），不驗內容。

## 已知限制

| 限制                          | 對本專案的影響               |
| ----------------------------- | ---------------------------- |
| 單次 alarm 最長 15 分鐘       | 回覆 ≤3 句，無虞             |
| 無 tool approval 機制         | 目前未開寫入類工具           |
| event stream 無 cursor 續傳   | 重連靠 snapshot（官方設計）  |
| DO 內背景任務最多晚 30 秒察覺 | 可接受                       |
| 無刪除對話 API                | 以 `reset()` + D1 開新檔取代 |

## 來源

- Pi harness（Agents SDK）：https://developers.cloudflare.com/agents/harnesses/pi/
- pi 官方文件（models / providers / custom provider）：https://pi.dev/docs/latest/models
- pi-ai（library）：npm `@earendil-works/pi-ai`（`providers/all`、`compat` 的 API 實作）
- 官方完整範例：https://github.com/cloudflare/agents/tree/main/examples/next/harnesses/pi

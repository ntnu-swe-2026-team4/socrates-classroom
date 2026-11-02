# server/ — Backend（Bun + Hono + SQLite）

所有權：`@ntnu-swe-2026-team4/backend`

後端以 **Bun + Hono** 實作 [`docs/api-contract.md`](../docs/api-contract.md) 的完整介面，資料庫使用 **SQLite**（`bun:sqlite`，不依賴 Docker 或外部資料庫）。

| 議題 | 內容 | 狀態 |
|---|---|---|
| #23 | Scaffold：Bun + Hono（:8000）+ SQLite + migrations + `bun:test` | 完成 |
| #24 | 帳號系統：cookie session + 三層角色 | 完成（示範用 `{ role, name }` 登入） |
| #25 | 空間與活動骨架：classrooms / archives / activities + FSM + events SSE | 完成 |
| — | 教室、加入流程、公告、議題（辯論）、討論區、多人討論、行事曆 | 完成 |
| — | 四階段辯論（個人調查 → 團隊提純 → 辯論比賽 → 結果）、立場星圖、計分 | 完成 |
| — | GLM 蘇格拉底串流（SSE）、情緒標記、多語言 | 完成 |
| — | 名詞查詢（`POST /api/lookup`，Exa / Keenable / DuckDuckGo（免 key）白名單搜尋 + GLM 整理，SSE） | 完成 |

## 快速開始

```bash
# 在專案根目錄
bun install

# 後端（http://localhost:8000）；第一次啟動會自動建立 SQLite 與示範資料
bun run dev:server

# 另一個終端機：前端（http://localhost:5173）
bun run dev
```

前端要用真後端時，把 `frontend/.env` 的 `VITE_API_MODE` 設成 `http`（Vite 會把 `/api` 代理到 `:8000`）。

## 指令

| 指令（專案根目錄） | 作用 |
|---|---|
| `bun run dev:server` | 啟動後端（`bun --watch`） |
| `bun run test` | 後端 API 測試（`server/tests`，使用記憶體 SQLite） |
| `bun run typecheck` | 前端 + 後端 TypeScript 檢查 |
| `bun run migrate` | 套用 `server/migrations/*.sql` |
| `bun run seed` | 建立示範資料（資料庫已有使用者時會跳過） |

也可以直接進 `server/` 執行 `bun run dev`、`bun test`、`bun run typecheck`。

## 環境變數

複製 [`server/.env.example`](./.env.example) 為 `server/.env`：

| 變數 | 預設 | 說明 |
|---|---|---|
| `PORT` | `8000` | HTTP 埠 |
| `DATABASE_PATH` | `./data/socrates.db` | SQLite 檔案；可設 `:memory:` |
| `UPLOAD_DIR` | `./data/uploads` | 上傳檔案目錄 |
| `COOKIE_SECURE` | `false` | HTTPS 部署時設 `true` |
| `CORS_ORIGINS` | `http://localhost:5173,...` | 直接跨網域呼叫 API 時允許的來源（Vite 代理不需要） |
| `PUBLIC_BASE_URL` | 空 | 檔案下載網址的前綴；留空時回相對路徑 `/api/files/:id` |
| `GLM_API_KEY` | 空 | **只放在後端**；沒設定時對話端點回 503 |
| `GLM_MODEL` | `glm-4.6` | GLM 模型 id（也可改 `llm/providers/models.json`） |
| `GLM_BASE_URL` | `https://api.z.ai/api/coding/paas/v4` | GLM 的 OpenAI 相容端點；一般 API 是 `https://open.bigmodel.cn/api/paas/v4` |
| `TAVILY_API_KEY` | 空 | 只有 `llm/lookup/search.json` 的 `provider` 含 `tavily` 時才需要（預設的 Exa / Keenable / DuckDuckGo 都免 key）；**只放在後端** |
| `LLM_PROVIDER` | 空 | 沒有 key 時可設 `mock`，用規則式回覆做離線開發／測試（名詞查詢也改用假的搜尋與解釋） |
| `SEED_DEMO` | `true` | 空資料庫第一次啟動時建立示範教室 |

### 示範帳號

登入是示範用（`POST /api/auth/login { role, name }`），同一個「角色 + 姓名」會對應到同一個使用者：

| 身分 | 姓名 | 看得到 |
|---|---|---|
| 老師 | `林老師` | 高二哲學選修 A、倫理學讀書會、待審核申請 |
| 老師 | `張老師` | 大學先修：邏輯與論證 |
| 學生 | `訪客` | 高二哲學選修 A、高二哲學選修 B 的邀請、私人題庫 |
| 學生 | `王○安`、`李○恩`、`林○彤`、`吳○哲` | 示範教室成員 |

其他姓名登入會建立新帳號；學生可以用邀請碼 `LOGIC3`（邏輯與論證）或 `ETHIC5`（倫理學讀書會，需審核）加入示範教室。

## 目錄

```
server/
├─ migrations/001_init.sql   SQLite schema（foreign keys / cascade）
├─ src/
│  ├─ index.ts               Bun.serve 入口
│  ├─ app.ts                 Hono app、CORS、錯誤處理、路由掛載
│  ├─ config.ts              環境變數
│  ├─ db.ts                  SQLite 連線、migration、參數綁定工具
│  ├─ auth.ts                cookie session middleware
│  ├─ http.ts                HttpError、驗證小工具
│  ├─ messages.ts            zh / en / es 使用者訊息
│  ├─ seed.ts                示範資料
│  ├─ routes/                auth / archives / classrooms / announcements /
│  │                         topics / posts / discussions / calendar /
│  │                         activities / team（辯論與結果）/ lookup（名詞查詢）
│  └─ services/              access（權限）、serialize、dialogue（SSE）、llm、
│                            debate（分組／裁判／計分）、activities（FSM／場次）、files、
│                            lookup（名詞查詢：驗證、Exa / Keenable / DuckDuckGo / Tavily 搜尋、白名單過濾、GLM 整理）
└─ tests/api.test.ts         端到端 API 測試
└─ tests/lookup.test.ts      名詞查詢（mock 與攔截搜尋服務與 GLM 的 fetch）
```

## 設計重點

- **SQLite 是事實來源**：WAL 模式、`PRAGMA foreign_keys = ON`；資料庫與上傳檔案都在 `server/data/`（gitignored）。備份只要複製 `socrates.db`（建議先停止服務或使用 `.backup`）。
- **權限在後端**：每個教室的 `myRole`（teacher / assistant / student）由 `services/access.ts` 判斷；匿名貼文、私人題庫分享、學生看不到他人對話／座標都在序列化前過濾。
- **活動 FSM**：`individual → team → debate → done`，只有老師能推進；換階段會清空截止時間與「我準備好了」。`finish` 可從任何階段直接結算，且不會刪掉已進行的場次。
- **辯論場次**：輪到誰、每回合順序、逾時都由後端決定（`tickExpired` 在讀取場次時補上逾時發言）；裁判分數為規則式保底，老師可覆寫。
- **對話 SSE**：先向 LLM 要第一段內容，若一開始就失敗回一般 HTTP 錯誤（401/403/404/409/422/429/503）；開始串流後才出錯送 `event: error`。成功才把「使用者訊息 + AI 回覆」寫入同一個 transaction。
- **情緒標記**：`[neutral|happy|confused|angry]` 由後端拆掉，第一個 `delta` 前送 `event: emotion`，不會出現在文字或資料庫。
- **GLM**：使用 OpenAI 相容的 `{GLM_BASE_URL}/chat/completions` 串流；key 只在後端。沒有 key 時回 `503 llm_not_configured`，伺服器其他功能照常運作。`LLM_PROVIDER=mock` 只用於本機開發與測試。串流中的 `delta.reasoning_content`（思考過程）直接丟掉；對話與 JSON 請求都帶 `thinking: { type: "disabled" }`。
- **GLM 錯誤碼**：`1111`–`1114`（額度不足）回 503、`1302` / `1303` / `1305`（限流）回 429；其他 4xx / 5xx 一律 503，不把原始錯誤訊息給使用者。
- **名詞查詢**：只送出名詞本身，不帶對話、不寫資料庫。搜尋服務依 `llm/lookup/search.json` 的 `provider` 依序嘗試（預設 Exa → Keenable → DuckDuckGo，前一個失敗或被限流就換下一個），都限定白名單網域：Exa 用公開 MCP 端點（`web_search_advanced_exa`，片段用 highlights、有全文）；Keenable 用公開 API（`/v1/search/public`，只有 snippet）；DuckDuckGo 讀 `html.duckduckgo.com` 結果頁（只有 snippet），請求太密集會對整個 IP 顯示機器人驗證，所以一次一個、間隔 2 秒，遇到驗證就停用 10 分鐘；也可加入 Tavily（`include_answer: false`，不採用搜尋服務的 AI 回答），程式再過濾一次網域；片段太短就用同一次搜尋回傳的網頁全文。白名單內沒有來源時不呼叫 LLM。回覆若是「資料不足」先不串流給前端，結果標為 `insufficient`。查詢失敗一律放在 `done` 的 `result.status`，HTTP 仍是 200；頻率限制與對話分開計算（每人每分鐘 20 次）。
- **結構化 AI**：論點草稿會嘗試 GLM 的 `response_format: json_object`；沒有 key／失敗時退回規則式整理，不讓功能中斷。

## 測試

```bash
cd server && bun test
```

測試使用 `:memory:` SQLite、`LLM_PROVIDER=mock`，涵蓋登入、權限、邀請碼／審核、私人題庫分享、匿名貼文、公告排程、行事曆、多人討論、四階段辯論（對話 → 分組 → 比賽 → 結算 → 星圖）。

## 已知邊界

- 登入是契約指定的示範版（角色 + 姓名），尚未接 email / 密碼或學校 SSO；session 存在 SQLite。
- 討論區只做排程發布，不寄 email／推播。
- 上傳上限 50 MB（報告與教材），檔案下載需要登入且沿用該議題的權限。
- 活動即時事件是單一 process 的記憶體 fan-out；多個後端實例需改成外部 pub/sub（目前 SQLite 單檔部署適用）。

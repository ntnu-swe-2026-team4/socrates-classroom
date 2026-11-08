# API 契約

> 日期：2026-11-06 ｜ 分支：`experiment/web-next` ｜ 狀態：定案
> 型別單一真相：`packages/shared`（zod schema + TypeScript）；本文件描述形狀，shared 是可編譯的同一份。
> 2026-11-06 重構變更：對話通道 SSE → WebSocket（R7，`docs/pi.md`）；報告形狀改 agent 分析（#74，PR #109）；新增 teacher keys（#82）；lookup 為獨立功能（#76）。

## 1. 慣例

| 項目     | 規範                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 部署     | 單一 Worker：static assets + `/api/*`（Hono）+ `/agents/*`（WebSocket），同源無 CORS                                           |
| Auth     | httpOnly cookie `socrates_session`（`SameSite=Lax`＋prod 恆 `Secure`）；前端 `credentials: "include"`；**任何 key 永不進前端** |
| 語言     | `Accept-Language` → `Lang`（`zh-*→"zh"`、`en→"en"`、`es→"es"`）——錯誤訊息依此三語                                              |
| JSON     | camelCase；id 為字串；時間 ISO 8601                                                                                            |
| 錯誤     | `{ "message": string, "code": string }`；`code` 為 shared 的 `ErrorCode` literal union（§10），`message` 已本地化              |
| 輸入邊界 | zod 強制：`name` ≤80、對話 `text` ≤2000、`term` 1–30、`direction` ≤200、STT 音檔 ≤60s；超界 `422 validation`                   |
| 授權     | 預設 deny——見 §1.1；未列者一律需登入且屬教室成員                                                                               |
| 限流     | per-user（#103）；未登入可打的端點（§1.1 訪客欄 ✅ 者）加 per-IP tier；超限 `429`                                              |
| 冪等     | 自然鍵冪等：重複 `POST /api/join`（同身分）＝200 冪等、`finish` 重試安全、`PUT settings/*` 天然冪等                            |
| 版本     | `/api` 無版本前綴（單一消費者）；外部消費者出現時才評版本化＋OpenAPI                                                           |
| 型別共享 | `export type RpcApp = ReturnType<typeof createApp>`（`apps/server/src/app.ts`）；web 端 `hc<RpcApp>("/api")`（R6）             |

### 1.1 授權矩陣

> 「訪客」＝未持 session；訪客入場後取得 guest user（有 session），權利視同學生。

| Operation                                                                                               | 訪客 | 學生（含 guest user） | 老師                                  |
| ------------------------------------------------------------------------------------------------------- | ---- | --------------------- | ------------------------------------- |
| `GET /join/:code`、`POST /join`、`POST /auth/login`、`POST /auth/register`                              | ✅   | ✅                    | ✅                                    |
| `GET /me`、`logout`、`stt`、`tts`、`lookup`                                                             | —    | ✅                    | ✅                                    |
| `GET/PUT/DELETE /settings/keys/:provider`、`PUT /settings/keys/order`（#82 teacher keys）               | —    | ❌ 403                | ✅                                    |
| `GET /topics`、`POST /topics`、`topics/generate`、`POST /classrooms`、`POST /classrooms/:id/activities` | —    | —                     | ✅                                    |
| `GET /activities/:id`、`GET /report`                                                                    | —    | 需教室成員            | 需教室成員                            |
| `GET /activities/:id/dialogue`                                                                          | —    | 需教室成員（僅自己）  | 需教室成員（任意學生，`?studentId=`） |
| **WS** `/agents/chat/:name`                                                                             | —    | 需教室成員            | ❌（對話僅學生）                      |
| `GET /activities/:id/live`、`POST …/finish`                                                             | —    | ❌ 403                | 需教室成員                            |

## 2. 身分（雙軌：訪客即玩＋帳號選用，#67）

```ts
interface User {
  id: string;
  name: string;
  role: "student" | "teacher";
}
```

- 訪客 join 即建 guest user（`role: "student"`）；帳號登入後訪客紀錄認領合併（#60，P1）
- `GET /me` → `User | null`

## 3. 入場（唯一閘門，#66/#70）

| Operation                                                            | 說明                                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/join/:code` → `{code, classroomName, topic}`               | 直達 URL 載入用（刷新不丟）；無效碼 404 `join_code_invalid`                                                                                                                                                                   |
| `POST /api/join` `{code, name?, tosAccepted}` → `{user, activityId}` | 一次完成：身分（無 session 建 guest user）＋ToS 同意存證＋加入教室。**冪等**：同身分重 join → 200。錯誤：`tosAccepted` 非 true → 422 `tos_required`；`name` 教室內唯一（409 `name_taken`）；老師 session → 403 `only_student` |

## 4. 老師：主題集與開課（#77）

| Operation                                                                                | 說明                                                                                           |
| ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `GET /api/topics` → `Topic[]`                                                            | 系統題＋自建題                                                                                 |
| `POST /api/topics` `{title, statement, prompts}` → `Topic`（201）                        | 手動出題                                                                                       |
| `POST /api/topics/generate` `{direction}` → `Topic[]`                                    | agent 生成（topic-gen profile，#77/#113）；結果進老師端編輯器，不自動投放。失敗 → mock（不擋） |
| `POST /api/classrooms` `{name, topicId}` → `{classroomId, code, url, activityId}`（201） | 建教室＋首活動；`url` 為 `PUBLIC_BASE_URL/join/:code`                                          |
| `POST /api/classrooms/:id/activities` `{topicId}` → 同上（201）                          | 重開活動（同 code、新 activityId）                                                             |

## 5. 對話（WebSocket，核心；R7）

### 5.1 通道

- `GET /agents/chat/:name`（WebSocket 升級；`name`＝thread id）——**對話唯一通道**（先前的 SSE 端點已退役）
- 授權：`socrates_session` cookie（升級請求帶 cookie；未登入 → 401 before upgrade）
- 一條連線跟一個 session（root）；重連後重新 `watch`

### 5.2 Client → Server

```ts
type ClientMessage =
  | { type: "watch"; id?: string; from?: EntryId }                       // 附掛（重連帶 from 續看）
  | { type: "submit"; id?: string; input: string; operationId?: string } // 發言（冪等鍵可選）
  | { type: "abort"; id?: string }
  | { type: "entries"; id: string; query?: {...}; limit: number };       // 分頁載入歷史
```

- **no queue**：submit 一律 `whenBusy: "reject"`——run 進行中第二發被拒（§5.3 error frame），**永不排隊**

### 5.3 Server → Client

```ts
type ServerMessage =
  | { type: "hello"; tools: { name: string; description: string }[] }    // 連線首發（在 SDK 的 cf_agent_identity 之後）
  | { type: "view"; view: ConversationView }                              // watch 附掛時整份視圖
  | { type: "ops"; ops: Op[] }                                            // 之後每次變更的 chord 增量
  | { type: "result"; id: string; result: ... }                           // 對帶 id 指令的回覆
  | { type: "error"; id?: string; message: string };                      // 指令失敗（含 ConversationBusy）
```

- **客戶端以 `applyImmutable`（`@earendil-works/chord/delta`）套用 ops**——禁止手寫 delta applier
- **情緒**：`view.entries` 的 `app.emotion` entry（`{emotion, probabilities, confidence, text}`，#111）——UI 依機率驅動表情，文字零污染
- **違規**：`app.violation` entry（`{type, probability, excerpt, source}`，#71）——老師面板讀 D1（#73 輪詢），學生端不消費
- **歷史**：`GET /api/activities/:id/dialogue`（REST，§5.4）或 WS `entries` 指令

### 5.4 歷史（REST 讀）

| Operation                                                | 說明                                                                                                                                                |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/activities/:id/dialogue` → `DialogueMessage[]` | D1 歷史（舊→新）。老師帶 `?studentId=` 覆盤任意學生；學生不帶＝自己，帶非自身 `studentId` → 403。**寫入只經 WS**（pi transcript 為真相，D1 為投影） |

```ts
interface DialogueMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
}
```

## 6. 老師即時面板（#73；本輪不實作，資料源已調查）

- `GET /api/activities/:id/live` → `StudentLive[]`（SQL 聚合：messages/violations，indexed；前端輪詢）——實作時依 #73 留言的調查結果拍板
- `StudentLive`：`{id, name, status, rounds, flagged, flagReason?, lastUtterance}`

## 7. 活動結束與報告（#74/#78/#79/#72）

| Operation                                                           | 說明                                                                                                                                                |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/activities/:id/finish` → `204`                           | 老師結束活動 → ReportRunner DO `startReport`（alarm 驅動，非同步）。冪等；老師專屬                                                                  |
| `GET /api/activities/:id/report` → `TeacherReport \| StudentReport` | 生成中 404 `report_pending`（前端輪詢至 200）；失敗 500 `report_failed`（重打 `finish` 可重觸發）。**角色分流**：老師見全班＋個人；學生見全班＋自己 |

**報告形狀（#74，PR #109 的分析為核心；`pseudonym` 生成一次存 D1，活動內穩定；#72 全去識別化）**：

```ts
// LLM 分析輸出（shared/reports.ts）
interface StudentAnalysis {
  stated: true; claim: {text; turns}; reasons: {text; turns}; tension: {text; turns} | null;
} | {
  stated: false; doing: {text; turns};   // 未表態：做了什麼（離題/早退…）
}
interface ClassReport {
  students: {id; summary: {step; turns}[]}[];   // 逐生摘要（cause → result 步驟＋出處行號）
  unstated: string[];                            // 未表態者
  axes: {name; low; high; positions: {id; turns; view; end: "low"|"middle"|"high"; at: 0-100}[]; why}[];  // 立場軸＋落點
  overview: string[];                            // 全班整理
}

// API 回應（組合層）
interface TeacherReport {
  topicTitle: string;
  classReport: ClassReport;                      // 群體：軸/落點/分群/整理
  students: Record<studentId, {
    pseudonym: string;
    analysis: StudentAnalysis | null;            // 論點總結（claim/reasons/tension＋turns 出處）
    violations: {turn; type; excerpt}[];         // 違規切片（讀 violations 表，不經 LLM）
  }>;
}
interface StudentReport {
  topicTitle: string;
  classReport: ClassReport;                      // 全班（自己的落點在其中）
  analysis: StudentAnalysis | null;              // 自己的
  violations: {turn; type; excerpt}[];
}
```

- 立場落點**不重算**：單人報告的落點＝classReport 的產物（兩份報告一致，PR #109 設計）
- hexagon（#78 六角圖）不在本契約——前端頁面屆時從 classReport 的 `at`/`end` 映射或 prompt 擴充，屆時更新本節

## 8. 語音（#69）

| Operation                                         | 說明                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `POST /api/stt`（multipart audio ≤60s）→ `{text}` | 供無 Web Speech API 的瀏覽器（Firefox）；支援者前端自走原生                                              |
| `POST /api/tts` `{text, lang}` → audio stream     | server-side 為保證路徑；**無 char boundary**——嘴型驅動用 amplitude：`Api.tts(text, onAmplitude, signal)` |

## 9. 查詢與 teacher keys

| Operation                                                              | 說明                                                                                                                                       |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/lookup` `{term}` → `{term, markdown}`                       | #76 獨立查詢功能（lookup profile：agent 自主 search/fetch）；**不落庫不計輪**。失敗 → mock。termHistory 由前端 localStorage 持久化，無端點 |
| `GET /api/settings/keys` → `{provider, last4, sortOrder}[]`            | #82 teacher keys；**一 provider 一把 key**（帳戶級）；key 明文永不回傳                                                                     |
| `PUT /api/settings/keys/:provider` `{key}` → `{provider, last4}`       | 冪等 upsert；非法 provider → 422 `byok_provider_invalid`                                                                                   |
| `DELETE /api/settings/keys/:provider` → `204`                          |                                                                                                                                            |
| `PUT /api/settings/keys/order` `{providers: string[]}` → `{providers}` | 拖曳排序＝routing 的 provider 鏈序（#98）                                                                                                  |

- **學生無 BYOK 入口**（#82 定案）

## 10. 錯誤碼

`code` 為 shared 的 `ErrorCode` literal union＋`ApiError`（帶型別 `code`），呼叫端 switch 窮舉有編譯期檢查。

| 層                     | code                                                                                                       | HTTP                        |
| ---------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------- |
| 通用                   | `unauthorized` / `forbidden` / `not_found` / `conflict` / `validation` / `rate_limited` / `internal_error` | 401/403/404/409/422/429/500 |
| 入場                   | `join_code_invalid` / `tos_required` / `name_taken` / `only_student`                                       | 404/422/409/403             |
| 對話（WS error frame） | `ConversationBusy`（busy 第二發）與 pi 的錯誤訊息；`llm_*` 碼保留給 oneshot 端點                           | —                           |
| 報告                   | `report_pending` / `report_failed`                                                                         | 404 / 500                   |
| BYOK / teacher keys    | `byok_provider_invalid`                                                                                    | 422                         |

## 11. 範圍外（明確不在 v1 契約）

- `/admin` 運維 dashboard（P1，#80/#81/#97）
- 單人模式的個人對話 scope（前端未實作，屆時拍板）
- 跨裝置 termHistory（P1）
- `PATCH /me` 改名／頭像（P1 若有需求）
- teacher key 設定頁 UI（#82 前端；後端 API 已就緒）

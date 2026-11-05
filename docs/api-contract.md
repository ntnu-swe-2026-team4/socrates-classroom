# API 契約（v3）

> 日期：2026-11-05 ｜ 分支：`experiment/web-next` ｜ 狀態：定案
> 型別單一真相：`packages/shared`（zod schema + TypeScript）；本文件描述形狀，shared 是可編譯的同一份。

## 1. 慣例

| 項目     | 規範                                                                                                                           |
| -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 部署     | 單一 Worker：static assets + `/api/*`（Hono），同源無 CORS                                                                     |
| Auth     | httpOnly cookie `socrates_session`（`SameSite=Lax`＋prod 恆 `Secure`）；前端 `credentials: "include"`；**任何 key 永不進前端** |
| 語言     | `Accept-Language` → `Lang`（`zh-*→"zh"`、`en→"en"`、`es→"es"`）——錯誤訊息依此三語                                              |
| JSON     | camelCase；id 為字串；時間 ISO 8601                                                                                            |
| 錯誤     | `{ "message": string, "code": string }`；`code` 為 shared 的 `ErrorCode` literal union（§10），`message` 已本地化              |
| 輸入邊界 | zod 強制：`name` ≤80、對話 `text` ≤2000、`term` 1–30、`direction` ≤200、STT 音檔 ≤60s；超界 `422 validation`                   |
| 授權     | 預設 deny——見 §1.1；未列者一律需登入且屬教室成員                                                                               |
| 限流     | per-user（#103）；**未登入可打的端點**（§1.1 訪客欄 ✅ 者）加 per-IP tier；超限 `429`                                          |
| 分頁     | 可增長列表用 cursor 慣例：`?before=<id>&limit=`（v1 不套；宣告供未來套用時不破契約）                                           |
| 冪等     | 自然鍵冪等：重複 `POST /api/join`（同身分）＝**200 冪等**、`finish` 重試安全、`PUT/DELETE byok` 天然冪等                       |
| 版本     | `/api` 無版本前綴（單一消費者）；外部消費者出現時才評版本化＋OpenAPI                                                           |

### 1.1 授權矩陣

> 「訪客」＝未持 session；訪客入場後取得 guest user（有 session），權利視同學生。

| Operation                                                                                               | 訪客 | 學生（含 guest user） | 老師                                  |
| ------------------------------------------------------------------------------------------------------- | ---- | --------------------- | ------------------------------------- |
| `GET /join/:code`、`POST /join`、`POST /auth/login`、`POST /auth/register`                              | ✅   | ✅                    | ✅                                    |
| `GET /me`、`logout`、`stt`、`tts`、`lookup`                                                             | —    | ✅                    | ✅                                    |
| `GET/PUT/DELETE /settings/byok`                                                                         | —    | ✅                    | ✅                                    |
| `GET /topics`、`POST /topics`、`topics/generate`、`POST /classrooms`、`POST /classrooms/:id/activities` | —    | —                     | ✅                                    |
| `GET /activities/:id`、`GET /report`                                                                    | —    | 需教室成員            | 需教室成員                            |
| `GET /activities/:id/dialogue`                                                                          | —    | 需教室成員（僅自己）  | 需教室成員（任意學生，`?studentId=`） |
| `POST /activities/:id/dialogue`                                                                         | —    | 需教室成員            | ❌ 403 `only_student`                 |
| `GET /activities/:id/live`、`/events`、`POST …/finish`                                                  | —    | ❌ 403                | 需教室成員                            |

## 2. 身分（雙軌：訪客即玩＋帳號選用，#67）

```ts
interface User {
  id: string;
  name: string;
  role: "student" | "teacher";
}
```

| Operation                                                          | 說明                                          |
| ------------------------------------------------------------------ | --------------------------------------------- |
| `GET /api/me` → `User \| null`（未登入 200 + null）                | guest 與帳號同一條路                          |
| `POST /api/auth/login` `{email, password}` → `User`                | 回應 `Set-Cookie`                             |
| `POST /api/auth/register` `{code, email, password, name}` → `User` | 邀請連結註冊，完成即入教室；回應 `Set-Cookie` |
| `POST /api/auth/logout` → `204`                                    |                                               |

v1 契約**無 `PATCH /me`**：改名／頭像編輯不在 8 頁範圍。

## 3. 入場（唯一閘門，#66/#70）

| Operation                                                                      | 說明                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/join/:code` → `JoinInfo`                                             | 公開。回 `{code, classroomName, topic}`（topic 為該教室當前 activity 的主題）；無效碼 404 `join_code_invalid`                                                                                                                                                                              |
| `POST /api/join` `{code, name?, tosAccepted: true}` → `200 {user, activityId}` | 一次完成：身分（無 session 建 guest user；有 session 用之）＋ToS 同意存證＋加入教室＋回傳當前 activityId。**冪等**：同身分重 join → 200 回同一歸屬。錯誤：`tosAccepted` 非 true → 422 `tos_required`；`name` 教室內唯一（409 `name_taken`）；老師 session → 403 `only_student`；無效碼 404 |

```ts
interface Topic {
  id: string;
  title: string;
  statement: string;
  summary?: string;
  prompts: string[];
}
interface JoinInfo {
  code: string;
  classroomName: string;
  topic: Topic;
}
```

## 4. 老師：主題集與開課（#77）

| Operation                                                              | 說明                                                                |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `GET /api/topics` → `Topic[]`                                          | 目錄＝系統預設集＋老師自建                                          |
| `POST /api/topics` `{title, statement, summary?, prompts}` → `Topic`   | 自訂主題集                                                          |
| `POST /api/topics/generate` `{direction}` → `Topic[]`                  | AI 生成（one-shot 閘道，#102）；結果進老師端編輯器，不自動投放      |
| `POST /api/classrooms` `{name, topicId}` → `ClassroomCreated`          | 一次建立教室＋join code＋當前 activity                              |
| `POST /api/classrooms/:id/activities` `{topicId}` → `ClassroomCreated` | 既有教室重開新活動；join code 不變，`/join` 一律解析到最新 activity |

```ts
interface ClassroomCreated {
  code: string;
  url: string;
  activityId: string;
}
```

## 5. 對話（SSE，核心）

| Operation                                                | 說明                                                                                                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/activities/:id` → `ActivityInfo`               | 直達 URL 載入用（刷新不丟）                                                                                                                                               |
| `GET /api/activities/:id/dialogue` → `DialogueMessage[]` | 歷史（舊→新）。老師帶 `?studentId=` 覆盤任意學生；學生不帶＝自己，帶非自身 `studentId` → 403                                                                              |
| `POST /api/activities/:id/dialogue` `{text}` → **SSE**   | 學生發言（老師 403 `only_student`）；PiAgent DO（`activity:{id}:{userId}`）串流；活動已結束 → 409 `activity_finished`。**無輪數上限**——對話由課堂時間與老師 `finish` 收束 |

```ts
interface ActivityInfo {
  id: string;
  classroomName: string;
  topic: Topic;
  finishedAt: string | null;
}
interface DialogueMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
}
```

**SSE 事件**（`text/event-stream`；事件間空行；`done`/`error` 後關連線；所有 `delta` 接起來＝`done.message.text`）：

| 事件     | data                                    | 說明                                                                              |
| -------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| `delta`  | `{ "text": string }`                    | 零至多次；前端照序接續顯示                                                        |
| `done`   | `{ "message": DialogueMessage }`        | **最後一個事件**；已寫入 D1 的完整回覆                                            |
| `error`  | `{ "message": string, "code": string }` | 取代 `done` 的收尾事件；`code` 見 §10，`message` 一律本地化（上游原始錯誤不透傳） |
| `: ping` | —                                       | 心跳 ~15s，前端忽略                                                               |

- 無 `emotion`／`meta` 事件（退役，#90）；過渡期前端**容忍未知事件**
- 串流開始前的錯誤 → 一般 HTTP 錯誤（不開 SSE）；開始後 → `event: error`
- 同一 thread 併發請求 → 409 `already_streaming`

## 6. 老師即時面板（#73）

| Operation                                        | 說明                                                                                                                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/activities/:id/live` → `StudentLive[]` | 面板資料；輪詢或搭 events SSE                                                                                                                                                   |
| `GET /api/activities/:id/events` → **SSE**       | 推播：`event: live`（snapshot，重連首發）、`event: update`（單生變更）、`event: violation`（#71 標記）。事件型別＝shared 的 `ActivitySseEvent` union；Last-Event-ID 語意隨 #101 |

```ts
type LiveStatus = "active" | "speaking" | "idle";
interface StudentLive {
  id: string;
  name: string;
  status: LiveStatus;
  rounds: number;
  flagged: boolean;
  flagReason?: string;
  lastUtterance: string;
}
```

## 7. 活動結束與報告（#74/#78/#79/#72）

| Operation                                                           | 說明                                                                                                                                                                                                             |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/activities/:id/finish` → `204`                           | 老師結束活動 → 觸發報告生成（非同步）。冪等、無 body；效果反映在 `ActivityInfo.finishedAt`。老師專屬                                                                                                             |
| `GET /api/activities/:id/report` → `TeacherReport \| StudentReport` | 生成中 404 `report_pending`（前端輪詢至 200）。**失敗語意**：部分學生分析失敗＝繼續重試，未全數完成前一律 `report_pending`；永久失敗 → 500 `report_failed`，老師重打 `finish` 可重觸發（冪等）。**角色分流見下** |

**報告型別**（`pseudonym` 生成一次存 D1，於 `group.points` 與 individuals 間一致且活動內穩定；#72 全去識別化）：

```ts
interface HexagonAxis {
  label: string;
  value: number;
}
interface ArgumentPoint {
  claim: string;
  reason: string;
  tension: string;
}
interface ViolationSlice {
  turn: number;
  type: string;
  excerpt: string;
}
interface ReportAxis {
  name: string;
  left: string;
  right: string;
  color: string;
}
interface StancePoint {
  pseudonym: string;
  values: number[];
  cluster: number;
}
interface IndividualReport {
  pseudonym: string;
  hexagon: HexagonAxis[];
  arguments: ArgumentPoint[];
  violations: ViolationSlice[];
}
interface GroupReport {
  axes: ReportAxis[];
  points: StancePoint[];
  clusters: { id: number; label: string }[];
}
interface TeacherReport {
  topicTitle: string;
  group: GroupReport;
  individuals: IndividualReport[];
}
interface StudentReport {
  topicTitle: string;
  group: GroupReport;
  individual: IndividualReport;
}
```

## 8. 語音（#69）

| Operation                                         | 說明                                                                                                     |
| ------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `POST /api/stt`（multipart audio ≤60s）→ `{text}` | 供無 Web Speech API 的瀏覽器（Firefox）；支援者前端自走原生                                              |
| `POST /api/tts` `{text, lang}` → audio stream     | server-side 為保證路徑；**無 char boundary**——嘴型驅動用 amplitude：`Api.tts(text, onAmplitude, signal)` |

## 9. 查詢與 BYOK

| Operation                                                        | 說明                                                                                       |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `POST /api/lookup` `{term}` → `{term, markdown}`                 | #76 查詢管線；融入對話流、**不落庫不計輪**。termHistory 由前端 localStorage 持久化，無端點 |
| `GET /api/settings/byok` → `{provider, last4} \| null`           | #82；key 明文永不回傳                                                                      |
| `PUT /api/settings/byok` `{provider, key}` → `{provider, last4}` | 白名單子集；非法 provider → 422 `byok_provider_invalid`                                    |
| `DELETE /api/settings/byok` → `204`                              |                                                                                            |

## 10. 錯誤碼

`code` 為 shared 的 `ErrorCode` literal union＋`ApiError`（帶型別 `code`），呼叫端 switch 窮舉有編譯期檢查。

| 層                          | code                                                                                                       | HTTP                        |
| --------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------- |
| 通用                        | `unauthorized` / `forbidden` / `not_found` / `conflict` / `validation` / `rate_limited` / `internal_error` | 401/403/404/409/422/429/500 |
| 入場                        | `join_code_invalid` / `tos_required` / `name_taken` / `only_student`                                       | 404/422/409/403             |
| 對話（SSE 前驗證）          | `already_streaming` / `only_student` / `activity_finished`                                                 | 409/403/409                 |
| 對話（串流中 `error` 事件） | `llm_unavailable` / `llm_rate_limited` / `llm_timeout`                                                     | —                           |
| 報告                        | `report_pending` / `report_failed`                                                                         | 404 / 500                   |
| BYOK                        | `byok_provider_invalid`                                                                                    | 422                         |

## 11. 範圍外（明確不在 v1 契約）

- `/admin` 運維 dashboard（P1，#80/#81/#97）
- 單人模式的個人對話 scope（前端未實作，屆時拍板）
- 跨裝置 termHistory（P1）
- `PATCH /me` 改名／頭像（P1 若有需求）

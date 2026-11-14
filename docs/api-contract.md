# API 契約

> 日期：2026-11-06 ｜ 分支：`experiment/web-next` ｜ 狀態：定案
> 型別單一真相：`packages/shared`（zod schema + TypeScript）；本文件描述形狀，shared 是可編譯的同一份。
> 2026-11-06 重構變更：對話通道 SSE → WebSocket（R7，`docs/pi.md`）；報告形狀改 agent 分析（#74，PR #109）；新增 teacher keys（#82）；lookup 為獨立功能（#76）。

## 1. 慣例

| 項目     | 規範                                                                                                                                                                                                                                                                                         |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 部署     | 單一 Worker：static assets + `/api/*`（Hono）+ `/agents/*`（WebSocket），同源無 CORS                                                                                                                                                                                                         |
| Auth     | httpOnly cookie `socrates_session`（`SameSite=Lax`＋prod 恆 `Secure`）；前端 `credentials: "include"`；**任何 key 永不進前端**。30 天 HMAC token **不可撤銷**（logout 僅清 cookie；membership 撤銷會在 WS 喚醒時 re-verify，REST 仍有效至過期）                                              |
| 語言     | `Accept-Language` → `Lang`（`zh-*→"zh"`、`en→"en"`、`es→"es"`）——錯誤訊息依此三語                                                                                                                                                                                                            |
| JSON     | camelCase；id 為字串；時間 ISO 8601                                                                                                                                                                                                                                                          |
| 錯誤     | `{ "message": string, "code": string }`；`code` 為 shared 的 `ErrorCode` literal union（§10），`message` 已本地化                                                                                                                                                                            |
| 輸入邊界 | zod 強制：`name` ≤80、對話 `text` ≤2000、`term` 1–30、`direction` ≤200、STT 音檔 ≤15MB（位元組上限，非時長）；超界 `422 validation`                                                                                                                                                          |
| 授權     | 預設 deny——見 §1.1；未列者一律需登入且屬教室成員                                                                                                                                                                                                                                             |
| 限流     | 現行 per-IP stopgaps（isolate-local sliding window，跨 isolate 不保證、eviction 即重置）：login/register 30、join-code 60、join 30、lookup 20、topics-generate 10、stt 20、tts 30、activity-finish 6、community-announce 30、community-post 30；集中式 per-user 限流為 #103 待辦，非現行行為 |
| 冪等     | 自然鍵冪等：重複 `POST /api/join`（同身分）＝200 冪等、`finish` 重試安全、`PUT settings/*` 天然冪等                                                                                                                                                                                          |
| 版本     | `/api` 無版本前綴（單一消費者）；外部消費者出現時才評版本化＋OpenAPI                                                                                                                                                                                                                         |
| 型別共享 | `RpcApp = ReturnType<typeof createApp>`＋`RpcApi = ReturnType<typeof createApi>`（`apps/server/src/app.ts`）；web 端消費 declaration 產物 `hc<RpcApi>("/api")`（R6）                                                                                                                         |

### 1.1 授權矩陣

> 身分模型見 [`accounts.md`](./accounts.md)。「老師」是**每間教室**的身分（owner），能開課需要帳號具備 teacher 能力且開啟教師模式。

| Operation                                                                                                | 無 session | guest（單一活動）         | student（受管）                            | user／teacher                                                           |
| -------------------------------------------------------------------------------------------------------- | ---------- | ------------------------- | ------------------------------------------ | ----------------------------------------------------------------------- |
| `GET /join/:code`、`POST /join`、`POST /auth/login`、`POST /auth/register`、`GET /auth/providers`、OAuth | ✅         | ✅                        | ✅（join 他班 → 403 `student_restricted`） | ✅                                                                      |
| `GET /me`、`logout`、`stt`、`tts`、`lookup`                                                              | —          | ✅                        | ✅                                         | ✅                                                                      |
| `PATCH /me`                                                                                              | —          | 改名                      | ❌ 403 `student_restricted`                | ✅                                                                      |
| `/solo/chats*`（僅本人）                                                                                 | —          | ❌ 403 `account_required` | ❌ 403 `student_restricted`                | ✅                                                                      |
| `GET /classrooms`、`GET /classrooms/:id`、`GET /classrooms/:id/activities`                               | —          | 成員                      | 所屬班級                                   | owner 或成員                                                            |
| `/classrooms/:id/announcements*`、`/classrooms/:id/members*`、`/classrooms/:id/posts*`（§4.2）           | —          | ❌ 403 `account_required` | 所屬班級（不能退出）                       | owner 或成員                                                            |
| `GET/POST /settings/keys`、`PATCH/DELETE /settings/keys/:id`、`PUT /settings/keys/order`、`/topics*`     | —          | ❌ 403 `account_required` | ❌ 403 `student_restricted`                | ✅                                                                      |
| `POST /classrooms`                                                                                       | —          | ❌ 403 `account_required` | ❌ 403 `student_restricted`                | 需教師模式（否則 403 `teacher_required`）；trial 上限 403 `trial_limit` |
| `POST /classrooms/:id/activities`、`/preview`、`/students*`、`POST /activities/:id/finish`               | —          | ❌ 403                    | ❌ 403                                     | 僅該教室 owner                                                          |
| `/admin/*`（§4.4）                                                                                       | —          | ❌ 403                    | ❌ 403                                     | 僅 admin                                                                |
| `GET /activities/:id`、`GET /report`                                                                     | —          | 僅綁定的那場活動          | 所屬班級                                   | owner 或成員                                                            |
| **WS** `/agents/chat/:name`（watch/entries/abort）                                                       | —          | 僅本人 thread（綁定活動） | 僅本人 thread                              | 本人 thread；owner 可觀察全班                                           |
| **WS** `submit` op                                                                                       | —          | 僅本人 thread             | 僅本人 thread                              | 僅本人 thread（owner ❌ `SubmitForbidden`）                             |

## 2. 身分

```ts
interface User {
  id: string;
  name: string;
  guest: boolean;
  kind?: "member" | "student" | "guest";
  admin?: boolean;
  teacherPlan?: "trial" | "school" | null;
  teacherMode?: boolean;
  schoolName?: string | null;
  username?: string | null; // student 登入帳號
  classroomId?: string | null; // student 所屬班級
  activityId?: string | null; // guest 綁定的活動
  preview?: boolean;
  previewClassroomId?: string;
}
```

- 帳號狀態每個請求從 D1 讀取；session token 只承載 `uid`。帳號被刪（例如 student 被移除）→ 視同未登入。
- `GET /me` → `User | null`；guest 綁定的活動結束超過 24 小時 → 401 `guest_session_expired`。
- 訪客只能從 `POST /join` 取得（無 session 時）；`POST /auth/guest` 已移除。guest **不能升級**：註冊與 OAuth 一律建立新帳號。

| Operation                                                                         | 說明                                                                                                                                                                                                                                                                                                                                    |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/login` `{identifier, password}` → `User`                          | `identifier` 含 `@` → 以 email 查；否則以 student `username` 查。舊欄位 `email` 仍接受。錯誤 → 401 `unauthorized`                                                                                                                                                                                                                       |
| `PATCH /api/me` `{name?, teacherMode?, acceptTeacherTerms?}` → `User`             | 至少一個欄位。`name`：改顯示名稱（student → 403 `student_restricted`）。`teacherMode`：僅正式帳號；第一次開啟（尚無 `teacherPlan`）需 `acceptTeacherTerms: true`（否則 422 `teacher_terms_required`），開啟後成為 `trial`。重發 session                                                                                                 |
| `POST /api/auth/register` `{email, password, name?, tosAccepted, code?}` → `User` | 一律建立新帳號（不接手 guest）。`name` 省略 → email 的 local part。`code` 選填：先驗證（404 `join_code_invalid`／409 `activity_finished`／409 `name_taken`／403 `trial_limit`）再建帳號並加入。Email 已存在 → 409 `conflict`                                                                                                            |
| `GET /api/auth/providers` → `{google, apple, facebook}`                           | 各第三方登入是否已設定（設定方式見 [`cf.md`](./cf.md) §Secrets）                                                                                                                                                                                                                                                                        |
| `GET /api/auth/oauth/:provider/start?next=` → 302                                 | `provider` ∈ `google`/`apple`/`facebook`。未設定或未知 → 302 `/login?error=oauth_unavailable`；否則設 state cookie `socrates_oauth`（HMAC 簽章、`HttpOnly; Secure; SameSite=None; Path=/api/auth/oauth`、10 分鐘，含 state／PKCE verifier（Google）／`next`）並 302 至 provider 授權頁。`next` 僅接受同源相對路徑，否則 `/home`         |
| `GET\|POST /api/auth/oauth/:provider/callback` → 302                              | Google／Facebook 為 GET、Apple 為 `form_post`。state 缺失／不符／過期、無 `code`、provider 錯誤 → 302 `/login?error=oauth_failed`；成功 → 設 session 並 302 至 `next`。帳號解析：既有 identity → 該 user；provider 驗證過的 email 屬於**無密碼**帳號 → link；否則建新帳號（email 已被有密碼帳號占用時不寫入 email）。per-IP 限流 30/min |

## 3. 入場（唯一閘門，#66/#70）

| Operation                                                            | 說明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/join/:code` → `{code, classroomName, topic}`               | 直達 URL 載入用（刷新不丟）；無效碼 404 `join_code_invalid`                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `POST /api/join` `{code, name?, tosAccepted}` → `{user, activityId}` | 一次完成：身分（無 session、或現有 guest 綁的是別場活動 → 建新 guest，綁定當前活動）＋ToS 同意存證＋加入教室。student 加入非所屬班級 → 403 `student_restricted`；trial 教師的教室滿額 → 403 `trial_limit`。**冪等**：同身分重 join → 200（活動結束後仍可 rejoin，供 session 修復與報告回看）。錯誤：`tosAccepted` 非 true → 422 `tos_required`；`name` 教室內唯一（409 `name_taken`）；教室 owner 自己 join → 403 `only_student`；活動已結束 → 409 `activity_finished`（僅攔新成員） |

## 4. 老師：主題集與開課（#77）

| Operation                                                                                  | 說明                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/topics` → `Topic[]`                                                              | 系統題＋自建題。系統題依 `Accept-Language` 回傳對應語言（`topics.i18n`，`005_topic_i18n.sql`；zh 為原文）；`/activities/:id`、`/join/:code`、`/classrooms*` 中的主題文字同樣在地化                                                                                                                                              |
| `POST /api/topics` `{title, statement, prompts}` → `Topic`（201）                          | 手動出題                                                                                                                                                                                                                                                                                                                        |
| `POST /api/topics/generate` `{direction}` → `Topic[]`                                      | agent 生成（topic-gen profile，#77/#113）；結果進老師端編輯器，不自動投放。失敗 → mock（不擋，回應帶 X-Socrates-Fallback: mock）                                                                                                                                                                                                |
| `POST /api/classrooms` `{name?, topicId?}` → `{classroomId, code, url, activityId}`（201） | 創建課程。兩者皆可省略：`name` 省略 → 依語言「未命名課程」；`topicId` 省略 → 不建活動（`activityId: null`，`current: null`，學生在第一個主題開始前無法 join）。`url` 為 `PUBLIC_BASE_URL/join/:code`                                                                                                                            |
| `PATCH /api/classrooms/:id` `{name}` → `{id, name}`                                        | 僅 owner 改課程名稱（他人 403）                                                                                                                                                                                                                                                                                                 |
| `POST /api/classrooms/:id/activities` `{topicId}` → 同上（201）                            | 重開活動（同 code、新 activityId）                                                                                                                                                                                                                                                                                              |
| `POST /api/classrooms/:id/preview` → `{user, activityId}`                                  | Student View：僅教室 owner 老師。建立（或重用）該教室唯一的測試學生（`users.preview_classroom_id`），把老師 session 存進 `socrates_preview_return` cookie，改發測試學生 session（`user.preview: true`）。測試學生不計入 `memberCount`、不進 ReportRunner 的 members 與 pseudonyms。無進行中活動 → 404 `not_found`；非老師 → 403 |
| `POST /api/preview/reset` → `{user, activityId}`                                           | 僅 preview session。刪除測試學生並建立新的（新 `user.id` ＝ 新對話 thread）；舊 thread 的 DO 資料不清除                                                                                                                                                                                                                         |
| `POST /api/preview/exit` → `User`（老師）                                                  | 僅 preview session。以 `socrates_preview_return` 還原老師 session；cookie 失效 → 401 `unauthorized` 並清除 session                                                                                                                                                                                                              |
| `GET /api/classrooms` → `ClassroomSummary[]`（登入者）                                     | 自己開的教室＋已加入的教室；`role` 為**此教室中**的身分（owner → `teacher`）。`code/url` 只回給 owner；`current` 嵌入當前活動（topic＋finished）                                                                                                                                                                                |
| `GET /api/classrooms/:id` → `ClassroomSummary`                                             | 單筆；非 owner 且非成員 → 404 `not_found`                                                                                                                                                                                                                                                                                       |
| `DELETE /api/classrooms/:id` → 204                                                         | 僅 owner（其他人 403、不存在 404）。FK cascade 刪除活動、成員、報告、pseudonyms 與該教室的測試學生；各 Chat DO 內的 transcript 不清除（已無法連線）                                                                                                                                                                             |
| `GET /api/classrooms/:id/activities` → `ClassroomActivity[]`                               | 教室的所有討論主題（新到舊）：`{id, topicId, topicTitle, topicStatement, createdAt, finished}`；權限同上                                                                                                                                                                                                                        |

### 4.1 單人對話（solo）

| Operation                                              | 說明                                                                                           |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| `GET /api/solo/chats` → `SoloChat[]`                   | 本人的單人對話（`updated_at` 新到舊）：`{id, title, createdAt, updatedAt}`                     |
| `POST /api/solo/chats` `{title}` → `SoloChat`（201）   | 建立；`id` 前綴 `s_`。訊息不走 REST——前端以 WS thread `${chatId}:${userId}` 對話（同 §5 協議） |
| `GET` / `PATCH {title}` / `DELETE /api/solo/chats/:id` | 僅本人；他人 → 404 `not_found`。刪除後 DO 內 transcript 不再可連線                             |

- Chat DO 對 `s_` thread：authorize＝本人且擁有該 chat；無「活動結束」檢查；每次 submit 更新 `updated_at`；model 路由使用擁有者自己的 teacher keys（有設才用）

### 4.2 教室社群（公告、成員、討論區）

資料表：`announcements`、`posts`（`006_community.sql`；`posts.parent_id` 自我參照、`ON DELETE CASCADE`）。所有端點需 session；非 owner 且非成員 → 404 `not_found`。測試學生（`users.preview_classroom_id`）視為成員可讀可發言，但不出現在成員列表。`body` 為 trim 後 1–2000 字（超界 422 `validation`）。

```ts
interface Announcement {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
}
interface ClassroomMembers {
  teacher: { id: string; name: string };
  members: Array<{ id: string; name: string; joinedAt: string }>;
}
interface PostReply {
  id: string;
  body: string;
  authorId: string;
  authorName: string;
  isTeacher: boolean;
  createdAt: string;
}
interface Post extends PostReply {
  replies: PostReply[];
}
```

| Operation                                                                           | 說明                                                                                                                                             |
| ----------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/classrooms/:id/announcements` → `Announcement[]`                          | 新到舊                                                                                                                                           |
| `POST /api/classrooms/:id/announcements` `{body}` → `Announcement`（201）           | 僅 owner（成員 403 `forbidden`）；per-IP 限流 30/min                                                                                             |
| `DELETE /api/classrooms/:id/announcements/:announcementId` → 204                    | 僅 owner；不存在或不屬此教室 → 404                                                                                                               |
| `GET /api/classrooms/:id/members` → `ClassroomMembers`                              | `teacher` 為 owner（`users.name`）；`members` 依加入時間舊到新，名稱為 `members.name`，排除測試學生                                              |
| `DELETE /api/classrooms/:id/members/:userId` → 204                                  | owner 移除成員，或成員移除自己（退出教室）；其他人 → 403；owner 不可被移除（403）；非成員 → 404。只刪 `members` row，不刪 user，已發表的貼文保留 |
| `GET /api/classrooms/:id/posts` → `Post[]`                                          | 討論串新到舊，`replies` 舊到新（只有一層）。`authorName`：成員用 `members.name`、owner 或已離開者用 `users.name`；`isTeacher` ＝作者為 owner     |
| `POST /api/classrooms/:id/posts` `{body, parentId?}` → `Post`（201，`replies: []`） | owner 或成員皆可。`parentId` 必須是同教室的頂層貼文，否則 404 `not_found`；per-IP 限流 30/min                                                    |
| `DELETE /api/classrooms/:id/posts/:postId` → 204                                    | 作者本人或 owner（其他人 403）；刪除討論串時 FK cascade 一併刪除回覆                                                                             |

### 4.3 學生帳號（受管）

| Operation                                                                                        | 說明                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `POST /api/classrooms/:id/students` `{names: string[]}` → `201 {id, name, username, password}[]` | 僅 owner。一次 1–50 位；`username` ＝ `{邀請碼}-{兩位序號}`、`password` ＝ `xxxx-xxxx`（只在此回傳一次）。名稱重複（請求內或與既有成員）→ 409 `name_taken`；trial 超額 → 403 `trial_limit` |
| `POST /api/classrooms/:id/students/:userId/password` → `{id, name, username, password}`          | 僅 owner；重設並回傳新密碼。非該班 student → 404                                                                                                                                           |
| `DELETE /api/classrooms/:id/members/:userId`（§4.2）                                             | 目標是該班 student → 刪除整個帳號；student 自己退出 → 403 `student_restricted`                                                                                                             |

`GET /classrooms/:id/members` 的每位成員多了 `kind`（`member`／`student`／`guest`）；owner 另外看得到 student 的 `username`。

### 4.4 管理（admin）

| Operation                                                                           | 說明                                                                                                                                                        |
| ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/notifications` → `{items: {id, title, body, createdAt}[], unread}`        | 系統通知，新到舊，最多 30 筆；不需 session（登入頁公告欄用），未登入或 guest 的 `unread` 恆為 0                                                             |
| `POST /api/notifications/seen` → 204                                                | 需帳號；把目前時間記為已讀時間                                                                                                                              |
| `POST /api/admin/notifications` `{title, body}` → `201` notification                | admin；`title` 1–120 字、`body` ≤ 2000 字                                                                                                                   |
| `DELETE /api/admin/notifications/:id` → 204                                         | admin；不存在 → 404                                                                                                                                         |
| `GET /api/admin/schools` → `{id, name, teacherCount, createdAt}[]`                  |                                                                                                                                                             |
| `POST /api/admin/schools` `{name}` → `201` school                                   |                                                                                                                                                             |
| `GET /api/admin/teachers` → `{id, name, email, schoolId, schoolName}[]`             | 所有 `school` 方案教師                                                                                                                                      |
| `POST /api/admin/teachers` `{name, email, schoolId}` → `201 {…, temporaryPassword}` | email 已是正式帳號 → 升級為 `school`（`temporaryPassword: null`）；不存在 → 建新帳號並回傳臨時密碼；email 屬於訪客或學生 → 409 `conflict`；學校不存在 → 404 |
| `DELETE /api/admin/teachers/:id` → `204`                                            | 移出學校 → 改回 `trial`，班級保留；非 school 教師 → 404                                                                                                     |

## 5. 對話（WebSocket，核心；R7）

### 5.1 通道

- `GET /agents/chat/:name`（WebSocket 升級）——**對話唯一通道**（先前的 SSE 端點已退役）
- thread name 協定：`{activityId}:{userId}`（一人一 thread；DO name 即路由鍵）
- 授權：`socrates_session` cookie（升級請求帶 cookie）——onConnect 驗 session＋membership：學生限本人 thread，老師可觀察全班（watch/entries/abort；**submit 僅限該 thread 的學生本人**——老師代打 → error frame code `SubmitForbidden`）；未通過 → close 1008（無 hello）；hibernation 喚醒後 reverify 確定撤權（ApiError）→ close 1008；reverify 暫時性錯誤（D1 失敗等）或 watch 遺失（session 驅逐）→ close 1011（客戶端重連即重試）
- 一條連線跟一個 session：預設 root；送 `btw` 後該連線改綁 side session（§5.4）。重連後重新 `watch`（partysocket 自動重連，客戶端端 onOpen 重送）

### 5.2 Client → Server

```ts
type ClientMessage =
  | { type: "watch"; id?: string; from?: EntryId }                       // 附掛（重連帶 from 續看）
  | { type: "submit"; id?: string; input: string; operationId?: string } // 發言（input＝string；pi 的 content parts 形狀未開放；冪等鍵可選）
  | { type: "abort"; id?: string }
  | { type: "btw"; id?: string; session?: string }                       // 本連線改綁 side session（§5.4）
  | { type: "entries"; id: string; query: {...}; limit: number };        // 分頁載入歷史（query 必填；上限 100）
```

- **no queue**：submit 一律 `whenBusy: "reject"`——run 進行中第二發被拒（§5.3 error frame），**永不排隊**

### 5.3 Server → Client

```ts
type ServerMessage =
  | { type: "hello"; tools: { name: string; description: string }[] }    // 連線首發（在 SDK 的 cf_agent_identity 之後）
  | { type: "view"; view: ConversationView }                              // watch 附掛時整份視圖
  | { type: "ops"; ops: Op[] }                                            // 之後每次變更的 chord 增量
  | { type: "result"; id: string; result: ... }                           // 對帶 id 指令的回覆；submit 的 result＝admission receipt（非 run 完成）
  | { type: "error"; id?: string; message: string; code?: string };      // 帶 id：該指令失敗（code＝pi 錯誤名，如 ConversationBusy）；無 id：run 失敗廣播（code=llm_unavailable）
```

- **客戶端以 `applyImmutable`（`@earendil-works/chord/delta`）套用 ops**——禁止手寫 delta applier
- **回合完成判定**：submit 後記 baseline（當時最後一個 entry id，sliding window splice 安全），view/ops 中 baseline 之後出現 `pi.assistant` entry 即完成（admission receipt 不代表完成；串流中的 partial 寫在 `pi.live` doc，不會誤觸）；reconnect 後全量 view 仲裁——無本輪 `pi.user` entry＝未被 admission，清 pending 報錯（防 double-submit）
- **情緒**：`view.entries` 的 `app.emotion` entry（`{emotion, probabilities, confidence}`，#111）——UI 依機率驅動表情，文字零污染
- **違規**：`app.violation` entry（`{type, probability, excerpt, source}`，#71）——老師面板讀 D1（#73 輪詢），學生端不消費
- **歷史**：WS `watch` 首個 view（window 預設最新 50 則 entries）或 `entries` 指令；pi transcript（DO storage）為唯一真相

### 5.4 BTW side session（#121）

副視窗的「順帶一問」：學生暫離蘇格拉底，問定義、思想實驗的設定（例：電車難題）、背景事實。

- 實作為 pi 原生 fork：從 root 最新 entry fork 出新 conversation，agent 只選 `btw` extension（`prompts/btw.md`；無 websearch／judgment／avatar）。side session 看得到 fork 點之前的主對話，**它的 entries 只寫在 fork 裡**——不進 root 的 model context，也不進報告 transcript
- 副視窗**另開一條連線**到同一 thread，送 `{ type: "btw", id }`：server fork 後把該連線綁到 side session，立即推該 session 的 `view`，再回 `result: { session }`。之後該連線的 `watch`／`submit`／`abort`／`entries` 全部作用在 side session，frame 形狀與 root 相同
- 再接回（副視窗重整、換分頁）：`{ type: "btw", id, session }` 附掛既有 side session；`session` 必須是本 thread root 的 fork，否則 error code `UnknownSession`。綁定存在連線 state，hibernation 喚醒後保留
- 每次不帶 `session` 的 `btw` 都 fork 新的 side session（fork 點＝當下 root 最新 entry）；舊 side session 留在 DO storage
- 錯誤 code：`NothingToFork`（root 尚無 entry）、`UnknownSession`、`SubmitForbidden`（開新 side session 與 submit 同權限：限 thread 學生本人；老師可附掛觀察）
- 規則同 root：no queue（side session 與 root 各自 busy，互不阻擋）、活動結束後 submit → `ActivityFinished`、run 失敗的無 id `llm_unavailable` 廣播只送給綁在該 session 的連線

## 6. 老師即時面板（#73；本輪不實作，資料源已調查）

- `GET /api/activities/:id/live` → `StudentLive[]`——gate 到 #73：資料源為 Chat DO 的 pi transcript 聚合（`messages`/`violations` 表已隨 v3 退役，migration 003 drop；pi transcript 是唯一真相），實作前不佔端點
- `StudentLive`：`{id, name, status, rounds, flagged, flagReason?, lastUtterance}`

## 7. 活動結束與報告（#74/#78/#79/#72）

| Operation                                                           | 說明                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/activities/:id/finish` → `204`                           | 老師結束活動 → ReportRunner DO `startReport`（alarm 驅動，非同步）。冪等；老師專屬                                                                                                                                                                                                                                                                                                                                                |
| `GET /api/activities/:id/report` → `TeacherReport \| StudentReport` | 生成中 404 `report_pending`（前端輪詢至 200）；失敗 500 `report_failed`（重打 `finish` 可重觸發）；**partial**＝群體生成失敗（第一次失敗即落 partial；重試不存在於 alarm 迴圈）但個別報告已存——200 回應，`classReport: null`、`positions: []`（重打 `finish` 可重觸發全量；alarm 層的重試耗盡才是 `failed`）。**角色分流**：老師見全班＋個人；學生見自己（無 classReport）；學生的報告不存在（無 transcript 等）→ 404 `not_found` |

**報告形狀（#74，PR #109 的分析為核心；`pseudonym` 生成一次存 D1，活動內穩定；#72 全去識別化）**：

```ts
// LLM 分析輸出（shared/reports.ts）
interface StudentAnalysis {
  stated: true; claim: {text; turns}; reasons: {text; turns}; tension: {text; turns} | null;
} | {
  stated: false; doing: {text; turns};   // 未表態：做了什麼（離題/早退…）
}
interface ClassReport {
  students: {id; summary: {step; turns}[]}[];   // 逐生摘要（cause → result 步驟＋出處行號）；空陣列＝全班未表態
  unstated: string[];                            // 未表態者
  axes: {name; low; high; positions: {id; turns; view; end: "low"|"middle"|"high"; at: 0-100}[]; why}[];  // 立場軸＋落點；空陣列＝無分歧（overview 照實寫）
  overview: string[];                            // 全班整理
}

interface ReportPosition {                       // 單人落點：從 classReport.axes[].positions 以 pseudonym 對出（不經 LLM，與全班報告一致）
  axis: string; view: string; end: "low"|"middle"|"high"; at: number;
}

// API 回應（組合層）
interface TeacherReport {
  topicTitle: string;
  classReport: ClassReport | null;               // null＝partial（群體生成失敗，個別報告仍可用）
  students: Array<{                              // array 保序（joined_at）；10k 班級下回應體積上限由生成端併發與輪詢分頁另議
    studentId: string;                           // 真實 id——僅老師可見
    pseudonym: string;
    analysis: StudentAnalysis | null;            // 論點總結（claim/reasons/tension＋turns 出處）
    violations: ViolationSlice[];                 // 違規切片（不經 LLM）
    positions: ReportPosition[];                 // 每位學生自己的落點（partial 時為空）
  }>;
}
interface StudentReport {
  topicTitle: string;
  pseudonym: string;                             // 學生在 classReport 中的定位線索（老師版可對照）
  analysis: StudentAnalysis | null;              // 自己的
  violations: ViolationSlice[];
  positions: ReportPosition[];                   // 自己在每條軸上的落點
}
interface ViolationSlice {
  turn: number;                                  // transcript 行號＝「學生（n）」的 n（app.violation entry 抽取時計算）
  type: ViolationType;                          // shared VIOLATION_TYPES enum
  excerpt: string;
}
```

- **學生不拿 classReport**（設計決策）：學生報告只有自己的 analysis＋violations＋pseudonym；全班視角是老師專屬
- **`ClassReport.students[].id`／`positions[].id`＝pseudonym**（LLM prompt 餵的就是 pseudonym；嚴禁放 studentId——全班互見會洩漏真實 id，#72）
- transcript 來源：Chat DO RPC（`stub.transcript()`，DO→DO；外部無 request 面）；violations 同源自 `app.violation` entries——**pi transcript 是唯一真相，violations 不落第二份儲存**
- 逐生分析與 transcript 抓取以 Router budget 批次進行（`budget("batch")`＝鏈上各 leg maxConcurrency 總和；10k 班級的生成時間與供應端限流考量）
- hexagon（#78 六角圖）與星座圖（#79）不在本契約——前端圖表從 classReport 的 `at`/`end` 映射，屆時更新本節

## 8. 語音（#69）

| Operation                                          | 說明                                                                                                     |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `POST /api/stt`（multipart audio ≤15MB）→ `{text}` | 供無 Web Speech API 的瀏覽器（Firefox）；支援者前端自走原生                                              |
| `POST /api/tts` `{text, lang}` → audio stream      | server-side 為保證路徑；**無 char boundary**——嘴型驅動用 amplitude：`Api.tts(text, onAmplitude, signal)` |

## 9. 查詢與 teacher keys

| Operation                                                                         | 說明                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/lookup` `{term}` → `{term, markdown}`                                  | #76 獨立查詢功能（lookup profile：agent 自主 search/fetch）；**不落庫不計輪**。失敗 → mock（回應帶 `X-Socrates-Fallback: mock`）。termHistory 由前端 localStorage 持久化，無端點                                                                                                                           |
| `GET /api/settings/keys` → `{id, provider, model, last4, sortOrder, updatedAt}[]` | #82 teacher keys；**多把 key × 多個 model**，每一筆（entry）＝一條 teacher leg；依 `sortOrder` 排序；key 明文永不回傳                                                                                                                                                                                      |
| `POST /api/settings/keys` `{provider, model, key?, fromEntry?}` → `201` entry     | `key` 與 `fromEntry` 恰給一個：`fromEntry`＝沿用自己某筆 entry 的 key（須同 provider，否則 422 `byok_provider_invalid`；不存在 → 404）。新 entry 排在最後；每帳號上限 20 筆（超過 → 409 `conflict`）；provider＝任意 pi builtin（api-key 類），model 不在該 provider catalog → 422 `byok_provider_invalid` |
| `PATCH /api/settings/keys/:id` `{model?, key?}` → entry                           | 至少一個欄位；換 key 或換 model；非本人 entry → 404 `not_found`                                                                                                                                                                                                                                            |
| `DELETE /api/settings/keys/:id` → `204`；非本人或不存在 → `404 not_found`         |                                                                                                                                                                                                                                                                                                            |
| `PUT /api/settings/keys/order` `{ids: string[]}` → `{ids}`                        | 拖曳排序結果；陣列順序＝gateway 的 teacher legs 鏈序（#98）。重複或非本人 id → 422 `validation`；未列出的 entry 依原順序接在後面                                                                                                                                                                           |
| `GET /api/settings/keys/providers` → `{id, name}[]`                               | 可選 provider 清單（pi builtin catalog，api-key 類）                                                                                                                                                                                                                                                       |
| `GET /api/settings/keys/providers/:provider/models` → `{id, name}[]`              | 該 provider 的 model catalog（設定頁選單）                                                                                                                                                                                                                                                                 |

- **學生無 BYOK 入口**（#82 定案）
- **teacher keys 服務語意**（2026-11-09 定案）：老師 keys 的教室流量**老師鏈在前、平台鏈墊後**；teacher leg 的 provider/model 資料責任由 ToS 移轉給教師（平台僅保證平台鏈 ZDR）；ledger 以 `teacher:<userId>` credential 獨立記帳；within-turn fallback 僅存在於平台 binding 鏈（pi 機制限制），跨輪失敗由 ledger cooldown 接手

## 10. 錯誤碼

`code` 為 shared 的 `ErrorCode` literal union＋`ApiError`（帶型別 `code`），呼叫端 switch 窮舉有編譯期檢查。

| 層                     | code                                                                                                                                                                                                                                                                                                                                                          | HTTP                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 通用                   | `unauthorized` / `forbidden` / `not_found` / `conflict` / `validation` / `rate_limited` / `internal_error`                                                                                                                                                                                                                                                    | 401/403/404/409/422/429/500 |
| 入場                   | `join_code_invalid` / `tos_required` / `name_taken` / `only_student` / `activity_finished`（新成員加入已結束活動）                                                                                                                                                                                                                                            | 404/422/409/403/409         |
| 對話（WS error frame） | pi 錯誤名作 code（`ConversationBusy`＝忙線拒寫、`ActivityFinished`＝活動已結束拒寫、`SubmitForbidden`＝非本人 thread 代打）；內部錯誤只回 generic 訊息不洩細節                                                                                                                                                                                                | —                           |
| 報告                   | `report_pending` / `report_failed`                                                                                                                                                                                                                                                                                                                            | 404 / 500                   |
| 語音／LLM              | `llm_unavailable`（binding 或上游失敗；mock 降級不丟這個碼）；`llm_rate_limited` / `llm_timeout` 未接線（保留碼，上游限流／逾時目前也回 `llm_unavailable`）                                                                                                                                                                                                   | 502（未接線碼保留）         |
| 對話入場               | `already_streaming`（歷史碼，保留給舊客戶端 switch 窮舉）                                                                                                                                                                                                                                                                                                     | 409                         |
| BYOK / teacher keys    | `byok_provider_invalid`                                                                                                                                                                                                                                                                                                                                       | 422                         |
| 帳號                   | `account_required`（guest 呼叫需帳號的端點）；`teacher_required`（未開教師模式開課）；`teacher_terms_required`（首次開啟教師模式未同意條款）；`trial_limit`（試用上限，vars `classrooms`／`members`）；`student_restricted`（學生帳號越界）；`guest_session_expired`（訪客活動已結束）；`oauth_unavailable` / `oauth_failed`（僅出現在 `/login?error=` 導回） | 403 / 422 / 401 / 302       |

## 11. 端點外的既存通道

- `GET /health` → `{ok: true}`（無需 session；deploy 後煙霧測試用）
- `POST /api/dev/seed`（`LLM_PROVIDER=mock` 或已設 `DGX_BASE_URL` 時生效；需 `SEED_TOKEN`）——demo 資料播種，非產品功能；非 mock 模式且首次建立 demo 老師時，密碼隨機產生並隨回應回傳（重播 seed 不回傳）

## 12. 範圍外（明確不在 v1 契約）

- `/admin` 運維 dashboard（P1，#80/#81/#97）
- 單人模式的個人對話 scope（前端未實作，屆時拍板）
- 跨裝置 termHistory（P1）
- `PATCH /me` 改名／頭像（P1 若有需求）
- teacher key 設定頁 UI（#82 前端；後端 API 已就緒）

# API 契約

> 日期：2026-11-06 ｜ 分支：`experiment/web-next` ｜ 狀態：定案
> 型別單一真相：`packages/shared`（zod schema + TypeScript）；本文件描述形狀，shared 是可編譯的同一份。
> 2026-11-06 重構變更：對話通道 SSE → WebSocket（R7，`docs/pi.md`）；報告形狀改 agent 分析（#74，PR #109）；新增 teacher keys（#82）；lookup 為獨立功能（#76）。

## 1. 慣例

| 項目     | 規範                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 部署     | 單一 Worker：static assets + `/api/*`（Hono）+ `/agents/*`（WebSocket），同源無 CORS                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Auth     | httpOnly cookie `socrates_session`（`SameSite=Lax`＋prod 恆 `Secure`）；前端 `credentials: "include"`；**任何 key 永不進前端**。30 天 HMAC token 只帶 `uid`／`ver`／`exp`（#131）：**授權真相在 DB**，每個帶 session 的請求讀一次 `users`（`is_admin`、`disabled_at`、`session_version`）——注銷**立刻生效**，不必等 30 天；`ver` 與 `session_version` 不符（注銷／復用後）視同未登入。活動參與另有獨立 cookie `socrates_participant`（`HttpOnly`、`SameSite=Lax`、7 天；#133）：簽章只帶 `aid`／`pid`／`exp`，**與 `socrates_session` 並存且互不覆寫** |
| 語言     | `Accept-Language` → `Lang`（`zh-*→"zh"`、`en→"en"`、`es→"es"`）——錯誤訊息依此三語                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| JSON     | camelCase；id 為字串；時間 ISO 8601                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 錯誤     | `{ "message": string, "code": string }`；`code` 為 shared 的 `ErrorCode` literal union（§10），`message` 已本地化                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 輸入邊界 | zod 強制：`name` ≤80、對話 `text` ≤2000、TTS `text` ≤4000（`TTS_MAX_CHARS`）、`term` 1–30、`direction` ≤200、STT 音檔 ≤15MB（位元組上限，非時長）；超界 `422 validation`                                                                                                                                                                                                                                                                                                                                                                               |
| 授權     | 預設 deny——見 §1.1；未列者一律需登入且屬教室成員                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 限流     | 現行 per-IP stopgaps（isolate-local sliding window，跨 isolate 不保證、eviction 即重置）：login/register 30、join-code 60、join 30、invite-preview 60、invite-join 30、lookup 20、topics-generate 10、stt 20、tts 30、activity-finish 6；集中式 per-user 限流為 #103 待辦，非現行行為                                                                                                                                                                                                                                                                  |
| 冪等     | 自然鍵冪等：重複 `POST /api/join`（同身分）＝200 冪等、`finish` 重試安全、`PUT settings/*` 天然冪等                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 版本     | `/api` 無版本前綴（單一消費者）；外部消費者出現時才評版本化＋OpenAPI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 型別共享 | `RpcApp = ReturnType<typeof createApp>`＋`RpcApi = ReturnType<typeof createApi>`（`apps/server/src/app.ts`）；web 端消費 declaration 產物 `hc<RpcApi>("/api")`（R6）                                                                                                                                                                                                                                                                                                                                                                                   |

### 1.1 授權矩陣

> 「訪客」＝沒有帳號的活動參與者：持 `socrates_participant` cookie，**不建 `users` 列**，只存在於那一個活動（#133）。
> 「老師」不是帳號屬性，而是班級的擁有關係（無 mode 定稿，#210、[`accounts.md`](./accounts.md) §7）：伺服器不記錄任何 mode/capability——**任何登入 user 皆可建班與開活動**，建班即成為該班 teacher（`classrooms.teacher_id`）；同一帳號可以同時是 A 班老師、B 班學生。`isAdmin` 只解鎖 `/admin/*`（seed 建立，API 不可授予）。
> 自行註冊（`POST /auth/signup`）與 Google OAuth（#124）建立的獨立帳號：未加入任何教室前權利同「已登入」欄（無班級關係，多數班級操作本就需成員或 owner）。

| Operation                                                                                               | 訪客                      | 已登入                                                   |
| ------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------- |
| `GET /join/:code`、`POST /join`、`POST /auth/login`、`POST /auth/register`                              | ✅                        | ✅                                                       |
| `POST /auth/signup`、`GET /auth/oauth/:provider/start`、`GET /auth/oauth/:provider/callback`（#124）    | ✅                        | ✅                                                       |
| `GET /invites/:token`、`POST /invites/:token/join`（活動邀請連結，#133）                                | ✅                        | ✅（只加入活動，不入名冊）                               |
| `GET /me`、`logout`、`stt`、`tts`、`lookup`                                                             | —                         | ✅                                                       |
| `GET /topics`、`POST /topics`、`topics/generate`、`POST /classrooms`、`POST /classrooms/:id/activities` | —                         | ✅（無 mode，#210）                                      |
| `GET /classrooms/:id/topics`（#135）                                                                    | —                         | 需該班成員                                               |
| `POST /classrooms/:id/topics`、`POST /topics/:id/copy`（#135）                                          | —                         | 需目標班 owner                                           |
| `POST /activities/:id/invites`（#133）                                                                  | —                         | 需該班 owner                                             |
| `GET/PUT/DELETE /settings/keys/:provider`、`PUT /settings/keys/order`（#82 teacher keys）               | —                         | ✅（per-user BYOK，#210）                                |
| `GET /admin/users`、`POST /admin/users`、`PATCH /admin/users/:id`                                       | —                         | ❌ 401／403 `forbidden`                                  |
| `GET /activities/:id`                                                                                   | 需本人 participant cookie | 需教室成員                                               |
| `GET /activities/:id/report`                                                                            | —                         | 需教室成員                                               |
| `GET/POST /activities/:id/slots`（#134）                                                                | —                         | 需該班 owner                                             |
| **WS** `/agents/chat/:name`（watch/entries/abort）                                                      | 僅本人 participant thread | 本人 participant thread，或該班 owner 可觀察自己帶的班級 |
| **WS** `submit` op                                                                                      | 僅本人 participant thread | 僅本人 participant thread                                |
| **WS** `btw` op（開新 side session）／`btw {session}`（附掛既有）                                       | 僅本人 participant thread | 僅本人 participant thread                                |
| `POST /activities/:id/finish`                                                                           | —                         | 需教室成員（owner）                                      |

- **test 活動（#134）只對該班 owner 存在**：`GET /activities/:id`、`/report`、`/slots`、WS 一律 403／close 1008 給其他任何身分（含班級成員與訪客）；`POST /activities/:id/invites` 對 test 活動回 409 `conflict`
- test 活動的 `kind = 'teacher'` slot 由老師本人持有（`user_id` = 老師），所以同一帳號在這些 thread 上可以 `submit`（`live` 活動的老師仍無 participant，仍 `SubmitForbidden`）

## 2. 身分（雙軌：訪客即玩＋帳號選用，#67）

```ts
interface User {
  id: string;
  name: string;
  isAdmin: boolean; // 帳號層：/admin/users（僅 seed 建立，API 不可授予）；無 mode/capability 欄位（#210）
}
```

- `users.role` 欄位已隨 migration 010 移除（無 mode 定稿，#210）：帳號表不再攜帶任何角色字樣——關係層的 `classroomAccess`／`members` 承載師生關係，帳號層只有 `user`（＋管理用 `isAdmin`）
- 未登入者**不再建立 `users` 列**：班級碼（`POST /join`）與活動邀請（`POST /invites/:token/join`）的匿名加入都取得 `socrates_participant` cookie 與 `kind = 'guest'` participant（#133）；訪客紀錄認領合併已裁 NOT_PLANNED（#60——帳號設計重新討論；無帳號訪客與任何新帳號之間不做紀錄連結，模型見 [`accounts.md`](./accounts.md)）
- `GET /me` → `User | null`；停用或 `session_version` 過期的 cookie 回 `null`（視同未登入），其他端點則分別回 403 `account_disabled`／401 `unauthorized`

### 2.1 活動層身分（`activity_participants`，#132）

「誰參加了哪個活動」是獨立的表，不是班級名冊：

| 欄位              | 意義                                                                                                                                                         |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `activity_id`     | 所屬活動；PK 為 (`activity_id`, `id`)，participant id 只在活動內唯一                                                                                         |
| `id`              | participant id——**WS thread 與報告的鍵**；新 participant 為 `p_…`，003 backfill 的既有成員等於其 `user_id`（既有 Chat DO thread 與既有報告的鍵因此原樣續用） |
| `user_id`         | nullable：訪客為 `null`（#133）；`ON DELETE SET NULL`——帳號刪除不帶走 participant，報告不斷鏈                                                                |
| `kind`            | `member`（班級成員進入活動）、`guest`（#133）、`teacher`（#134 測試模式 slot，`user_id` = 該班老師）                                                         |
| `display_name`    | 活動內顯示名；UNIQUE(`activity_id`, `display_name`)                                                                                                          |
| `tos_accepted_at` | 同意存證（nullable）                                                                                                                                         |
| `joined_at`       | 進入活動時間；`member` 的 participant 由 `POST /join`／註冊或 `GET /activities/:id` 建立，`guest` 由 `POST /join` 或活動邀請加入（皆僅活動進行中）           |

- **報告母體是 participant，不是 `members`**：沒進活動的班級成員不出現在報告，非成員的參與者（訪客、老師）會出現
- `members` 仍是班級名冊（決定「能不能進入這個班級的活動」）；兩者不可互相取代
- participant 只描述「活動期間的存在」，活動關閉後不再新增；`kind` 的 `guest`／`teacher` 分別由 #133、#134 生產；邀請連結加入的 `guest`（已綁 `user_id`）在帳號入班後由 `ensureParticipant` 升級為 `member`
- `GET /activities/:id` 對已登入的教室成員帶**寫入副作用**：冪等建立 participant（auto-join）
- **成員 display_name 優先**（UNIQUE(`activity_id`, `display_name`) 撞名時）：被 account-less 訪客搶佔的名字——訪客列改名為 `原名（訪客）`（再撞則 `（訪客 2）`…），成員取名原 名；與其他已綁帳號的 participant 撞名——新參與者改用後綴 `原名 2`、`原名 3`…，既色列不動
- 同一帳號在**同一個活動**可以有多個 participant（#134 的 1–6 個 `teacher` slot）：`activity_participants` 的 PK 是 (`activity_id`, `id`)，不是 (`activity_id`, `user_id`)；`ensureParticipant` 的「一人一個」只約束 `member`／`guest` 的入場路徑

### 2.1 自行註冊與第三方登入（#124）

| Endpoint                                                                | 說明                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/signup` `{email, password, name, tosAccepted}` → `User` | 不需邀請碼；建獨立帳號（無能力，未屬任何教室）並發 session。email 已被 email 帳號使用 → 409 `email_taken`；`tosAccepted` 非 true → 422 `tos_required`；限流與 register 共用                                                                         |
| `GET /api/auth/oauth/:provider/start`（目前 `provider` 僅 `google`）    | 302 至 provider 授權頁；state＋nonce＋PKCE（S256）封入 10 分鐘 httpOnly cookie `socrates_oauth`（HMAC 簽章，path `/api/auth/oauth`）。未設定 `GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET` → 302 `/login?error=oauth_unavailable`；未知 provider → 404 |
| `GET /api/auth/oauth/:provider/callback?code&state`                     | 驗 state cookie → code＋PKCE verifier 換 ID token → 驗簽章（JWKS）／`iss`／`aud`／`exp`／`nonce`／`email_verified` → 以 `(provider, sub)` 找或建獨立帳號 → 發 session → 302 `/home`。失敗一律 302 `/login?error=<code>`，不發 session               |

- 一個帳號對應一種登入方式；同一個 email 經 email 註冊與 Google 登入是**兩個帳號**（第三方登入不以 email 認身分）
- Google 帳號的 email 存於 `user_identities.email`，`users.email` 為 NULL（`users.email` 只承載 email 密碼登入）
- callback redirect URI＝`PUBLIC_BASE_URL`（未設則用請求 origin）＋`/api/auth/oauth/google/callback`，需登錄於 Google Cloud Console

## 3. 入場（唯一閘門，#66/#70）

| Operation                                                                                 | 說明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/join/:code` → `{code, classroomName, topic}`                                    | 直達 URL 載入用（刷新不丟）；無效碼 404 `join_code_invalid`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `POST /api/join` `{code, name?, tosAccepted}` → `{user, activityId, participantId, kind}` | 一次完成：身分＋ToS 同意存證＋加入教室＋建立活動 participant（§2.1）。**已登入**：加入 `members`（名冊）並取得 `kind = 'member'` participant，`user` 為本人、`kind = 'member'`；**未登入**：建 `kind = 'guest'` participant（`user_id = null`）並發 `socrates_participant` cookie，`user = null`，**不建 `users`／`members` 列**（#133）。**冪等**：同身分重 join → 200（活動結束後仍可 rejoin，供 session 修復與報告回看；已結束的活動不再新增 participant，`participantId` 為 `null`）。錯誤：`tosAccepted` 非 true → 422 `tos_required`；`name` 活動內唯一（409 `name_taken`）；活動已結束 → 409 `activity_finished`（僅攔新加入者）。**任何已登入身分都可加入**（任何帳號可同時在另一班當學生） |
| `GET /api/activities/:id` → `ActivityInfo`                                                | `{id, classroomId, classroomName, participantId, mode, topic, finishedAt}`。`participantId` 是**呼叫者在該活動的 participant**（WS thread 名的一半）；班級成員在活動進行中呼叫會取得（必要時建立）自己的 participant，活動已結束或呼叫者是該班老師（非參與者）則為 `null`。持 `socrates_participant` cookie 的訪客亦可讀（只回自己的 participant）；既非成員也無 participant cookie → 401／403。`mode` 為 `live`／`test`（#134）；test 活動只有該班 owner 可讀，而且老師可用 `?participantId=` 指定自己的 slot（非自己的 slot → 403）                                                                                                                                                               |

### 3.1 活動邀請連結（#133）

邀請連結**在活動關閉前持續有效**：不是一次性兌換、不設使用次數上限；已登入者開連結只加入活動，不進班級名冊。

| Operation                                                               | 說明                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/activities/:id/invites` → `ActivityInvite`                   | 該班 owner 專屬。每個活動**只有一條有效邀請**：已有未撤回、未過期的 invite 就回同一條，否則以高熵 token（32 hex，128 bits）新建 → `{token, activityId, url, createdAt, expiresAt}`；`url` 為 `PUBLIC_BASE_URL/join/a/{token}`。活動已結束 → 409 `activity_finished`                                                                                                                                                                                                    |
| `GET /api/invites/:token` → `InviteInfo`                                | `{token, activityId, classroomName, topic, finishedAt}`；活動已結束仍回 200（前端顯示「活動已結束」）。無效 token 404 `invite_invalid`、已撤回 410 `invite_revoked`、已過期 410 `invite_expired`                                                                                                                                                                                                                                                                       |
| `POST /api/invites/:token/join` `{name?, tosAccepted}` → `InviteJoined` | `{activityId, participantId, displayName, kind}`；發獨立 `socrates_participant` cookie（不覆寫 `socrates_session`）。**已登入**：是班級成員 → `kind = 'member'`，不是成員 → `kind = 'guest'`（`user_id` 記帳號；認領已裁 NOT_PLANNED #60，僅作身分記錄）；**未登入**：需 `name`（422 `validation`），建 `kind = 'guest'` participant。同一 participant cookie 重打 → 冪等回同一 participant。`name` 活動內唯一（409 `name_taken`）、活動已結束 409 `activity_finished` |

## 4. 老師：議題集與開課（#77、#135）

`Topic` 形狀：`{id, classroomId, title, statement, summary?, prompts}`——`classroomId` 為 `null` 表示系統題或個人題（#135）。

| Operation                                                                                                      | 說明                                                                                                                                                                                                                                                               |
| -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/classrooms/:id/topics` → `Topic[]`                                                                   | 該班議題集（只含 `classroom_id = :id`）。班級成員可讀、非成員 403；不含系統題                                                                                                                                                                                      |
| `POST /api/classrooms/:id/topics` `{title, statement, summary?, prompts}` → `Topic`（201）                     | 該班 owner 專屬；寫入 `topics.classroom_id`                                                                                                                                                                                                                        |
| `POST /api/topics/:id/copy` `{classroomId}` → `Topic`（201）                                                   | snapshot 成新 id 並歸入目標班級，`topics.copied_from` 記來源。來源須為系統題、自己的個人題，或自己帶的班級議題（其他 → 404）；目標班級需 owner（403）。改任一邊不影響另一邊                                                                                        |
| `GET /api/topics` → `Topic[]`                                                                                  | 系統題（`classroom_id IS NULL AND owner_id IS NULL`）＋自己的個人題；**不含任何班級的議題集**                                                                                                                                                                      |
| `POST /api/topics` `{title, statement, prompts}` → `Topic`（201）                                              | 手動出個人題（`classroom_id = NULL`）；legacy 入口，班級議題請走 `POST /classrooms/:id/topics`                                                                                                                                                                     |
| `POST /api/topics/generate` `{direction}` → `TopicDraft[]`                                                     | agent 生成（topic-gen profile，#77/#113）；候選未落庫（無 `classroomId`），要投放得再呼叫 `POST /classrooms/:id/topics`。失敗 → mock（不擋，回應帶 X-Socrates-Fallback: mock）                                                                                     |
| `POST /api/classrooms` `{name}` → `{classroomId, code, url}`（201）                                            | **只建班級，不建活動**——空班級（無議題、無活動）是合法狀態；`url` 為 `PUBLIC_BASE_URL/join/:code`                                                                                                                                                                  |
| `POST /api/classrooms/:id/activities` `{topicId, mode?}` → `{classroomId, code, url, activityId, mode}`（201） | 開活動（同 code、新 activityId）。`topicId` 須為該班議題集或系統題（另一班的議題 → 404）。`mode` 預設 `live`；`live` 會把 `classrooms.current_activity_id` 指向新活動，`test` **不會**（學生任何入口都不會看到，見 §6）                                            |
| `GET /api/classrooms` → `ClassroomSummary[]`（登入者）                                                         | **owned ∪ joined**：自己開的教室與已加入的教室，同一帳號可兩者兼具。`role` 是該教室的關係（owner＝`teacher`，否則 `student`）；`code/url` 只回給 owner；`current` 可為 `null`（空班級），否則嵌入當前活動（topic＋finished）。教室單筆不另設端點——前端以本列表過濾 |

**`current` 語意（#135）**：`classrooms.current_activity_id` 是「最近一次 `mode = 'live'` 的活動」指標——`test` 永不寫入，所以一班最多一個 `current`；開新 `live` 活動即取代指標（舊活動留在 `activities` 歷史）。活動結束**不清除**指標，`current.finished` 區分進行中／已結束（結業報告入口與 `POST /join` 的 `activity_finished` 判定都靠它）。空班級的 `current` 為 `null`，其邀請碼在開活動前一律 404 `join_code_invalid`（§3）。

## 5. 對話（WebSocket，核心；R7）

### 5.1 通道

- `GET /agents/chat/:name`（WebSocket 升級）——**對話唯一通道**（先前的 SSE 端點已退役）
- thread name 協定：`{activityId}:{participantId}`（**一人一 thread 已不再是規則**——同一帳號在同一活動可以有多個 participant，#132／#134；DO name 即路由鍵）
- 授權：升級請求帶 cookie，`socrates_session` 與 `socrates_participant` **兩顆都接受**（#133）。onConnect 先驗 session＋班級關係，再驗 participant cookie（簽章 `aid`／`pid` 必須等於 thread 名）；**`submit` 的擁有者規則是「該 participant slot 屬於這條連線」**：participant 帶 `user_id` 時必須等於 session 的 uid，`user_id = null` 的訪客則靠 participant cookie 證明持有（`ChatSockets` 每次 submit 重讀 participant；老師在自己班代打 → error frame code `SubmitForbidden`），班級 owner 可觀察全班（watch/entries/abort）；未通過 → close 1008（無 hello）；hibernation 喚醒後 reverify 確定撤權（ApiError）→ close 1008；reverify 暫時性錯誤（D1 失敗等）或 watch 遺失（session 驅逐）→ close 1011（客戶端重連即重試）
- 每則 client message 先做一次**身分重驗**：帳號 session 看 `disabled_at`／`session_version`（#131），訪客看 participant 是否仍存在（#133）——不符 → close 1008（停用與撤銷即刻生效，含已建立連線）
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

## 6. 老師即時面板（#73）與測試模式 slot（#134）

### 6.1 test 活動與 slot（#134）

老師可以用測試模式自己跑完整對話，不需要學生在場。`activities.mode = 'test'` 的活動**不寫** `classrooms.current_activity_id`，所以班級邀請碼、`GET /classrooms` 的 `current`、首頁均看不到它；同時 `activityAccess` 在 test 活動對非該班 owner 一律 403，報告頁、WS 亦同。

| Operation                                                                | 說明                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/activities/:id/slots` → `ActivitySlots`                        | 老師專屬（該班 owner）。僅 `mode = 'test'`（否則 409 `conflict`）→ `{activityId, mode, maxSlots: 6, slots}`；每個 slot 為 `{id, name, rounds, lastUtterance}`（`id` = participant id，rounds 由 Chat DO 的 pi transcript 即時彙總）                             |
| `POST /api/activities/:id/slots` `{count: 1–6}` → `ActivitySlots`（201） | 建立 `kind = 'teacher'`、`user_id` = 老師的 participant slot；名稱由伺服器依 `Accept-Language` 產生（`測試 1`／`Test 1`／`Prueba 1`）。總數上限 6（`ACTIVITY_SLOT_MAX`；超出 → 409 `conflict`）；活動已結束 → 409 `activity_finished`。slot 不新增 `members` 列 |

- 每個 slot 是一條獨立的 Chat DO thread（`{activityId}:{participantId}`），同一老師帳號可同時在 1–6 條 thread 上 `submit`（slot 的 `user_id` 就是老師）；這也取代了「單人模式」（#136 已定）
- `finish` 照常觸發 ReportRunner，報告母體就是這些 slot（§7）；`GET /activities/:id?participantId=` 讓老師取得 slot 的 thread 名（見 §3）

### 6.2 即時面板（#73，未實作）

- `GET /api/activities/:id/live` → `StudentLive[]`——gate 到 #73：資料源為 Chat DO 的 pi transcript 聚合（`messages`/`violations` 表已隨 v3 退役，migration 003 drop；pi transcript 是唯一真相），實作前不佔端點
- `StudentLive`：`{id, name, status, rounds, flagged, flagReason?, lastUtterance}`——`id` 屆時為 participant id（#132 後 thread 鍵的後半段）；現行 `/t/live/:id` 對 `live` 活動仍顯示待上線提示，對 `test` 活動則渲染 slot 列表

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
  students: Array<{                              // array 保序（joined_at）；只列真的有對話的參與者
    participantId: string;                       // 活動 participant id——僅老師可見（真實身分在 members／users）
    participantName: string;                     // 參與者名稱（老師個別頁與學生本人頁顯示；classReport 仍用 pseudonym）
    pseudonym: string;
    analysis: StudentAnalysis | null;            // 論點總結（claim/reasons/tension＋turns 出處）
    violations: ViolationSlice[];                 // 違規切片（不經 LLM）
    positions: ReportPosition[];                 // 每位學生自己的落點（partial 時為空）
  }>;
}
interface StudentReport {
  topicTitle: string;
  participantName: string;                       // 本人名稱（學生看不到別人的）
  pseudonym: string;                             // 自己在 classReport 中的定位線索（老師版可對照）
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
- **報告母體＝有對話的 `activity_participants`**（#132）：沒進活動的班級成員、進了活動但**一句都沒說**的參與者都不產生空報告——本人報告頁 404 `not_found`，classReport 的 roster 也只含真的有對話的人；test 活動（#134）的母體就是它的 `teacher` slot；`student_reports` 的 JSON key 與 WS thread 名的後半段同為 participant id；pseudonym 序號**不依加入順序**（#133）：以 `HMAC(AUTH_SECRET, (activityId, participantId))` 排序後給 1..n，避免老師用報到時序反推訪客身分（既有 pseudonym 存 D1，活動內穩定不變）
- **`ClassReport.students[].id`／`positions[].id`＝pseudonym**（LLM prompt 餵的就是 pseudonym；嚴禁放 participantId 或 userId——全班互見會洩漏真實 id，#72）
- transcript 來源：Chat DO RPC（`stub.transcript()`，DO→DO；外部無 request 面）；violations 同源自 `app.violation` entries——**pi transcript 是唯一真相，violations 不落第二份儲存**
- 逐生分析與 transcript 抓取以 Router budget 批次進行（`budget("batch")`＝鏈上各 leg maxConcurrency 總和；10k 班級的生成時間與供應端限流考量）
- 立場星圖（#79）不新增契約欄位：前端直接從 `classReport.axes[].positions` 映射——座標＝`at`（0–100 線性對到軸的兩端），每條軸一個維度，學生沒談到的軸沒有 position（前端放在該軸中間、標為空心、不納入分群）。分群在前端做（階層式 Ward，#58），不落儲存
- hexagon（#78 六角圖）不在本契約——`StudentAnalysis` 沒有可量化的欄位，待思辨力目標定義後更新本節

## 8. 語音（#69）

| Operation                                          | 說明                                                                                                                                                                                  |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/stt`（multipart audio ≤15MB）→ `{text}` | 供無 Web Speech API 的瀏覽器（Firefox）；支援者前端自走原生                                                                                                                           |
| `POST /api/tts` `{text, lang}` → audio stream      | server-side 為保證路徑；`text` ≤ `TTS_MAX_CHARS = 4000`（shared `TtsInputSchema`，客戶端 `lib/speech.ts` 同步在句尾截斷）——嘴型驅動用 amplitude：`Api.tts(text, onAmplitude, signal)` |

## 9. 查詢與 teacher keys

| Operation                                                                                                                                                                        | 說明                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/lookup` `{term}` → `{term, markdown}`                                                                                                                                 | #76 獨立查詢功能（lookup profile：agent 自主 search/fetch）；**不落庫不計輪**。失敗 → mock（回應帶 `X-Socrates-Fallback: mock`）。termHistory 由前端 localStorage 持久化，無端點                                                                                                                                                                                                                         |
| `GET /api/settings/keys` → `{provider, last4, maxConcurrency, monthlyQuotaUsd, monthCostUsd, monthTokens, sortOrder, updatedAt, models: {model, maxConcurrency, sortOrder}[]}[]` | #152 teacher keys；**一 provider 一把 key（帳戶級）＋多個 model 腳位**；key 明文永不回傳；provider 層 `maxConcurrency`＝該 provider 全部腳位的總併發上限（`null`＝不限）；`models[].maxConcurrency: null`＝跟隨 `teacherChain.maxConcurrency`；`monthlyQuotaUsd`＝額度警示分母（`null`＝無額度）；`monthCostUsd`/`monthTokens`＝本月累計（UTC 月曆，見 [`providers.md`](./providers.md) § Teacher keys） |
| `PUT /api/settings/keys/:provider` `{key?, maxConcurrency?, monthlyQuotaUsd?}` → `{provider, last4?, maxConcurrency, monthlyQuotaUsd}`                                           | 帶 `key`＝冪等 upsert（省略 `maxConcurrency`/`monthlyQuotaUsd`＝保留原值）；**僅帶 `maxConcurrency` 或 `monthlyQuotaUsd`**＝免重貼 key 只改該欄（`maxConcurrency` 1–100、`monthlyQuotaUsd` 正數 USD、`null`＝不限／無額度；無該 key row → `404 not_found`）。provider＝任意 pi builtin（api-key 類），非法 → 422 `byok_provider_invalid`                                                                 |
| `PUT /api/settings/keys/:provider/models` `{model, maxConcurrency?}` → `{provider, model, maxConcurrency}`                                                                       | 新增／更新 model 腳位（免重貼 key）；body 省略 `maxConcurrency`＝保留現值（新腳位 → `null`），明列 `null`＝跟隨預設；`maxConcurrency` 範圍 1–100；model 不在 catalog → 422 `byok_provider_invalid`；尚未貼 key 就加腳位 → 422 `validation`                                                                                                                                                               |
| `DELETE /api/settings/keys/:provider/models/:model` → `204`；無該腳位 → `404 not_found`                                                                                          | model id 需 URL-encode（含 `/`）                                                                                                                                                                                                                                                                                                                                                                         |
| `PUT /api/settings/keys/:provider/models/order` `{models: string[]}` → `{models}`                                                                                                | 同 provider 內腳位排序；未列出的排後面                                                                                                                                                                                                                                                                                                                                                                   |
| `DELETE /api/settings/keys/:provider` → `204`；無該 key → `404 not_found`                                                                                                        | FK cascade 同步移除其 model 腳位                                                                                                                                                                                                                                                                                                                                                                         |
| `PUT /api/settings/keys/order` `{providers: string[]}` → `{providers}`                                                                                                           | provider 排序；teacher legs 鏈序＝provider `sort_order` → 同 provider 內 model `sort_order`（#98/#152）；排序寫入同步更新 `updated_at`                                                                                                                                                                                                                                                                   |
| `GET /api/settings/keys/providers` → `{id, name}[]`                                                                                                                              | 可選 provider 清單（pi builtin catalog，api-key 類）                                                                                                                                                                                                                                                                                                                                                     |
| `GET /api/settings/keys/providers/:provider/models` → `{id, name}[]`                                                                                                             | 該 provider 的 model catalog（設定頁選單）                                                                                                                                                                                                                                                                                                                                                               |

- **學生無 BYOK 入口**（#82 定案）
- **teacher keys 服務語意**（2026-11-09 定案）：老師 keys 的教室流量**老師鏈在前、平台鏈墊後**；teacher leg 的 provider/model 資料責任由 ToS 移轉給教師（平台僅保證平台鏈 ZDR）；ledger 以 `teacher:<userId>` credential 獨立記帳；within-turn fallback 僅存在於平台 binding 鏈（pi 機制限制），跨輪失敗由 ledger cooldown 接手

## 9.1 管理員：帳號與能力（#131）

僅 `is_admin` 可呼叫；`is_admin` 只能由 seed 建立（首位 admin 在 `apps/server/src/seed.ts`），API 不可授予（PATCH 不支援 `isAdmin`，帶了會 422 `validation`）。

| Operation                                                              | 說明                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/users` → `AdminUser[]`                                 | 全帳號：`{id, name, email, isAdmin, disabled, createdAt}`；排序 admin → 建立時間（#210：無能力欄位）                                                                                                  |
| `POST /api/admin/users` `{name, email, password}` → `AdminUser`（201） | 建立帳號（帳號無預設，登入即可建班）；email 重複 → 409 `conflict`；密碼 8–128（PBKDF2 同登入）                                                                                                        |
| `PATCH /api/admin/users/:id` `{disabled}` → `AdminUser`                | 停用／復用。一律 bump `session_version`（停用即刻踢掉既有 REST session 與 WS；復用後舊 token 不復活，需重新登入）。停用自己 → 409 `conflict`。（#210：能力調整已退役，`canManageClasses` 不再是欄位） |

- 停用帳號的 WS：連線上的下一則 frame 被 1008 關閉，重連亦被拒（§5.1）
- 對應頁面 `/admin/users`（`apps/web/src/routes/admin.users.tsx`）：列表、切換能力、停用／復用、建立帳號

## 10. 錯誤碼

`code` 為 shared 的 `ErrorCode` literal union＋`ApiError`（帶型別 `code`），呼叫端 switch 窮舉有編譯期檢查。

| 層                     | code                                                                                                                                                           | HTTP                        |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| 通用                   | `unauthorized` / `forbidden` / `not_found` / `conflict` / `validation` / `rate_limited` / `internal_error`                                                     | 401/403/404/409/422/429/500 |
| 入場                   | `join_code_invalid` / `tos_required` / `name_taken` / `activity_finished`（新成員加入已結束活動）                                                              | 404/422/409/409             |
| 活動邀請（#133）       | `invite_invalid` / `invite_revoked` / `invite_expired`                                                                                                         | 404/410/410                 |
| 帳號                   | `account_disabled`（停用帳號的請求／登入）                                                                                                                     | 403                         |
| 對話（WS error frame） | pi 錯誤名作 code（`ConversationBusy`＝忙線拒寫、`ActivityFinished`＝活動已結束拒寫、`SubmitForbidden`＝非本人 thread 代打）；內部錯誤只回 generic 訊息不洩細節 | —                           |
| 報告                   | `report_pending` / `report_failed`                                                                                                                             | 404 / 500                   |
| 語音／LLM              | `llm_unavailable`（binding 或上游失敗；mock 降級不丟這個碼）。上游限流／逾時**不另設碼**（拍板理由見 [`providers.md`](./providers.md) §上游失敗碼）            | 502                         |
| BYOK / teacher keys    | `byok_provider_invalid`                                                                                                                                        | 422                         |
| 第三方登入（#124）     | `oauth_unavailable` / `oauth_state_invalid` / `oauth_email_unverified` / `oauth_failed`（以 `/login?error=<code>` query 傳回，非 JSON）                        | 302                         |
| 自行註冊（#124）       | `email_taken`（`POST /auth/signup` 信箱已被使用）                                                                                                              | 409                         |

## 11. 端點外的既存通道

- `GET /health` → `{ok: true}`（無需 session；deploy 後煙霧測試用）
- `POST /api/dev/seed`（需 `ENVIRONMENT=dev`＋server 端 `SEED_TOKEN`；header 帶同值 token）——播種固定 fixture（8 個固定 id 帳號、共用密碼 `demo-demo`、3 個系統題、2 間教室）；冪等 upsert，重跑不改 id、不動既有對話資料

## 11.1 Dev-only 端點（#130；`ENVIRONMENT=dev` 之外一律 404）

| Operation                                | 回應                                                                                                                                                                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/dev/accounts`                  | `{password, accounts: DevAccount[]}`——每個 fixture 帳號（`fixtureRole`: admin／teacher／student；`isAdmin` 為帳號真相，無能力欄位）＋其班級（教室關係 `role`、owner 才有的 `code`／`url`、`activityId`） |
| `POST /api/dev/login` `{email}` → `User` | 以 fixture 身分發 `socrates_session`（不需密碼）；email 不在 fixture 清單 → 404 `not_found`；未 seed → 404                                                                                               |

- 對應頁面：`/dev/accounts`（`apps/web/src/routes/dev.accounts.tsx`）——一鍵切換身分與入口連結
- 護欄：router 內每個 handler 先過 `isDev(c.env)`；production build 的 `ENVIRONMENT` 預設 `production`，故 dev 端點不得經任何 production 路徑可達
- fixture 的 admin（`u_fx_admin`）帶 `is_admin`；停用狀態由 seed 重設為啟用，`session_version` 不重設（既有 token 不復活）

## 12. 範圍外（明確不在 v1 契約）

- `/admin` 運維 dashboard（P1，#80/#81/#97）——與 §9.1 的帳號管理無關
- 單人模式的個人對話 scope（#136 已定：不做單人模式，以 §6.1 測試模式取代）
- 訪客事後回看報告（活動關閉後不提供；participant cookie 不代表班級身分，#133）
- 跨裝置 termHistory（P1）
- `PATCH /me` 改名／頭像（P1 若有需求）
- teacher key 設定頁 UI（#82 前端；後端 API 已就緒）

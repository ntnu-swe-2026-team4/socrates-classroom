# API 契約

> 日期：2026-11-06 ｜ 分支：`experiment/web-next` ｜ 狀態：定案
> 型別單一真相：`packages/shared`（zod schema + TypeScript）；本文件描述形狀，shared 是可編譯的同一份。
> 2026-11-06 重構變更：對話通道 SSE → WebSocket（R7，`docs/pi.md`）；報告形狀改 agent 分析（#74，PR #109）；新增 teacher keys（#82）；lookup 為獨立功能（#76）。

## 1. 慣例

| 項目     | 規範                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 部署     | 單一 Worker：static assets + `/api/*`（Hono）+ `/agents/*`（WebSocket），同源無 CORS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Auth     | httpOnly cookie `socrates_session`（`SameSite=Lax`＋prod 恆 `Secure`）；前端 `credentials: "include"`；**任何 key 永不進前端**。30 天 HMAC token 只帶 `uid`／`ver`／`exp`（#131）：**授權真相在 DB**，每個帶 session 的請求讀一次 `users`（`is_admin`、`disabled_at`、`session_version`）——注銷**立刻生效**，不必等 30 天；`ver` 與 `session_version` 不符（注銷／復用後）視同未登入。活動參與另有獨立 cookie `socrates_participant`（`HttpOnly`、`SameSite=Lax`、7 天；#133）：簽章只帶 `aid`／`pid`／`exp`，**與 `socrates_session` 並存且互不覆寫**                                                                                                                                                                                                                                                                                                                                                                                                                |
| 語言     | `Accept-Language` → `Lang`（`zh-*→"zh"`、`en→"en"`、`es→"es"`）——錯誤訊息依此三語                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| JSON     | camelCase；id 為字串；時間 ISO 8601                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 錯誤     | `{ "message": string, "code": string }`；`code` 為 shared 的 `ErrorCode` literal union（§10），`message` 已本地化                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 輸入邊界 | zod 強制：`name` ≤80、對話 `text` ≤2000、TTS `text` ≤4000（`TTS_MAX_CHARS`）、`term` 1–30、`direction` ≤200、STT 音檔 ≤15MB（位元組上限，非時長）；超界 `422 validation`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 授權     | 預設 deny——見 §1.1；未列者一律需登入且屬教室成員                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 限流     | per-IP 限流走 `RateLimiter` DO（key＝`scope:ip`，60 秒 sliding window；跨 isolate 一致，計數只存 DO 記憶體、idle eviction 後歸零；DO 不可用時 fail-open；無 `CF-Connecting-IP` 一律放行）：login 30、register 10、email-verify 30、email-verify-resend 5、password-forgot 5、password-reset 10、join-code 60、join 30、invite-preview 60、invite-join 30、lookup 20、topics-generate 10、stt 20、tts 30、activity-finish 6。per-identifier 限流走同一 `RateLimiter` DO（`sha256(lowercase(email))` 分片，同為記憶體計數、idle eviction 歸零、fail-open，不依賴 `CF-Connecting-IP`，#393）：`POST /auth/login` 同一 email 15 分鐘內失敗達 10 次後回 `429 rate_limited`（不附 `Retry-After`，存在與不存在的 email 採同一門檻防列舉，登入成功或 `POST /auth/password/reset` 成功歸零，密碼正確但停用之 `403 account_disabled` 不計失敗）；`POST /auth/password/forgot` 同一 email 5 分鐘內只寄一封（重複請求靜默回 `204`）。集中式 per-user 限流為 #103 待辦，非現行行為 |
| 冪等     | 自然鍵冪等：重複 `POST /api/join`（同身分）＝200 冪等、`finish` 重試安全、`PUT settings/*` 天然冪等                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 版本     | `/api` 無版本前綴（單一消費者）；外部消費者出現時才評版本化＋OpenAPI                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| 型別共享 | `RpcApp = ReturnType<typeof createApp>`＋`RpcApi = ReturnType<typeof createApi>`（`apps/server/src/app.ts`）；web 端消費 declaration 產物 `hc<RpcApi>("/api")`（R6）                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

登入方式變更另有短效 sudo cookie `socrates_reauth`（`HttpOnly`、`SameSite=Lax`、`Secure`、path `/api`、10 分鐘；#138，§2.4），一般登入不核發，登出清除，`session_version` 變更即失效。登入方式管理的 per-IP 限流為 `oauth` 30、`reauth` 10、`identity-bind` 10、`identity-unbind` 10 次／分鐘。

所有 `/api/*` 回應預設 `Cache-Control: private, no-store`，包含錯誤回應；個別 route 可顯式覆寫。`/health` 與 static assets 不套用此預設值。

### 1.1 授權矩陣

> 「訪客」＝沒有帳號的活動參與者：持 `socrates_participant` cookie，**不建 `users` 列**，只存在於那一個活動（#133）。
> 「老師」不是帳號屬性，而是班級的擁有關係（無 mode 定稿，#210、[`accounts.md`](./accounts.md) §7）：伺服器不記錄任何 mode/capability——**任何登入 user 皆可建班與開活動**，建班即成為該班 teacher（`classrooms.teacher_id`）；同一帳號可以同時是 A 班老師、B 班學生。`isAdmin` 只解鎖 `/admin/*`（seed 建立，API 不可授予）。
> 自行註冊（`POST /auth/signup`）與 Google／Facebook OAuth（#124/#207）建立的獨立帳號：未加入任何教室前權利同「已登入」欄（無班級關係，多數班級操作本就需成員或 owner）。

| Operation                                                                                                                               | 訪客                                          | 已登入                                                             |
| --------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| `GET /join/:code`、`POST /join`、`POST /auth/login`、`POST /auth/register`                                                              | ✅                                            | ✅                                                                 |
| `POST /auth/signup`、`GET /auth/oauth/:provider/start`、`GET /auth/oauth/:provider/callback`（#124）                                    | ✅                                            | ✅                                                                 |
| `POST /auth/password/forgot`、`POST /auth/password/reset`（#230）                                                                       | ✅                                            | ✅                                                                 |
| `GET /invites/:token`、`POST /invites/:token/join`（活動邀請連結，#133）                                                                | ✅                                            | ✅（只加入活動，不入名冊）                                         |
| `GET /notifications`（feed 免登入）、`POST /notifications/seen`、`POST /admin/notifications`（#239）                                    | feed ✅（未登入 `unread` null）；seen/admin — | feed ✅（`unread` 有值）；seen ✅；admin ❌ 401／403               |
| `GET /config`（#159）                                                                                                                   | ✅                                            | ✅                                                                 |
| `GET /me`、`logout`、`stt`、`tts`、`lookup`                                                                                             | —                                             | ✅                                                                 |
| `GET /topics`、`POST /topics`、`topics/generate`、`POST /classrooms`、`POST /classrooms/:id/activities`                                 | —                                             | ✅（無 mode，#210）                                                |
| `GET /classrooms/:id/topics`（#135）                                                                                                    | —                                             | 需該班成員                                                         |
| `GET /classrooms/:id/calendar-events`（#348）                                                                                           | —                                             | 需該班 owner 或成員                                                |
| `POST /classrooms/:id/calendar-events`、`PATCH/DELETE /classrooms/:id/calendar-events/:eventId`（#348）                                 | —                                             | 需該班 owner                                                       |
| `POST /classrooms/:id/topics`、`POST /topics/:id/copy`、`DELETE /classrooms/:id/topics/:topicId`（#135／#383）                          | —                                             | 需目標班 owner                                                     |
| `POST /activities/:id/invites`（#133）                                                                                                  | —                                             | 需該班 owner                                                       |
| `GET/PUT/DELETE /settings/keys/:provider`、`PUT /settings/keys/order`（#82 teacher keys）                                               | —                                             | ✅（per-user BYOK，#210）                                          |
| `GET/POST /api/solo/threads`、`GET/PATCH/DELETE /api/solo/threads/:id`（#281 solo chat）                                                | —                                             | ✅（僅本人 thread）                                                |
| `GET/POST /admin/users`、`PATCH /admin/users/:id`、`GET/PUT /admin/settings`、`GET /admin/overview`（#185）、`/admin/keys` 家族（#354） | —                                             | ❌ 401／403 `forbidden`                                            |
| `GET /activities/:id`                                                                                                                   | 需本人 participant cookie                     | 教室成員、owner 或此活動的登入訪客                                 |
| `GET /activities/:id/report`                                                                                                            | —                                             | 本人 participant、班級 owner；未產生個人報告的現有成員可查生成狀態 |
| `PUT /activities/:id/engagement-visibility`（#267）                                                                                     | —                                             | 需該班 owner                                                       |
| `GET/POST /activities/:id/slots`（#134）                                                                                                | —                                             | 需該班 owner                                                       |
| **WS** `/agents/chat/:name`（watch/entries/abort）                                                                                      | 僅本人 participant thread                     | 本人 participant thread，或該班 owner 可觀察自己帶的班級           |
| **WS** `submit` op                                                                                                                      | 僅本人 participant thread                     | 僅本人 participant thread                                          |
| **WS** `btw` op（開新 side session）／`btw {session}`（附掛既有）                                                                       | 僅本人 participant thread                     | 僅本人 participant thread                                          |
| **WS** `/agents/solo-chat/:name`（#281 solo chat WS）                                                                                   | —                                             | 僅本人 thread（`userId === thread owner`）                         |
| `POST /activities/:id/finish`                                                                                                           | —                                             | 需教室成員（owner）                                                |

- **test 活動（#134）只對該班 owner 存在**：`GET /activities/:id`、`/report`、`/slots`、WS 一律 403／close 1008 給其他任何身分（含班級成員與訪客）；`POST /activities/:id/invites` 對 test 活動回 409 `conflict`
- test 活動的 `kind = 'teacher'` slot 由老師本人持有（`user_id` = 老師），所以同一帳號在這些 thread 上可以 `submit`（`live` 活動的老師仍無 participant，仍 `SubmitForbidden`）

## 2. 身分（雙軌：訪客即玩＋帳號選用，#67）

```ts
interface User {
  id: string;
  name: string;
  isAdmin: boolean; // 帳號層：/admin console（僅 seed 建立，API 不可授予）；無 mode/capability 欄位（#210）
  emailVerified: boolean; // 「帳號至少一種已驗證的登入方式」（#138 對齊 #437）：email_verified_at 非 NULL、或有任一 user_identities（SSO 由 provider 端驗證）；users.email 為 NULL 的 SSO 帳號與已驗證帳號皆為 true
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

| Endpoint                                                                      | 說明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/login` `{email, password}` → `User`                           | 驗 email＋PBKDF2 密碼，發 30 天 session。帳號不存在或密碼錯 → 401 `unauthorized`（同一回應防列舉；per-identifier 失敗限流見 §1）；停用 → 403 `account_disabled`；**email 未驗證（`email_verified_at IS NULL`）且帳號另有 SSO identity → 403 `email_unverified`（#138 方式層：未驗證的 email＋密碼不可作為登入憑證，請改用已綁 SSO 或先完成驗證；不發 session）**；email-only 未驗證帳號照常發 session，交 hard gate（§2.3）接手                                                                                                                                                                                                                                                                               |
| `POST /api/auth/signup` `{email, password, name, tosAccepted}` → `User`       | 不需邀請碼；建獨立帳號（無能力，未屬任何教室）並發 session，同時寄出 email 驗證信（§2.3），回傳的 `emailVerified` 為 `false`。email 已被 email 帳號使用 → 409 `email_taken`，但**stale takeover 例外**（§2.3）；`tosAccepted` 非 true → 422 `tos_required`；限流與 register 共用（register 10）                                                                                                                                                                                                                                                                                                                                                                                                               |
| `GET /api/auth/providers` → `{providers: ("google" \| "facebook")[]}`（#207） | 能力探測：回傳**已設定環境變數而啟用**的 SSO provider（`GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET`、`FACEBOOK_APP_ID`／`FACEBOOK_APP_SECRET` 任一對齊才算啟用）；未設定的不列出——前端（#178）據此決定顯示哪些按鈕。免 session、不讀 DB。**`apple` 永不回傳**（拍板退場，[`accounts.md`](./accounts.md) §7）；回應帶 `Cache-Control: public, max-age=300`——内容常數（僅隨 deploy／env 變動），瀏覽器可快取，Cloudflare edge 對 JSON 預設不快取（全域 Cache-Control 策略另由 #245 拍板）                                                                                                                                                                                                                         |
| `GET /api/auth/oauth/:provider/start`（`provider` = `google`｜`facebook`）    | 302 至 provider 授權頁；state＋nonce＋PKCE（S256）封入 10 分鐘 httpOnly cookie `socrates_oauth`（HMAC 簽章，path `/api/auth/oauth`）。Google：PKCE S256＋nonce；Facebook：state only（Meta 無 nonce／PKCE，`verifier` 欄位存在但不送）。未設定該 provider 的環境變數 → 302 `/login?error=oauth_unavailable`；未知 provider → 404                                                                                                                                                                                                                                                                                                                                                                              |
| `GET /api/auth/oauth/:provider/callback?code&state`                           | 驗 state cookie → 換 token → 取身分 → 以 `(provider, sub)` 找或建獨立帳號 → 發 session → 302 `/home`。失敗一律 302 `/login?error=<code>`，不發 session；**帳號已停用 → 302 `/login?error=account_disabled`（與密碼登入同一閘門，不發 session）**。**Google**：PKCE verifier 換 ID token，驗 JWKS 簽章／`iss`／`aud`／`exp`／`nonce`／`email_verified`（未驗證 → `oauth_email_unverified`）。**Facebook**（#207）：code 換 access token（server-side）→ `GET /me?fields=id,name,email`；身分一律 `(facebook, id)`，**email 焺 informational**（Meta 無 `email_verified` 信號，不參與身分判定；缺 email 照常建帳，`user_identities.email` 為 NULL）；access token 用完即棄，**不落庫**（Graph API pin `v27.0`） |

- 一個帳號可以有**多種**登入方式（email＋密碼、各 SSO provider），但**至少保留一種**；綁定／解綁、重驗與原子性規則見 §2.4。同一個 email 經 email 註冊與 Google／Facebook 登入仍是**各自獨立的帳號**（第三方登入不以 email 認身分，也不自動合併——合併的 use case 由 §2.4＋#233 二件套覆蓋）
- Google 帳號的 email 存於 `user_identities.email`，`users.email` 為 NULL（`users.email` 只承載 email 密碼登入）；Facebook 帳號同理，且其 email 可能缺席（informational）
- callback redirect URI＝`PUBLIC_BASE_URL`（未設則用請求 origin）＋`/api/auth/oauth/<provider>/callback`；Google 需登錄於 Google Cloud Console，Facebook 需登錄於 Meta App Dashboard（設定見 [`google-oauth.md`](./google-oauth.md) §6）

### 2.2 密碼找回（#230）

| Endpoint                                                  | 說明                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/password/forgot` `{email}` → 204          | 一律回 204，不透露帳號是否存在。帳號存在、有密碼且未停用時，寄出重設信（語言依 `users.lang`），連結為 `PUBLIC_BASE_URL`（未設則用請求 origin）＋`/reset-password#token=<token>`；同一 email 5 分鐘內僅寄一封，冷卻期間重複請求靜默回 204 不寄信（#393）；寄信走 `waitUntil`，寄送失敗只記 log |
| `POST /api/auth/password/reset` `{token, password}` → 204 | token 有效 → 更新密碼、`session_version + 1`（所有裝置登出）並清空該 email 的 `login-fail` 鎖定計數（#393），不發 session。token 無效、過期、已使用，或帳號已停用 → 400 `reset_token_invalid`；`password` 規則同 signup（8–128）→ 不符 422 `validation`                                       |

- token 對 client 是不透明字串；有效 30 分鐘。伺服器不存 token：簽章綁定帳號目前的 `password_hash` 與 `email`，密碼或 email 一改，所有尚未使用的連結都失效（等於單次使用）；簽章金鑰依用途由 `AUTH_SECRET` 推導，不同用途的 token 不能互用
- 連結把 token 放在 URL fragment（`#token=`），不會送到伺服器，也不會出現在 Referer 或伺服器 log
- 限流：per-IP 為 forgot 每分鐘 5 次、reset 每分鐘 10 次（429 `rate_limited`，#157）；per-email 為 forgot 每 5 分鐘 1 封（靜默 204，上限 12 封/小時/email，#393）
- 純 SSO 帳號（`users.email` 為 NULL、無密碼）不適用

### 2.3 Email 驗證（#259）

| Endpoint                                      | 說明                                                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/auth/email/verify` `{token}` → 204 | 免登入（使用者可能在另一台裝置點信）。token 對 `users.email` 有效 → 寫入 `users.email_verified_at`；重複點同一個連結、帳號已驗證時照樣回 204（不改變狀態）。token 無效／過期／被竄改、`users.email` 在寄信後已變更、或帳號已停用 → 400 `verify_token_invalid`；限流每 IP 每分鐘 30 次 |
| `POST /api/auth/email/verify/resend` → 204    | 需登入。未驗證 → 依 `users.lang` 重寄驗證信；已驗證 → 204 但不寄信；`users.email` 為 NULL 的 SSO 帳號 → 409 `email_not_set`；限流每 IP 每分鐘 5 次                                                                                                                                    |

- `signup`／`register` 建立 email 帳號後寄出驗證信（語言依 `users.lang`），連結為 `PUBLIC_BASE_URL`（未設則用請求 origin）＋`/verify-email#token=<token>`；寄信走 `waitUntil`，寄送失敗只記 log（fail-open，不阻擋註冊）
- token 對 client 是不透明字串；有效 24 小時（`EMAIL_VERIFY_TTL_HOURS`）。伺服器不存 token：簽章用途為 `email_verify`（與 `password_reset` 互不通用，見 §2.2），綁定目前的 `users.email`——email 一改舊連結即失效。單次使用由寫入端保證：`UPDATE … WHERE email_verified_at IS NULL`，重放只會是 no-op
- **hard gate（#437，取代 #259 的 soft 模型；#138 對齊為 verified method）**：gate 的鈔匙是「帳號至少一種 **verified method**」——有任一 `user_identities`（SSO 登入由 provider 端驗證）或 `email_verified_at` 非 NULL 即放行；一種都沒有的 session（＝未驗證的 email-only 帳號）只能存取驗證流程相關端點（`/api/me`、login、logout、register、signup、providers、password forgot/reset、email verify、verify/resend），其餘 API 一律 `403 email_unverified`；WS authorize（chat／solo／classroom-events）同樣拒絕。設計語意見 [`accounts.md`](./accounts.md) §8
- **方式層（#138 拍板：未驗證一律影響登入）**：未驗證的 email＋密碼不可作為登入憑證——`POST /auth/login` 對「`email_verified_at IS NULL` 且帳號另有 SSO identity」回 403 `email_unverified`（不發 session）；email-only 未驗證帳號維持發 session＋VerifyGate（否則重寄驗證信沒有入口）。SSO 登入本身即 verified method，不受其綁定的未驗證 email 影響
- **stale takeover**：超過 `EMAIL_VERIFY_TTL_HOURS` 仍未驗證的帳號，其地址視同無主——以該 email 重新 `signup`／`register` 覆寫 name／password／lang／`created_at` 並 `session_version + 1`（舊 session 全滅），帳號維持未驗證；已驗證的地址不適用，照回 409。`register` 對「stale 帳號已是該教室成員」的情形視為冪等：member row 改名為請求的 name 並更新 `tos_accepted_at`，照回 200（同一 user id）
- 同一個 `users.email` 只能屬於一個帳號（UNIQUE，stale takeover 為唯一例外）；驗證狀態決定 hard gate（見上），也用於判斷「這個信箱是否已被本人確認」

### 2.4 登入方式綁定／解綁（#138）

一個帳號可以同時有多種登入方式（email＋密碼、各 SSO provider），**至少保留一種，且至少保留一種 verified 方式**（解綁守衛見下方原子性，與 §2.3 gate 同一把鈔匙）；同一 SSO provider 對同一帳號最多 1 筆（`INSERT … WHERE NOT EXISTS` 原子保護），換綁＝先解綁舊的再綁新的。綁定／解綁前 MUST 先通過**身分再驗證（re-auth）**：

- 短效 sudo cookie `socrates_reauth`（`HttpOnly`、`SameSite=Lax`、`Secure`、path `/api`、`Max-Age=600`）。payload 為 `{purpose: "reauth", uid, ver, exp}`，以獨立用途金鑰（`AUTH_SECRET` 推導的 `socrates:reauth`）簽章，綁定 `users.id` 與 `session_version`
- 一般登入**不**核發（避免共用電腦離座被趁機改掉）；`POST /api/auth/logout` 同步清除；任何 `session_version` bump 或 10 分鐘到期即失效
- 未通過／過期一律 403 `reauth_required`（不回 401，前端才不會誤判為 session 過期而導回 `/login`）

| Operation                                                     | 說明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/me/identities`                                      | requireUser → `{email: {email, verified} \| null, oauth: [{provider, email, linkedAt}], reauthExpiresAt: string \| null}`。`reauthExpiresAt` 僅在**有效且屬於當前 `session_version`** 的 `socrates_reauth` 存在時非 null                                                                                                                                                                                                                                                                             |
| `POST /api/auth/reauth/password` `{password}`                 | requireUser；限流 `reauth` 10/min → 200 `{expiresAt}` 並設 `socrates_reauth`。錯密碼 → 401 `invalid_credentials`；帳號無密碼（純 SSO）→ 409 `password_not_set`                                                                                                                                                                                                                                                                                                                                       |
| `POST /api/auth/reauth/oauth/:provider/start` `{returnTo?}`   | requireUser；限流 `oauth` 30/min → 200 `{url}` 並設 `socrates_oauth`（`intent: "reauth"`）。該 provider 未綁在本帳號 → 404 `identity_not_found`；provider 未設定 → 409 `oauth_unavailable`                                                                                                                                                                                                                                                                                                           |
| `POST /api/me/identities/oauth/:provider/start` `{returnTo?}` | requireUser＋reauth；限流 `oauth` 30/min → 200 `{url}` 並設 `socrates_oauth`（`intent: "bind"`）。已綁同 provider → 409 `provider_already_linked`；provider 未設定 → 409 `oauth_unavailable`；未知 provider → 404 `not_found`                                                                                                                                                                                                                                                                        |
| `POST /api/me/identities/email` `{email, password}`           | requireUser＋reauth；限流 `identity-bind` 10/min → 200 `{email, verified: false}`（寫入小寫正規化 email、PBKDF2 密碼、`email_verified_at = NULL`，沿用 §2.3 非同步寄驗證信；綁定不觸發帳號層 gate（§2.3：帳號已有 verified SSO），但該 email＋密碼完成驗證前不可用於 `POST /auth/login`（方式層，§2.3）。已有 email／密碼 → 409 `email_already_linked`（改信箱／改密碼屬 #234）；信箱已屬其他帳號 → 409 `email_taken`                                                                                |
| `DELETE /api/me/identities/:method`                           | `method` = `email`｜`google`｜`facebook`。requireUser＋reauth；限流 `identity-unbind` 10/min → 204。解綁成功 `session_version + 1`，並在同一回應換發當前裝置的 `socrates_session` 與 `socrates_reauth`（沿用原剩餘效期，不延長 sudo 窗口）——其他裝置立即失效，當前裝置不斷線。未綁 → 404 `identity_not_found`；一種登入方式都不剩 → 409 `last_login_method`；**僅剩未驗證 email＋密碼（＝解綁後沒有 verified 方式）→ 409 `last_verified_method`，先完成信箱驗證再解**；未知 method → 404 `not_found` |

- **OAuth 啟動採 POST 回 `{url}`**（不 302）：防 GET CSRF 與瀏覽器 link prefetch 覆寫 state cookie，且前置錯誤（401／403／409）直接回結構化 JSON 給 SPA 處理。登入用的 `GET /api/auth/oauth/:provider/start` 維持 302（既有行為不變）
- **callback 共用** `/api/auth/oauth/:provider/callback`（Google Cloud Console／Meta App Dashboard 已登錄的 Redirect URI 不變）：`socrates_oauth` 的 pending 新增 `intent: "login" \| "bind" \| "reauth"`、`uid`、`ver`、`returnTo`。bind／reauth 回調再以即時 session 驗一次 `uid`／`ver`（防登入 CSRF 與中途換帳），不符 → `<returnTo>?error=reauth_identity_mismatch`；bind 成功 → `<returnTo>?linked=<provider>`；reauth 成功 → `<returnTo>?reauth=ok`（並設 `socrates_reauth`）；login 維持 302 `/home`（失敗一律 302 `/login?error=<code>`）
- **`returnTo`** 只接受同源相對路徑（`/` 開頭、非 `//`、不含 `\`），不符或未帶一律 `/settings`；結果參數以 `URLSearchParams` 安全附加
- **SSO 重驗參數**：Google 加 `max_age=0`＋`prompt=select_account`，`user_identities.email` 非 NULL 時再帶 `login_hint`（`auth_time` 僅於已發布、通過驗證且在 Google Auth Platform 開啟 Session age claims 的專案穩定回傳，因此不硬性要求——安全由帳號選擇＋回調比對 `(provider, sub)` 確屬當前帳號＋單次 state 綁定共同保證）；Facebook 加 `auth_type=reauthenticate`
- **原子性（D1 單寫者）**：綁定以單句 `INSERT INTO user_identities … SELECT … WHERE NOT EXISTS`，跨帳號撞由 PK (`provider`, `provider_user_id`) 攔下（callback 以 302 `<returnTo>?error=identity_taken` 回應，非 JSON）；解綁以單句 `UPDATE`／`DELETE` 把「至少留一種 **verified** 方式」檢查與寫入合併（SSO 分支要求 `email_verified_at IS NOT NULL` 或另一筆 identity；email 分支要求尚有 identity），避免並發解綁造成 0 種登入方式或 0 種 verified 方式。`meta.changes === 0` 時再查現況區分 404 `identity_not_found`、409 `last_login_method`（一種都不剩）與 409 `last_verified_method`（剩的都未驗證）
- 綁定成功**不** bump `session_version`（新增方式不撤銷既有憑證）；解綁成功 bump（見上表）
- Email 解綁一併清空 `email_verified_at`；既有 `POST /auth/email/verify` 與 `POST /auth/password/reset` 對 `users.email IS NULL` 的帳號自動失效

### 2.5 帳號個資（#234）

`Profile`＝`{name, email, lang, avatar}`（SSO 帳號 `email` 為 NULL）；`avatar` 為前綴 token：`color:<ink｜ochre｜moss｜vermilion｜graphite>`（五色 Initial 底色）、`image:<8hex>`（上傳圖，版本碼）或 NULL（未設定）。`User`（§2）不動——session 形狀不攜帶 PII。

| Operation                                            | 說明                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/me/profile` → `Profile`                    | 讀取自己的個資；未登入 401 `unauthorized`                                                                                                                                                                                                                                                                                                                                             |
| `PATCH /api/me {name? , lang?, avatar?}` → `Profile` | `name` 1–80（同註冊規則）；`lang` 寫 `users.lang`（語言偏好單一真相）；`avatar` 只收 `color:` token 或 null（清空）。空 body → 422 `validation`；限流 `profile-update` 30/min。**快照不連動**：`members.name`（入班自取）與 `activity_participants.display_name`（入場快照）刻意不隨改名變更——歷史報告署名維持當時事實；會即時更新的是 `GET /me`／帳號選單／教師名（join `users` 處） |
| `POST /api/me/avatar`（raw JPEG body）→ `Profile`    | ≤64KB＋magic bytes（`ff d8 ff`）；服務端**不重編碼、不驗尺寸**（客戶端已裁 128×128——繞過前端可存非圖片 bytes，屬 accepted risk：回應固定 `image/jpeg`、實害有限）。內容 SHA-256 前 8 hex 為版本 → R2 `avatars/<userId>/<version>.jpg`（版本化 immutable key，同內容冪等不重寫）；DB 存 `image:<version>`，成功後刪被取代的舊物件。限流 `avatar-upload` 20/min                         |
| `DELETE /api/me/avatar` → 204                        | 清空 avatar（token = NULL）並刪 R2 物件；限流 `avatar-remove` 20/min                                                                                                                                                                                                                                                                                                                  |
| `GET /api/avatars/:userId/:version` → binary         | 需 session（同源 `<img>` 自帶 cookie）；`Content-Type: image/jpeg`＋`Cache-Control: private, max-age=31536000, immutable`（版本化 key 可永久快取）＋ ETag；無此物件 404 `not_found`                                                                                                                                                                                                   |

- **儲存**：R2 binding `AVATARS`（bucket `socrates-avatars`，`cloudflare.config.ts` 宣告、`wrangler.vitest.jsonc` 同步）；本地 dev／測試用 workerd／miniflare 模擬，production bucket 由 `cf r2 buckets create --name socrates-avatars` 建立後 deploy
- **hard gate**（§2.3）：本節端點全不在 `VERIFICATION_BYPASS`，未驗證帳號一律 403 `email_unverified`；bypass 比對已改為 method-aware（`"GET /api/me"`），同路徑的新寫入端點不會意外繼承 GET 的豁免
- 頭像是使用者上傳內容：帳號刪除（#233）時 MUST 一併刪除 `avatars/<userId>/*`（已列入 #233 範圍）

## 3. 入場（唯一閘門，#66/#70）

| Operation                                                                                 | 說明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/join/:code` → `{code, classroomName, topic}`                                    | 直達 URL 載入用（刷新不丟）；無效碼 404 `join_code_invalid`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `POST /api/join` `{code, name?, tosAccepted}` → `{user, activityId, participantId, kind}` | 一次完成：身分＋ToS 同意存證＋加入教室＋建立活動 participant（§2.1）。**已登入**：加入 `members`（名冊）並取得 `kind = 'member'` participant，`user` 為本人、`kind = 'member'`；**未登入**：建 `kind = 'guest'` participant（`user_id = null`）並發 `socrates_participant` cookie，`user = null`，**不建 `users`／`members` 列**（#133）。**冪等**：同身分重 join → 200（活動結束後仍可 rejoin，供 session 修復與報告回看；已結束的活動不再新增 participant，`participantId` 為 `null`）。錯誤：`tosAccepted` 非 true → 422 `tos_required`；`name` 活動內唯一（409 `name_taken`）；活動已結束 → 409 `activity_finished`（僅攔新加入者）。**任何已登入身分都可加入**（任何帳號可同時在另一班當學生） |
| `GET /api/activities/:id` → `ActivityInfo`                                                | `{id, classroomId, classroomName, participantId, mode, topic, finishedAt}`。`participantId` 是**呼叫者在該活動的 participant**（WS thread 名的一半）；班級成員在活動進行中呼叫時會取得自己的 participant，必要時建立。活動已結束時只回既有 participant，該班老師預設為 `null`。登入訪客以帳號驗證活動 participant。匿名訪客以 `socrates_participant` cookie 驗證，皆只回本人 participant。欠缺授權 → 401／403。`mode` 為 `live`／`test`（#134）；test 活動只有該班 owner 可讀，而且老師可用 `?participantId=` 指定自己的 slot（非自己的 slot → 403）                                                                                                                                                |

### 3.1 活動邀請連結（#133）

邀請連結**在活動關閉前持續有效**：不是一次性兌換、不設使用次數上限；已登入者開連結只加入活動，不進班級名冊。

| Operation                                                               | 說明                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/activities/:id/invites` → `ActivityInvite`                   | 該班 owner 專屬。每個活動**只有一條有效邀請**：已有未撤回、未過期的 invite 就回同一條，否則以高熵 token（32 hex，128 bits）新建 → `{token, activityId, url, createdAt, expiresAt}`；`url` 為 `PUBLIC_BASE_URL/join/a/{token}`。活動已結束 → 409 `activity_finished`                                                                                                                                                                                                    |
| `GET /api/invites/:token` → `InviteInfo`                                | `{token, activityId, classroomName, topic, finishedAt}`；活動已結束仍回 200（前端顯示「活動已結束」）。無效 token 404 `invite_invalid`、已撤回 410 `invite_revoked`、已過期 410 `invite_expired`                                                                                                                                                                                                                                                                       |
| `POST /api/invites/:token/join` `{name?, tosAccepted}` → `InviteJoined` | `{activityId, participantId, displayName, kind}`；發獨立 `socrates_participant` cookie（不覆寫 `socrates_session`）。**已登入**：是班級成員 → `kind = 'member'`，不是成員 → `kind = 'guest'`（`user_id` 記帳號；認領已裁 NOT_PLANNED #60，僅作身分記錄）；**未登入**：需 `name`（422 `validation`），建 `kind = 'guest'` participant。同一 participant cookie 重打 → 冪等回同一 participant。`name` 活動內唯一（409 `name_taken`）、活動已結束 409 `activity_finished` |

## 4. 老師：議題集與開課（#77、#135）

`TopicDraft` 形狀：`{id, title, statement, summary?, prompts, axes}`；`Topic` 為 `TopicDraft` 加上 `classroomId`（`null` 表示系統題或個人題，#135）。`axes` 為 `Axis[]`（`{name, left, right}`，各欄位 trim 後 1–40 字元），0–3 條且 `name` MUST NOT 重複（#159）。

誰決定群體報告的價值軸（#159）由後端 policy（`ReportAxesPolicy`：`teacher`／`ai`／`both`）決定：管理員可透過 `PUT /api/admin/settings` 設為 `teacher`（僅允許老師設軸）、`ai`（僅允許模型定軸）或 `both`（由老師開活動時選擇），變更立即生效且僅影響之後開啟的活動；未設定時 fallback 至 `providers.config.yaml` 的 `report.axes`（預設 `both`）。以 `teacher` 設軸開活動時，題目 MUST 具備 1–3 條 `axes`。

**題目身分（#383）**：同一個池子內 `(classroom_id, title, statement, axes)` 相同即為同一題——`classroom_id` 非 `NULL` 走班級池，`classroom_id IS NULL AND owner_id IS NOT NULL` 走個人池（系統題不參與 dedup）。`axes` 的 JSON 由 server 以固定 key 順序序列化後落庫，key 順序不影響身分。建立類端點（`POST /topics`、`POST /classrooms/:id/topics`、`POST /topics/:id/copy`）同內容回 200 及既有題目、新內容回 201；既有題目的 `prompts`／`summary`／`copied_from` 不被覆寫。題目沒有 edit 端點。

| Operation                                                                                                                                                                                                                                                                                                                                      | 說明                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /api/config` → `{reportAxes}`                                                                                                                                                                                                                                                                                                             | 免登入；回傳 `ClientConfig`（`reportAxes`: `"teacher" \| "ai" \| "both"`），供前端決定開活動時是否顯示設軸模式選擇與填軸介面（#159）                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `GET /api/classrooms/:id/topics` → `Topic[]`                                                                                                                                                                                                                                                                                                   | 該班議題集（只含 `classroom_id = :id` 且未刪除）。班級成員可讀、非成員 403；不含系統題                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `POST /api/classrooms/:id/topics` `{title, statement, summary?, prompts, axes?}` → `Topic`（201 新建／200 已存在）                                                                                                                                                                                                                             | 該班 owner 專屬；寫入 `topics.classroom_id`。`axes` 預設 `[]`，最多 3 條 `{name, left, right}` 且 `name` MUST NOT 重複。dedup key 為 `(classroom_id, title, statement, axes)`（#383）：同內容再送一次回 200 及既有題目（含其 `prompts`／`summary`，不覆寫），不新增列                                                                                                                                                                                                                                                                                                                                        |
| `POST /api/topics/:id/copy` `{classroomId, axes?}` → `Topic`（201 新建／200 已存在）                                                                                                                                                                                                                                                           | snapshot 成新 id 並歸入目標班級，`topics.copied_from` 記來源；body MAY 帶 `axes`（規格同上，未帶時沿用來源的 `axes`）。來源 MUST 為系統題、自己的個人題，或自己帶的班級議題，且未刪除（其他 → 404）；目標班級 MUST 為 owner（403）。改任一邊不影響另一邊。目標班已有同內容同 `axes` 的題目時回 200 及既有列（不覆寫其 `copied_from`，見 #383）                                                                                                                                                                                                                                                               |
| `GET /api/topics` → `Topic[]`                                                                                                                                                                                                                                                                                                                  | 系統題（`classroom_id IS NULL AND owner_id IS NULL`）＋自己的個人題（皆不含已刪除）；**不含任何班級的議題集**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `POST /api/topics` `{title, statement, summary?, prompts, axes?}` → `Topic`（201 新建／200 已存在）                                                                                                                                                                                                                                            | 手動出個人題（`classroom_id = NULL`，`axes` 規格同上）；legacy 入口，班級議題請走 `POST /classrooms/:id/topics`。dedup key 為 `(owner_id, title, statement, axes)`（#383），同內容再送一次回 200 及既有題目                                                                                                                                                                                                                                                                                                                                                                                                  |
| `DELETE /api/classrooms/:id/topics/:topicId` → 204                                                                                                                                                                                                                                                                                             | 該班 owner 專屬（非 owner 403）。soft delete（`topics.deleted_at`，#383）：題目從所有清單消失、不能再開新活動（404），但既有活動、班級 `current`、歷史頁與報告仍以原題目渲染；重複呼叫回 204。刪除後可用同內容重新建立（新 id）                                                                                                                                                                                                                                                                                                                                                                              |
| `POST /api/topics/generate` `{direction}` → `TopicDraft[]`                                                                                                                                                                                                                                                                                     | agent 生成（topic-gen profile，#77/#113）；候選未落庫（無 `classroomId`）且回傳 `axes: []`，要投放得再呼叫 `POST /classrooms/:id/topics`。失敗 → 502 `llm_unavailable`；只有 `LLM_PROVIDER=mock` 回固定題（回應帶 X-Socrates-Fallback: mock）                                                                                                                                                                                                                                                                                                                                                                |
| `POST /api/classrooms` `{name}` → `{classroomId, code, url}`（201）                                                                                                                                                                                                                                                                            | **只建班級，不建活動**——空班級（無議題、無活動）是合法狀態；`url` 為 `PUBLIC_BASE_URL/join/:code`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| `POST /api/classrooms/:id/activities` `{topicId, mode?, reportAxes?, topicAxes?, calendarEventId?}` → `{classroomId, code, url, activityId, mode}`（201）                                                                                                                                                                                      | 開活動（同 code、新 activityId）。`topicId` MUST 為該班議題集、本人個人題或系統題（另一班的議題 → 404）。`reportAxes`（`"teacher" \| "ai"`）指定本活動由誰設軸：policy 為 `both` 時由老師選擇（省略時沿用 `"ai"`）；policy 鎖定時省略即套用該鎖定值，帶入另一種則回 422 `report_axes_not_allowed`。生效值寫入 `activities.report_axes`（之後變更設定不影響既有活動）；老師模式使用題目既有的軸或傳入的 `topicAxes`，生效的軸 MUST 有 1–3 條（否則 422 `topic_axes_required`）。`mode` 預設 `live`；`live` 會把 `classrooms.current_activity_id` 指向新活動，`test` **不會**（學生任何入口都不會看到，見 §6） |
| `GET /api/classrooms` → `ClassroomSummary[]`（登入者）                                                                                                                                                                                                                                                                                         | **owned ∪ joined**：自己開的教室與已加入的教室，同一帳號可兩者兼具。`role` 是該教室的關係（owner＝`teacher`，否則 `student`）；`code/url` 只回給 owner；`current` 可為 `null`（空班級），否則嵌入當前活動（topic＋finished）。教室單筆不另設端點——前端以本列表過濾                                                                                                                                                                                                                                                                                                                                           |
| **題目生命週期（#383）**：`DELETE /api/classrooms/:id/topics/:topicId` 是 soft delete——列入 `topics.deleted_at` 後不再出現在任何清單、不能用來開新活動，但 `activities.topic_id` 不動，既有活動的 `GET /api/activities/:id`、班級 `current`、歷史頁與報告照舊渲染該題。因此刪除不做引用檢查、也不改寫歷史；刪除後可用同內容重新建立（新 id）。 |

若 `topicAxes` 與原題的軸不同，Worker 建立歸入目標班級的題目 snapshot（保留 `copied_from`），活動指向新題目；目標班級已有同內容同軸的題目時沿用既有列，不重複建立（#383）。題目 snapshot、活動及 live 的 `current_activity_id` 更新一起寫入。省略 `topicAxes` 或傳入相同的軸會沿用原題。AI 模式帶入 `topicAxes` 回 422 `report_axes_not_allowed`。 |

**`current` 語意（#135）**：`classrooms.current_activity_id` 是「最近一次 `mode = 'live'` 的活動」指標——`test` 永不寫入，所以一班最多一個 `current`；開新 `live` 活動即取代指標（舊活動留在 `activities` 歷史）。活動結束**不清除**指標，`current.finished` 區分進行中／已結束（結業報告入口與 `POST /join` 的 `activity_finished` 判定都靠它）。空班級的 `current` 為 `null`，其邀請碼在開活動前一律 404 `join_code_invalid`（§3）。

### 4.1 教室社群與邀請（#324）

本節以 `C = /api/classrooms/:id` 表示班級資源。API 依班級 owner／member 授權。活動訪客的班級操作回 403，未登入回 401。教室資料使用既有 `private, no-store`。

| Operation                                                          | 契約                                                                                                                                                                                                                  |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET C/announcements`、`GET C/posts`                               | 班級成員可讀。公告與根貼文的 item 為 `{id, body, authorId, authorName, createdAt}`。作者已刪除時 `authorId`、`authorName` 為 `null`。                                                                                 |
| `POST C/announcements`、`POST C/posts`                             | 接收 `{body}`，trim 後 1–4,000 字。公告由 owner 發布，討論區由班級成員發文。新寫入回 201 與 item。                                                                                                                    |
| `GET/POST C/posts/:postId/replies`                                 | 單層回覆。parent MUST 是同一班的根貼文，否則 404。讀取與建立形狀同貼文。                                                                                                                                              |
| `DELETE C/announcements/:announcementId`、`DELETE C/posts/:postId` | 公告由 owner 刪除，貼文與回覆由作者或 owner 刪除。刪除根貼文 CASCADE 回覆（#158）。成功回 204。                                                                                                                       |
| `GET C/members`                                                    | `{teacher: {id, name}, items: {id, name, joinedAt}[], nextCursor}`。班級成員可讀。                                                                                                                                    |
| `DELETE C/members/:userId`                                         | owner 可移除成員，成員可自行離開。移除 owner 回 403。成功回 204。資料與授權語義見 [帳號與權限模型](./accounts.md#4-詞彙)。                                                                                            |
| `GET C/activities`                                                 | `{id, mode, topicTitle, createdAt, finishedAt}` 的分頁。owner 可讀 live 與 test，成員只可讀 live。                                                                                                                    |
| `POST C/invites`                                                   | owner 專屬。接收 `{scope: "classroom"}` 或 `{scope: "activity_guest" \| "classroom_activity", activityId}`。回 201 與邀請 metadata、token、`url`。邀請預設七天到期。活動 MUST 屬於該班且是進行中的 live 活動。        |
| `GET C/invites`、`DELETE C/invites/:inviteId`                      | owner 專屬。列表 item 為 `{id, classroomId, activityId, scope, createdAt, expiresAt, revokedAt}`。撤銷回 204，阻止之後接受此邀請。                                                                                    |
| `GET /api/classroom-invites/:token`                                | 公開預覽 `{classroomId, classroomName, activityId, scope, expiresAt, finishedAt, topic}`。班級邀請的活動欄位為 `null`。無效 404，撤銷或到期 410。                                                                     |
| `POST /api/classroom-invites/:token/join`                          | `{name?, tosAccepted}` → `{classroomId, activityId, participantId, displayName, kind}`。班級與組合邀請需登入。訪客可用登入身分或以 name 取得活動 participant session。班級邀請的活動欄位為 `null`。活動已結束回 409。 |

列表預設回 `{items, nextCursor}`，`limit` 預設 30、上限 100。以回應中的 opaque cursor 繼續讀取，`nextCursor: null` 表示結束。公告、根貼文、活動及邀請為新到舊，回覆及名冊為舊到新，同一時間以 ID 排序。

公告、根貼文與回覆的 `POST` MAY 帶 `Idempotency-Key`（1–128 個可見 ASCII 字元）。相同帳號、班級、操作與 key 的同內容重試回 200 及原 item，內容不同回 409。已刪除的 item 保留 request key 的 deduplication 效果。

新邀請 token 僅建立時回傳，`url` 為 `PUBLIC_BASE_URL/join/i/{token}`，邀請頁面見 [前端 route map](./frontend.md#2-route-map)。班級邀請可在沒有活動時使用，組合邀請以同一 D1 transaction 寫入 membership 與 participant。既有六碼與活動邀請維持 §3 的相容契約。

### 4.2 教室事件（#324）

`GET /api/classrooms/:id/events` 以相同 origin 與有效登入 session 升級 WebSocket。owner 與成員在連線成功後收到 `{"type":"ready"}`。D1 commit 後推播 `{"type":"classroom.changed","resource":"announcements"|"posts"|"members"|"activities"|"calendar"}`。推播採 best effort，權威狀態由 REST 讀取，重連後重新同步。移除成員回收該人的連線權限，推播前重驗當下的 membership 與 session。test 活動不送班級事件。

### 4.3 教室行事曆（#348）

行事曆事件屬於單一教室，與 §4.1 的 `activities` 分開儲存。老師可在建立事件時提供 `topicId` 來排定討論。建立或改期只寫入排程；老師確認開始後才建立 live activity，並將原事件連到該活動。此處的 `calendar-events` REST 路徑與 §4.2 的 `/events` WebSocket 分開。

開始已排定的討論使用 §4.1 的 `POST /api/classrooms/:id/activities`，另帶 `calendarEventId`。事件 MUST 屬於該班且議題 MUST 與 `topicId` 一致。初次開始回 201；重送同一事件回 200 與同一個 `activityId`。未知事件回 404、議題不符或 mode 為 `test` 回 422。教室若已有其他未結束的目前活動，回 409 `conflict`，老師可先在即時面板結束該活動。

| Operation                                        | 契約                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET C/calendar-events?from=&to=&limit=&cursor=` | owner 與成員可讀；未登入 401、非成員 403、未知教室 404。`from`／`to` REQUIRED，為帶時區的 ISO 8601 時間；區間為 `[from, to)`，長度 MUST 大於 0 且不超過 62 天。回 `{items: CalendarEvent[], nextCursor}`；依 `startsAt, id` 由早到晚排序。事件時間區間與查詢區間相交時回傳；無 `endsAt` 的事件以 `startsAt` 落在區間內判定。`limit` 預設 100、上限 100，`cursor` MUST 搭配原本的 `from`／`to` 使用。無效 query 回 422 `validation`。 |
| `POST C/calendar-events`                         | owner 專屬；`{title, startsAt, endsAt?, note?, topicId?}` → `CalendarEvent`（201）。`title` trim 後 1–120 字，`note` trim 後 0–1,000 字且預設 `""`；`startsAt` REQUIRED，`endsAt` 可省略或為 `null`。有 `endsAt` 時 MUST 晚於 `startsAt`。無效輸入回 422 `validation`。如提供 `topicId`，其可用範圍同 §4.1 的開活動。                                                                                                                |
| `PATCH C/calendar-events/:eventId`               | owner 專屬；可更新 `title`、`startsAt`、`endsAt`、`note`，body MUST 至少包含一欄；`endsAt: null` 清除結束時間。以更新後的完整事件驗證時間先後，回更新後 `CalendarEvent`（200）。事件不存在或不屬於該班回 404 `not_found`；已開始的排定討論回 409 `conflict`。                                                                                                                                                                        |
| `DELETE C/calendar-events/:eventId`              | owner 專屬；成功回 204。事件不存在或不屬於該班回 404 `not_found`；已開始的排定討論回 409 `conflict`。                                                                                                                                                                                                                                                                                                                                |

`CalendarEvent` 為 `{id, classroomId, title, startsAt, endsAt, note, topicId, activity, createdAt, updatedAt}`。輸入時間 MAY 使用 UTC offset；server 將時間正規化為 UTC ISO 8601（`Z`）後儲存與回傳，`endsAt` 缺省時回 `null`。一般事件的 `topicId` 為 `null`。活動開始後，`activity` 為 `{id, finishedAt}`，未開始為 `null`。事件寫入後推播 §4.2 的 `calendar`；live activity 開始或結束推播 `activities`，行事曆可據此重新查詢。

排序一律以 `startsAt` 為準：跨日事件的 `startsAt` 早於查詢區間時，會排在該頁所有窗內起始事件之前——月視圖整頁拉取時長跨度事件出現在最前面，屬預期結果。時間欄位存的是 `toISOString()` 的正規化格式（`.000Z`），`starts_at`／`ends_at` 的先後比較因此等價於字串比較；新增的寫入路徑 MUST 沿用同一個正規化，否則 CHECK 與 `PATCH` 的時間先後驗證會失真。

## 5. 對話（WebSocket，核心；R7）

### 5.1 通道

- `GET /agents/chat/:name?lang=<介面語言>`（WebSocket 升級）——**對話唯一通道**（先前的 SSE 端點已退役）。`lang`：學生目前的介面語言（前端送 `zh-TW`／`en`／`es`；WebSocket 無法帶自訂的 Accept-Language）。語言碼為 `zh`／`en`／`es`（可帶 `-地區`，如 `zh-TW`、`en-US`）才採用，其他值不改它；只採用學生本人連線帶來的值，老師旁觀的連線不改它；沒帶過時為中文。蘇格拉底如何依語言取 prompt 見 `docs/pi.md`
- thread name 協定：`{activityId}:{participantId}`（**一人一 thread 已不再是規則**——同一帳號在同一活動可以有多個 participant，#132／#134；DO name 即路由鍵）
- 授權：升級請求帶 cookie，`socrates_session` 與 `socrates_participant` **兩顆都接受**（#133）。onConnect 以登入 session 驗班級資格或本人活動訪客資格。匿名訪客以 participant cookie 驗證（簽章 `aid`／`pid` MUST 等於 thread 名）；**`submit` 的擁有者規則是「該 participant slot 屬於這條連線」**：participant 帶 `user_id` 時 MUST 等於 session 的 uid，`user_id = null` 的訪客則靠 participant cookie 證明持有（`ChatSockets` 每次 submit 重讀 participant；老師在自己班代打 → error frame code `SubmitForbidden`），班級 owner 可觀察全班（watch/entries/abort）；未通過 → close 1008（無 hello）；hibernation 喚醒後 reverify 確定撤權（ApiError）→ close 1008；reverify 暫時性錯誤（D1 失敗等）或 watch 遺失（session 驅逐）→ close 1011（客戶端重連即重試）
- 每則 client message 先做一次**身分重驗**：帳號 session 核對 `disabled_at`／`session_version`、班級資格或本人活動訪客資格，匿名訪客核對 participant 是否仍存在——不符 → close 1008（停用與撤銷即刻生效，含已建立連線）
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
- **回合完成判定**：submit 後記 baseline（當時最後一個 entry id），透過 view/ops 判斷本輪的 assistant 回覆是否已完成。Admission receipt 代表已受理。串流中的 partial 寫在 `pi.live` doc。重連後，若 watch window 缺少本輪的 `pi.user` entry，前端仍以可判定的回覆或明確的失敗訊號結束 `pending`。
- **Run 失敗與逾時（#148）**：Chat DO 保存待處理的 operation，重啟後恢復追蹤。查到 run 遺失、失敗，或達到約 120 秒的 deadline 仍無結果時，向同一個 session 廣播無 `id` 的 `llm_unavailable`。失敗通知自記錄起保留 120 秒，供重連後重新 watch 同一個 session 時補收。若同一個 session 另有待追蹤的 operation，則暫緩補送上一輪的失敗通知。
- **情緒**：`view.entries` 的 `app.emotion` entry（`{emotion, probabilities, confidence}`，#111）——UI 依機率驅動表情，文字零污染
- **違規**：`app.violation` entry（`{type, probability, excerpt, source}`，#71）——老師面板讀 D1（#73 輪詢），學生端不消費
- **歷史**：WS `watch` 首個 view（window 預設最新 50 則 entries）或 `entries` 指令；pi transcript（DO storage）為唯一真相

### 5.4 BTW side session（#121）

副視窗的「順帶一問」：學生暫離蘇格拉底，問定義、思想實驗的設定（例：電車難題）、背景事實。

- 實作為 pi 原生 fork：從 root 最新 entry fork 出新 conversation，agent 只選 `btw` extension（`prompts/btw.md`；無 websearch／judgment／avatar）。side session 看得到 fork 點之前的主對話，**它的 entries 只寫在 fork 裡**——不進 root 的 model context，也不進報告 transcript
- 副視窗**另開一條連線**到同一 thread，送 `{ type: "btw", id }`：server fork 後把該連線綁到 side session，立即推該 session 的 `view`，再回 `result: { session }`。之後該連線的 `watch`／`submit`／`abort`／`entries` 全部作用在 side session，frame 形狀與 root 相同
- 再接回（副視窗重整、換分頁）：`{ type: "btw", id, session }` 附掛既有 side session；`session` MUST 是本 thread root 的 fork，否則 error code `UnknownSession`。綁定存在連線 state，hibernation 喚醒後保留
- 每次不帶 `session` 的 `btw` 都 fork 新的 side session（fork 點＝當下 root 最新 entry）；舊 side session 留在 DO storage
- 錯誤 code：`NothingToFork`（root 尚無 entry）、`UnknownSession`、`SubmitForbidden`（開新 side session 與 submit 同權限：限 thread 學生本人；老師可附掛觀察）
- 規則同 root：no queue（side session 與 root 各自 busy，互不阻擋）、活動結束後 submit → `ActivityFinished`、run 失敗的無 id `llm_unavailable` 廣播只送給綁在該 session 的連線

### 5.5 單人自由提問對話（Solo chat，#281）

免教室的自由提問（不經 activity/participant 語意，以登入使用者為 thread owner）。

#### 5.5.1 REST 端點

| Operation                                                 | 說明                                                             |
| --------------------------------------------------------- | ---------------------------------------------------------------- |
| `GET /api/solo/threads` → `SoloThread[]`                  | 列出登入者的所有 solo thread（依 `updated_at DESC`）。未登入 401 |
| `POST /api/solo/threads` `{title?}` → `SoloThread`（201） | 建立新 solo thread（`id` 為 `solo_…`）。未登入 401               |
| `GET /api/solo/threads/:id` → `SoloThread`                | 取得單一 thread 資訊。非本人 404                                 |
| `PATCH /api/solo/threads/:id` `{title}` → `SoloThread`    | 變更 thread 標題。非本人 404                                     |
| `DELETE /api/solo/threads/:id` → 204                      | 移除 thread 的 D1 紀錄並撤銷存取。非本人 404                     |

`SoloThread`：`{ id: string, title: string, createdAt: string, updatedAt: string }`

#### 5.5.2 WebSocket 通道

- `GET /agents/solo-chat/:name?lang=<介面語言>`（WebSocket 升級）
- thread name 協定：`{userId}:{threadId}`（DO name 即路由鍵，由獨立的 `SoloChat` DO 服務）
- 連線時驗證 `socrates_session` 和 D1 thread ownership，喚醒及收到指令時重新驗證。驗證失敗以 close 1008 結束連線。
- 對話的 credential owner 和 fallback 見 [Gateway](./architecture.md#5-gatewayappsserversrcgateway)。
- `DELETE` 後拒絕新連線與既有連線的後續指令。D1 刪除不會清除 Durable Object transcript。
- 通訊協定：完全維持既有 WebSocket chord protocol（§5.2、§5.3、§5.4 BTW side session 均支援），既有客戶端邏輯可 100% 複用

## 6. 老師即時面板（#73）與測試模式 slot（#134）

### 6.1 test 活動與 slot（#134）

老師可以用測試模式自己跑完整對話，不需要學生在場。`activities.mode = 'test'` 的活動**不寫** `classrooms.current_activity_id`，所以班級邀請碼、`GET /classrooms` 的 `current`、首頁均看不到它；同時 `activityAccess` 在 test 活動對非該班 owner 一律 403，報告頁、WS 亦同。

| Operation                                                                | 說明                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/activities/:id/slots` → `ActivitySlots`                        | 老師專屬（該班 owner）。僅 `mode = 'test'`（否則 409 `conflict`）→ `{activityId, mode, maxSlots: 6, slots}`；每個 slot 為 `{id, name, rounds, lastUtterance}`（`id` = participant id，rounds 由 Chat DO 的 pi transcript 即時彙總）                             |
| `POST /api/activities/:id/slots` `{count: 1–6}` → `ActivitySlots`（201） | 建立 `kind = 'teacher'`、`user_id` = 老師的 participant slot；名稱由伺服器依 `Accept-Language` 產生（`測試 1`／`Test 1`／`Prueba 1`）。總數上限 6（`ACTIVITY_SLOT_MAX`；超出 → 409 `conflict`）；活動已結束 → 409 `activity_finished`。slot 不新增 `members` 列 |

- 每個 slot 是一條獨立的 Chat DO thread（`{activityId}:{participantId}`），同一老師帳號可同時在 1–6 條 thread 上 `submit`（slot 的 `user_id` 就是老師）；這也取代了「單人模式」（#136 已定）
- `finish` 照常觸發 ReportRunner，報告母體就是這些 slot（§7）；`GET /activities/:id?participantId=` 讓老師取得 slot 的 thread 名（見 §3）

### 6.2 即時面板（#73）

`GET /api/activities/:id/live` → `ActivityLive`。只有該班 owner 的登入 session 可讀取。未登入回 401 `unauthorized`，帳號停用回 403 `account_disabled`，非 owner 回 403 `forbidden`，活動不存在回 404 `not_found`，`test` 活動回 409 `conflict`。回應採用 `Cache-Control: private, no-store`。

| 欄位         | 語意                                                                             |
| ------------ | -------------------------------------------------------------------------------- |
| `activityId` | 活動 ID。                                                                        |
| `finishedAt` | ISO 8601 timestamp。活動進行中為 `null`，結束後仍可查詢。                        |
| `asOf`       | Worker 讀完 snapshot 的時間，採 ISO 8601。學生摘要為 eventual consistency。      |
| `students`   | 每個 `member`／`guest` participant 一列，依 participant ID 排序。空名單回 `[]`。 |

每列 `StudentLive` 欄位如下。

| 欄位                     | 語意                                                                                                                                          |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`, `name`             | Participant ID 與活動內顯示名稱。                                                                                                             |
| `status`                 | `not_started` 表示 snapshot 內尚無已同步的發言。最近 120 秒曾發言為 `active`，其餘已發言者為 `idle`。既有活動的摘要尚未初始化時為 `unknown`。 |
| `rounds`, `lastActiveAt` | 已 commit 的學生發言數、最後一次學生發言的 ISO 8601 timestamp。未發言時分別為 `0` 與 `null`，摘要未知時兩者為 `null`。                        |
| `flags`                  | 每種類別保留最新一筆 `{id, type}`。ID 在同一 participant 內穩定。沒有已記錄的標記為 `[]`，摘要未知為 `null`。標記是供老師確認的訊號。         |

老師面板建議前景每 5 秒查詢一次。重新連線時載入完整 snapshot，收到 `finishedAt` 後可停止輪詢。實作採用 [D1 projection](./architecture.md#135-d13-event-layer)。

## 7. 活動結束與報告（#74/#78/#79/#72）

| Operation                                                                                       | 說明                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/activities/:id/finish` → `204`                                                       | 老師結束活動 → ReportRunner DO `startReport`（alarm 驅動，非同步）。冪等；老師專屬                                                                                                                                                                                                                                                                                                                                                                               |
| `GET /api/activities/:id/report` → `TeacherReport \| StudentReport`                             | 生成中 404 `report_pending`（前端輪詢至 200）；失敗 500 `report_failed`（重打 `finish` 可重觸發）；**partial**＝群體生成失敗（第一次失敗即落 partial；重試不存在於 alarm 迴圈）但個別報告已存——200 回應，`classReport: null`、`positions: []`（重打 `finish` 可重觸發全量；alarm 層的重試耗盡才是 `failed`）。**角色分流**：老師見全班＋個人；帳號可讀本人 participant 的報告（含離班後），無 classReport；學生的報告不存在（無 transcript 等）→ 404 `not_found` |
| `PUT /api/activities/:id/engagement-visibility` `EngagementVisibility` → `EngagementVisibility` | 老師設定認真度（`engagement`）除了老師的單人報告之外還顯示在哪裡（#267）：`classReport`＝群體報告（以 pseudonym 列出），`student`＝學生本人的報告。兩者都 MUST 帶（缺欄位 422 `validation`）；預設皆 `false`；隨時可改、可在報告生成前後設定，讀取報告時才套用（不重新生成）。老師專屬（非 owner 403 `forbidden`），test 活動同樣可設                                                                                                                            |

**報告形狀（#74，PR #109 的分析為核心；`pseudonym` 生成一次存 D1，活動內穩定；#72 全去識別化）**：

```ts
// LLM 分析輸出（shared/reports.ts）
interface StudentAnalysis {
  stated: true; claim: {text; turns}; reasons: {text; turns}; tension: {text; turns} | null;
} | {
  stated: false; doing: {text; turns};   // 未表態：做了什麼（離題/早退…）
}
interface Indicator {
  level: 0 | 1 | 2 | 3;                          // 0＝這場對話沒有可判斷的證據，不代表能力差
  turns: number[];                               // level 0 時為空陣列；1–3 時至少一個，都必須是學生說過的行號
  evidence: string;                              // 一句依據說明（老師的語言）；內容只由 prompt 要求，server 不檢查（level 0 時要求空字串）
}
interface ThinkingIndicators { c1: Indicator; c2: Indicator; s1: Indicator; s2: Indicator; a1: Indicator; a2: Indicator }  // 六項思辨力指標（#255）
interface Engagement { substance: Indicator; uptake: Indicator; focus: Indicator }  // 認真度（#267）：實質發言／回應追問／切題，判斷原則與 Indicator 規則同 ThinkingIndicators
interface EngagementVisibility { classReport: boolean; student: boolean }  // 認真度另外顯示在群體報告／學生本人報告；預設皆 false
interface ClassReport {
  students: {id; summary: {step; turns}[]}[];   // 逐生摘要（cause → result 步驟＋出處行號）；空陣列＝全班未表態
  unstated: string[];                            // 未表態者
  axes: {name; low; high; positions: {id; turns; view; end: "low"|"middle"|"high"; at: 0-100}[]; why}[];  // 立場軸＋落點；空陣列＝無分歧（overview 照實寫）；報告依老師的軸與軸數產生時（ReportRunner `startReport` 帶 `axes`），每條軸列出全班，無符合條件的發言時回空陣列
  overview: string[];                            // 全班整理
}

interface ReportPosition {                       // 單人落點：從 classReport.axes[].positions 以 pseudonym 對出（不經 LLM，與全班報告一致）
  axis: string; view: string; end: "low"|"middle"|"high"; at: number;
}

// API 回應（組合層）
interface TeacherReport {
  topicTitle: string;
  classReport: ClassReport | null;               // null＝partial（群體生成失敗，個別報告仍可用）
  engagementVisibility: EngagementVisibility;    // 老師的勾選狀態；classReport＝true 時群體報告頁以 pseudonym 列出全班認真度
  students: Array<{                              // array 保序（joined_at）；只列真的有對話的參與者
    participantId: string;                       // 活動 participant id——僅老師可見（真實身分在 members／users）
    participantName: string;                     // 參與者名稱（老師個別頁與學生本人頁顯示；classReport 仍用 pseudonym）
    pseudonym: string;
    analysis: StudentAnalysis | null;            // 論點總結（claim/reasons/tension＋turns 出處）
    indicators: ThinkingIndicators | null;       // 思辨力指標，與 analysis 分開判斷、各自失敗；null＝沒有對話、重試後仍失敗，或指標上線前的舊報告
    engagement: Engagement | null;               // 認真度，老師一律看得到；與 analysis、indicators 分開判斷、各自失敗；null 的意思同 indicators
    violations: ViolationSlice[];                 // 違規切片（不經 LLM）
    positions: ReportPosition[];                 // 每位學生自己的落點（partial 時為空）
  }>;
}
interface StudentReport {
  topicTitle: string;
  participantName: string;                       // 本人名稱（學生看不到別人的）
  pseudonym: string;                             // 自己在 classReport 中的定位線索（老師版可對照）
  analysis: StudentAnalysis | null;              // 自己的
  indicators: ThinkingIndicators | null;         // 自己的（null 的意思同 TeacherReport）
  engagement: Engagement | null;                 // 自己的；老師未勾 engagementVisibility.student 時一律 null（與失敗不區分）
  violations: ViolationSlice[];
  positions: ReportPosition[];                   // 自己在每條軸上的落點
}
interface ViolationSlice {
  turn: number;                                  // transcript 行號＝「學生（n）」的 n（app.violation entry 抽取時計算）
  type: ViolationType;                          // shared VIOLATION_TYPES enum
  excerpt: string;
}
```

- **學生不拿 classReport**（設計決策）：學生報告只有自己的 analysis＋indicators＋violations＋pseudonym（＋老師開放時的 engagement）；全班視角是老師專屬
- **認真度（#267）**：三個維度沿用 #255 的判斷原則——只看學生自己說的話、附和 AI 或只挑 AI 給的選項不算、level 0＝這場對話看不出來（不是對學生態度的評價）、不評判立場；等級與行號的查核和重試與 `indicators` 相同。可見性是讀取時套用的老師設定（`activities.engagement_to_class`／`engagement_to_student`），學生版在 server 端就把 `engagement` 換成 `null`，不靠前端隱藏；群體報告的開關只影響老師的群體報告頁（資料老師本來就有），讓投影到全班時預設不露出認真度
- **`violations` 的收斂住在報告層**：`transcript()` 回傳 transcript 裡全部的 `app.violation` entry（忠實反映 entry 身分），報告組裝時才依 `turn + type + excerpt` 收斂為一筆、保留先寫入者——同一輪 classifier 與 `report_violation` 工具都回報時，老師看到與分析模型讀到的仍是單筆
- **報告母體＝有對話的 `activity_participants`**（#132）：沒進活動的班級成員、進了活動但**一句都沒說**的參與者都不產生空報告——本人報告頁 404 `not_found`，classReport 的 roster 也只含真的有對話的人；test 活動（#134）的母體就是它的 `teacher` slot；`student_reports` 的 JSON key 與 WS thread 名的後半段同為 participant id；pseudonym 序號**不依加入順序**（#133）：以 `HMAC(AUTH_SECRET, (activityId, participantId))` 排序後給 1..n，避免老師用報到時序反推訪客身分（既有 pseudonym 存 D1，活動內穩定不變）
- 報告母體為空時，兩種設軸模式均直接生成可讀的群體報告。`classReport.students`、`unstated`、`axes` 與個別報告 `students` 皆為空陣列，`overview` 以老師的語言說明無人發言。
- **`ClassReport.students[].id`／`positions[].id`＝pseudonym**（LLM prompt 餵的就是 pseudonym；嚴禁放 participantId 或 userId——全班互見會洩漏真實 id，#72）
- transcript 來源：Chat DO RPC（`stub.transcript()`，DO→DO；外部無 request 面）；violations 同源自 `app.violation` entries——**pi transcript 是唯一真相，violations 不落第二份儲存**
- 逐生分析與 transcript 抓取以 Router budget 批次進行（`budget("batch")`＝鏈上各 leg maxConcurrency 總和；10k 班級的生成時間與供應端限流考量）
- 立場星圖（#79）不新增契約欄位：前端直接從 `classReport.axes[].positions` 映射——座標＝`at`（0–100 線性對到軸的兩端），每條軸一個維度，學生沒談到的軸沒有 position（前端放在該軸中間、標為空心、不納入分群）；報告依老師的軸與軸數產生時，每位學生在每條軸上都有 position，沒談到的是 `end: "middle"`、`at: 50`。分群在前端做（階層式 Ward，#58），不落儲存
- hexagon（#78 六角圖）直接由 `indicators` 映射（`C1–A2`，四級 0–3：未觀察到／初步／部分／達成，右側附上依據與行號；`indicators` 為 `null` 時不顯示）

`GET /api/me/reports` 列出登入帳號已有個人報告的 live 活動，含已離開的班級。列表形狀見 §4.1，item 為 `{activityId, classroomId, classroomName, topicTitle, finishedAt}`。排序依 report 建立時間及活動 ID，由新到舊。

## 8. 語音（#69）

| Operation                                          | 說明                                                                                                                                                                                         |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/stt`（multipart audio ≤15MB）→ `{text}` | 供無 Web Speech API 的瀏覽器（Firefox）；支援者前端自走原生                                                                                                                                  |
| `POST /api/tts` `{text, lang}` → audio stream      | server-side 為保證路徑；`text` ≤ `TTS_MAX_CHARS = 4000`（shared `TtsInputSchema`，客戶端 `lib/speechArbiter.ts` 同步在句尾截斷）——嘴型驅動用 amplitude：`Api.tts(text, onAmplitude, signal)` |

## 9. 查詢與 teacher keys

| Operation                                                                                                                                                                        | 說明                                                                                                                                                                                                                                                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/lookup` `{term}` → `{term, markdown}`                                                                                                                                 | #76 獨立查詢功能（lookup profile：agent 自主 search/fetch）；**不落庫不計輪**。失敗或模型回空白 → 502 `llm_unavailable`；只有 `LLM_PROVIDER=mock` 回固定說明（回應帶 `X-Socrates-Fallback: mock`）。termHistory 由前端 localStorage 持久化，無端點                                                                                                                                                       |
| `GET /api/settings/keys` → `{provider, last4, maxConcurrency, monthlyQuotaUsd, monthCostUsd, monthTokens, sortOrder, updatedAt, models: {model, maxConcurrency, sortOrder}[]}[]` | #152 teacher keys；**一 provider 一把 key（帳戶級）＋多個 model 腳位**；key 明文永不回傳；provider 層 `maxConcurrency`＝該 provider 全部腳位的總併發上限（`null`＝不限）；`models[].maxConcurrency: null`＝跟隨 `teacherChain.maxConcurrency`；`monthlyQuotaUsd`＝額度警示分母（`null`＝無額度）；`monthCostUsd`/`monthTokens`＝本月累計（UTC 月曆，見 [`providers.md`](./providers.md) § Teacher keys） |
| `PUT /api/settings/keys/:provider` `{key?, maxConcurrency?, monthlyQuotaUsd?}` → `{provider, last4?, maxConcurrency, monthlyQuotaUsd}`                                           | 帶 `key`＝冪等 upsert（省略 `maxConcurrency`/`monthlyQuotaUsd`＝保留原值）；**僅帶 `maxConcurrency` 或 `monthlyQuotaUsd`**＝免重貼 key 只改該欄（`maxConcurrency` 1–100、`monthlyQuotaUsd` 正數 USD、`null`＝不限／無額度；無該 key row → `404 not_found`）。provider＝任意 pi builtin（api-key 類），非法 → 422 `byok_provider_invalid`                                                                 |
| `PUT /api/settings/keys/:provider/models` `{model, maxConcurrency?}` → `{provider, model, maxConcurrency}`                                                                       | 新增／更新 model 腳位（免重貼 key）；body 省略 `maxConcurrency`＝保留現值（新腳位 → `null`），明列 `null`＝跟隨預設；`maxConcurrency` 範圍 1–100；model 不在 catalog → 422 `byok_provider_invalid`；尚未貼 key 就加腳位 → 422 `validation`                                                                                                                                                               |
| `DELETE /api/settings/keys/:provider/models/:model` → `204`；無該腳位 → `404 not_found`                                                                                          | model id 需 URL-encode（含 `/`）                                                                                                                                                                                                                                                                                                                                                                         |
| `PUT /api/settings/keys/:provider/models/order` `{models: string[]}` → `{models}`                                                                                                | 同 provider 內腳位排序；未列出的排後面                                                                                                                                                                                                                                                                                                                                                                   |
| `DELETE /api/settings/keys/:provider` → `204`；無該 key → `404 not_found`                                                                                                        | FK cascade 同步移除其 model 腳位                                                                                                                                                                                                                                                                                                                                                                         |
| `PUT /api/settings/keys/order` `{providers: string[]}` → `{providers}`                                                                                                           | provider 排序；teacher legs 鏈序＝provider `sort_order` → 同 provider 內 model `sort_order`（#98/#152）；排序寫入同步更新 `updated_at`                                                                                                                                                                                                                                                                   |
| `GET /api/settings/keys/providers` → `{id, name}[]`                                                                                                                              | 可選 provider 清單（pi builtin catalog，api-key 類）                                                                                                                                                                                                                                                                                                                                                     |
| `GET /api/settings/keys/providers/:provider/models` → `{id, name}[]`                                                                                                             | 該 provider 的 model catalog（設定頁選單）                                                                                                                                                                                                                                                                                                                                                               |

- BYOK 設定屬於登入帳戶。各對話模式的 credential owner 見 [Gateway](./architecture.md#5-gatewayappsserversrcgateway)。
- **teacher keys 服務語意**（2026-11-09 定案）：老師 keys 的教室流量**老師鏈在前、平台鏈墊後**；teacher leg 的 provider/model 資料責任由 ToS 移轉給教師（平台僅保證平台鏈 ZDR）；ledger 以 `teacher:<userId>` credential 獨立記帳；within-turn fallback 僅存在於平台 binding 鏈（pi 機制限制），跨輪失敗由 ledger cooldown 接手

## 9.1 管理員：帳號與系統設定（#131、#159）

僅 `is_admin` 可呼叫；`is_admin` 只能由 seed 建立（首位 admin 在 `apps/server/src/seed.ts`），API 不可授予（PATCH 不支援 `isAdmin`，帶了會 422 `validation`）。

| Operation                                                              | 說明                                                                                                                                                                                                  |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/overview` → `AdminOverview`                            | 帳號層輕量計數（#185）：`{users, classrooms, runningActivities}`（`runningActivities`＝`activities.finished_at IS NULL`）。ops 維度（通道健康、配額、違規）屬 #80，不入此端點                         |
| `GET /api/admin/users` → `AdminUser[]`                                 | 全帳號：`{id, name, email, isAdmin, disabled, createdAt}`；排序 admin → 建立時間（#210：無能力欄位）                                                                                                  |
| `POST /api/admin/users` `{name, email, password}` → `AdminUser`（201） | 建立帳號（帳號無預設，登入即可建班）；email 重複 → 409 `conflict`；密碼 8–128（PBKDF2 同登入）                                                                                                        |
| `PATCH /api/admin/users/:id` `{disabled}` → `AdminUser`                | 停用／復用。一律 bump `session_version`（停用即刻踢掉既有 REST session 與 WS；復用後舊 token 不復活，需重新登入）。停用自己 → 409 `conflict`。（#210：能力調整已退役，`canManageClasses` 不再是欄位） |
| `GET /api/admin/settings` → `AdminSettings`                            | 讀取目前設定：`{reportAxes}`（`"teacher" \| "ai" \| "both"`）；D1 `settings` 未設定時 fallback 至 `providers.config.yaml` 的 `report.axes`（#159）                                                    |
| `PUT /api/admin/settings` `{reportAxes}` → `AdminSettings`             | 更新設定並回傳 `{reportAxes}`（自然鍵冪等）。變更立即生效，僅影響之後開啟的新活動（不回溯既有 `activities.report_axes`）                                                                              |

- 停用帳號的 WS：連線上的下一則 frame 被 1008 關閉，重連亦被拒（§5.1）
- 對應頁面 `/admin?tab=users`（`apps/web/src/routes/admin.tsx`，#185 tabbed console）：列表、建立、停用／復用（#210：能力調整已退役）；總覽 tab 消費 `GET /admin/overview`，通知 tab 發 `POST /admin/notifications`（§9.2）

### 9.2 通知與公告（#158 拍板，#239）

公告是平台維護訊息（登入頁顯示）；`unread` 是 per-user watermark（`users.notifications_seen_at`）——不是 per-notification 已讀表，`unread`＝`created_at > watermark` 的條目數，計數以 feed 內（前 30 筆）為準——超過上限的公告不會推高 `unread`（badge 封頂用途足夠；真實總數日後有需要再以獨立 COUNT 查詢提供），O(1) 讀取。

| Operation                                                               | 說明                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/notifications` → `NotificationFeed`                           | **免登入**（#158 拍板：登入頁公告用途）；`{items: Notification[], unread}`，最新在前、上限 30。`unread` 僅登入帳號回傳；未登入一律 `null`。無限流（read-only 成本低＋CF always-on DDoS 緩解；#187 feed 納入社群內容後再評估 edge rule／per-user limit，ceiling 需按單一 IP 合法尖峰校準避開校園 NAT 誤傷） |
| `POST /api/notifications/seen` → 204                                    | requireUser；watermark 設為 now（冪等——重打不變）；未登入 401                                                                                                                                                                                                                                              |
| `POST /api/admin/notifications` `{title, body}` → `Notification`（201） | requireAdmin（限流同 admin-create）；公告為單語內容（admin 撰寫語言，非 UI copy）；`created_by` FK（#233 帳號刪除時 SET NULL）                                                                                                                                                                             |

- `Notification`：`{id, title, body, createdAt}`——`kind` 欄位刻意不設（YAGNI：目前僅公告一種；#212 社群通知若需要再擴充）

### 9.3 管理員：admin BYOK keys（#354；母單 #353）

平台池的 keyed 腿（admin BYOK）：D1 AES-GCM 儲存（金鑰 `BYOK_ENC_KEY`）、**明文永不回傳（last4-only）**；credential class `admin:<keyId>`。**一個 provider 只能一把 key**（`UNIQUE(provider_id)`——pi 的 credential store 以 provider id 解析，同 provider 第二把 key 無法被歸因區分；擴容靠加 provider，不靠同 provider 堆 key）。腿進 chain 的排序與 cooldown 語意已隨 #355 落地（teacher → admin → YAML binding 三層，見 [`providers.md`](./providers.md) § Admin BYOK）；quota 觸頂＝該腿 skip 等月窗重置（UTC）。ZDR 核可閘門屬 #357。

| Operation                                                                                           | 說明                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/keys` → `AdminKeyStatus[]`                                                          | requireAdmin；`{id, provider, last4, maxConcurrency, monthlyQuotaUsd, monthCostUsd, monthTokens, sortOrder, updatedAt, models: {model, maxConcurrency, sortOrder}[]}`；`monthCostUsd`/`monthTokens`＝UTC 月曆累計（`admin_key_usage`） |
| `POST /api/admin/keys` `{provider, key, maxConcurrency?, monthlyQuotaUsd?}` → `AdminKeyEcho`（201） | requireAdmin（限流同 admin-create）；provider＝任意 pi builtin（api-key 類），非法 → 422 `byok_provider_invalid`；同 provider 已有 key → 409 `conflict`                                                                                |
| `PUT /api/admin/keys/:id` `{key?, maxConcurrency?, monthlyQuotaUsd?}` → `AdminKeyEcho`              | requireAdmin；帶 `key`＝換 key（last4 隨之更新）；僅帶限額欄＝免重貼 key 只改該欄（`null`＝不限／無額度）；無該 id → `404 not_found`                                                                                                   |
| `DELETE /api/admin/keys/:id` → `204`                                                                | requireAdmin；FK cascade 同步移除其 model 腳位與 usage／alerts rows                                                                                                                                                                    |
| `PUT /api/admin/keys/:id/models` `{model, maxConcurrency?}` → `AdminKeyModelEcho`                   | requireAdmin；同 §9 teacher keys 的腳位語意（catalog 驗證 422 `byok_provider_invalid`；`null`＝跟隨 `adminChain.maxConcurrency` 預設）                                                                                                 |
| `DELETE /api/admin/keys/:id/models/:model` → `204`                                                  | model id 需 URL-encode（含 `/`）；無該腳位 → `404 not_found`                                                                                                                                                                           |
| `POST /api/admin/keys/:id/zdr` `{retentionSource, verifiedAt}` → `AdminKeyEcho`（zdr 欄位）         | #357 ZDR 核可閘門（#389 改 key 級 attestation）：`retentionSource`＝官方 retention 來源 URL、`verifiedAt`＝查證日期（`YYYY-MM-DD`）；核可快照（含當下腿集合）寫入 audit log（§9.4）。未核可的 key 不進 chain                           |
| `PUT /api/admin/keys/:id/models/order` `{models: string[]}` → `{models}`                            | 同 key 內腳位排序；未列出的排後面；寫入含 `admin_key_model.order` 稽核（#390）                                                                                                                                                         |
| `PUT /api/admin/keys/order` `{keys: string[]}` → `{keys}`                                           | admin keys 鏈序（#355 router 排序依據）；含未知 id → 422 `validation`；寫入含 `admin_key.order` 稽核（#390）                                                                                                                           |
| `GET /api/admin/keys/providers` → `{id, name}[]`                                                    | requireAdmin；可選 provider 清單（與 §9 teacher keys 共用 catalog）                                                                                                                                                                    |
| `GET /api/admin/keys/providers/:provider/models` → `{id, name}[]`                                   | requireAdmin；該 provider 的 model catalog                                                                                                                                                                                             |

- 額度警示（60/80/100%）與 teacher keys 共用同一套 claim/lease/re-arm 機制（`gateway/quota-alerts.ts`，#146 模式抽出）；收件人僅 `ADMIN_ALERT_EMAIL`（zh）。

### 9.4 管理員：動作稽核（#359；母單 #353）

admin panel 直接操作生產鏈的前提：每個 admin 動作與其業務寫入以同一個 D1 `batch()` 提交——稽核失敗即整個操作失敗。`admin_actions`（migration 023）：`{id, actorId, action, target, before, after, createdAt}`；`before`／`after` 為純 JSON 摘要，**MUST NOT 含 key 素材**（last4-only）；`actor_id` FK `users` ON DELETE SET NULL（#233 慣例——帳號刪除保留紀錄、actor 為 null）。動作命名：`admin_key.create`／`admin_key.update`／`admin_key.delete`／`admin_key_model.upsert`／`admin_key_model.delete`／`admin_key.order`／`admin_key_model.order`（#390）；ZDR 核可（#357）與 teacher key 代管停用（#360）落地時寫入同一表。

| Operation                                                                    | 說明                                                                                                                |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `GET /api/admin/actions?limit&cursor` → `{items: AdminAction[], nextCursor}` | requireAdmin；新到舊（`id` DESC），`limit` 預設 30、上限 100，`cursor`＝上一頁最後一筆 `id`；匿名 401／非 admin 403 |

## 10. 錯誤碼

`code` 為 shared 的 `ErrorCode` literal union＋`ApiError`（帶型別 `code`），呼叫端 switch 窮舉有編譯期檢查。

| 層                     | code                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | HTTP                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| 通用                   | `unauthorized` / `forbidden` / `not_found` / `conflict` / `validation` / `rate_limited` / `internal_error`                                                                                                                                                                                                                                                                                                                                                                          | 401/403/404/409/422/429/500                  |
| 入場                   | `join_code_invalid` / `tos_required` / `name_taken` / `activity_finished`（新成員加入已結束活動）                                                                                                                                                                                                                                                                                                                                                                                   | 404/422/409/409                              |
| 活動邀請（#133）       | `invite_invalid` / `invite_revoked` / `invite_expired`                                                                                                                                                                                                                                                                                                                                                                                                                              | 404/410/410                                  |
| 帳號                   | `account_disabled`（停用帳號的請求／登入）                                                                                                                                                                                                                                                                                                                                                                                                                                          | 403                                          |
| 對話（WS error frame） | pi 錯誤名作 code（`ConversationBusy`＝忙線拒寫、`ActivityFinished`＝活動已結束拒寫、`SubmitForbidden`＝非本人 thread 代打）；內部錯誤只回 generic 訊息不洩細節                                                                                                                                                                                                                                                                                                                      | —                                            |
| 報告                   | `report_pending` / `report_failed`                                                                                                                                                                                                                                                                                                                                                                                                                                                  | 404 / 500                                    |
| 議題／活動（#159）     | `topic_axes_required`（以 `teacher` 模式開活動，但題目無價值軸）／`report_axes_not_allowed`（請求帶入 policy 不允許的模式，或在 AI 模式傳入 `topicAxes`）                                                                                                                                                                                                                                                                                                                           | 422 / 422                                    |
| 語音／LLM              | `llm_unavailable`（binding 或上游失敗，含 topics/generate、lookup；`LLM_PROVIDER=mock` 不丟這個碼）。上游限流／逾時**不另設碼**（拍板理由見 [`providers.md`](./providers.md) §上游失敗碼）                                                                                                                                                                                                                                                                                          | 502                                          |
| BYOK / teacher keys    | `byok_provider_invalid`                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 422                                          |
| 第三方登入（#124）     | `oauth_unavailable` / `oauth_state_invalid` / `oauth_email_unverified` / `oauth_failed`（登入失敗以 `/login?error=<code>` query 傳回；bind／reauth 失敗以 `<returnTo>?error=<code>` 傳回，非 JSON）                                                                                                                                                                                                                                                                                 | 302                                          |
| 登入方式綁定（#138）   | `reauth_required`（無效／過期的 `socrates_reauth`，或 session 版本已變）／`invalid_credentials`／`password_not_set`／`provider_already_linked`（bind start 409；callback 併發搶綁 302）／`email_already_linked`／`identity_not_found`／`last_login_method`（一種登入方式都不剩）／`last_verified_method`（僅剩未驗證 email＋密碼）／`reauth_identity_mismatch`（callback 的 session 與 pending 不符）／`identity_taken`（callback：綁定對象已屬他人，一律 302 `<returnTo>?error=`） | 403/401/409/409・302/409/404/409/409/302/302 |
| 自行註冊（#124）       | `email_taken`（`POST /auth/signup` 信箱已被使用）                                                                                                                                                                                                                                                                                                                                                                                                                                   | 409                                          |
| 密碼找回（#230）       | `reset_token_invalid`（`POST /auth/password/reset` 的 token 無效、過期、已使用，或帳號已停用）                                                                                                                                                                                                                                                                                                                                                                                      | 400                                          |
| Email 驗證（#259）     | `verify_token_invalid`（`POST /auth/email/verify` 的 token 無效、過期、email 已變更，或帳號已停用）／`email_not_set`（重寄對象的 `users.email` 為 NULL）                                                                                                                                                                                                                                                                                                                            | 400 / 409                                    |
| Email 驗證閘門（#437） | `email_unverified`（無 verified method 的 session 存取驗證流程以外的 API 或 WebSocket；亦為 `POST /auth/login` 拒絕未驗證 email＋密碼的回應碼，見 §2.3）                                                                                                                                                                                                                                                                                                                            | 403                                          |

## 11. 端點外的既存通道

- `GET /health` → `{ok: true}`（無需 session；deploy 後煙霧測試用）——production 回應僅此欄位；`ENVIRONMENT=dev` 時另帶 `warnings: string[]`，列出缺值的 fail-fast secret（`AUTH_SECRET`／`BYOK_ENC_KEY`，缺值時對應登入與 teacher-key 端點回 `internal_error`）
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
- teacher key 設定頁 UI（#82 前端；後端 API 已就緒）

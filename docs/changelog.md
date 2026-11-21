# Changelog（變更紀錄）

> 分支工作定案後記錄於此（標注分支；合併進主分支時更新連結）。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)。

## 2026-11-21 — 群體報告可依老師的軸與軸數產生（`feat/159-report-axes`，#159）

### Added

- `ReportRunner.startReport` 可帶 `axes`：群體報告改依老師的軸與軸數產生（流程見 `docs/architecture.md` ReportRunner）
- `report-submit-axes` extension 與 `submit_class_axes_report` 工具，只裝在這條路徑用的 registry

### Notes

- 沒帶 `axes` 時群體報告與 main 相同（prompt、工具、輸入逐字不變）；目前沒有後端路由傳 `axes`

## 2026-11-21 — glue 層收斂：violation 收斂移到報告層、TTS race 記為已知限制（`refactor/165-glue-decisions`，#165）

### Changed

- `transcript()` 不再對 `app.violation` 做內容去重：抽 `readTranscript(items)` 純函式負責 scan，回傳 transcript 裡全部的 violation entry——用字串拼出來的身份判斷（`${turn}:${type}:${excerpt}`）退場
- `collapseViolations()` 移入報告層（`do/report-runner.ts`，`transcriptOf` 收斂）：同一輪、同類型、同片段仍只呈現一筆且保留先寫入者——報告形狀、分析輸入、老師報告頁的違規切片完全不變（`test/transcript.test.ts` 五條紅線釘住兩側）
- `docs/architecture.md` §12 風險表新增：TTS 跨分頁仲裁的毫秒級 race 定位為已知限制，附重啟條件
- `docs/api-contract.md` §7：載明 violations 的收斂住在報告層

## 2026-11-21 — query key 全面收斂 queryOptions factory＋TanStack lint 上線（`refactor/277-query-options`，#277）

### Added

- `api/queries.ts`：query options registry——18 個 factory（`classroomsOptions`／`topicsOptions`／`classroomTopicsOptions(id)`／`activityOptions`／`teacherActivityOptions`／`activitySlotsOptions`／`reportOptions`／`joinOptions`／`inviteOptions`／teacher keys 三組／`adminUsersOptions`／`authProvidersOptions`／`notificationsOptions`／`devAccountsOptions`／`termHistoryOptions`／`qrOptions`），`queryFn` 走 `api` facade（同 `me.ts` 先例，保 mock 可測性）；per-call 差異（`enabled`／`select`）以 spread 覆寫於呼叫端
- **Lint 上線**：`biome-plugin-tanstack-query`（`@tanstack/eslint-plugin-query` 的 GritQL port，mirror upstream 5.104.1）掛入根 `biome.json` plugins——`recommended-strict` preset 含 `prefer-query-options`；維持「Biome owns formatting and linting」單一工具鏈政策（ESLint 窄域整合留作 fallback）
- Ratchet test `test/review/query-keys.test.ts`：字面 key（`queryKey: [`／`*QueryData([`／`invalidateQueries({ queryKey: [`）僅允許存在於 `api/queries.ts`／`api/me.ts`——plugin partial parity 的絕對保證（已插探針驗證會抓）
- `apps/web/AGENTS.md` deltas：query key 必經 factory 的規範與執法機制

### Changed

- 39 個字面 key 站點（16 keys、14 檔，含 2 處測試 mock）全數改引用 `*Options`／`.queryKey`——行為零變更：key 陣列內容逐一保持原樣（含 `["classrooms"]` 的 7+ 站點、`["activity", id, "teacher"]` 與 slot variant 的差異鍵、`enabled`／`select`／`retry` 等呼叫端覆寫全部保留）
- `QrBlock` 的 QR 查詢收進 registry（單一規則零例外，ratchet 才能寫死）

## 2026-11-21 — parseBody 全面退役與 transport 誠實性收尾（`refactor/268-parsebody-retirement`，#268）

### Added

- `rest.test.ts` parity 測試沿用 #264 基礎（envelope／guard 順序語意不變）；`api.e2e.test.ts` 新增 `createActivitySlots` raw-count 契約釘（transport 不夾持，server 端 `ActivitySlotCreateInputSchema` 為唯一權威）

### Changed

- 15 條非 param 路由全數自 `parseBody` 遷移 `validateJson`（auth login／register／signup／password forgot／reset、join、topics／topics generate、classrooms POST、admin users POST、admin notifications、lookup、tts、dev login、settings/keys/order PUT）——guard／rate limit 語意順序以 `rateLimit`／`guardUser`／`guardAdmin`／`devGuard` middleware 保序；wire shapes 零變更，server 235 條測試全綠
- `http.ts` 刪除 `parseBody`——server 端輸入驗證自此單一 pattern（`zValidator`）；stt 的 multipart form 解析維持手寫（非 body-json、無契約型別需求）
- `httpApi.createActivitySlots` 移除 transport 層靜默 clamp（原 1–6 夾持會掩蓋 UI 送出的超界值；UI 層 `t.live.$id.tsx` 本有 `planned` 夾持，超界改由 server 422 `validation` 誠實拒絕）
- `dev.accounts.tsx`／`join.$code.tsx` `["me"]` 字面 key 改 `meQueryOptions.queryKey` 共 7 處（join.×2、dev.accounts、AppShell 讀寫×3、join.a 的 invalidate）——#243 慣例單點
- `apps/server/AGENTS.md` module map：`parseBody` → `validateJson`／`validateQuery`／guard middlewares

## 2026-11-21 — server 路由 zValidator 遷移，收斂 web 端單一 hc 通道（`refactor/264-zvalidator-transport`，#264）

### Added

- `http.ts`：`validateJson`／`validateQuery`（包 `@hono/zod-validator`，hook 內 `fail(422, "validation")`——envelope 與 `parseBody` 完全一致）；`rateLimit`／`guardUser`／`guardAdmin` middleware——param 路由上按各路由原本的 guard／rate limit 順序保序（匿名無 body 請求仍 401；rate limit 先於驗證執行——壞 body 無法繞過限流，無效 body 亦計入配額，與 `parseBody` 時代一致）
- `app.ts` `onError`：hono 內部 `HTTPException` 補處理——malformed JSON（`Content-Type: json` 但 body 破損）維持 422 `validation` 而非 hono 原生的 400／500
- shared：`TeacherKeyEcho`／`TeacherKeyModelEcho`（PUT keys echo 的契約型別——補齊 `api-contract.md` L286-287 的 `last4?` optional＋`monthlyQuotaUsd`，終結 web 端 inline 型別的漂移）
- 回應構造補型別（`payload: JoinResult`／`InviteJoined`／`ActivityInfo`／echo 等）：hono client 推導的回應型別自此直接滿足 shared 契約，web 端零 cast
- 測試：`rest.test.ts` 二條 parity（malformed JSON → 422 `validation`；匿名無 body 的 param 路由 → 401）；`api.e2e.test.ts` 一條（`activityInfo` optional query 序列化無殘留）

### Changed

- 10 條 param 路由自 `parseBody` 遷移 `zValidator`（invites join、classrooms topics／activities、topics copy、activities slots、GET activities query、teacher-keys 三條 PUT、admin users PATCH）——wire shapes 零變更，server 既有測試零修改全綠（撰寫時 216 條，rebase 後 head 實測 235 條）
- `apps/web/src/api/http.ts`：`raw()` 手寫 fetch 整支移除，所有 method 收斂 `hc<RpcApi>`＋`unwrap`；`Api` interface 的 teacher-key echo 改用 shared 契約型別
- `GET /activities/:id` 的 `participantId` query 改 `validateQuery`（原先手寫 `c.req.query`）
- 非目標（維持 `parseBody`）：不帶 param 的路由（auth login/signup、topics、classrooms POST、dev、notifications 等）——hc 對其 `json` 寬鬆接受，full retirement 另行評估

## 2026-11-21 — 登入頁重設計：dithered colonnade、provider 探測、開放註冊（`split/178-login-page`，#178）

### Added

- Review suggestion 落實：重設 TTL 單一事實——`PASSWORD_RESET_TTL_MINUTES`（shared）由 server `auth.ts` 與 web 忘記密碼文案（`{minutes}` 插值，三語）共同引用，終結「30 分鐘」兩處維護
- 忘記密碼入口：登入模式表單尾「忘記密碼？」連至 `/forgot-password`（#230 交給本單的接線；`login_forgot` 三語）
- `routes/login.tsx` 重寫為 dithered colonnade 版面（`StoaField` 柱廊背景＋`comic-ground` 點陣）：hero 框、回故事頁連結、方形語言切換、登入／註冊模式切換、密碼直顯表單（顯示／隱藏切換掛 `aria-controls`）、邀請碼虛線表單（導向 `/join/$code`）
- OAuth 按鈕按 `GET /auth/providers` 能力探測渲染（該端點即為本單解鎖，#207）：啟用的 google／facebook 渲染為連結，未啟用渲染虛線停用鈕；`api.authProviders()` 回 shared 契約型別 `OAuthProviders`，enabled set 由頁面端推導
- 公告欄（NoticeBar）消費 `GET /notifications`——feed 免登入為 #158 拍板的登入頁用途；fetch 失敗整條不渲染，日後 feed 語義隨 #187 社群化收緊時零改動退化
- `api.signup({ name, email, password, tosAccepted })`：`tosAccepted` 顯式經呼叫鏈傳遞（對齊 `joinByInvite` 慣例），server 端 `tos_required` 閘門保持有效
- 已登入者 guard redirect（`meOf`；admin 無 `next` 參數導 `/admin`，其餘走 `safeNext`）
- i18n 三語新增：`login_guest_hint`、`login_facebook`
- 測試：`routes.test.tsx` 四條 #178 契約（探測渲染＋無 demo／guest 入口、未設定 provider 與 feed 失敗的退化、admin redirect、註冊模式 name+email+password+ToS 閘門與 POST body）；`api.e2e.test.ts` 三條（`authProviders`／`notifications` 契約路徑、`signup` body＋session announce、`email_taken` 錯誤映射）

### Changed

- 依 #204「設計先行、不照 web-next 分支實作」原則適配 main 帳號模型：登入欄 email-only（main 無 identifier／username 契約，`docs/accounts.md` §5）；註冊模式必填 `name`（`SignupInputSchema`）；錯誤映射同時收 `email_taken` 與 `conflict`
- me query 改用 `meQueryOptions`（#243 慣例），登入成功寫回 `meQueryOptions.queryKey`
- 密碼欄改 `label htmlFor`＋`input id` 分離結構（切換鈕不包在 label 內，accessible name 不受污染）

### Removed

- `landing/LandingChrome.tsx`＋`landing.css`（`/login` 為唯一消費者，#177 時保留至此退場）
- demo 教師一鍵登入按鈕與 `login_demo_teacher` i18n key（dev fixture 登入由 `/dev/accounts` 承接）
- web-next 稿的 `useGuestSessionExpired`／guest 逾期通知（main 訪客 `user:null`、無 guest session 機制）與 login 頁 `storage` 監聽（跨 tab 同步職責屬 AppShell `useSessionSync`，#179）

### Fixed

- `raw()` 補上 204 guard：`DELETE /settings/keys/:provider/models/:model` 回 204 空 body，原實作直接 `res.json()` 會拋 SyntaxError（`unwrap` 有 guard、`raw` 漏同步——雙運輸通道的直接代價）；regression test 於 `api.e2e.test.ts`
- 錯誤解包四份複製（`unwrap`／`raw`／`stt`／`tts`）收斂為單一 `raiseApiError`
- `joinAsGuest` 簽名改顯式 `{ name?, tosAccepted }`：原 transport 層硬編 `tosAccepted: true`，server 的 `tos_required` 閘門從此 client 永不觸發；呼叫端（`/join/$code`）改傳真實 checkbox 狀態

## 2026-11-21 — Email 帳號密碼找回（`feat/230-password-reset`，#230）

### Added

- `POST /api/auth/password/forgot`、`POST /api/auth/password/reset`（契約見 [`api-contract.md`](./api-contract.md) §2.2）：無狀態 token（簽章綁定目前 `password_hash` 與 `email`、依用途推導金鑰、30 分鐘），重設成功 `session_version + 1`；錯誤碼 `reset_token_invalid`（三語訊息）
- 三語重設信模板（`mail.ts`，寄件人沿用 `ALERT_FROM_EMAIL`）；寄信走 `waitUntil`，寄送失敗只記 log
- `/forgot-password`、`/reset-password` 頁面（只用既有 `components/ui`；入口已接線 `/login`，#178）
- `tests/password-reset.test.ts`（17 tests：寄信與不寄信的情況、單次使用、雙連結、並行重設、session 失效、過期、竄改、跨用途、密碼或 email 在別處變更、停用、fail-open、限流）＋ `test/password-reset.test.tsx`（5 tests）

### Changed

- Worker 入口（`index.ts`）把 `ExecutionContext` 傳給 Hono，路由可用 `c.executionCtx.waitUntil`（先前入口沒有傳入，`waitUntil` 無法使用）

## 2026-11-21 — speech 仲裁政策抽離：`SpeechArbiter` 與注入式環境（`refactor/165-speech-arbiter`，#165）

### Added

- `lib/speechArbiter.ts`：`SpeechArbiter` 持有 TTS 單通道的全部自家狀態（意圖序、當前播放、跨分頁播報），依賴經 `SpeechEnv` 注入（transport／mute／speakingSource／跨分頁 announce／字數上限）；`defaultSpeechEnv` 為瀏覽器實作，`dispose()` 退訂跨分頁監聽
- `test/speechArbiter.test.ts`（5 tests，全為 ctor fakes、零 global stubbing）：兩個實例互不干擾、意圖優先序、靜音短路、注入式字數上限的句尾截斷、他分頁播報中斷本頁與 `dispose` 退訂

### Changed

- `lib/speech.ts` 退化為 facade：公開簽名（`markIntent`／`stopSpeech`／`speak`／`speakableText` 與兩個 type）不變，模組級可變狀態（`intentAt`／`sequence`／`active`／`BroadcastChannel`）全數移入 `SpeechArbiter` 實例；`test/speech.test.ts` 既有仲裁迴歸測試在新結構下全綠
- 行為零變更：跨分頁仲裁、打斷／跳過／靜音優先序、句尾截斷與 `TTS_MAX_CHARS` 預算皆與前一版一致

## 2026-11-21 — 帳號接線：meOf guards、join 雙軌、登出清殘留（`split/181-account-wiring`，#181）

### Added

- `api/me.ts`：`meOf` 統一 guard 輔助——identity 查詢失敗 `.catch(() => null)` 視為未登入（redirect 取代 error boundary）；九個 guard 路由全數收斂（home／dialogue／settings／t.setup／t.live／admin.users／classrooms×2／report）
- `/join/:code` 帳號／訪客雙軌（#136 帳號模型接線）：登入直入免填名（`POST /join` 不帶 `name`、join 後落地班級頁）；訪客走選擇卡 → 填名＋ToS；`join_as` 帳號卡＋切換帳號；`JoinResult.user` 寫回 `["me"]` 快取並失效班級查詢
- `routes.test.tsx` F01b／F01c（帳號直入不重填名；POST body 不含 `name`）＋ guard 失敗 redirect 測試

### Changed

- `api.joinAsGuest(code, name?)`／`api.joinByInvite(token, { name?, tosAccepted })` 簽名對齊 server（`JoinInputSchema.name` optional；invite 不再送空字串 name）
- 登出清 `socrates_terms`／`socrates_activity` localStorage 殘留（`clearLocalUserState`）
- `/join`（index）改 redirect `/classrooms`（入場改由班級頁的邀請碼欄）

## 2026-11-21 — 殼層重構：side rail、compact 帳號選單、跨 tab session 同步（`split/179-appshell`，#179）

### Added

- `useSessionSync`：focus／visibilitychange 重查 `me`、`storage` 事件跨 tab 同步（`SESSION_SIGNAL_KEY`）——identity 變更 reload、`isAdmin` 變更更新快取並失效班級查詢；announce 段自 #181 提前（`http.ts` 於 login/logout/devLogin 後寫入，前例：#193 自 #183 提前 speech.ts）
- `test/appshell.test.tsx`（9 tests：store、跨 tab 重查、identity reload、admin 權限更新、rail/選單結構、ht-theme、bare route）＋ announce 契約測試（`api.e2e.test.ts`）

### Changed

- AppShell 重構：halftone rail（品牌塊、Home/Classrooms、admin 桿、主題方鈕、頭像）；drawer／帳號 popover 改走共用 `TrapDialog`（W8 收斂，本地 focus-trap 移除）；帳號選單改 compact popover（名稱／設定／登出——語言切換歸設定頁 #184，admin 連結改 rail 桿）；`ht-theme` 內頁效果層接線（`HALFTONE_MATCH` 路由）；`accountSheet` 改 `useSyncExternalStore`；`__root` 返回鈕邊角對齊
- AppShell 的 `useEffect` 全數退場（render-phase 狀態對照＋`useDomEvent`）——#188 gating 表再退一格

## 2026-11-21 — useVoiceInput controller 重構：環境注入、零 global stubbing（`split/166-voice-controller`，#166）

### Added

- `test/voiceInput.test.ts`（16 tests，依賴全為 ctor fakes、零 global stubbing）：unsupported×2、denied／failed 判別、權限彈窗期間按停、start 重入、`onresult` final／interim 累積、`onerror` 四型別、`onend` 自動收尾、fallback 錄音→stt 恰一次、`onstop` 沉默保險、stt 失敗映射、60 秒自動停、`dispose` 清理

### Changed

- `useVoiceInput` 依賴全面注入：抽 `lib/voiceInput.ts` 的 `VoiceInputController`（`VoiceEnv` 注入 getUserMedia／AudioContext／recognition ctor／MediaRecorder／rAF／lang／stt），hook 退化為薄 state adapter；行為零變更（`voice.test.tsx`／`trace.test.ts` 安全網全綠）；死碼 `startedAt` 欄位移除
- review 建議二項：`stop()` 的 1s 保險計時器改為僅在實際停錄時排程、`onstop` 正常觸發即清除（正常 stop 不再殘留 timer，`vi.getTimerCount` 測試釘住）；hook 移除未使用的 `env` 參數（注入縫在 `VoiceInputController` ctor，`defaultVoiceEnv` 為 hook 唯一環境）

## 2026-11-21 — Notifications feed、已讀 watermark 與 admin 公告端點（`feat/239-notifications`，#239）

### Added

- `GET /api/notifications`：免登入公告 feed（#158 拍板——登入頁維護公告用途）；`{items, unread}`，最新在前、上限 30；`unread` 僅登入帳號回傳，未登入一律 `null`
- `POST /api/notifications/seen`：requireUser，per-user watermark（`users.notifications_seen_at`）設為 now；冪等
- `POST /api/admin/notifications`：requireAdmin 撰寫公告（單語內容；`created_by` FK，帳號刪除時 SET NULL——相容 #233）
- Migration `012`：`notifications` 表＋`users.notifications_seen_at` 欄位；已讀採 watermark 而非 per-notification join 表（unread＝`created_at > watermark`，O(1)）

### 決策記錄

- #158 三項拍板（2026-11-21）：成員移除 cascade 改變→#237；root post CASCADE 維持（門留著）；feed 免登入維持——本 PR 實作其第三項的端點面

## 2026-11-21 — SSO 擴充：Facebook 登入與 authProviders 能力探測（`feat/207-sso-providers`，#207）

### Added

- `GET /api/auth/providers` → `{providers}`——能力探測端點（#204 母單項目 1 缺口，解鎖 #178 登入頁按鈕渲染）：回傳依環境變數啟用的 SSO provider 清單，免 session、不讀 DB；`OAUTH_PROVIDERS` 契約型別入 `packages/shared`
- Facebook OAuth（web code flow）：dialog（state＋`scope=email`）→ server-side 換 token → `GET /me?fields=id,name,email`（帶 `appsecret_proof` hardening）；身分一律 `(facebook, id)`，email 為 informational（Meta 無 `email_verified` 信號，不參與身分判定，缺席照常建帳）；access token 用完即棄不落庫；Graph API pin `v27.0`；資料保留查證入 `google-oauth.md` §6.4
- Migration `011_facebook_identity.sql`：`user_identities.provider` 的 google-only CHECK 移除（provider 詞彙由 shared `OAUTH_PROVIDERS` 型別擁有，schema 不再複製同一事實）；既有 identity 列存活、cascade 保留
- `routes/auth.ts` 的 provider dispatch 抽象（`providerRuntime`）：start/callback 由 provider registry 分派，新增 provider＝一個 config reader＋authorize/profile 兩函數

### Changed

- `google-oauth.md` 擴域為「第三方登入（SSO）設定」（§6 Facebook、§7 Apple 退場指向）

### 決策記錄

- **Apple 登入退場**（`accounts.md` §7，2026-11-21）：Sign in with Apple 僅 Apple Developer Program 會員可設定（US$99／年，官方文件查證），且 web 流程要求 primary iOS/macOS App ID；fee waiver 限法人教育機構——日後條件成立可重開

## 2026-11-21 — Capability bit 退役：無 mode 帳號模型落地（`feat/210-capability-retirement`，#210）

### Changed

- 帳號模型無 mode 定稿（[`accounts.md`](./accounts.md) §7）實作落地：**任何登入 user 皆可建班與開活動**，`requireCapability("manage_classes")` 全數改為 `requireUser`（`POST /classrooms`、`POST /topics`、`topics/generate`、`POST /classrooms/:id/topics`、`POST /classrooms/:id/activities`、`POST /topics/:id/copy`、`POST /activities/:id/invites`、`/settings/keys/*`）；擁有權檢查（`classroomAccess` 的 isTeacher）照舊，非 owner 對他人班級仍 403 `forbidden`
- `User`／`AdminUser`／`DevAccount` 形狀移除 `canManageClasses`；`POST /admin/users` 建立帳號不帶能力欄，`PATCH /admin/users/:id` 僅剩 `{disabled}`（停用／復用，一律 bump `session_version`）——admin 的桿子收斂為帳號層：建立＋停用
- 前端最小接線（同 PR vertical slice）：`t.setup`／`t.live`／`settings` guard 改為登入即入；建班/開活動工具對所有登入 user 顯示；admin 頁「開通/收回權限」UI 退場

### Removed

- Migration `010_retire_capability.sql`：`users.can_manage_classes` 與 legacy `users.role` 欄位一併移除——帳號表不再有任何角色字樣，師生關係只存在於班級關係層；錯誤碼 `capability_required`（`ERROR_CODES`／`messages.ts` 三語）退場
- 錯誤碼清理（#221）：`already_streaming`（「舊客戶端」不存在——單一消費者原子部署）與未接線的保留碼 `llm_rate_limited`/`llm_timeout` 刪除——pi-durable 將上游失敗統一 settle 為 `model_error`，另設碼需解析 pi 內部訊息且 retry/backoff 本屬 pi 範疇（拍板記錄：`providers.md` §上游失敗碼）
- i18n 字典清理（#221）：刪除 82 個無消費 keys（三語）——main 與 web-next 皆零引用的舊稿文案（story_scene/hero_/landing_ 等），以及無 mode 定稿取消的段落詞彙（TeacherMode、teacher_plan/account_kind/plan、admin 教師申請 tab、教師建學生帳號的 students_* 舊稿——窗口拍板取代）；拆分單 #178–#188 的預載詞彙（login/admin/settings/community/chat 等）**保留**

## 2026-11-21 — 語音模式收尾：useVoiceInput effect-free、TTS 字數統一（`split/183-voice`，#183）

### Added

- `test/speech.test.ts`：speech 通道仲裁迴歸釘（打斷/跳過/靜音優先序，自 HEAD port）＋ 4000 字預算句尾截斷測試（TDD）

### Changed

- `TTS_MAX_CHARS` 2000→4000（shared 單點：server `TtsInputSchema` 與客戶端 `lib/speech.ts` 同步生效——#193 預留的「一行 diff」）
- `useVoiceInput` effect-free 重構：`useEffect`→`useLayoutEffect`／`useOnUnmount`、抽出 `startMeter`、去 `useCallback`（外部簽名不變；既有 `voice.test.tsx` 安全網全綠）——`useVoiceInput` 的 useEffect 退場（#188 前置之一）

### Fixed

- `docs/api-contract.md`：`/tts`「無 char boundary」漂移（實際一直有 `TtsInputSchema.max` 驗證）→ 明載 `text` ≤4000；輸入邊界總表補 TTS 上限

## 2026-11-21 — 設定頁重構：分類導覽與對話偏好（`split/184-settings`，#184）

### Added

- 設定頁分類導覽：section list（一般／對話體驗／API keys）＋ content panel，`?section=` deep link、`aria-current` 標示目前區
- 對話體驗區（純 client-side，接 #193 的 companion store）：蘇格拉底 3D 模型開關、語音朗讀、音量與聲線偏好
- `test/settings.test.tsx`：section 導覷切換、deep link、companion 接線、keys 區掛載

### Changed

- 設定頁版面由單欄卡片改為 200px 導覷列＋內容 panel；`ProviderKeys`（含 #146 月配額編輯器）原元件移植進 keys 區 re-skin；keys 區標題由元件自帶的 h2 承擔（不重複區標題）、section 導覽按鈕 focus ring 對齊設計系統（`focus-visible` ember）

## 2026-11-21 — Teacher BYOK 額度與警示 email（`feat/146-teacher-byok-quota`）

### Added

- 每個 teacher key provider 可設**每月額度（USD）**；設定頁 row 顯示本月累計 cost 與 tokens（`GET /api/settings/keys` 新增 `monthlyQuotaUsd`/`monthCostUsd`/`monthTokens`；`PUT` 免重貼 key 可改額度，#146）
- `usage` extension（pi `afterResponse` hook）記帳每個老師鏈 response 的 tokens 與 cost（pi `Usage.cost.total`：billed 優先、否則 catalog 估計；不存對話內容）；Chat DO、ReportRunner、topic-gen 三個 teacher 流程都已掛上
- 額度水位 60/80/100% **inline 檢測**（LiteLLM/Portkey 同款，無 cron）：以 `teacher_quota_alerts` PK 原子去重，同月同水位只寄一次，UTC 月曆跨月重置；寄送失敗自動重臂
- 佔位帶 60s claim lease（`claimed_at`/`sent_at`）：crash 產生的孤兒 pending 佔位會在 TTL 過期後被下一輪水位檢查偷走重寄，不再靜默漏水位
- email 走 Workers `send_email` binding（`ALERT_FROM_EMAIL`＝zone 位址、`ADMIN_ALERT_EMAIL`）；binding 缺失時 log-only fail-open。老師以其 lang 收信（zh/en/es），管理員收 zh 副本
## 2026-11-20 — 群體報告立場星圖（`feat/79-stance-constellation`，#79）

### Added

- `StanceConstellation`：老師的群體報告在「立場分佈」文字清單上方多一張立場星圖。每個點是一位學生（顯示假名），座標來自 `classReport.axes[].positions[].at`；勾 0–3 條軸做維度漸展（中間點 → 一條線 → 平面 → 立體），第 4 條會換掉最早勾的那條；立體時可拖曳或用方向鍵旋轉，可重設視角
- 分群：`lib/stance.ts` 的階層式分群（Ward，依 #58 決議）。「自動」在兩群重心距離超過門檻時停止合併，最多 5 群、且不超過人數的一半；老師可改成指定 2–4 群或不分群。圖下方列出各群成員與各軸平均落點
- 沒談到某條軸的學生：放在該軸中間、畫成空心點、不納入分群，圖下有說明；在所選軸上都有表態的學生不到 3 位時不分群並說明原因
- 三語 `stance_*` 字串；分群配色 token `--color-stance-1…5`（淺色／深色各一組），分群同時用形狀區分
- `test/stance.test.ts`（落點合併、layout 補間、投影、分群）與 `test/stanceConstellation.test.tsx`（維度漸展、分群、選點）

### Notes

- 以 SVG 加自寫投影實作，不走 three.js：點數是班級人數等級，SVG 讓 theme token、深色模式與 jsdom 測試都直接可用，也不需要 `useEffect`；動畫走 `createFrameLoop`，尊重 `prefers-reduced-motion`
- values-constellation-3d 的軌跡未移植：報告只有最終落點，沒有逐輪資料
- 後端與 `docs/api-contract.md` §7 的形狀零變動

## 2026-11-20 — 報告與蘇格拉底語言修正（`fix/report-and-socrates-language`）

### Fixed

- 蘇格拉底用學生的語言回答：原本只有一份中文 prompt、沒有指定回答語言，英文學生收到中文（glm-5.3-flash 實測 0/3）。改為中／英／西各一份 prompt（`socrates.md`／`socrates.en.md`／`socrates.es.md`），依學生連線時帶的 `?lang=` 挑選
- 單人報告改用老師的語言（原為各學生自己的語言；老師同時讀單人與群體報告）
- 單人報告引用的 turns 須是學生說過的行號，否則視同格式錯誤重試
- 群體報告落點：模型改給靠哪一端（left／middle／right）與堅定程度 1–5，`end`／`at` 由 server 換算（原本 glm-5.3-flash 把堅定程度寫成落點數字、把 high 讀成「支持題目的行動」，整班放反）

### Changed

- 報告 prompt 依 #161 整理：輸出格式從 `profiles.ts` 移進 `student-report.md`／`class-report.md`，刪去從未被讀取的 user template，語言佔位符改為 `{{lang}}`，輸入外框集中於 `prompts/assemble.ts`；送給模型的內容逐字不變，`prompts.test.ts` 以 snapshot 固定

## 2026-11-20 — LLM 失敗不再回傳假內容（`fix/160-no-canned-llm-content`，#160）

### Fixed

- `POST /api/topics/generate`、`POST /api/lookup`：沒有 `AI` binding 或 pipeline 失敗（lookup 含模型回空白）時回 502 `llm_unavailable`，不再回固定的假題目／假說明（前端原本分不出真假）；固定內容只在 `LLM_PROVIDER=mock` 回傳

## 2026-11-19 — 對話視圖重構：companion 小窗、ChatLayout、btw panel 接線（`split/180-dialogue`，#180）

### Added

- companion 場景層：`SocratesCompanion`（對話頁角落小窗，可拖曳、可關閉、主題切換墨色）、`StoaField`／`DotField` canvas、`lib/companion.ts`、`test/companion.test.tsx`
- 模組級 TTS 單通道 `lib/speech.ts`（跨 tab 仲裁；自 #183 語音單提前，`api.tts` 簽名相容）；`TTS_MAX_CHARS = 2000` 常數入 `packages/shared`（4000 統一待 #183 與後端）

### Changed

- 對話視圖改用 `ChatLayout`（sidebar overlay）；btw panel 接線進對話視圖，走既有 `/agents` WS、零協議變動；`useDialogue`／`useBtw`／`useSelectionPopover` 重構；`routes/dialogue.tsx` 橋接新 props（`threadId`／`userId`／`subtitle`）

### Removed

- `SocratesStage.tsx`（HEAD 終態，由 companion 小窗取代）

## 2026-11-19 — Landing 捲動故事頁（sprite sheet，取代 Lottie）（`split/177-landing`，#177）

### Changed

- `/` 改為捲動驅動漫畫故事頁：47 張 WebP sprite sheet 於 `<canvas>` 播放（視差、人群氣球、眼睛虹彩切換），rAF 走 `createFrameLoop`，尊重 `prefers-reduced-motion`；資產由 repo 外產出（Blender＋Pillow），更換時 bump `ASSET_VERSION`

### Removed

- `lottie-web` 依賴、`src/landing/` 故事實作（`LandAnimation`／`StorySection`／`story`／`useStoryTour`／`lottie.d.ts`）與 `public/landing/*.json`；`LandingChrome` 與 `landing.css` 保留至登入頁單（#178）退場

## 2026-11-19 — 內頁基礎層：視覺系統與 effect-free 架構（`split/176-base`，#176）

### Added

- 內頁視覺系統：`index.css` 的 `@theme`/halftone 變數與效果層
- `components/ui.tsx` primitives 重構：TrapDialog 收斂（ref-counted inert）、focus-trap 基準（`getClientRects` 濾器）、dialog title id 改 `useId()`
- effect-free 共用層：`hooks/useSubscription.ts`（`useSyncExternalStore`）、`lib/frameLoop.ts`（module-scope 共用 rAF loop）、`lib/motion.ts`
- i18n 全量字典（三語；併回 main 專用 key 維持拆分期間 t.setup/live 面板可用）

## 2026-11-17 — 各模式 thinkingLevel 依 #122 實測調整（`feat/122-thinking-levels`）

### Changed

- `PROFILES.socrates.thinkingLevel` 由 `"high"` 改為 `"low"`：#122 實測 high 只多 0.25 分，TTFT p50 卻從 4.5 秒拉長到 11.8 秒（實測結果見 #144 的 `providers.md` §8）
- BTW 不再沿用 root 的 level：`forkBtw` 在 fork 的 agent change 設 `BTW_THINKING_LEVEL`（`"high"`）
- lookup、topic-gen、student-report、class-report 維持 `"high"`
- 只影響新建立的 root conversation：已存在的 Chat DO 在 root 建立時寫入的 `"high"` 不會被改寫

## 2026-11-17 — code review 修復（`136-account-classroom-model`）

### Fixed

- **成員 display_name 優先**（#142 review W1）：訪客搶先以成員姓名入活動後，成員本人 join 原被 UNIQUE(`activity_id`, `display_name`) 擋成 409 `name_taken`；`ensureParticipant` 現在把 account-less 訪客列改名（`原名（訪客）`，再撞則 `（訪客 2）`…）讓成員取名原名
- 已綁帳號 participant 間的撞名改為新參與者加後綴（`原名 2`、`原名 3`…）而非 409；邀請連結加入的 `guest`（已綁 `user_id`）在帳號入班後由 `ensureParticipant` 升級 `kind` 為 `member`
- **slot 名稱撞名回 409 而非 500**（W2）：`POST /api/activities/:id/slots` 建名前先查活動內既有 display_name 跳號（`測試 1`、`測試 3`…）；併發撞 UNIQUE 時經 `uniqueViolationColumns` 轉 409 `name_taken`
- **slot 上限改為 batch 內原子護欄**（W3）：每條 INSERT 以 `WHERE (SELECT COUNT(*) …) < ACTIVITY_SLOT_MAX - i` 條件插入（D1 batch 同一交易，COUNT 含前面已插入列），併發兩次 POST 不再可能超過上限；未足額建立回 409 `conflict`
- ReportRunner 的 pseudonym HMAC secret 改用 `secretOf()`（AUTH_SECRET 缺失即 fail-fast，原 `?? ""` 會靜默退化為固定排序）

### Changed

- Docs：`api-contract.md` §2.1 明寫 `GET /activities/:id` 的 auto-join 寫入副作用、成員 display_name 優先規則與 `guest`→`member` 升級；測試：`invite.test.ts`（搶名回收、同名著被後綴、kind 升級）、`test-mode.test.ts`（slot 跳號）

## 2026-11-16 — #135 班級、活動、議題解耦（`136-account-classroom-model`）

### Added

- Schema `006_topic_classroom.sql`：`topics.classroom_id`（`NULL` = 系統題／個人題，`ON DELETE CASCADE` 隨班級）、`topics.copied_from`（`ON DELETE SET NULL`）、`topics_classroom` index
- `GET/POST /api/classrooms/:id/topics`（#135）：該班議題集；讀取需班級成員，寫入需該班 owner＋`canManageClasses`
- `POST /api/topics/:id/copy` `{classroomId}`：snapshot 成新 id 並歸入目標班級（`copied_from` 記來源）；改任一邊不影響另一邊
- `TopicSchema` 新增 `classroomId`；`TopicDraftSchema`／`TopicDraft` 供 `POST /api/topics/generate` 的未落庫候選（不含 `classroomId`）
- `/t/setup` 改成三步（建教室 → 議題集 → 開活動）；教室頁新增議題集（新增／AI 生成／複製既有）與「開新活動」區塊；`apps/web/src/components/ClassroomTopics.tsx` 為兩頁共用元件

### Changed

- **`POST /api/classrooms` 只建班級**：body 由 `{name, topicId}` 改為 `{name}`，回應由 `{classroomId, code, url, activityId, mode}` 改為 `{classroomId, code, url}`（`ClassroomCreated`）；活動建立移到 `POST /api/classrooms/:id/activities`，其回應獨立為 `ActivityStarted`。空班級（無議題、無活動）是合法狀態，`current` 為 `null`、邀請碼 404 `join_code_invalid`
- `GET /api/topics` 只回 `classroom_id IS NULL` 的系統題與自己的個人題——班級議題集不再混進個人題池；`POST /api/topics` 保留為個人題 legacy 入口
- `POST /api/classrooms/:id/activities` 驗證 `topicId` 屬於該班或為系統題／自己的個人題（其他班級的議題 → 404）
- `current` 語意明文化：指標為「最近一次 `live` 活動」（`test` 不寫入、結束不清除，`current.finished` 區分）；文件見 `api-contract.md` §4
- `activities.topic_id` 的 FK 維持 001 的預設動作：SQLite 的 `NO ACTION`（非 deferrable）與 `ON DELETE RESTRICT` 在本 schema 行為相同，且 topic 刪除不在本批範圍，因此不做 table rebuild
- 測試：`apps/server/tests/topics.test.ts`（空班級、議題集歸屬、權限、`current` 與 `test` 互斥、複製為獨立副本、系統題可用）；既有測試改走 `tests/helpers.ts` 的 `classroomWithActivity`／`startActivity`
- Docs：`api-contract.md` §1.1、§4（改寫）；`feature.md`、`frontend.md`、`architecture.md`（migration 清單）

## 2026-11-16 — #134 教師用測試模式（`136-account-classroom-model`）

### Added

- Schema `005_activity_mode.sql`：`activities.mode`（`live` | `test`，預設 `live`）
- `POST /api/classrooms/:id/activities` 接受 `{topicId, mode?}`：`live` 照舊更新 `classrooms.current_activity_id`，**`test` 不更新**——班級邀請碼、`GET /classrooms` 的 `current` 與首頁都不會看到測試活動
- `GET/POST /api/activities/:id/slots`（老師、該班 owner、僅 `test` 活動）：建立 1–6 個 `kind = 'teacher'`、`user_id` = 老師的 participant slot，伺服器依 `Accept-Language` 命名（`測試 1`／`Test 1`／`Prueba 1`）；回傳 `{activityId, mode, maxSlots, slots: [{id, name, rounds, lastUtterance}]}`，rounds 由 Chat DO transcript 即時彙總。總數上限 6（`ACTIVITY_SLOT_MAX`），超出 409 `conflict`
- `GET /api/activities/:id?participantId=`：老師可指定自己的 test slot，取得 WS thread 名的後半段（非本人 slot → 403）
- 教室頁「換一個主題」新增測試模式勾選（建完直接進 `/t/live/:id`）；`/t/live/:id` 對 `test` 活動渲染 slot 列表、建立數量選擇（含「建立後共 N 份學生分析」成本提示）與每個 slot 的獨立對話視窗；`/dialogue` 接受 `slot` search param
- 錯誤字串 `live_*`／`classroom_mode_*`（zh-TW／en／es）
- 測試：`apps/server/tests/test-mode.test.ts`（test 活動不進 `current`、學生／訪客 403、invite 409、slot 上限與權限、同一帳號 3 條互不干擾的 thread、結束後報告 3 位 pseudonym 且不影響 `live` 的 `current`）

### Changed

- `activityAccess` 對 `mode = 'test'` 的活動只放行該班 owner：`GET /activities/:id`、`/report`、`/slots`、`/invites`、WS 升級全部在源頭擋下（其他人 403／close 1008）
- `POST /api/activities/:id/invites` 對 `test` 活動回 409 `conflict`（測試活動沒有對外邀請入口）
- `ActivityInfo` 新增 `mode`；`ClassroomCreated` 新增 `mode`；`ActivityStartInputSchema` 新增 `mode`（預設 `live`）
- `apps/server/src/seed.ts` 的既有活動走 `mode` 預設值 `live`，fixture 不變
- Docs：`api-contract.md` §1.1、§2.1、§3、§4、§6（改寫）、§7、§12；`feature.md`、`frontend.md`、`architecture.md`（migration 清單）

## 2026-11-16 — #133 活動邀請連結與無帳號訪客（`136-account-classroom-model`）

### Added

- Schema `004_activity_invites.sql`：`activity_invites`（`token` PK、`activity_id`、`created_by`、`created_at`、`expires_at` nullable、`revoked_at`）；token 為 32 hex（128 bits），每個活動只有一條有效邀請
- `POST /api/activities/:id/invites`（老師／該班 owner）→ `ActivityInvite`；`GET /api/invites/:token` → `InviteInfo`（活動已結束仍回 200，前端顯示結束）；`POST /api/invites/:token/join` → `InviteJoined`（`apps/server/src/routes/invites.ts`）
- 獨立 cookie `socrates_participant`（`HttpOnly`、`SameSite=Lax`、7 天；簽章只帶 `aid`／`pid`／`exp`）與 `lookupParticipant`（`apps/server/src/auth.ts`）——**不覆寫 `socrates_session`**
- `/join/a/$token` 入場頁（`apps/web/src/routes/join.a.$token.tsx`）：活動預覽、姓名＋ToS、結束狀態；教室頁新增「活動邀請」卡（`QrBlock` 產生 QR，無新增圖片端點）
- 錯誤碼 `invite_invalid`／`invite_revoked`／`invite_expired`（404／410／410；`messages.ts` 三語同步）
- 測試：`apps/server/tests/invite.test.ts`（邀請穩定性、訪客不建 `users`／`members`、session 不被覆寫、thread slot 擁有權、撤回／過期、活動結束、pseudonym 序號）

### Changed

- **匿名加入不再建 guest user**（`POST /join`）：未登入者取得 `kind = 'guest'` participant 與 `socrates_participant` cookie，`users`／`members` 不新增列；回傳改為 `{user, activityId, participantId, kind}`（`JoinResult`）。已登入者仍走名冊（`kind = 'member'`）
- `GET /api/activities/:id` 接受 participant cookie（訪客只讀自己的 participant）；`GET /api/activities/:id/report` 對訪客一律 403——訪客事後回看報告不在本輪範圍
- WS 授權（`do/chat.ts`、`ws/sockets.ts`）：`SocketIdentity` 改為 `{userId: string | null, participantId, version: number | null}`；`authorize` 同時接受兩顆 cookie，`submit` 的擁有者規則改為「該 participant slot 屬於這條連線」（`user_id` 本人或無帳號訪客的 participant cookie）；reverify／每則 message 的重驗對訪客改讀 participant
- **pseudonym 序號改由 HMAC 決定**（`pseudonymRanks`）：以 `HMAC(AUTH_SECRET, activityId:participantId)` 排序後配 1..n，不再等於報到順序；既有 pseudonym 不變
- `pseudonym 序列依 joined_at` 的舊敘述同步為 HMAC 規則（`api-contract.md` §7）
- `POST /api/auth/register` 不變（帳號註冊仍建 member 與 participant）；`activity_participants` 的 `guest` kind 自本輪開始生產
- Docs：`api-contract.md` §1（cookie）、§1.1 授權矩陣、§2、§2.1、§3、§3.1（新）、§5.1、§7、§10、§12；`feature.md`、`architecture.md`（資料表清單）

## 2026-11-16 — #132 activity participant 成為對話與報告的母體（`136-account-classroom-model`）

### Added

- Schema `003_activity_participants.sql`：`activity_participants`（PK `activity_id` + `id`；`user_id` nullable 且 `ON DELETE SET NULL`、`kind`＝`member`／`guest`／`teacher`、`display_name`、`tos_accepted_at`、`joined_at`；UNIQUE(`activity_id`, `display_name`)）
- Backfill：既有活動以 `members` 建 `kind = 'member'` participant，participant id 即 `user_id`——既有 Chat DO thread（`{activityId}:{userId}`）與既有報告的鍵因此原樣續用
- `services/members.ts`：`participantOf`／`ensureParticipant`／`requireActivityAccess`（回傳呼叫者在該活動的 participant）
- 測試：`apps/server/tests/migrations.test.ts`（backfill 對映、帳號刪除後 participant 與 pseudonym 存活）

### Changed

- **thread name 協定**：`{activityId}:{userId}` → `{activityId}:{participantId}`（`do/chat.ts`：`authorize`／`reverify`／submit 的擁有者比對改讀 participant 的 `user_id`；`ChatSockets` 的 `CanSubmit` 可為 async，每次 submit 重驗）；`docs/api-contract.md` §5.1 與 `apps/server/tests/chat.test.ts` 同步——這是刻意的協定變更
- **報告母體**：`do/report-runner.ts` 改以 `activity_participants` 為母體，且只納入真有對話（transcript 有發言）的參與者——沒進活動的成員、進了活動但一句沒說的參與者都不再拿到空分析（本人報告頁 404）；pseudonym 序列與 `student_reports` key 均以 participant id 為準
- `pseudonyms`：`student_id` → `participant_id`，移除對 `users` 的 FK（改指 participant；訪客消失或帳號刪除都不斷鏈）
- `TeacherReport.students[].studentId` → `participantId`，並新增 `participantName`（`StudentReport` 亦有）：老師的個別頁以真實名稱列人（pseudonym 作為副標），學生自己的報告頁改顯示本人名稱（pseudonym 對學生無定位用途）；`StudentReportEntrySchema.participantName` 為 optional，舊 stored report 回退到 pseudonym
- `ActivityInfo` 新增 `participantId`：`GET /api/activities/:id` 回傳呼叫者在該活動的 participant（活動進行中且是班級成員時必要則建立）；web 的對話頁等它 resolve 後才掛載 WS
- `POST /api/join`、`POST /api/auth/register` 一併寫入 participant（活動進行中才寫）
- Docs：`api-contract.md` §1.1、§2.1（新）、§3、§5.1、§6、§7；`architecture.md`／`feature.md` 的資料表清單

## 2026-11-16 — #131 能力模型取代 role（`136-account-classroom-model`）

### Added

- Schema `002_capabilities.sql`：`users.can_manage_classes`（由 `role = 'teacher'` backfill）、`is_admin`、`disabled_at`、`session_version`
- `GET/POST /api/admin/users`、`PATCH /api/admin/users/:id`（`apps/server/src/routes/admin.ts`）：列表、建立帳號、切換 `canManageClasses`、停用／復用；`is_admin` 只能由 seed 建立
- `/admin/users` 管理頁（`apps/web/src/routes/admin.users.tsx`）與帳號面板的 admin 入口
- 測試：`apps/server/tests/admin.test.ts`（能力即時生效、停用即斷 session、雙重身分、建立帳號、自我停用防呆、`isAdmin` 不可提權）；`chat.test.ts` 新增停用帳號的 WS 拒絕案例

### Changed

- `UserSchema`：`role` → `canManageClasses` / `isAdmin`（`packages/shared`）；web 的 `.role` 讀取全部改為能力判斷（`AppShell`、`home`、`classrooms.index`、`report.$id`、`dialogue`、`settings`、`t.live.$id`、`t.setup`）
- Token 只帶 `uid`／`ver`／`exp`：`requireUser` 的人民讀取改到 middleware（每次帶 session 的請求一次 `SELECT`），能力與停用狀態以 DB 為真相
- `requireTeacher` → `requireCapability(c, "manage_classes")`；`topics`、`teacher_keys`、`POST /classrooms`、`POST /classrooms/:id/activities` 同步換閘
- `GET /classrooms` 改為 owned **UNION** joined：同一帳號可同時是 A 班老師、B 班學生
- `POST /join` 移除 `only_student`：任何已登入身分都可加入班級成為學生（含 `canManageClasses`）
- WS：`do/chat.ts` 的 `reverify` 併入 `disabled_at` 與 `session_version`；另加每則 message 的帳號狀態重驗——停用後連線上的下一個 frame 即 1008 關閉，重連亦被拒
- 錯誤碼：移除 `only_student`，新增 `account_disabled`、`capability_required`（`messages.ts` 三語同步）
- Seed fixture：帳號改帶 `canManageClasses`／`isAdmin`（admin 兩個都有）；`DevAccount` 以能力取代 `role`
- 部署後既有 session 失效一次（舊 token 無 `ver` claim → `session_version` 不符），使用者需重新登入；此後能力／停用變更皆即時生效
- `POST /api/dev/login` 修正 fixture 的 `is_admin` 漂移：舊 seed 建的 row 在 migration 002 後 `is_admin` 仍是 0（migration 只 backfill `can_manage_classes`），管理員一鍵登入會看到 `/admin/users` 被導回 `/classrooms`
- Docs：`api-contract.md` §1（token／每請求 D1 read）、§1.1 授權矩陣（能力欄）、§2 `User`、§3 入場、§4 `GET /classrooms` scope、§5.1 WS 重驗、§9.1 管理員端點、§10 錯誤碼、§11.1

## 2026-11-15 — #130 review fixture 與 dev 操作台（`136-account-classroom-model`）

### Added

- `apps/server/src/seed.ts` 改為固定 fixture：1 管理員、2 老師（陳老師同時是「高二哲學選修 A」的成員）、5 學生；固定 id／名稱／共用密碼 `demo-demo`；3 個系統題、2 間教室（一班 3 位成員、一班空）各含進行中活動；不含任何 transcript
- `GET /api/dev/accounts`、`POST /api/dev/login`（`apps/server/src/routes/dev.ts`）與網頁 `/dev/accounts`：一鍵以 fixture 身分發 session，免密碼
- `ENVIRONMENT` text binding（`cf dev` = `dev`、build/deploy = `production`）：`/dev/*` 與 `/api/dev/*` 在非 dev 環境一律 404

### Changed

- `POST /api/dev/seed` 也受 `ENVIRONMENT=dev` 閘門；回應不再帶隨機老師密碼（fixture 密碼固定）
- `seedDemo` → `seedFixture`（測試同步）；seed 以 id／email／教室名稱冪等 upsert，重跑不改 id
- 測試：新增 `apps/server/tests/dev.test.ts`（fixture 冪等、帳號清單、免密碼登入、非 dev 404）、`helpers.callWith` 可換 env 呼叫 Worker
- Docs：README quickstart、`development.md`（fixture／`ENVIRONMENT`）、`api-contract.md` §11.1

## 2026-11-14 — BTW side session（#121，`feat/121-btw-side-chat`）

### Added

- `btw` extension＋`prompts/btw.md`：副視窗 LLM——可直接解釋定義、思想實驗設定與各方立場，但不替學生下結論、不代寫論證；不帶 tool（與 websearch 分離）
- WS `btw` op：從 root 最新 entry 做 pi fork，該連線改綁 side session；side session 的 entries 不進 root context 與報告（`api-contract.md` §5.4）
- 錯誤 code `NothingToFork`、`UnknownSession`
- 前端「順帶一問」：對話頁頂欄按鈕／輸入框 `/btw 問題` 開 `BtwPanel` 右側欄（與查詢面板互斥）；`useBtw` 另開 WS 綁 side session，只顯示 fork 點之後的 entries，回答以 Markdown 呈現；「新話題」重新 fork；session 存 sessionStorage，重整後接回（失效則自動重開）；三語 i18n

### Changed

- Chat DO `settings.extensions` 改為 getter：已安裝且非 btw 的 extensions（root 行為不變）
- routeSubmit 的 model 快取改 per session；`llm_unavailable` 廣播只送綁定該 session 的連線
## 2026-11-14 — SSO 登入：Email 自行註冊＋Google（#124，`feat/124-sso-login`）

### Added

- `POST /api/auth/signup`：不需邀請碼的 email＋密碼註冊，建獨立帳號（不屬於任何教室、無能力；加入班級後即一般學生）
- Google 登入：`GET /api/auth/oauth/:provider/start`／`callback`（OIDC authorization code＋PKCE S256＋state＋nonce；ID token 以 JWKS 驗簽並驗 `iss`／`aud`／`exp`／`nonce`／`email_verified`）；`src/oauth.ts` 為 provider 共用流程，日後加 provider 只需新增 adapter
- Migration `007_user_identities.sql`：第三方登入身分表（`user_identities`，PK (`provider`, `provider_user_id`)，隨帳號 cascade 刪除）
- 錯誤碼 `oauth_unavailable`／`oauth_state_invalid`／`oauth_email_unverified`／`oauth_failed`（三語）；binding `GOOGLE_CLIENT_ID`（text）／`GOOGLE_CLIENT_SECRET`（secret，留空＝停用）
- 錯誤碼 `email_taken`（三語）：`POST /auth/signup` 信箱重複回 409 `email_taken`，取代語意模糊的 `conflict`；邀請碼註冊 `POST /auth/register` 維持 `conflict` 不變
- `assets.runWorkerFirst: ["/api/*", "/health"]`：SPA `notFoundHandling` 會把瀏覽器 navigation（`Sec-Fetch-Mode: navigate`）直接回 `index.html`，導致整頁跳轉的 `/api/auth/oauth/*` 永遠到不了 Worker
- 新增 [`google-oauth.md`](./google-oauth.md)（建立用戶端、本機／正式設定、secret 輪替、常見錯誤）；`.env.example` 補 `GOOGLE_CLIENT_ID`／`GOOGLE_CLIENT_SECRET`
- 測試：`tests/auth-sso.test.ts`（signup、OAuth 成功／state 竄改／簽章偽造／aud・iss・exp・nonce・未驗證 email）、`tests/migrations.test.ts`（user_identities 唯一性與 cascade）

## 2026-11-09 — routing/ 更名 gateway/（`experiment/web-next`）

### Changed

- `apps/server/src/routing/` → `apps/server/src/gateway/`——與業界用語對齊（LLM Gateway／Model Router：LiteLLM、Portkey、Cloudflare AI Gateway 皆稱 gateway），並與 URL routing（Hono/TanStack routes）劃清界線；`routing-schema.ts` → `gateway-schema.ts`、`RoutingLedger` → `GatewayLedger`、`routingConfig` → `gatewayConfig`、`tests/routing.test.ts` → `tests/gateway.test.ts`；docs 對應更新（architecture §5、feature、pi、providers、api-contract、AGENTS.md）；CI/deploy config-drift 路徑跟隨

## 2026-11-09 — 第三波深度審查修復（8 blocking＋MINOR 批次，`experiment/web-next`）

### Fixed

- **dgx 死腿**：Router.chain 先解析 def 級 model 再過 canServe（原 priority-1 免費主力被 `getModel("dgx-spark", "")` 永遠過濾）；DGX_BASE_URL 回歸測試
- **inFlight 洩漏**：routeSubmit submit 包 try/catch → settle＋rethrow（ConversationBusy 常態路徑原每次洩一格）；abort 結算 ok（學生中斷不助攻 cooldown）
- **hibernate 授權**：reattach() 恢復 #authorized（evict 後第一個 frame 原被 1008）；跨 evict 重用測試
- **input 邊界**：WS submit 走 DialogueInputSchema（contract §1 的 2000 字上限原是死碼）；空字串/超長測試
- **fetch_content 收斂（B 定案）**：只准本對話 web_search 結果 URL（store.isSearchHit）——匿名代理與二階 prompt-injection 面收斂；isPrivateIp 補真 IPv6 解析（mapped/fe80::/10 全段/CGNAT/240.0.0.0/4）＋bypass 語料庫測試
- **register ToS**：RegisterInputSchema 加 tosAccepted＋members insert 前閘（原公開端點偽造同意存證）
- **activity_finished 實裝**：routeSubmit 檢查 finished_at（原死碼——結束後對話繼續燒 LLM 且不進報告）
- dgx provider 定義對齊 team lead 的 pi config（model GLM-5.3-Flash、reasoning、compat thinkingFormat: openai 進 YAML，registerDgx 讀定義不再 hardcode）

### Changed

- WS error frame：pi 錯誤名作 code；內部錯誤只回 generic 訊息（不洩 D1/secret 細節）
- YAML schema strict（未知鍵即敗）；openai-completions 必須帶 baseUrl/baseUrlEnv；死鍵 params 移除
- teacherLegs SQL 收斂 credentials.ts（原三份 byte 相同複本）；TeacherKeyStatus 進 shared（server/web/contract 三份手抄收斂）
- buildModels：mock 只認 LLM_PROVIDER=mock（缺 AI binding 原靜默 fallback faux——生產 misconfig 會演假對話，現 fail-fast）
- runProfile：完成即 ok（退化空輸出不再計入 provider 失敗）；ipHits 真正強制上限；register/join 區分 email vs name 違規
- Rate limit stopgap：lookup 20/min、topics-generate 10/min、stt 20/min、tts 30/min（#103 前的過渡）
- Report alarm watchdog：alarmTimeoutMs 5 分鐘（generate 卡死原永遠 pending）
- settings remove/move 錯誤處理（帳單活躍資源不再靜默失敗）；TrapDialog 焦點圈＋還原＋容器級 Escape
- playTts decodeAudioData 失敗關閉 AudioContext；speak 重疊競態（stale finally 不再吃掉新 controller）；query 錯誤與空教室狀態分流；useSelectionPopover 改掛 ref 不再掃全域 class
- `@ts-nocheck` 移除：avatar.ts/scene.ts 完整型別（159 個錯誤清零）
- DialogueMessageSchema 死型別退役

### Docs

- providers.md 池表對齊實際鏈（dgx→workers-ai×2；opencode-go/OpenRouter 不再是學生鏈）；oneshot 死連結移除；STT 15MB 位元組上限（原寫 60s）；roadmap 已完成項勾選；frontend.md 元件庫實況；CODEOWNERS 移除已刪路徑；deploy gate 補 lint＋typecheck；architecture .env.example 路徑

## 2026-11-09 — 第二波深度審查修復＋teacher keys 服務（`experiment/web-next`）

### Added

- **Prompt 資產接線**（審查 CRITICAL）：profiles instructions 從 placeholder 字串改為真資產——`prompts/*.md` 於 `{{role "user"}}` 切開、前段 `?raw` 注入＋JSON 輸出形狀附錄；report-analyst 拆 student-report／class-report 兩 profile；lookup/topic-gen 新撰資產；`templates/` 重複份刪除。§7 報告在真模型下首次可生產
- **Teacher keys 服務**（#82 定案＋ToS 責任移轉，2026-11-09 拍板）：任意 pi builtin provider＋自選 model（migration 004 `model` 欄）；老師鏈在前、平台鏈墊後；ledger `teacher:<userId>` credential 獨立記帳；Chat DO per-turn pick→setModel→submit→wait 結算；ReportRunner／topic-gen 同接；web 設定頁 provider/model 選單＋責任條款文案（三語）
- **dgx-spark 首次真正可 serve**：buildModels 註冊全部 pi builtin providers（`builtinModels`＋Workers `AuthContext` 注入）＋dgx `createProvider`（keyless）——priority-1 不再是死配置
- WS 逐訊授權回歸測試（拒絕後 close 前逕送 watch → 不給 view）

### Fixed

- **WS 逐訊授權閘門**：onConnect 只驗一次，close handshake 期間的 frame 仍會被 dispatch（跨學生 transcript 競窗）——authorized set 修復
- **guest join 原子化**：batch users＋members、cookie 成功後才發（原 name_taken 競態留下孤兒 session cookie）
- runProfile settle 包 try/finally（inFlight 不洩漏）；lookup/topic-gen 拿到 websearch 工具（原 `_registryFor` 死碼、registry 空）
- 測試 migration runner 收斂 `tests/migrations.ts`（001–004 全套；003 原本沒被套用）

### Changed

- **D1 reset 決策記錄**（2026-11-08）：從未部署，`001_init.sql` 原地重寫 v4 schema 且剝除 create-then-drop 死表（10→7 表）——不做前向 migration；本地 v3 殘留刪 `.cloudflare/state` 重來
- Ledger 種類收斂：pi 無結構化錯誤狀態，刪不可達的 rate/timeout/auth 與 dead 語意；保留 ok/error＋連續 5 error cooldown
- `modelsFor`／`fallbackModels` 死碼刪除；`providers.config.yaml` 增 `teacherChain.maxConcurrency`
- Docs：providers.md 學生 BYOK 殘段（與 #82 定案矛盾）改為 teacher keys 服務定案；architecture §8 CI 更新為實況（Node 26/pnpm）＋header 狀態對齊；api-contract §6 live 改 pi transcript 資料源、§9 keys 帶 model 欄＋providers/models 端點、§7 批次寬度改 Router budget

## 2026-11-09 — 深度審查修復（10 項 blocking＋MINOR，`experiment/web-next`）

### Fixed

- no queue 非談判項 server 端強制：`#dispatch` 寫死 `whenBusy: "reject"`，protocol 移除客户端欄位（#110）
- Secrets fail-fast：`AUTH_SECRET`／`BYOK_ENC_KEY` 移除 `"socrates-dev-secret"` 回退，缺 secret 即 throw；偽造 cookie 不再 500
- teacher-keys：`sort_order` off-by-one（`COALESCE(MAX,-1)+1`）＋重複 `PUT /order` 刪除＋改走 `db/d1.ts` batch
- STT 不再偽造轉寫：mock 值限 `LLM_PROVIDER=mock`；生產缺 binding／失敗 → 502 `llm_unavailable`；result-body log 刪除；judgment sink 只記 type/source（ZDR）
- Routing ledger 生命週期：`getRouter(env)`（WeakMap，isolate 級共享）——cooldown/dead 跨請求生效；`pick()` 加 `canServe` 謂詞（只挑 models registry 可解析的 provider，記帳不再錯配）；`oneshot.ts` 零呼叫者退役
- Websearch：`ResponseStore` 改 per-extension instance（10k 併發下跨 thread 不互逐）；`fetch_content` 逐 hop 重驗 redirect（SSRF）、`::ffff:` IPv4-mapped IPv6、串流限量讀取＋20s timeout
- WS 斷線復原：`onConnectionError` 接線（清 pending、回 idle、呈現錯誤）；重連 `view` 快照偵測孤兒 run 完成併收斂；`reattach` 迴圈全部 sockets
- byok 退役：端點／`byok_keys` 表／settings 頁接線／i18n keys 全數移除（#82 學生無 BYOK 定案）
- login 開放學生（register 建的帳號可登入）；register user＋member 改 batch 原子寫入；新增 register→login 測試
- 10k 併發：report 批次寬度 mock fallback 8（原全班無界並行）；pseudonym 改 `prefix＋序號`（原 %26 撞名）；transcript 取最新 1000 筆（原取最舊）；ipHits 有界清理
- `pnpm seed` 修復（apps/server 補 seed script）；CI `pnpm -r test`（web 測試 34 條首次進 CI）；`frontend-review-tests/` scaffolding 刪除
- `/t/live/:id` gate 到 #73：頁面顯示待上線提示（原每 2.5s 輪詢不存在的端點）；`liveStudents` 客户端方法退役
- 報告頁 `report_pending` 輪詢耗盡後改手動重試（原無限 spinner）；AudioContext 錄音啟動失敗路徑 close（Chrome 上限洩漏）

### Changed

- Docs SSOT 對齊：README（產品段/結構樹/SSE→WS/R2 移除）、feature.md 全文重寫（v3 四階段/題庫/社群/檔案 → v4 現況 25 端點）、architecture（D4/D7 決策更新、violations 表投影移除）、api-contract（§1.1 WS 老師可觀察、限流標為 #103 待辦）、providers（BYOK 三層次標 #82 定案）
- Migration 003：`byok_keys`／`messages`／`violations` 死表退役（pi transcript 唯一真相）

## 2026-11-09 — 後端依 pi 兩原則重建＋前端對齊（`experiment/web-next`）

### Added

- Chat DO（thread 級）：PiHarness 宿主＋WebSocket transport（`view`＋chord ops、`applyImmutable`）；no queue（`whenBusy: reject`）；fallback legs 綁鏈首 model object（`MODEL_OPTIONS` symbol）
- Extensions：socrates（prompt preamble）／avatar（Clef choice → `app.emotion` entry）／judgment（`report_violation` 自報 tool → `app.violation` entry）／websearch（三 tool＋SSRF 防護＋`env.AI.toMarkdown()`）／faux-replay（faux queue 補給）
- Routing：`providers.config.yaml`（唯一配置點，build-time 編譯）＋ledger cooldown（LiteLLM 語意）＋Router traffic class 鏈走訪＋oneshot；程式碼零 hardcoded model id
- Agent profiles（socrates／lookup／topic-gen／report-analyst，#113）——角色欄位，model 依 traffic class 解析
- ReportRunner DO（activity 級，#74）：alarm 驅動（crash-safe，attempts 上限）；Chat DO `/transcript`（pi transcript 唯一真相，violations 不落第二份儲存）
- teacher keys（#82）：一 provider 一把 key（AES-GCM）；PUT order＝gateway provider 鏈序
- `GET /api/classrooms`：角色視角教室列表（code/url 只回老師；PR #108 UI 收編）
- 前端：TanStack file routes、三分頁 AppShell rail、DialogueView（頭像側欄可收合）、教室列表/詳情/首頁、i18n 單一 typed dictionary（tsc 强制三語）
- 契約層 `hc<RpcApi>`：server declarations（`build:types`）→ `@server/*` path；手寫 `types.ts` 退役

### Changed

- 後端依「pi handles everything／everything is an extension」重建；v3 退役：PiAgent/ActivityEvents DO、provider pool/whitelist、四階段 routes、`packages/llm`、web `pages/` 與 mock 引擎
- 對話傳輸 SSE → WebSocket（`/agents/chat/:name`）；`dialogueHistory` 死端點退役
- 表情：`[tag]` 文字解析 → `app.emotion` entry（機率本體）驅動 SocratesExpression（#111/#90）
- 報告：v3 hexagon/arguments → §7 `classReport`/`StudentAnalysis`；學生不拿 classReport（id=pseudonym，#72）
- 報告 prompt 資產收編（PR #109，author shiraga1094；runtime 不移植——pi-durable 內建同等能力）
- Judgment 模型拍板（PR #114 查證，#55 結案）：Clef-flash 主力（ZDR 官方明文）、Clef 備選、Jev 不採用（ZDR 僅 enterprise）；不得經 AI Gateway、不得用 async/batch
- 歷史重整：71 個 atomic commits（逐 commit tsc 驗證）

### Fixed

- `POST /classrooms/:id/activities` 契約偏移：實作誤用 `ClassroomCreateInputSchema`（要求 `name`）→ `ActivityStartInputSchema {topicId}`
- 外部審查 probes 全綠（F01–F22/S01）：inFlightRef、MediaRecorder 生命週期、logout `removeQueries`、`recordTerm` 持久化等
- 註解清理：組織/摘要型註解全數移除；config 註解 English only

## 2026-11-03 — 全面遷移至 Cloudflare Workers + Pi Durable（PR [#48](https://github.com/ntnu-swe-2026-team4/socrates-classroom/pull/48)）

### Added

- 單一 Worker 架構：Hono API + React SPA 靜態資產 + `PiAgent` / `ActivityEvents` 兩個 Durable Objects
- D1 轉接層（`$named` → positional 自動轉換，99 個端點 SQL 不動）、R2 檔案上傳
- Provider pool：ZDR 白名單路由（DGX Spark → OpenCode Go → OpenRouter → Workers AI）＋健康降級＋常駐閘門（併發/RPM 限流）
- BYOK 目錄與 provider 工廠（`byok.ts`；路由串接見 roadmap）
- CI：pnpm workspaces、Biome 2.6、TS 7、Vitest 5（workerd 實機）、yamllint；main 自動 migrations + deploy
- 文件 SSOT 重整（`docs/`：feature / api-contract / architecture / providers / cf / pi / roadmap / changelog）

### Changed

- Bun + SQLite + 手寫 LLM SSE → Cloudflare Workers + D1/R2 + Pi Durable（PiHarness）；SSE 契約 `delta/emotion/done/error` 不變，前端零修改
- npm → pnpm workspaces（cf CLI 需要 per-package `node_modules`）；建置腳本核准改用官方 `pnpm approve-builds`（`allowBuilds`）
- 文件不再包含歷史遷移報告；現況/願景/歷史分離（feature / roadmap / changelog）

### Fixed

- Provider pool 閘門隨呼叫重建導致限流失效（gate 改 module-level 常駐，pool 按 env 簽名快取；mock 模式維持原語意）
- CI：pnpm 12 非互動環境未核准建置腳本導致 `ERR_PNPM_IGNORED_BUILDS`
- 移除 npm lockfile 遺留物與 `package.json` 死欄位 `pnpm.onlyBuiltDependencies`

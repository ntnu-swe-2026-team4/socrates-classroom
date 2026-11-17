# Changelog（變更紀錄）

> 分支工作定案後記錄於此（標注分支；合併進主分支時更新連結）。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)。

## 2026-11-18 — 併入 `integration/web-next-142`，補齊新帳號模型的前端（`frontend/web-next`）

### Added

- 教室頁可以用「測試模式」開始活動；即時面板在測試活動顯示「測試對話」面板（新增、開啟各條對話），`/dialogue?slot=` 讓教師進入指定的測試對話
- 教室頁新增「單次活動邀請」卡片：產生 invite link 與 QR code，沒有帳號的人可以只加入目前這個活動
- 管理後台「使用者」分頁可以建立帳號、停用與恢復帳號（原本獨立的 `/admin/users` 頁併入此分頁）
- 蘇格拉底模型改放在對話清單下方的框內，可以上下收合，也可以左右拖曳轉動

### Fixed

- 教室對話的 WebSocket 改用 `participantId` 連線（先前誤用 user id，新帳號模型下連不上）
- 沒有帳號的訪客用邀請碼或 invite link 加入後可以直接進入對話，不再被導向 `/login`；側欄對未登入者顯示「登入」
- 登入頁的註冊改呼叫 `/auth/signup`（`/auth/register` 現在必須帶邀請碼）
- 收回教師權限時一併清除 `can_manage_classes`
- 帳號選單不再被模型蓋住
- 有 `can_manage_classes` 但沒有 `teacher_plan` 的帳號（seed 教師、後台直接建立的教師）可以切換教師模式，關閉後不會失去權限；seed 教師預設開啟教師模式

### Changed

- 教室橫幅與教室卡片封面改用主題的半色調圓點（`HalftoneFade`），移除彩色神殿插圖 `public/greek/banner.webp`
- 深色版配色改為中性深灰，外框線加強，重點色統一為黃棕

### Removed

- 對話頁右上角的模型小窗（`SocratesTile`）

## 2026-11-17 — 蘇格拉底模型改為對話頁角落的小窗（`frontend/web-next`）

### Changed

- 3D 模型只出現在對話頁右上角的小窗（`SocratesTile`）：可收合成一顆按鈕，狀態記在 `socrates_tile_open`；手機預設收合；訊息區會讓出小窗的位置
- `/login` 頂列新增語言切換（中／EN／ES）

### Removed

- 左側面板的「提問／對話」切換與面板內的模型舞台
- 語音模式上方的 3D 肖像（語音模式本身保留）
- `public/stage/`（底座與柱廊背景）

### Fixed

- rail 的通知鈴鐺彈出框被 rail 的捲動容器裁切：改為 `position: fixed` 並貼齊 rail 右緣
- rail 底部的頭像按鈕 hover／按下時位移造成 rail 出現橫向捲軸；移除重複的 `title` 提示

## 2026-11-17 — 內部頁面套用 halftone 主題（`frontend/web-next`）

### Changed

- 合併 `new-graphic` 分支的內部頁面主題：`.ht-theme`（方角、1.5px 邊框、serif 標題、黃棕色主按鈕、按下時下沉）、`DotField` 點陣背景、rail 與首頁改版、蘇格拉底回覆改為無框文字
- 主題套用範圍：`/home`、`/chat`、`/classrooms`、`/dialogue`、`/admin`，以及 `/t/`、`/report`、`/settings`、`/join`（後四者為合併時補上，避免與新 rail 不一致）
- 對話頁新增語音模式：麥克風按鈕切換成「按住說話」的大按鈕；左側面板顯示列表時，語音模式上方會顯示蘇格拉底 3D 肖像

### 合併時保留

- 左側面板的「提問／對話」切換、「順帶一問」、訪客與學生的 rail、管理後台 rail、帳號選單、通知鈴鐺（含訪客）
- `SocratesDock` 新增 `compact`：語音模式用小尺寸，左側面板維持原尺寸；兩處不會同時顯示模型

## 2026-11-17 — 帳號選單（`frontend/web-next`）

### Changed

- 點 rail 底部的頭像不再拉出右側整片的帳號面板，改為頭像旁的小選單：目前帳號、設定、登出（訪客為建立正式帳號、退出活動）；介面語言只留在設定頁

## 2026-11-17 — 設定頁改為分類導覽（`frontend/web-next`）

### Changed

- `/settings` 由單欄卡片改為左側分類清單＋右側內容：一般（個人資料、介面語言）／對話體驗（3D 模型、語音朗讀）／教師模式／API keys／用量；分類記在 `?section=`，手機為橫向捲動的分類列
- 訪客與學生只有「一般」與「對話體驗」

## 2026-11-17 — 額度設定與額度警示（`frontend/web-next`）

### Added

- `011_usage_quota.sql`：`users.usage_quota_tokens`、`usage_months`（owner × UTC 月份的 tokens／requests）、`usage_alerts`（owner × 月份 × 門檻，primary key 保證同一水位只記一次）
- 用量記帳：Chat DO 在一輪對話完成且該輪由 teacher credential 服務時，把該輪 assistant message 的 `usage.totalTokens` 累加到 owner 的當月用量（`routes/usage.ts` 的 `recordUsage`）
- 門檻偵測：用量達額度的 60%／80%／100% 時寫入 `usage_alerts`，並寄 email 給 owner 與所有 admin；寄出後記 `emailed_at`，未寄出的留待下次 `flushUsageAlerts`
- Worker 新增 `scheduled` handler（呼叫 `flushUsageAlerts`）；cron trigger 尚未宣告
- API：`GET /api/settings/usage`、`PUT /api/settings/usage/quota`、`GET /api/admin/usage-alerts`
- 設定頁「用量」區塊（進度條、額度設定、三個門檻狀態）；管理後台總覽的「額度警示」清單

### 尚未啟用

- Email 寄送需要 `ALERT_EMAIL`（send email binding）與 `ALERT_EMAIL_FROM`，`cloudflare.config.ts` 尚未宣告；未設定時警示只顯示在設定頁與管理後台
- 只計入主對話中由 teacher keys 服務的輪次；judgment、lookup、topic-gen、report 與平台鏈的用量不計

## 2026-11-17 — 登入頁改為 dither 柱廊風格（`frontend/web-next`）

### Changed

- `/login` 套用 `new-graphic` 分支的設計：`StoaField`（canvas 繪製的 Floyd–Steinberg 風格柱廊，滑鼠可推開顆粒）、歡迎標題、單行公告列；登入行為沿用現況（Email 與 Google、admin 登入後進 `/admin`、邀請碼入口）
- 大螢幕下頁面高度補滿視窗

### Removed

- 舊的登入頁公告欄 `NotificationBoard` 與 `public/greek/hero.webp`

## 2026-11-17 — 訪客與學生改用側欄（`frontend/web-next`）

### Changed

- 訪客與學生帳號不再使用上方的 top bar，改為與一般帳號相同的左側 rail：訪客為「活動／設定」，學生為「學習／設定」；訪客的「退出活動」移到 rail 底部
- 訪客也有通知鈴鐺（訪客沒有未讀數）

## 2026-11-17 — 第三方登入只保留 Google（`frontend/web-next`）

### Removed

- server 端的 Apple／Facebook OAuth（`routes/oauth.ts`、`oauth-config.ts`、`env.ts` 的對應欄位、`AUTH_PROVIDERS`）；`GET /api/auth/providers` 改回 `{google}`
- OAuth callback 不再接受 POST（原為 Apple `form_post` 所需）

### Changed

- OAuth state cookie 由 `SameSite=None` 改為 `SameSite=Lax`

## 2026-11-17 — 管理後台的學校頁改為清單 → 詳情（`experiment/web-next`）

### Changed

- 學校頁：學校清單＋「新增學校」對話框；點進學校才看到該校教師與「新增教師」對話框（只填 Email）
- 使用者表格每列新增「指派學校」
- `POST /api/admin/teachers` 的 `name` 改為選填；新帳號未給名稱時用 Email 的 `@` 前段

## 2026-11-17 — 單一登入與管理後台側欄（`experiment/web-next`）

### Changed

- 管理後台的側欄改為後台自己的導覽（總覽／使用者／教師申請／學校／系統通知），不再顯示一般使用者的項目；底部「檢視網站」回到一般介面
- admin 從一般登入頁登入後直接進 `/admin`

### Removed

- `/admin/login` 與登入頁的「管理員登入」連結：登入只有一個入口，權限由帳號決定。未登入開啟 `/admin` 導向 `/login?next=/admin`，非 admin 導向 `/home`

## 2026-11-17 — 管理後台改版（`experiment/web-next`）

### Changed

- `/admin` 改為分頁式後台：總覽（統計卡片、待審核提醒）、使用者（搜尋、身分標籤、開通／收回教師權限）、教師申請、學校、系統通知；分頁記在 `?tab=`

### Added

- API：`GET /api/admin/overview`、`GET /api/admin/users?q=`、`PUT｜DELETE /api/admin/users/:id/teacher`
- admin 可以收回任何帳號的教師權限（包含申請制上線前就取得試用方案的舊帳號）

## 2026-11-17 — 教師模式改為申請制、管理員登入獨立（`experiment/web-next`）

### Changed

- 教師模式預設關閉且不能自行開啟：使用者在設定頁申請（`POST /api/me/teacher-request`），admin 在管理頁核准或婉拒後才能切換；`010_teacher_requests.sql`
- 新增 `/admin/login` 管理員登入頁；未登入或非 admin 開啟 `/admin` 會導向該頁
- 登入頁底部新增「管理員登入」連結
- 登入頁的第三方登入只保留 Google（Apple、Facebook 按鈕移除；server 端 provider 尚未移除）

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

## 2026-11-14 — 老師即時面板與立場分佈圖（`experiment/web-next`）

### Added

- `/t/live/:id` 即時面板（輪詢 `GET /api/activities/:id/live`，Chat DO 新增 `live()` 與 `lastActiveAt`）：學生狀態、輪數、違規標記、最後一句，依需要注意的程度排序，新標記與長時間沒回應會提醒
- 班級報告的立場軸加上分佈圖

## 2026-11-14 — 系統通知（`experiment/web-next`）

### Added

- `009_notifications.sql`：`notifications` 與 `users.notifications_seen_at`
- admin 在管理頁發送／刪除系統通知；rail 與 top bar 的鈴鐺顯示通知與未讀紅點；登入頁改為左側公告欄、右側登入表單
- API：`GET /api/notifications`（公開）、`POST /api/notifications/seen`、`POST｜DELETE /api/admin/notifications`

## 2026-11-14 — 內部介面改版（`experiment/web-next`）

### Changed

- 配色改為與故事頁一致：白底、黑墨、朱紅點綴（`index.css` 的 `@theme` token；深色模式同步）
- 主要按鈕與選取中的分段按鈕改為黑色；輸入框聚焦邊框改為黑色；朱紅只用於連結、作用中導覽、開關
- 蘇格拉底 3D 模型不再浮動：只停靠在 AI 對話介面的左側面板，面板最上方切換「列表／蘇格拉底」；會員、學生帳號、訪客都有（訪客的列表只有所在活動的主題）
- 設定頁新增「蘇格拉底 3D 模型」開關，關閉後介面不出現模型
- 登入頁公告欄與教室橫幅各放一張希臘風插圖（`public/greek/`）
- 對話側欄的蘇格拉底舞台：希臘式底座（`public/stage/pedestal.webp`）、淡化的柱廊遠景（`public/stage/back.webp`，CSS mask 上色）與前景霧化，皆為靜態圖
- 內部頁面改為常見的 dashboard 版型：淺灰頁底配白色卡片、方角按鈕與輸入框、無襯線標題；教室頁改為上方橫幅（教室名稱、老師、人數、狀態）＋分頁列＋左側資訊欄（老師：邀請與學生帳號；學生：關於這間教室），老師與學生同一版型
- rail 的「教室」拆成兩個入口：「學習」（輸入邀請碼、我加入的教室）與「教室」（我開的教室、創建課程），對應 `/classrooms?view=student|teacher`
- 已登入時開啟 `/login` 直接導向目的頁（`next` 或 `/home`），不再顯示「目前登入的帳號」確認卡；加入頁的「登出並切換帳號」改為先登出再顯示登入表單

### Removed

- 回紋（meander）圖樣與所有裝飾圖片（`public/theatre/`）；內部介面目前不含裝飾圖，待以 Higgsfield 重新設計
- 模型的輪盤選單（雙擊開啟：問 AI／靜音／表情）、拖曳，以及 rail 與 top bar 的小幫手按鈕；靜音改由設定頁的語音朗讀開關控制
- 「問 AI」：web 端入口、`POST /api/assistant`、assistant profile 與其 prompt

## 2026-11-14 — 登入前故事頁重做（`experiment/web-next`）

### Changed

- `/` 改為上下捲動的漫畫故事：開場只有站名，往下依序是柱廊走路、廣場階梯接沙漠（兩個梯形分格相連）、龍捲風、群眾、轉頭、結尾 CTA
- 分格動畫全部是預先算好的 WebP sprite sheet，用 `<canvas>` 播放（不跑即時 3D）；龍捲風、白轉黑的直線過場、風線為 canvas 即時繪製
- 滑鼠偏移改為外框固定、框內場景位移（原本整格傾斜晃動）
- 群眾分格的對話框點一下切換下一句（每人三句）；眼睛特寫點一下切換瞳孔顏色（藍／灰／土黃）；進站時站名有進場動畫
- 互動：眼睛特寫的虹膜跟著滑鼠、可拖曳廣場人物、可抓起工程師、按住龍捲風喚醒、按住提問讓他轉身
- 右上角：語言切換（中／EN／ES）、登入、「跳到結尾」
- 效能：canvas 繪製上限約 30fps、畫面外的動畫全部暫停（`IntersectionObserver`）、sprite sheet 以 `image.decode()` 在背景解碼、觸控裝置不做視差；尊重 `prefers-reduced-motion`
- RWD：320–2560 寬度無水平溢出，說明框不互相重疊

### Removed

- 舊版 Lottie 故事頁（`src/landing/`、`public/landing/` 共 17 MB）與 `lottie-web` 依賴

## 2026-11-13 — 帳號管理重新設計（`experiment/web-next`）

### Added

- 身分模型（[`accounts.md`](./accounts.md)）：admin、user⇄teacher（設定頁「教師模式」）、student（老師建立的受管帳號）、guest（綁定單一活動）
- `008_account_roles.sql`：`schools` 與 `users` 角色欄位；既有開過課的帳號搬為試用教師
- 學生帳號：成員分頁「新增學生帳號」批次建立、一次性顯示帳密（可複製）、重設密碼、移除即刪除帳號；學生以帳號登入後只看得到所屬班級
- 管理後台 `/admin`：建立學校、開通學校教師（既有帳號升級／新帳號臨時密碼）、移出學校
- 試用方案上限：3 間教室、每間 40 人；首次開啟教師模式需同意教師條款

### Changed

- 登入欄位改為「Email 或學生帳號」；登入頁移除「以訪客進入」，改為輸入邀請碼
- 訪客：活動結束 24 小時後失效（`guest_session_expired`），不能升級為正式帳號；`POST /auth/guest` 移除
- 帳號狀態每個請求從 D1 讀取（`resolveSession`），WS 授權同步改用
- 教師模式預設關閉；左側「教室」不再有下拉，依教師模式顯示「我開的教室」或「我加入的教室」
- 訪客沒有教室概念：左側只有「活動」、直接進入對話，不能看公告／討論區／成員；換活動需「退出活動」後重輸邀請碼
- 教室側欄新增「學生帳號」卡片，可直接建立綁定該教室的學生帳號（成員分頁也有）
- 開課需教師模式（`teacher_required`）；單人對話、teacher keys、題庫限正式帳號（學生 `student_restricted`）

## 2026-11-12 — Teacher keys 多把 key × 多個模型（`experiment/web-next`）

### Changed

- **BYOK 設定（PM 需求）**：老師可加入多把 key、多個模型，並以拖曳把手（或上移／下移按鈕）調整優先順序；可「用這把金鑰加入其他模型」沿用已存的 key；每列可更換金鑰或刪除（確認對話框）；列表最後顯示平台模型為最後備援
- `007_teacher_key_entries.sql`：`teacher_keys`（一 provider 一列）→ `teacher_key_entries`（每筆 entry＝provider＋model＋key），舊資料自動搬移
- API：`PUT/DELETE /settings/keys/:provider` → `POST /settings/keys`、`PATCH/DELETE /settings/keys/:id`；`PUT /settings/keys/order` 改收 `{ids}`（見 api-contract §9）
- Gateway：每筆 entry 是一條 teacher leg，credential `teacher:{userId}:{entryId}` 各自記帳；選中的 entry 以 AsyncLocalStorage 釘住，同 provider 多把 key 也能讀到正確的 key

## 2026-11-11 — 統一帳號、單人模式、第三方登入與介面改版（`experiment/web-next`）

### Added

- 單人模式（從 `socrate-classroom` 分支移植並改走 WS）：`solo_chats`（`003_accounts_solo.sql`）、`/api/solo/chats` CRUD；Chat DO 支援 `s_` thread（本人授權、無活動結束檢查、擁有者 teacher keys）；前端 `/chat`、`/chat/:chatId`（左側主題欄可收合＋搜尋／重新命名／刪除）
- 登入：訪客（`POST /auth/guest`）、Email 註冊／登入（`code` 改選填，guest 原地升級）、Google／Apple／Facebook OAuth（`004_oauth.sql` `oauth_identities`，未設定時按鈕停用）
- `GET /api/classrooms/:id`、`GET /api/classrooms/:id/activities`；教室內頁與教室對話左欄列出所有討論主題
- 自由浮動的蘇格拉底小幫手（`SocratesCompanion`）：左鍵拖曳、雙擊開啟輪盤選單（查詢／靜音／表情）；rail 上的小幫手按鈕切換顯示

### Changed

- **帳號不分老師／學生**：`users.role` 移除、改 `is_guest`；`User.role` → `User.guest`；老師是每間教室的 owner 身分，任何正式帳號都可開課也可加入別人的教室（guest 開課 → 403 `account_required`）
- 對話介面統一為 AI 對話版型（左主題欄＋右對話）；移除固定蘇格拉底面板、旋轉與全息特效；TTS 遵守小幫手靜音
- 導向：登入後到首頁；「教室」一律先到教室列表／教室內頁（不再預設開課頁或邀請碼頁）；邀請連結加入後進教室內頁
- 視覺：移除漸層、收緊區塊間距（圓角維持原設計）；教室列表與教室內頁改為滿版（Moodle 式課程卡片格狀排列＋右側資訊欄）；帳號只保留一個頭像入口；蘇格拉底小幫手放大（桌面 280px／手機 180px）
- Biome 排除參考資料夾 `socrate-classroom/`

### Added（後續）

- 刪除教室（`DELETE /api/classrooms/:id`，僅 owner，確認框）
- 教室社群（`006_community.sql`）：教室頁改為分頁（主題／公告／討論區／成員）；公告（僅 owner 發布）、討論區（討論串＋單層回覆）、成員列表（owner 移除學生、學生退出教室）；端點見 `api-contract.md` §4.2
- 全翻譯：系統主題 en／es 譯文（`005_topic_i18n.sql`）、日期依介面語言格式化、離線 mock 回覆依學生語言、`socrates.md` 新增「以學生語言回覆」規則；問 AI（`POST /api/assistant`）

- 學生視角預覽改版：頂部深色細條（回到教室／重設／離開）、預覽期間鎖定在該教室（session 帶 `previewClassroomId`，首頁／聊天／教室列表／設定導回）；切換身分改整頁導向，修正離開預覽後畫面不更新
- 邀請連結加入前先選身分（使用我的帳號／以訪客加入）；課程改名改為對話框；設定新增語音朗讀開關＋音量（套用到 TTS GainNode）；頁面標題字級縮小；手機版小幫手縮為 120px；移除已棄用的 `THREE.Clock`；對話連線前 3 秒顯示「連線中」

- 語音仲裁：所有朗讀改走單一語音通道 `lib/speech.ts`（最後主動者優先、非主動不打斷、跨分頁互斥），小幫手「正在朗讀」標籤＋停止鈕，問 AI 回答新增「朗讀」

- 老爺爺聲線：前端 Web Audio 處理（playbackRate 0.86、low-shelf 暖化、3.2 kHz lowpass、5.2 Hz tremolo），設定頁可切換「老爺爺／原聲」，預設老爺爺；離線 mock 對話改為五種追問輪替

- 離線 mock 朗讀改用瀏覽器本機語音（僅 `localService` voice，不送出文字；優先台灣男聲，老爺爺聲線＝pitch 0.55、rate 0.86），伺服器 mock 音檔加 `X-Socrates-Fallback: mock` 標記；真實 TTS 的老爺爺處理減弱以免悶糊；教室頁與卡片移除「我開的」標示

### Security

- OAuth 不自動連結到「有密碼、Email 未驗證」的帳號，避免先註冊他人 Email 再接管其第三方登入

## 2026-11-11 — Student View（學生視角預覽，`experiment/web-next`）

### Added

- 老師在教室頁一鍵以測試學生進入對話，不需邀請碼或第二個瀏覽器：`002_preview_student.sql`（`users.preview_classroom_id`）、`POST /api/classrooms/:id/preview`・`/api/preview/reset`・`/api/preview/exit`、`User.preview`（session claim `pv`）、AppShell banner（重設／離開）；`memberCount` 與 ReportRunner 排除測試學生；i18n zh/en/es

### Changed

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

## 2026-11-17 — 合併 `216f62f`（帳號／教室模型重寫）進 `frontend/web-next`（`integration/web-next-142`）

### Changed

- 身分模型以 `216f62f` 的 capability ＋ participant 版本為準：`users.can_manage_classes`／`is_admin`／`disabled_at`／`session_version` 決定授權；`activity_participants` 是活動名冊與 WS thread／報告的鍵；訪客＝無帳號的 participant＋`socrates_participant` cookie，不再建 `users` 列
- `only_student` 退場：任何已登入身分都能加入班級；老師自測改走 `test` 活動與 slot（`GET/POST /activities/:id/slots`）
- `POST /classrooms` 只建班級；活動改由 `POST /classrooms/:id/activities` 開啟（回應為 `ActivityStarted`）；議題屬於班級（`GET/POST /classrooms/:id/topics`、`POST /topics/:id/copy`）
- `teacherMode` 與 `can_manage_classes` 同步開關（`PATCH /me`），教師申請／核准仍走 `docs/accounts.md` 的 `teacher_plan` 流程
- Google 登入採 `216f62f` 之後 main 的實作（`src/oauth.ts`、`user_identities` 017），`frontend/web-next` 的 `oauth_identities` 分支移除
- web 全面保留 `frontend/web-next` 的設計；`/t/setup` 維持移除，議題集與開活動併入教室頁（`TopicSet`）；新增 `/dev/accounts`、`/admin/users`、`/join/a/$token`

### Migrations

`frontend/web-next` 的 002–011 重編為 008–016，`216f62f` 的 002–006 與 main 的 `007_user_identities` 維持原編號（production 已套用）；`is_guest`／`guest_activity_id` 與 `users.role` 一併移除（`009_solo_chats.sql` 負責 drop role）

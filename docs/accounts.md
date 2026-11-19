# 帳號與身分設計

> 2026-11-13 定案（依市面教育產品慣例：Google Classroom、Kahoot、Seesaw、ClassDojo）。2026-11-19 對齊 `integration/web-next-142`（PR #155，HEAD `09caede`）的實作與 issue 決策——**該分支尚未合併進 main，production 未部署本批變更**。
> 本文件擁有身分、plan、limits、session 語義；request／response 形狀（單一真相 `packages/shared`）見 [`api-contract.md`](./api-contract.md) §1.1、§2、§3、§3.1、§9.1、§12。

## 1. 身分一覽

| 身分             | 產生方式                                                    | 登入                                                            | 能力                                             |
| ---------------- | ----------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------ |
| admin 管理員     | `users.is_admin = 1`（seed 或手動 SQL；`002_capabilities`） | 同 user                                                         | 學校與教師開通、帳號管理、系統公告               |
| user 單人用戶    | 自行註冊（Email＋密碼／Google OAuth）                       | Email＋密碼或 Google                                            | 加入多個班級與活動、單人對話、自備金鑰           |
| teacher 教師     | user 上的計畫＋模式（見 §2），不是另一個身分                | 同 user                                                         | 開班級與活動、建立 student 帳號                  |
| student 學生     | 教師在班級「成員」分頁批次建立                              | 帳號（`username`，unique）＋密碼                                | 只在所屬班級內參與；跨活動累積紀錄與報告         |
| participant 訪客 | 未登入者以班級碼或活動邀請連結加入活動                      | 無（`socrates_participant` cookie，7 天）                       | 只存在於入場那一場活動；**不建 `users` 列**      |
| preview 測試學生 | 教師在教室頁開啟「學生視角預覽」時自動建立（每班一個）      | 掛在教師 session 上（`socrates_preview_return` 暫存教師 token） | 進入該班目前的 `live` 活動；可 reset（重建帳號） |

## 2. 定案

- **user 與 teacher 是同一個身分**：一個人一個帳號。「能不能建班級」看 capability `users.can_manage_classes`；`users.teacher_plan`（`trial`／`school`／NULL）是**計畫**，不是 capability。`users.teacher_mode` 是設定頁的「教師模式」開關，**預設關閉**。開啟時列出自己開的教室並可創建課程，關閉時列出加入的教室並可輸入邀請碼；已開的班級仍歸本人所有。兩者的同步規則（`PATCH /me`）：
  - **有 `teacher_plan` 者**：開關 `teacher_mode` 會同步 `can_manage_classes`（開模式＝給 capability、關模式＝收回）。
  - **沒有 `teacher_plan` 但已有 capability 者**（admin 經 `PATCH /admin/users/:id` 直接授予）也能開啟教師模式，此時 `can_manage_classes` 不受開關影響。
  - **兩者皆無**：開啟 → 403 `teacher_approval_required`（須先申請並經核准）。
- **teacher plan 的來源決定責任歸屬**：
  - `trial`（申請＋核准）：設定頁 `POST /me/teacher-request`（`teacher_terms_at` 教師條款存證）→ admin 在申請佇列核准後 `teacher_plan = 'trial'`。班級與學生資料由教師本人負責。上限 3 間教室、每間 40 人（`TRIAL_LIMITS`；超出 → 403 `trial_limit`，成員數不含 preview 帳號）。
  - `school`（admin 開通，`school_id`）：學校為簽約方，不受試用上限限制。admin 把教師移出學校 → `teacher_plan` 改回 `trial`、`school_id` 清空，班級保留。
- **owner 可加入自己的班級**：`POST /join` 對已登入者只有 student gate（其他班的學生 → 403 `student_restricted`），沒有 owner gate。老師要測試自己的活動另有兩條路（不可混淆，見 §3）。
- **測試的兩條路徑**：
  - **#134 教師測試活動**（已定案）：`mode = 'test'` 活動＋老師本人持有的 1–6 個 `kind = 'teacher'` participant slot，**照常產報告**，不會出現在任何學生入口。
  - **學生視角預覽**（PR #155 帶入）：每班一個測試學生——真實 `users` 列掛 `preview_classroom_id`、加入 `members`，切換 session 進入該班**目前的 `live` 活動**；`memberCount` 與試用 seats 不計，可 reset（刪除重建）。**報告母體目前沒有排除 preview**：有發言的 preview 會進 live 活動報告與 pseudonyms——與「不計報告」的宣稱相牴觸，#169 已開單追蹤（待團隊決定修復隔離或讓此功能退場）；在該單結案前，本文件不宣稱報告隔離。#134 的 test slots **必須**進報告，兩者語義不得互相覆蓋。
- **試用教師也可以建立 student 帳號**（與 Seesaw／ClassDojo 免費版一致）。教師條款要求先取得學校或監護人同意，人數算進試用上限。
- **student 是受管帳號**（`User.kind = 'student'`，由 `student_classroom_id` 推導）：
  - 沒有 email、不能改名（`PATCH /me` → 403 `student_restricted`）、不能申請教師模式、不能加入其他班級、不能退出班級、不能使用單人對話與社群發文。
  - 密碼只在建立或重設時顯示一次，由教師重設（`audit_log` 存證）。
  - 教師移除學生 = 刪除帳號（`student_classroom_id` `ON DELETE CASCADE` 隨班級刪除）。
- **訪客沒有帳號層的存在**：未登入加入（班級碼 `POST /join` 或活動邀請 `POST /invites/:token/join`）只建立 `activity_participants` 列（`kind = 'guest'`、`user_id = NULL`）並發 `socrates_participant` cookie（HMAC 簽 `aid`／`pid`／`exp`，**7 天**），與 `socrates_session` 並存互不覆寫：
  - cookie 只對那一場活動有效：其他活動的端點視同未參與（401／403）；要參加別的活動，重新輸入邀請碼或班級碼即可，不需要「登出」。
  - cookie 過期或失效後行為同「未持 cookie」（`guest_session_expired` 是 shared 保留碼，**未接線**）。cookie 期間內活動結束仍可重進對話（submit → `ActivityFinished`），訪客不提供報告（契約 §13）。
  - **沒有升級路徑**：訪客紀錄認領合併已以 #60 NOT_PLANNED 結案（改走 #136 的帳號模型），#136 亦已結案——不得在文檔或 roadmap 恢復「升級保留資產」的承諾。註冊一律建立新帳號，訪客紀錄留在該場活動報告。
- **帳號狀態每個請求都從 D1 讀取**（`resolveSession`）。admin 變更、刪除學生等效果立即生效，不必等 session 過期。session token（30 天 HMAC）識別 `uid` 並攜帶 `ver`（`session_version`，`002_capabilities`）：比對不一致即失效——**教師重設學生密碼**（同時寫入 `audit_log`）與 **admin 停用／復用帳號**都會 bump `session_version`，舊 session 全數撤銷。`GET /me` 對停用帳號回 403 `account_disabled`、對過期／撤銷 cookie 回 401 `unauthorized`，**不回 `null`**（契約 §2）。

## 3. 資料（migrations）

- `002_capabilities`：`users` 加 `can_manage_classes`、`is_admin`、`disabled_at`、`session_version`（drop legacy `role` 不在此——`role` 由 `008_web_next` 移除，002 曾以它 backfill capability）。
- `007_user_identities`：Google OAuth 綁定（`provider = 'google'`；production 已套用，不隨 squash 重播）。
- `008_web_next`（web-next 遷移 squash 單檔）：`users` 加 `teacher_plan`、`school_id`、`teacher_mode`、`teacher_terms_at`、`teacher_request_at`、`username`（unique partial index）、`student_classroom_id`、`preview_classroom_id`（unique partial index）、`notifications_seen_at`、`usage_quota_tokens`，並 drop `users.role`；新表 `schools`、`audit_log`、`solo_chats`、`announcements`、`posts`、`notifications`、`usage_months`、`usage_alerts`、`teacher_key_entries`（自舊 `teacher_keys` backfill 後 drop）。
- 搬移（008 內建）：開過班級的既有帳號 → `teacher_plan = 'trial'`、`teacher_terms_at = created_at`、`can_manage_classes = 1`。
- **沒有任何 guest 專屬欄位**（無 `guest_activity_id`）：訪客只存在 `activity_participants`（`user_id = NULL`，`003_activity_participants`）。

## 4. 後續可擴充

- 學校管理員（school admin）：目前只有平台 admin。
- 試用的平台模型用量額度：目前只限制教室數與人數（模型用量記帳是 teacher keys 的 teacher leg 語義，見契約 §9）。
- 學生帳號 CSV 匯入、列印登入卡。

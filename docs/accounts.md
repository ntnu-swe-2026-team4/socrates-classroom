# 帳號與身分設計

> 2026-11-13 定案（依市面教育產品慣例：Google Classroom、Kahoot、Seesaw、ClassDojo）。API 形狀見 [`api-contract.md`](./api-contract.md) §1.1、§2、§4.3、§4.4。

## 1. 身分一覽

| 身分          | 產生方式                                   | 登入                            | 能力                                         |
| ------------- | ------------------------------------------ | ------------------------------- | -------------------------------------------- |
| admin 管理員  | `users.is_admin = 1`（seed 或手動 SQL）    | 同 user                         | 建立學校、為學校開通教師帳號、把教師移出學校 |
| user 單人用戶 | 自行註冊（Email／第三方）                  | Email＋密碼                     | 加入多個班級與活動、單人對話、自備金鑰       |
| teacher 教師  | user 在設定開啟「教師模式」，或 admin 開通 | 同 user                         | 開班級與活動、建立 student 帳號              |
| student 學生  | 教師在班級「成員」分頁批次建立             | 帳號（`{邀請碼}-{序號}`）＋密碼 | 只在所屬班級內參與；跨活動累積紀錄與報告     |
| guest 訪客    | 邀請碼入場時選「以訪客加入」               | 無                              | 只能參加入場當下的那一場活動                 |

## 2. 定案

- **user 與 teacher 是同一個身分**：一個人一個帳號。teacher 是帳號上的**能力**（`teacher_plan`），設定頁的「教師模式」只是切換**模式**（`teacher_mode`），**預設關閉**（自行註冊、admin 開通、既有帳號搬移皆同）。左側只有一個「教室」按鈕：開啟時列出自己開的教室並可創建課程，關閉時列出加入的教室並可輸入邀請碼。已開的班級仍歸本人所有。
- **teacher 能力的來源決定責任歸屬**：
  - `trial`（自行開啟）：第一次開啟需同意教師條款（`teacher_terms_at` 存證）。班級與學生資料由教師本人負責。上限 3 間教室、每間 40 人（`TRIAL_LIMITS`）。
  - `school`（admin 開通，`school_id`）：學校為簽約方，不受試用上限限制。admin 移出學校 → 改回 `trial`，班級保留。
- **試用場景（自開自用）**：老師要測試自己的活動時用「學生視角預覽」（測試學生掛在老師名下、不算人數、可重置）。owner 不能用自己的帳號加入自己的班級（`only_student`）。因此不需要另一個身分來承擔責任。
- **試用教師也可以建立 student 帳號**（與 Seesaw／ClassDojo 免費版一致）。教師條款要求先取得學校或監護人同意，人數算進試用上限。
- **student 是受管帳號**：
  - 沒有 email、不能改名、不能切換教師模式、不能加入其他班級、不能退出班級、不能使用單人對話（`student_restricted`）。
  - 密碼只在建立或重設時顯示一次，由教師重設。
  - 教師移除學生 = 刪除帳號（`student_classroom_id` 也 `ON DELETE CASCADE` 隨班級刪除）。
- **guest 綁定單一活動，沒有教室的概念**：
  - 介面只有「活動」：直接進入該場對話，看不到教室頁、公告、討論區與成員（端點回 403 `account_required`）。
  - 要參加別的活動：「退出活動」（登出）後輸入新的邀請碼。
  - session 只對 `guest_activity_id` 那場活動有效（其他活動 → 403）。
  - 活動結束 **24 小時後**失效，留時間看報告；Kahoot 等產品同樣在活動結束時呈現結果。
  - 失效後 `GET /me` 回 401 `guest_session_expired`，前端導回登入頁並提示輸入新邀請碼。
  - 不能註冊升級：註冊一律建立新帳號，訪客紀錄留在該場報告，不轉移。
- **帳號狀態每個請求都從 D1 讀取**（`resolveSession`）。admin 變更、刪除學生等效果立即生效，不必等 session 過期。session token 只用來識別 `uid`。

## 3. 資料（`008_account_roles.sql`）

- 新表 `schools(id, name, created_at)`
- `users` 新欄位：`is_admin`、`teacher_plan`（`trial`／`school`／NULL）、`school_id`、`teacher_mode`、`teacher_terms_at`、`username`（unique）、`student_classroom_id`、`guest_activity_id`
- 搬移：
  - 既有正式帳號中已開過班級者 → `trial`＋教師模式開啟。
  - 既有訪客 → 綁定最近加入班級的當前活動。

## 4. 後續可擴充

- 學校管理員（school admin）：目前只有平台 admin。
- 試用的平台模型用量額度：目前只限制教室數與人數。
- 學生帳號 CSV 匯入、列印登入卡。

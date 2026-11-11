# 交接：與原版的差異與上線待辦

> 基準：2026-11-10 下載的 `experiment/web-next`（以下稱「原版」）。本文件只列**差異與待辦**；細節以各 SSOT 為準——功能清單見 [`feature.md`](./feature.md)、API 格式見 [`api-contract.md`](./api-contract.md)、逐條變更見 [`changelog.md`](./changelog.md)。

## 1. 雲端與部署設定：維持原版

下列檔案與原版**完全相同**，未做任何修改：

| 檔案                                     | 說明                                                             |
| ---------------------------------------- | ---------------------------------------------------------------- |
| `apps/web/cloudflare.config.ts`          | Worker 名稱、bindings、D1 id、網域 `socrates.g36maid.dev` 皆原樣 |
| `apps/web/.env.example`                  | 原樣                                                             |
| `.github/workflows/ci.yml`、`deploy.yml` | 原樣（push `main` → 全閘門 → D1 migrations → deploy）            |
| `apps/server/providers.config.yaml`      | 原樣（模型路由、TTS／STT 模型）                                  |

因此有兩個行為與「開發時曾改過的版本」不同，請留意：

- **本機 dev 需要 Cloudflare 遠端連線**：原版 config 在 dev 也宣告 `AI` binding，cf CLI 會走 remote mode。若出現「You need to register a workers.dev subdomain」，需到 Cloudflare 註冊 workers.dev 子網域，或在 `pnpm dev` 終端機按 `l` 切成 local。
- **第三方登入（Google／Apple／Facebook）停用**：server 已實作，但 config 未宣告對應 bindings。啟用步驟見 [`cf.md` §OAuth 登入](./cf.md#oauth-登入googlefacebookapple選用)。登入頁三顆按鈕會顯示為「尚未設定」，其他登入方式不受影響。

## 2. 資料庫 migrations（新增 5 支）

原版只有 `001_init.sql`。部署時 `deploy.yml` 的「D1 migrations」步驟會**自動依序套用**，不需手動操作；本機 `pnpm dev` 啟動時也會自動套用（已開著的 dev server 可執行 `pnpm migrate`）。

| Migration                 | 內容                                                                              |
| ------------------------- | --------------------------------------------------------------------------------- |
| `002_preview_student.sql` | `users.preview_classroom_id`：學生視角預覽的測試學生                              |
| `003_accounts_solo.sql`   | 帳號統一：移除 `users.role`、新增 `users.is_guest`；新增 `solo_chats`（單人對話） |
| `004_oauth.sql`           | `oauth_identities`：第三方登入身分（目前停用，表先建好）                          |
| `005_topic_i18n.sql`      | `topics.i18n`：系統主題的英文／西班牙文譯文，並回填三個內建主題                   |
| `006_community.sql`       | `announcements`、`posts`：教室公告與討論區                                        |

> `003` 會**刪除 `users.role` 欄位**：既有帳號依「有無 email」換算為正式帳號／訪客；舊 session 的 `role` claim 仍可登入（student → 訪客、teacher → 正式帳號）。

## 3. 功能差異摘要

| 範圍     | 原版                  | 現在                                                                                                |
| -------- | --------------------- | --------------------------------------------------------------------------------------------------- |
| 帳號     | 老師／學生兩種帳號    | 不分角色：任何正式帳號都能開課與加入；老師＝教室 owner。訪客一鍵進入、註冊時原地升級保留紀錄        |
| 登入     | Email＋密碼、示範老師 | 訪客、Email 登入／註冊、第三方登入（停用中）；已登入時可「繼續使用／切換帳號」                      |
| 單人模式 | 無                    | `/chat`：AI 對話版型（左主題欄＋右對話），搜尋／改名／刪除                                          |
| 教室     | 開課頁先命名＋選題    | 「創建課程」直接建立空課程並進入教室頁編輯；名稱對話框修改；主題可選題庫／自訂／AI 生成；可刪除教室 |
| 教室內頁 | 主題卡片              | 分頁：主題（可選取歷次主題）／公告／討論區／成員（移除成員、退出教室）；學生視角預覽                |
| 加入教室 | 邀請碼→輸入名字       | 先選「使用我的帳號」或「以訪客加入」；已登入沿用帳號名                                              |
| 蘇格拉底 | 固定 3D 面板          | 可拖曳的圓形小幫手：雙擊輪盤（問 AI／靜音／表情）、表情一次性播放                                   |
| 問 AI    | 無                    | 小幫手面板直接回答（`POST /api/assistant`），每則可「朗讀」                                         |
| 語音     | 對話自動朗讀          | 單一語音通道：最後主動者優先、跨分頁互斥、「正在朗讀」標籤；設定頁開關＋音量＋「老爺爺／原聲」聲線  |
| 多語系   | 介面三語              | 另加系統主題譯文、日期依介面語言、蘇格拉底依學生語言回覆                                            |
| 介面     | 原設計                | 全面改版（首頁、教室卡片、AppShell、設定頁個人資料＋語音）                                          |

## 4. 已補上的後端

以下為前端新功能所需、且**不需變動雲端設定**即可完成的後端部分，皆已實作並有測試（`pnpm test`：server 115、web 63 皆通過）：

- 帳號：`POST /auth/guest`、`/auth/register`（`name`／`code` 選填、訪客升級）、`PATCH /me`、`GET /auth/providers`
- 單人對話：`/solo/chats` CRUD；Chat DO 支援 `s_` thread（本人授權、擁有者 teacher keys）
- 教室：`GET /classrooms/:id`、`/classrooms/:id/activities`、`PATCH`／`DELETE /classrooms/:id`、`POST /classrooms` 可不帶主題
- 學生視角預覽：`/classrooms/:id/preview`、`/preview/reset`、`/preview/exit`（session 帶 `previewClassroomId`）
- 教室社群：公告、討論區、成員（含移除與退出）
- 問 AI：`POST /assistant`（assistant profile，走既有 gateway 路由）
- 系統主題在地化（依 `Accept-Language`）；離線 mock 回覆依學生語言輪替五種追問
- 第三方登入的 server 端（`routes/oauth.ts`、`004_oauth.sql`）：程式完成，**待 config 宣告後即可用**

## 5. 無法在不改雲端設定下完成的項目

| 項目                        | 需要什麼                                                                                                        |
| --------------------------- | --------------------------------------------------------------------------------------------------------------- |
| 第三方登入                  | `cloudflare.config.ts` 宣告 bindings、各平台申請 client、CI 提供 public id 與 secrets（[`cf.md`](./cf.md)）     |
| 真正的老年男聲              | 換成提供聲線選擇的 TTS；新增 provider 需先通過 ZDR 審查（[`providers.md`](./providers.md)）。目前為前端聲音處理 |
| 本機 dev 免 Cloudflare 帳號 | 需在 config 讓 dev 不宣告 `AI` binding（曾試行，已依決定還原）                                                  |

## 6. 新 repo 上線前檢查清單

- [ ] GitHub repo secrets：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`D1_DATABASE_ID`、`PROD_SECRETS_FILE`（內容為 `AUTH_SECRET`、`BYOK_ENC_KEY`、`SEED_TOKEN` 的 dotenv）。**未設定前 push 到 `main` 會讓 Deploy workflow 失敗**（屬預期，不會部署任何東西）
- [ ] 網域：config 綁定 `socrates.g36maid.dev`；若部署到不同的 Cloudflare 帳號，需擁有該網域或另議
- [ ] 確認 Facebook Graph API 版本（`routes/oauth.ts` 的 `FACEBOOK_VERSION`，目前 `v24.0`）仍有效（啟用 FB 登入時）

## 7. 已知限制

- 公告與討論區尚無分頁（資料多時一次載入全部）
- Email 註冊不驗證信箱；為避免帳號被搶註接管，第三方登入不會自動連結到「有密碼的帳號」
- 刪除教室或重設預覽後，舊對話的 Durable Object transcript 不會清除（已無法連線）

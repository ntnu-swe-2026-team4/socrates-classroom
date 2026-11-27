# 功能總覽（Feature Inventory）

> 最後更新：2026-11-21 ｜ 對應 `apps/server/src/routes` 與 `apps/web/src/routes`
> API 細節見 [`api-contract.md`](./api-contract.md)；架構見 [`architecture.md`](./architecture.md)

## 目錄

- [學生與老師：帳號與教室](#學生與老師帳號與教室)
- [單人：與蘇格拉底對話](#單人與蘇格拉底對話)
- [活動與報告](#活動與報告)
- [對話引擎（Pi Durable）](#對話引擎pi-durable)
- [LLM Gateway 與 Teacher Keys](#llm-gateway-與-teacher-keys)
- [平台與基礎建設](#平台與基礎建設)

---

## 學生與老師：帳號與教室

| 功能         | 說明                                                                                                                                                                                                                                                  | 主要路由 / 頁面                                                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 登入頁       | dithered colonnade 重設計（#178）：email＋密碼（PBKDF2、HMAC cookie 30 天）；登入／註冊模式切換（註冊 name 必填）；忘記密碼入口（#230）；系統公告欄；邀請碼入場；已登入 admin 由 guard 導 `/admin`；SSO 按鈕見「SSO 登入」                            | `POST /api/auth/login`・`GET /api/auth/providers`・`/login`                                                                                         |
| 註冊學生     | 以邀請碼註冊學生帳號（email＋密碼），註冊即成員；同 email 可登入                                                                                                                                                                                      | `POST /api/auth/register`                                                                                                                           |
| 自行註冊     | 不需邀請碼，email＋密碼註冊為獨立帳號（#124）；加入班級後即一般學生                                                                                                                                                                                   | `POST /api/auth/signup`                                                                                                                             |
| SSO 登入     | Google／Facebook OAuth 2.0／OIDC（PKCE＋state＋nonce，#124、#207）；同 email 與 email 帳號分屬兩個帳號；登入頁按 `GET /auth/providers` 探測渲染按鈕（#178）                                                                                           | `GET /api/auth/oauth/:provider/start`・`/callback`                                                                                                  |
| 登入方式管理 | 一個帳號可綁多種登入方式（email＋密碼、Google、Facebook），至少保留一種 verified 方式；變更前需 re-auth，解綁後其他裝置登出；未驗證的 email＋密碼驗證前不可登入，帳號另有 SSO 則不受 gate 影響（#138，契約見 api-contract §2.4）                      | `GET /api/me/identities`・`POST /api/me/identities/{email,oauth/:provider/start}`・`DELETE /api/me/identities/:method`・`/settings?section=account` |
| 密碼找回     | email 帳號申請重設信，以信中連結設定新密碼（#230，契約見 api-contract §2.2）；登入頁「忘記密碼」入口（#178）                                                                                                                                          | `POST /api/auth/password/forgot`・`POST /api/auth/password/reset`・`/forgot-password`・`/reset-password`                                            |
| Email 驗證   | email 帳號註冊後寄驗證信，以信中連結證明信箱是自己的（#259，閘門 #437：未驗證 session 僅能存取驗證流程，其餘一律 `403 email_unverified`；契約見 api-contract §2.3，模型見 accounts §8）。頁面見 `/verify-email` 與未驗證時的 VerifyGate（重寄＋登出） | `POST /api/auth/email/verify`・`POST /api/auth/email/verify/resend`・`/verify-email`                                                                |
| 訪客加入     | 邀請碼頁雙軌（#181）：帳號直入免填名（`POST /join` 不帶 name、成員身分、落地班級頁）；或訪客填名＋ToS（不建帳號，取得活動層 participant cookie）；`/join` index 改由班級頁邀請碼欄取代                                                                | `GET /api/join/:code`・`POST /api/join`・`/join/$code`                                                                                              |
| 活動邀請     | 老師產生活動專屬連結／QR；無痕開連結即成活動訪客，不進班級名冊                                                                                                                                                                                        | `POST /api/activities/:id/invites`・`GET /api/invites/:token`・`/join/a/$token`                                                                     |
| 教室社群     | 主題、公告、單層討論串和成員分頁，含活動歷史與 WebSocket 更新（#324、#187）                                                                                                                                                                           | `/classrooms/:id`・`/api/classrooms/:id/{members,announcements,posts,activities,events}`                                                            |
| 教室行事曆   | 教室內頁的「行事曆」分頁提供月／週視圖與當天事件檢視。老師可新增／編輯／刪除排程，也能從議題排定討論並在原事件開始；學生可從原事件加入，結束後可開啟報告頁。                                                                                          | `/classrooms/:id?tab=calendar`；`ClassroomCalendar`、`lib/calendar.ts`                                                                              |
| 教室邀請     | 班級邀請、活動訪客邀請與班級＋活動邀請，老師可分享 QR code 及撤銷邀請（#324、#187）                                                                                                                                                                   | `/join/i/:token`・`/api/classrooms/:id/invites`・`/api/classroom-invites/:token`                                                                    |
| 個人報告索引 | 教室列表中的「我的報告」可查看本人在各班的報告，含已離開的班級（#324、#187）                                                                                                                                                                          | `/classrooms`・`GET /api/me/reports`                                                                                                                |
| 教室清單     | 側邊欄「教室」按鈕按下後在原地展開兩個子項目，分成「我選的課」（加入中的教室）與「教室管理」（自己開的教室，含 code/url），列表頁以 `?view=enrolled｜teaching` 切換（#408）                                                                           | `GET /api/classrooms`・`/classrooms`                                                                                                                |
| 建立教室     | 任何登入 user 建立空教室（建班即成為該班老師；只建班級、產生邀請碼，不建活動，#210）                                                                                                                                                                  | `POST /api/classrooms`・`/classrooms`（New class 對話框，#185）                                                                                     |
| 議題集       | 議題屬於班級；班級內新增／AI 生成；跨班複製為獨立副本；系統題任何登入 user 可用（#210）；同內容視為同一題（dedup）、題目可刪（soft delete，歷史頁不受影響，#383）                                                                                     | `GET/POST/DELETE /api/classrooms/:id/topics`・`POST /api/topics/:id/copy`・`/classrooms/:id`                                                        |
| 開活動       | 以班級議題或系統題開新活動（`live` 會換掉進行中活動；`test` 不換，見下）                                                                                                                                                                              | `POST /api/classrooms/:id/activities`・`/classrooms/:id`                                                                                            |
| 測試模式     | 老師建 1–6 個 slot，各自一條獨立對話；學生任何入口都看不到；結束後照常產報告                                                                                                                                                                          | `GET/POST /api/activities/:id/slots`・`/t/live/:id`                                                                                                 |
| 議題池       | 系統題＋個人題列表；AI 生成候選（未落庫）                                                                                                                                                                                                             | `GET/POST /api/topics`・`POST /api/topics/generate`                                                                                                 |

## 單人：與蘇格拉底對話

| 功能     | 說明                                                                                                                                                            | 路由 / 頁面                                                 |
| -------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| 自由對話 | 學生提問 → 蘇格拉底追問（≤3 句、以問句結尾）；WebSocket 串流（view＋chord ops）                                                                                 | `/agents/chat/:name`・`/dialogue`                           |
| 3D 頭像  | three.js 蘇格拉底半身像（`socrates.glb`）＋viseme/expression morph targets，對話頁角落小窗 `SocratesCompanion` 呈現（可拖曳、可關閉、主題切換墨色）             | `SocratesCompanion`・`public/socrates.glb`                  |
| 情緒表現 | avatar extension 產生 `app.emotion` entry（機率本體）→ 頭像表情映射                                                                                             | `dialogue.tsx`（thinking 暫態 Confused；回合後按 entry）    |
| 語音輸入 | 原生 SpeechRecognition 優先；無支援（Firefox）時 MediaRecorder → server STT；effect-free hook（#183）                                                           | `POST /api/stt`・`useVoiceInput`                            |
| 語音朗讀 | 單通道 TTS（跨 tab 仲裁、句尾截斷 ≤4000 字）＋說話中振幅驅動嘴型（#180/#183）                                                                                   | `POST /api/tts`・`lib/speechArbiter.ts`                     |
| 名詞查詢 | 選取文字 → 查詢面板（prose oneshot，失敗時顯示錯誤）；查詢紀錄持久化                                                                                            | `POST /api/lookup`・`TermPanel`                             |
| 順帶一問 | 頂欄按鈕或在輸入框打 `/btw 問題` 開側欄，暫離蘇格拉底問定義／背景（例：電車難題）；fork 主對話，內容不回寫主對話與報告；「新話題」以當下主對話重新 fork（#121） | WS `btw` op（`api-contract.md` §5.4）・`BtwPanel`・`useBtw` |
| 對話歷史 | pi transcript 永久保存於 DO；重連 watch 即恢復完整 view                                                                                                         | `watch`（無獨立歷史端點）                                   |

## 活動與報告

| 功能       | 說明                                                                                                                                                                                                | 路由 / 頁面                                                                                                      |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 活動詳情   | 教室＋議題＋結束時間                                                                                                                                                                                | `GET /api/activities/:id`                                                                                        |
| 即時面板   | `live` 活動的資料源（#73）尚未接線——顯示待上線提示；`test` 活動顯示 slot 列表與開啟對話                                                                                                             | `/t/live/:id`                                                                                                    |
| 結束活動   | 老師觸發報告生成（ReportRunner DO，alarm 驅動）                                                                                                                                                     | `POST /api/activities/:id/finish`                                                                                |
| 報告輪詢   | 生成中 404 `report_pending`（前端輪詢）；失敗 500 `report_failed`                                                                                                                                   | `GET /api/activities/:id/report`・`/report/:id`                                                                  |
| 角色分流   | 老師見全班（classReport＋每人 analysis＋indicators＋engagement）；學生只見自己（analysis＋indicators＋假名，engagement 依老師勾選）                                                                 | 同上；形狀見 `api-contract.md` §7                                                                                |
| 立場星圖   | 老師的群體報告把 `classReport.axes` 的落點畫成星圖：勾 0–3 條軸，從中間點展開成一條線、平面、立體（可拖曳旋轉）；階層式分群（Ward）自動或指定 2–4 群；點一個點看該生在各軸的想法                    | `/report/:id`（群體）；`StanceConstellation`                                                                     |
| 六角圖     | 單人報告的思辨表現圖：六條軸對應 spec 的六項思辨力目標（`indicators`，C1–A2），每項四級（未觀察到／初步／部分／達成，不是分數），右側列出判準、一句依據與行號；`indicators` 為 `null` 時隱藏（#78） | `/report/:id`（單人）；`ThinkingHexagon`                                                                         |
| 思辨力指標 | 單人報告附六項思辨力指標（C1–A2，各 0–3 級＋行號＋一句依據），與論點總結分開判斷（#255），由六角圖呈現（#78）                                                                                       | `GET /api/activities/:id/report`（`indicators`）                                                                 |
| 認真度     | 單人報告附認真度三維度（實質發言／回應追問／切題，各 0–3 級＋行號＋一句依據），老師一律看得到；老師可勾選是否也顯示在群體報告（以假名列表）與學生本人的報告，預設皆關（#267）                       | `GET /api/activities/:id/report`（`engagement`）・`PUT /api/activities/:id/engagement-visibility`；`/report/:id` |

## 對話引擎（Pi Durable）

| 能力             | 說明                                                                                                                                                                           | 位置                                       |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------ |
| Durable 對話     | 每執行緒一個 Chat DO：transcript/admission/retry/恢復存於 DO SQLite（pi_* 表）；no queue（busy 拒絕）                                                                          | `apps/server/src/do/chat.ts`               |
| WebSocket        | `session.watch()` → view + chord ops；客戶端 `applyImmutable` 套用；斷線 `onConnectionError` 復原                                                                              | `apps/server/src/ws/`・`useDialogue`       |
| 情緒協議         | avatar extension：Clef choice 題 → `app.emotion` entry（機率）；文字零污染（#111）                                                                                             | `apps/server/src/pi/extensions/avatar/`    |
| 違規偵測         | judgment extension：逐輪 Clef 分類＋`report_violation` 自報 tool → `app.violation` entry（#71）                                                                                | `apps/server/src/pi/extensions/judgment/`  |
| BTW side session | btw extension：root 的 pi fork，只選 `btw`（`prompts/btw.md`）；host 預設 selection 排除 btw，主對話不受影響（#121）                                                           | `apps/server/src/pi/extensions/btw.ts`     |
| 網路搜尋         | websearch extension：`web_search`（全網）／`fetch_content`（任意 URL，per-hop SSRF 驗證）／`get_search_content`（分頁＋findText）                                              | `apps/server/src/pi/extensions/websearch/` |
| Agent profiles   | socrates／lookup／topic-gen／student-report／student-indicators／student-engagement／class-report／class-report-axes——角色欄位，model 由 gateway 依 traffic class 解析（#113） | `apps/server/src/pi/agents/profiles.ts`    |
| 供 mock 測試     | pi-ai faux provider（`LLM_PROVIDER=mock`）                                                                                                                                     | `apps/server/src/pi/models.ts`             |

詳細：[`pi.md`](./pi.md)

## LLM Gateway 與 Teacher Keys

| 能力          | 說明                                                                                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 配置化路由    | `providers.config.yaml`（build-time 編譯）：provider 實例×credential×priority×traffic class；程式碼零模型 id                                                  |
| fallback      | pi 原生 legs（鏈首綁 symbol）＋`settings.retry` 指數退避；gateway 只做決策（cooldown/記帳）                                                                   |
| cooldown      | (provider, model, credential) 記帳；429/timeout 60s、401/403 dead、過期自然回；ledger 生命週期＝isolate（`getRouter`）                                        |
| Teacher keys  | 帳戶級 provider keys 與 model 順序見 [Gateway](./architecture.md#5-gatewayappsserversrcgateway)                                                               |
| BYOK 額度警示 | 每 provider 每月 USD 額度（`usage` extension 記 tokens+cost，不存對話內容）；60/80/100% inline 檢測寄 email（同月同水位一次，UTC 月曆）；老師＋管理員（#146） |
| Mock          | `LLM_PROVIDER=mock`：離線 faux 模型（測試預設）                                                                                                               |

詳細規則與查證：[`providers.md`](./providers.md)、[`architecture.md`](./architecture.md) §5

## 平台與基礎建設

| 能力        | 說明                                                                                                                                                                                                                                                                                 |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 單一 Worker | Hono API + SPA 靜態資產 + 兩個 DO，同一部署單位                                                                                                                                                                                                                                      |
| D1          | 應用資料（users／classrooms／topics／activities／members／activity_participants／reports／pseudonyms／teacher_keys）；migrations 走 `cf d1 migrations apply`                                                                                                                         |
| i18n        | 介面三語（zh-TW/en/es，typed dictionary 由 tsc 強制完備）；後端訊息 (`src/messages.ts`) 同步三語                                                                                                                                                                                     |
| 登入前故事  | 捲動驅動漫畫故事頁：47 張 WebP sprite sheet 於 `<canvas>` 播放（視差、人群氣球、眼睛虹彩切換）；資產 repo 外產出，更換時 bump `ASSET_VERSION`                                                                                                                                        |
| 殼層        | AppShell side rail（品牌塊、Home/Classrooms、admin 桿、主題方鈕、頭像）；compact 帳號選單（TrapDialog）；focus/visibility 重查 session 與跨 tab 同步（`SESSION_SIGNAL_KEY` announce，#179）；`ht-theme` 內頁效果層接線                                                               |
| 設定頁      | 分類導覷（一般／對話體驗／API keys，`?section=` deep link）；對話偏好（3D 模型、朗讀、音量、聲線——companion store 純 client-side）；BYOK 金鑰與月配額管理（#153/#146）                                                                                                               |
| 新手教學    | 帳號第一次進入登入後的頁面時自動出現，逐一亮起左側導覽列的按鈕（首頁、提問、教室、通知、深淺色、帳號）並附說明，可上一步／下一步／略過；設定頁「一般」可重新觀看（#487）。已看過的紀錄存 localStorage（`tour-seen:<userId>`），換裝置會再出現一次（`OnboardingTour`、`lib/tour.ts`） |
| CI/CD       | GitHub Actions：PR lint/test（server＋web）/build/dry-run；main 自動 migrations + deploy（見 [`cf.md`](./cf.md)）                                                                                                                                                                    |
| 觀測        | Worker observability 開啟；AI Gateway log/cache 關閉（ZDR）；log 不含學生對話內容                                                                                                                                                                                                    |

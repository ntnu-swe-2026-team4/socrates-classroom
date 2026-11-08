# 功能總覽（Feature Inventory）

> 最後更新：2026-11-03 ｜ 對應 `apps/server/src/routes`（99 個端點）與 `apps/web/src/pages`
> API 細節見 [`api-contract.md`](./api-contract.md)；架構見 [`architecture.md`](./architecture.md)

## 目錄

- [學生與老師：帳號與教室](#學生與老師帳號與教室)
- [單人：與蘇格拉底對話](#單人與蘇格拉底對話)
- [私人題庫與分享](#私人題庫與分享)
- [四階段辯論活動](#四階段辯論活動)
- [多人討論](#多人討論)
- [教室社群：貼文、公告、行事曆](#教室社群貼文公告行事曆)
- [教材與結論報告（檔案）](#教材與結論報告檔案)
- [對話引擎（Pi Durable）](#對話引擎pi-durable)
- [LLM Provider Pool 與 BYOK](#llm-provider-pool-與-byok)
- [平台與基礎建設](#平台與基礎建設)

---

## 學生與老師：帳號與教室

| 功能       | 說明                                                                                                                         | 主要路由 / 頁面                                                             |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| 示範登入   | 選身分（學生/老師）+ 姓名；同名自動登入既有帳號，cookie session 30 天。示範級驗證，正式版規劃見 [`roadmap.md`](./roadmap.md) | `POST /api/auth/login`・`/login`                                            |
| 個人資料   | 改名（查重）、頭像 data URL（≤200KB）                                                                                        | `PATCH /api/me`                                                             |
| 建立教室   | 老師建立；自動產生邀請碼                                                                                                     | `POST /api/classrooms`・ClassroomFormDialog                                 |
| 邀請碼加入 | 學生以邀請碼加入（可停用）                                                                                                   | `GET /api/join-codes/:code`・`POST /api/classrooms/:id/join`・JoinClassroom |
| 加入審核   | 可要求申請+問卷；老師核准/駁回/附註                                                                                          | `POST /api/applications/:id/review`・ClassroomAdmin                         |
| 名單匯入   | 老師貼上多名稱批次建立學生（回報 added/skipped）                                                                             | `POST /api/classrooms/:id/members/import`                                   |
| 成員管理   | 助教指派、移除、線上狀態（5 分鐘內有活動）、學習進度                                                                         | `/api/classrooms/:id/members*`                                              |
| 教室探索   | 學生瀏覽開放探索的教室                                                                                                       | `GET /api/classrooms/discover`                                              |
| 邀請處理   | 待處理邀請的接受 / 婉拒                                                                                                      | `POST …/invite/accept｜decline`                                             |

## 單人：與蘇格拉底對話

| 功能     | 說明                                                                | 路由 / 頁面                                                         |
| -------- | ------------------------------------------------------------------- | ------------------------------------------------------------------- |
| 自由對話 | 學生提問 → 蘇格拉底追問（≤3 句、以問句結尾）；SSE 串流              | `POST /api/archives/:id/dialogue`・DialoguePage                     |
| 情緒標記 | AI 回覆開頭 `[neutral/happy/confused/angry]` → 驅動 3D 頭像表情     | 已退役（#90）：情緒走 avatar extension 的 app.emotion entry（#111） |
| 3D 頭像  | three.js 蘇格拉底半身像（`socrates.glb`）＋說話動作                 | DialoguePage・`public/socrates.glb`                                 |
| 語音朗讀 | AI 回覆 TTS 朗讀（`speech.ts`）＋ AI 說話中狀態（`ai-speaking.ts`） | DialoguePage・IndividualStage                                       |
| 表情預覽 | 點擊情緒按鈕即時播放頭像表情                                        | DialoguePage                                                        |
| 對話歷史 | 每段對話永久保存於 D1；重新進入可續聊                               | `GET /api/archives/:id/dialogue`                                    |

## 私人題庫與分享

| 功能     | 說明                                                           | 路由 / 頁面                                                                |
| -------- | -------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 議題庫   | 對話存檔（標題、輪數、摘要、日期）分私人/公開                  | `GET/POST/PATCH /api/archives*`・TopicsPage                                |
| 論點總結 | 標記進總結的題目彙整                                           | `/summary`・SummaryPage                                                    |
| 分享     | 擁有者可分享給同教室同學/助教/老師（整份名單取代、不可轉分享） | `PATCH /api/archives/:id`・`GET /api/me/share-targets`・ShareArchiveDialog |
| 公開題庫 | `bank: "public"` 的題目全校可見                                | `/bank/public`・BankPage                                                   |

## 四階段辯論活動

老師從議題建立活動，四階段推進：**個人調查 → 團隊提純 → 辯論比賽 → 結果**。

| 功能     | 說明                                                                 | 路由 / 頁面                                                                   |
| -------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 個人調查 | 與蘇格拉底對話（≤20 輪）＋ AI 草稿論點（主張/理由/證據）＋ 座標估計  | `POST …/dialogue`・`POST …/position/draft`・`PUT …/position`・IndividualStage |
| 自動補位 | 沒確認論點的學生由 AI 依對話自動補建議                               | `autoFillPositions`                                                           |
| 團隊分組 | 依論點座標 kmeans 分組（2–8 人）；可重新分組                         | `POST …/groups/regroup`・buildGroups                                          |
| 組內提純 | 組別聊天室；AI 整理主張、丟反例；投票 endorse/revise/oppose → 狀態機 | `POST /groups/:gid/ai/*`・`POST /arguments/:id/vote`・TeamStage               |
| 分裂     | 分歧過大可分裂成兩組（票數重算）                                     | `POST /groups/:gid/split`                                                     |
| 辯論比賽 | 兩兩配對、四回合（開場/質詢/反駁/結辯）、回合時鐘、逾時自動送出      | `POST /rooms/:id/start`・`POST /rooms/:id/turns`・`tickExpired`・DebateStage  |
| AI 裁判  | 逐回合依證據/推理/回應/表達評分＋文字講評                            | `judgeTurn`＋judgments                                                        |
| 老師覆寫 | 老師可覆寫單項分數                                                   | `PATCH /api/judgments/:id`                                                    |
| 計分     | 個人/團隊/辯論加權總分＋老師調分                                     | `GET/POST …/scores`・`PATCH …/scores/:memberId`                               |
| 立場星圖 | 個人座標 → 團隊共識座標的 3D 星圖（three.js）                        | `GET …/star`・ResultsStage・StarMap                                           |
| 活動事件 | 階段/回合/截止/就緒即時廣播（SSE，經 ActivityEvents DO）             | `GET /api/activities/:id/events`                                              |
| 筆記     | 階段筆記 CRUD                                                        | `/api/activities/:id/notes*`                                                  |
| 就緒回報 | 團隊階段的就緒標記                                                   | `PUT /api/activities/:id/ready`                                               |

## 多人討論

| 功能      | 說明                                                      | 路由 / 頁面                                     |
| --------- | --------------------------------------------------------- | ----------------------------------------------- |
| 出題      | 老師建立討論題目（提示、結論提示、輪數上限 2–40、截止）   | `POST /api/classrooms/:id/discussions`          |
| 個別對話  | 每位學生各自與蘇格拉底對話（獨立 DO 執行緒）              | `POST …/sessions/me/messages`（SSE）            |
| 結論提交  | 對話過才可提交；可撤回重寫                                | `PUT …/sessions/me/conclusion`                  |
| 全班成果  | 老師看每位學生：輪數、覆蓋度（主張/理由/證據/反例）、結論 | `GET …/sessions/:studentId`・DiscussionTaskPage |
| 結束/刪除 | 老師結束討論（唯讀）或刪除                                | `PATCH/DELETE /api/discussions/:id`             |

## 教室社群：貼文、公告、行事曆

| 功能       | 說明                                                                     | 路由 / 頁面                          |
| ---------- | ------------------------------------------------------------------------ | ------------------------------------ |
| 教室討論區 | 貼文+回覆（限同討論區主貼）、匿名發問（老師看得到身分）、刪除            | `/api/classrooms/:id/posts*`         |
| 公告       | 老師發布/編輯/刪除、置頂、排程發布（`publish_at`）                       | `/api/classrooms/:id/announcements*` |
| 行事曆     | 自動彙集四種系統事件（辯論截止、活動階段、討論截止、公告）＋老師自訂事件 | `GET /api/classrooms/:id/calendar`   |

## 教材與結論報告（檔案）

| 功能     | 說明                                                          | 路由 / 頁面                                                   |
| -------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| 教材上傳 | 老師上傳連結或檔案（≤50MB → R2）；下載需教室成員              | `POST /api/topics/:id/resources/files`・`GET /api/files/:id`  |
| 結論報告 | 學生上傳報告檔（每題一份，重傳覆蓋）；僅本人與老師/助教可下載 | `POST /api/topics/:id/reports`・`GET /api/topics/:id/reports` |

## 對話引擎（Pi Durable）

| 能力         | 說明                                                                                                  | 位置                                      |
| ------------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Durable 對話 | 每執行緒一個 Chat DO：transcript/admission/retry/恢復存於 DO SQLite（pi_* 表）；no queue（busy 拒絕） | `apps/server/src/do/chat.ts`              |
| WebSocket    | `session.watch()` → view + chord ops；客戶端 `applyImmutable` 套用                                    | `apps/server/src/ws/`                     |
| 情緒協議     | avatar extension：Clef choice 題 → `app.emotion` entry（機率）；文字零污染（#111）                    | `apps/server/src/pi/extensions/avatar/`   |
| 違規偵測     | judgment extension：逐輪 Clef 分類＋`report_violation` 自報 tool → `app.violation` entry（#71）       | `apps/server/src/pi/extensions/judgment/` |
| 歷史讀取     | D1 `messages` 表（REST GET）；寫入只經 WS（pi transcript 為真相，D1 為投影）                          | `apps/server/src/routes/activity.ts`      |
| 供 mock 測試 | pi-ai faux provider（`LLM_PROVIDER=mock`）                                                            | `apps/server/src/pi/models.ts`            |

詳細：[`pi.md`](./pi.md)

## LLM Routing 與 Teacher Keys

| 能力         | 說明                                                                                                         |
| ------------ | ------------------------------------------------------------------------------------------------------------ |
| 配置化路由   | `providers.config.yaml`（build-time 編譯）：provider 實例×credential×priority×traffic class；程式碼零模型 id |
| fallback     | pi 原生 legs（鏈首綁 symbol）＋`settings.retry` 指數退避；routing 只做決策（cooldown/記帳）                  |
| cooldown     | (provider, model, credential) 記帳；429/timeout 60s、401/403 dead、過期自然回                                |
| Teacher keys | 一 provider 一把 key（D1 AES-GCM，回 last4）；拖曳排序＝provider 鏈序；學生無 BYOK（#82）                    |
| Mock         | `LLM_PROVIDER=mock`：離線 faux 模型（測試預設）                                                              |

詳細規則與查證：[`providers.md`](./providers.md)、[`architecture.md`](./architecture.md) §5

## 平台與基礎建設

| 能力        | 說明                                                                                               |
| ----------- | -------------------------------------------------------------------------------------------------- |
| 單一 Worker | Hono API + SPA 靜態資產 + 兩個 DO，同一部署單位                                                    |
| D1 + R2     | 應用資料與檔案；migrations 走 `cf d1 migrations apply`                                             |
| i18n        | 介面三語（zh-TW/en/es）；後端訊息 (`src/messages.ts`) 同步三語                                     |
| 音效        | 介面音效（`public/sounds/`、AudioContext）                                                         |
| 登入前故事  | Lottie 動畫故事頁（`public/landing/*.json`，捲動載入）                                             |
| CI/CD       | GitHub Actions：PR lint/test/build/dry-run；main 自動 migrations + deploy（見 [`cf.md`](./cf.md)） |
| 觀測        | Worker observability 開啟；AI Gateway log/cache 關閉（ZDR）                                        |

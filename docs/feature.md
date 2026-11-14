# 功能總覽（Feature Inventory）

> 最後更新：2026-11-09 ｜ 對應 `apps/server/src/routes` 與 `apps/web/src/routes`
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

| 功能         | 說明                                                                                                                                                                                    | 主要路由 / 頁面                                                                                                           |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 登入         | 訪客（一鍵）、Email＋密碼（PBKDF2）、Google／Apple／Facebook OAuth（未設定時按鈕停用）；HMAC cookie session 30 天                                                                       | `POST /api/auth/guest`・`POST /api/auth/login`・`/api/auth/oauth/:provider/*`・`/login`                                   |
| 註冊         | Email＋密碼註冊正式帳號（邀請碼選填）；目前是訪客則原地升級、保留對話與教室                                                                                                             | `POST /api/auth/register`・`/login?mode=register`                                                                         |
| 加入教室     | 邀請碼＋ToS 同意（未登入需輸入姓名、已登入沿用帳號名）；加入後進教室內頁                                                                                                                | `GET /api/join/:code`・`POST /api/join`・`/join/:code`・教室列表的邀請碼欄                                                |
| 教室清單     | 自己開的與已加入的教室一起列出，`role` 為該教室中的身分；可篩選                                                                                                                         | `GET /api/classrooms`・`/classrooms`                                                                                      |
| 創建課程     | 正式帳號在「授課」頁按「創建課程」即建立空課程並進入教室頁；名稱可在標題旁直接改；第一個主題可從題庫挑、自訂或 AI 生成（訪客 → 說明需正式帳號的確認框）                                 | `POST /api/classrooms`・`PATCH /api/classrooms/:id`・`/classrooms?view=teacher`・教室頁 `TopicPicker`                     |
| 教室內頁     | 目前主題＋所有討論主題列表（學生進入對話／看報告；owner 即時面板／報告／開新主題／邀請碼與 QR）                                                                                         | `GET /api/classrooms/:id`・`GET /api/classrooms/:id/activities`・`POST /api/classrooms/:id/activities`・`/classrooms/:id` |
| 教室社群     | 教室頁分頁（主題／公告／討論區／成員，`?tab=`）：owner 發布與刪除公告；成員與 owner 發討論串、單層回覆，作者或 owner 可刪除；成員列表（不含測試學生），owner 可移除學生、學生可退出教室 | `/api/classrooms/:id/announcements`・`/api/classrooms/:id/posts`・`/api/classrooms/:id/members`・`/classrooms/:id?tab=`   |
| 學生視角預覽 | 老師以每間教室一個的測試學生進入對話（Student View）；不計入 `memberCount`、報告與 pseudonyms；可重設、可回到老師 session                                                               | `POST /api/classrooms/:id/preview`・`/api/preview/reset`・`/api/preview/exit`・教室頁按鈕＋AppShell banner                |
| 議題         | 內建議題列表；AI 生成（方向 → 三題）                                                                                                                                                    | `GET/POST /api/topics`・`POST /api/topics/generate`                                                                       |

## 單人：與蘇格拉底對話

| 功能         | 說明                                                                                                                                                                                                                                                                                                                                                                | 路由 / 頁面                                           |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| 單人對話     | 不需教室的自由提問；左側主題欄（搜尋、重新命名、刪除、可收合）＋右側對話                                                                                                                                                                                                                                                                                            | `/api/solo/chats`・`/chat`・`/chat/:chatId`           |
| 教室對話     | 學生提問 → 蘇格拉底追問（≤3 句、以問句結尾）；WebSocket 串流（view＋chord ops）；左欄列出該教室所有討論主題                                                                                                                                                                                                                                                         | `/agents/chat/:name`・`/dialogue`                     |
| 蘇格拉底模型 | 3D 半身像（`socrates.glb`）只出現在 AI 對話介面的左側面板：面板最上方可切換「列表／蘇格拉底」（手機為抽屜），會員、學生帳號、訪客都有；模型只顯示、不可操作，朗讀時顯示「正在朗讀」與停止鈕；設定頁可關閉模型，關閉後介面不出現模型，語音朗讀不受影響                                                                                                               | `SocratesCompanion`・`ChatLayout`・`lib/companion.ts` |
| 情緒表現     | avatar extension 產生 `app.emotion` entry（機率本體）→ 本次對話中新回覆抵達時，模型播放一次對應表情（不循環、載入歷史不重播）                                                                                                                                                                                                                                       | `DialogueView`・`companion.playExpression`            |
| 語音輸入     | MediaRecorder 錄音 → whisper STT → 文字                                                                                                                                                                                                                                                                                                                             | `POST /api/stt`・`useVoiceInput`                      |
| 語音朗讀     | 單一語音通道（`lib/speech.ts`）：整個 App 同時只有一段聲音，嘴型跟著正在播的那段；「使用者最後主動做的事」優先——新的主動朗讀會打斷舊的，非主動的自動朗讀不打斷別人（略過時顯示「唸給我聽」）；對話自動朗讀、問 AI 每則回答有「朗讀」鈕；小幫手顯示「正在朗讀：來源」可一鍵停止；跨分頁用 `BroadcastChannel`，一個分頁開始說話其他分頁自動停止；設定頁可關閉或調音量 | `POST /api/tts`・`lib/speech.ts`・`SocratesCompanion` |
| 名詞查詢     | 選取文字 → 查詢面板（prose oneshot，失敗回 fallback 文字）；查詢紀錄持久化                                                                                                                                                                                                                                                                                          | `POST /api/lookup`・`TermPanel`                       |
| 對話歷史     | pi transcript 永久保存於 DO；重連 watch 即恢復完整 view                                                                                                                                                                                                                                                                                                             | `watch`（無獨立歷史端點）                             |

## 活動與報告

| 功能     | 說明                                                                     | 路由 / 頁面                                     |
| -------- | ------------------------------------------------------------------------ | ----------------------------------------------- |
| 活動詳情 | 教室＋議題＋結束時間                                                     | `GET /api/activities/:id`                       |
| 即時面板 | 資料源（#73）尚未接線——頁面顯示待上線提示；結束活動按鈕可用              | `/t/live/:id`                                   |
| 結束活動 | 老師觸發報告生成（ReportRunner DO，alarm 驅動）                          | `POST /api/activities/:id/finish`               |
| 報告輪詢 | 生成中 404 `report_pending`（前端輪詢）；失敗 500 `report_failed`        | `GET /api/activities/:id/report`・`/report/:id` |
| 角色分流 | 老師見全班（classReport＋每人 analysis）；學生只見自己（analysis＋假名） | 同上；形狀見 `api-contract.md` §7               |

## 對話引擎（Pi Durable）

| 能力           | 說明                                                                                                  | 位置                                       |
| -------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| Durable 對話   | 每執行緒一個 Chat DO：transcript/admission/retry/恢復存於 DO SQLite（pi_* 表）；no queue（busy 拒絕） | `apps/server/src/do/chat.ts`               |
| WebSocket      | `session.watch()` → view + chord ops；客戶端 `applyImmutable` 套用；斷線 `onConnectionError` 復原     | `apps/server/src/ws/`・`useDialogue`       |
| 情緒協議       | avatar extension：Clef choice 題 → `app.emotion` entry（機率）；文字零污染（#111）                    | `apps/server/src/pi/extensions/avatar/`    |
| 違規偵測       | judgment extension：逐輪 Clef 分類＋`report_violation` 自報 tool → `app.violation` entry（#71）       | `apps/server/src/pi/extensions/judgment/`  |
| 網路搜尋       | websearch extension：`web_search`／`fetch_content`／`get_search_content`（allowlist＋SSRF 防護）      | `apps/server/src/pi/extensions/websearch/` |
| Agent profiles | socrates／lookup／topic-gen／report-analyst——角色欄位，model 由 gateway 依 traffic class 解析（#113） | `apps/server/src/pi/agents/profiles.ts`    |
| 供 mock 測試   | pi-ai faux provider（`LLM_PROVIDER=mock`）                                                            | `apps/server/src/pi/models.ts`             |

詳細：[`pi.md`](./pi.md)

## LLM Gateway 與 Teacher Keys

| 能力         | 說明                                                                                                                                                             |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 配置化路由   | `providers.config.yaml`（build-time 編譯）：provider 實例×credential×priority×traffic class；程式碼零模型 id                                                     |
| fallback     | pi 原生 legs（鏈首綁 symbol）＋`settings.retry` 指數退避；gateway 只做決策（cooldown/記帳）                                                                      |
| cooldown     | (provider, model, credential) 記帳；429/timeout 60s、401/403 dead、過期自然回；ledger 生命週期＝isolate（`getRouter`）                                           |
| 帳號角色     | admin／user⇄teacher（教師模式、試用 3 教室×40 人、學校方案）／student（老師建立）／guest（單一活動，結束 24h 失效）；`/admin` 管理學校與教師（見 `accounts.md`） |
| 立場分佈圖   | 班級報告每條立場軸把學生畫在 0–100 的軸上                                                                                                                        | `/report/:id`                                 |
| 老師即時面板 | 每 5 秒輪詢：每位學生一列（名稱、對話中／閒置／還沒開口、輪數、違規標記、最後一句），需要注意的排最上面；新的違規標記或超過 3 分鐘沒回應時在面板上方提醒         | `/t/live/:id`・`GET /api/activities/:id/live` |
| 系統通知     | admin 在管理頁發送／刪除；有帳號者在鈴鐺看到並有未讀紅點（打開即已讀）；登入頁左側公告欄公開顯示                                                                 |
| Teacher keys | 多把 key × 多個 model（每筆 entry 一條 leg，D1 AES-GCM，回 last4）；設定頁拖曳排序＝鏈序；學生無 BYOK（#82）                                                     |
| Mock         | `LLM_PROVIDER=mock`：離線 faux 模型（測試預設）                                                                                                                  |

詳細規則與查證：[`providers.md`](./providers.md)、[`architecture.md`](./architecture.md) §5

## 平台與基礎建設

| 能力        | 說明                                                                                                                                         |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 單一 Worker | Hono API + SPA 靜態資產 + 兩個 DO，同一部署單位                                                                                              |
| D1          | 應用資料（users／classrooms／topics／activities／members／reports／pseudonyms／teacher_key_entries）；migrations 走 `cf d1 migrations apply` |
| i18n        | 介面三語（zh-TW/en/es，typed dictionary 由 tsc 強制完備）；後端訊息 (`src/messages.ts`) 同步三語                                             |
| 登入前故事  | 捲動式漫畫故事頁（`routes/index.tsx`）：sprite sheet＋canvas 分格動畫、滑鼠視差、可拖曳人物、按住互動；取代原 Lottie 故事頁                  |
| CI/CD       | GitHub Actions：PR lint/test（server＋web）/build/dry-run；main 自動 migrations + deploy（見 [`cf.md`](./cf.md)）                            |
| 觀測        | Worker observability 開啟；AI Gateway log/cache 關閉（ZDR）；log 不含學生對話內容                                                            |

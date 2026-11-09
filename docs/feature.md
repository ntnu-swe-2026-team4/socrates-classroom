# 功能總覽（Feature Inventory）

> 最後更新：2026-11-09 ｜ 對應 `apps/server/src/routes` 與 `apps/web/src/routes`
> API 細節見 [`api-contract.md`](./api-contract.md)；架構見 [`architecture.md`](./architecture.md)

## 目錄

- [學生與老師：帳號與教室](#學生與老師帳號與教室)
- [單人：與蘇格拉底對話](#單人與蘇格拉底對話)
- [活動與報告](#活動與報告)
- [對話引擎（Pi Durable）](#對話引擎pi-durable)
- [LLM Gateway 與 Teacher Keys](#llm-routing-與-teacher-keys)
- [平台與基礎建設](#平台與基礎建設)

---

## 學生與老師：帳號與教室

| 功能     | 說明                                                             | 主要路由 / 頁面                                     |
| -------- | ---------------------------------------------------------------- | --------------------------------------------------- |
| 老師登入 | email＋密碼（PBKDF2）；HMAC cookie session 30 天                 | `POST /api/auth/login`・`/login`                    |
| 註冊學生 | 以邀請碼註冊學生帳號（email＋密碼），註冊即成員；同 email 可登入 | `POST /api/auth/register`                           |
| 訪客加入 | 邀請碼＋姓名＋ToS 同意；同名冪等重 join；mock 身分重載即失效     | `GET /api/join/:code`・`POST /api/join`・`/join`    |
| 教室清單 | 老師見自己開的教室（含 code/url）；學生見加入中的教室            | `GET /api/classrooms`・`/classrooms`                |
| 建立教室 | 老師從議題建立教室，自動產生邀請碼與第一個活動                   | `POST /api/classrooms`・`/t/setup`                  |
| 重開活動 | 同教室換議題開新活動                                             | `POST /api/classrooms/:id/activities`               |
| 議題     | 內建議題列表；AI 生成（方向 → 三題）                             | `GET/POST /api/topics`・`POST /api/topics/generate` |

## 單人：與蘇格拉底對話

| 功能     | 說明                                                                            | 路由 / 頁面                                              |
| -------- | ------------------------------------------------------------------------------- | -------------------------------------------------------- |
| 自由對話 | 學生提問 → 蘇格拉底追問（≤3 句、以問句結尾）；WebSocket 串流（view＋chord ops） | `/agents/chat/:name`・`/dialogue`                        |
| 3D 頭像  | three.js 蘇格拉底半身像（`socrates.glb`）＋viseme/expression morph targets      | `SocratesStage`・`public/socrates.glb`                   |
| 情緒表現 | avatar extension 產生 `app.emotion` entry（機率本體）→ 頭像表情映射             | `dialogue.tsx`（thinking 暫態 Confused；回合後按 entry） |
| 語音輸入 | MediaRecorder 錄音 → whisper STT → 文字                                         | `POST /api/stt`・`useVoiceInput`                         |
| 語音朗讀 | AI 回覆 melotts TTS 朗讀＋說話中振幅                                            | `POST /api/tts`                                          |
| 名詞查詢 | 選取文字 → 查詢面板（prose oneshot，失敗回 fallback 文字）；查詢紀錄持久化      | `POST /api/lookup`・`TermPanel`                          |
| 對話歷史 | pi transcript 永久保存於 DO；重連 watch 即恢復完整 view                         | `watch`（無獨立歷史端點）                                |

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

| 能力         | 說明                                                                                                                   |
| ------------ | ---------------------------------------------------------------------------------------------------------------------- |
| 配置化路由   | `providers.config.yaml`（build-time 編譯）：provider 實例×credential×priority×traffic class；程式碼零模型 id           |
| fallback     | pi 原生 legs（鏈首綁 symbol）＋`settings.retry` 指數退避；gateway 只做決策（cooldown/記帳）                            |
| cooldown     | (provider, model, credential) 記帳；429/timeout 60s、401/403 dead、過期自然回；ledger 生命週期＝isolate（`getRouter`） |
| Teacher keys | 一 provider 一把 key（D1 AES-GCM，回 last4）；`sort_order`＝provider 鏈序；學生無 BYOK（#82，byok 端點已退役）         |
| Mock         | `LLM_PROVIDER=mock`：離線 faux 模型（測試預設）                                                                        |

詳細規則與查證：[`providers.md`](./providers.md)、[`architecture.md`](./architecture.md) §5

## 平台與基礎建設

| 能力        | 說明                                                                                                                                  |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 單一 Worker | Hono API + SPA 靜態資產 + 兩個 DO，同一部署單位                                                                                       |
| D1          | 應用資料（users／classrooms／topics／activities／members／reports／pseudonyms／teacher_keys）；migrations 走 `cf d1 migrations apply` |
| i18n        | 介面三語（zh-TW/en/es，typed dictionary 由 tsc 強制完備）；後端訊息 (`src/messages.ts`) 同步三語                                      |
| 登入前故事  | StorySection 互動故事頁（#83 拆分互動化）＋ Lottie 動畫（捲動載入）                                                                   |
| CI/CD       | GitHub Actions：PR lint/test（server＋web）/build/dry-run；main 自動 migrations + deploy（見 [`cf.md`](./cf.md)）                     |
| 觀測        | Worker observability 開啟；AI Gateway log/cache 關閉（ZDR）；log 不含學生對話內容                                                     |

# Changelog（變更紀錄）

> 分支工作定案後記錄於此（標注分支；合併進主分支時更新連結）。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)。

## 2026-11-14 — BTW side session（#121，`feat/121-btw-side-chat`）

### Added

- `btw` extension＋`prompts/btw.md`：副視窗 LLM——可直接解釋定義、思想實驗設定與各方立場，但不替學生下結論、不代寫論證；不帶 tool（與 websearch 分離）
- WS `btw` op：從 root 最新 entry 做 pi fork，該連線改綁 side session；side session 的 entries 不進 root context 與報告（`api-contract.md` §5.4）
- 錯誤 code `NothingToFork`、`UnknownSession`
- 前端「順帶一問」：對話頁頂欄按鈕／輸入框 `/btw 問題` 開 `BtwPanel` 右側欄（與查詢面板互斥）；`useBtw` 另開 WS 綁 side session，只顯示 fork 點之後的 entries，回答以 Markdown 呈現；「新話題」重新 fork；session 存 sessionStorage，重整後接回（失效則自動重開）；三語 i18n

### Changed

- Chat DO `settings.extensions` 改為 getter：已安裝且非 btw 的 extensions（root 行為不變）
- routeSubmit 的 model 快取改 per session；`llm_unavailable` 廣播只送綁定該 session 的連線

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

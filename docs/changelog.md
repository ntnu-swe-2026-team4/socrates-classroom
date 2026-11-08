# Changelog（變更紀錄）

> 分支工作定案後記錄於此（標注分支；合併進主分支時更新連結）。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)。

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
- teacher keys（#82）：一 provider 一把 key（AES-GCM）；PUT order＝routing provider 鏈序
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

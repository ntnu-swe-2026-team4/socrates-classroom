# Changelog（變更紀錄）

> 分支工作定案後記錄於此（標注分支；合併進主分支時更新連結）。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)。

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

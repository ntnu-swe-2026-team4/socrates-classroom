# Changelog（變更紀錄）

> 功能合併進主分支後記錄於此。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/1.1.0/)。

## 2026-11 — 全面遷移至 Cloudflare Workers + Pi Durable（PR [#48](https://github.com/ntnu-swe-2026-team4/socrates-classroom/pull/48)）

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

# apps/server — Hono Worker + Pi Durable 對話引擎

架構設計與決策記錄請看 [`../../docs/architecture.md`](../../docs/architecture.md)；provider 路由與查證看 [`../../docs/providers.md`](../../docs/providers.md)；API 契約看 [`../../docs/api-contract.md`](../../docs/api-contract.md)。

## 重點

- 單一 Worker：`src/index.ts` 匯出 `PiAgent`、`ActivityEvents` 兩個 Durable Object 與 fetch handler。
- **PiAgent DO**（每對話執行緒一個）：`PiHarness` 管理 transcript／排隊／重試／恢復（存在 DO 自己的 SQLite `pi_*` 表）；`session.events()` 轉成前端契約的 SSE（`delta/emotion/done/error`）；完成後寫回 D1。
- **Provider pool**（`src/providers/`）：白名單唯一可路由（全 ZDR 0-day 模型），fallback 順序＝自架 DGX Spark（CF Tunnel，4 併發）→ opencode-go → OpenRouter（`zdr:true`）→ Workers AI；`LLM_PROVIDER=dev` 時 Coding Plan 優先；`mock` 用 pi-ai faux provider。
- **學生 BYOK**：自帶 provider key（pi 支援的 API-key 類 provider 全部可掛），AES-GCM 加密存 D1。
- **資料**：D1（`migrations/`，`cf d1 migrations apply`）；上傳在 R2（`UPLOADS` binding）。

## 本機

```bash
npx cf dev            # 需 Node ≥ 22.23（cf 不支援 Bun 載入 cloudflare.config.ts）
npm test              # vitest-pool-workers：真實 Worker runtime + 本地 D1/R2/DO
node scripts/seed.mjs # 灌示範資料（需 SEED_TOKEN）
```

設定（vars/secrets）見 `.env.example` 與 `cloudflare.config.ts`。

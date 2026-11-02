# AGENTS.md — apps/server (Hono Worker + Pi Durable)

The only Worker: Hono API + `PiAgent` / `ActivityEvents` Durable Objects + provider pool.
All rules from the root `AGENTS.md` apply; below are the deltas and deep water.

## Commands

```bash
pnpm dev               # cf dev (Worker + local D1/R2; AI binding is remote)
pnpm test              # vitest-pool-workers: real runtime + local D1/R2/DO
pnpm typecheck         # TS7 strict + @cloudflare/workers-types
pnpm exec cf build     # verify the bundle (.cloudflare/output/)
node scripts/seed.mjs  # seed demo data (requires SEED_TOKEN)
```

## Architecture boundaries

- `src/do/pi-agent.ts` (PiHarness) **knows nothing about HTTP**: routes call in over RPC; SSE is its output contract
- `src/providers/whitelist.ts` is the single source of truth for model routing — read the ZDR rules in `docs/providers.md` before adding any provider
- `prepare()` in `src/db/d1.ts` converts `$named` params to positional binds: keep writing SQL with `$named`
- Transactions: `db.batch()` is the only source of atomicity (D1 has no interactive transactions)
- pnpm's per-package `node_modules` is **required**: the cf CLI only resolves cf/wrangler/vite-plugin from the Worker package's own node_modules (workspace-root hoisting does not count)

## Boundaries

- **Never** change the SSE event shapes (`delta/emotion/done/error`) — the contract in `docs/api-contract.md` is frozen by design; the frontend must keep working with zero changes
- **Never** swallow a failed `saveTurn` — a turn saved to the pi transcript but missing from D1 is a data inconsistency
- **Always** attach `session.events()` **before** `session.submit()` — inverted order misses runs that finish instantly (this bug already happened)
- **Ask first**: changing `PiHarness` settings (retry / afterFailedRun), adding Durable Objects, bumping `@earendil-works/pi-*` (version-locked to `agents`: 0.32 ↔ 1.4)

## Testing conventions

- Integration tests live in `tests/api.test.ts` and are **sequentially coupled** (earlier tests seed data later tests use); `isolatedStorage: false` is intentional
- Tests use `wrangler.vitest.jsonc` (not `cloudflare.config.ts`) + the mock provider; compatibility date is 2026-08-06 (the workerd ceiling of the vitest plugin)
- LLM assertions only check shape (a `done` event, an `emotion`, non-empty text) — never content

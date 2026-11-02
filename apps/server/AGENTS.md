# AGENTS.md — apps/server (Hono Worker + Pi Durable)

Worker source (Hono API + `PiAgent` / `ActivityEvents` Durable Objects + provider pool) and the vitest setup. The deployable full-stack project lives in `apps/web` (which holds `cloudflare.config.ts` and bundles this package via `entrypoint: ../server/src/index.ts`) — all rules from the root `AGENTS.md` apply; below are the deltas and deep water.

## Commands

```bash
pnpm test              # canonical check: vitest-pool-workers (real runtime + local D1/R2/DO)
pnpm typecheck         # TS 7 strict + @cloudflare/workers-types
```

- `cf dev/build/deploy` do **not** run here — they run from `apps/web` (the vite root where the plugin finds `cloudflare.config.ts`)
- Tests cannot run from the repo root without `--root apps/server`; the pool config is `wrangler.vitest.jsonc` (not `cloudflare.config.ts`), and its compatibility date is 2026-08-06 (the vitest plugin's workerd ceiling)

## Vocabulary (get this right)

| Term      | Means                                                                       | Counted against                                   |
| --------- | --------------------------------------------------------------------------- | ------------------------------------------------- |
| **stage** | Activity phase: `individual → team → debate → done`                         | `activities.stage`                                |
| **round** | One student message in a Socratic dialogue (`role = "user"` row)            | `max_rounds` / activity limit 20 / archive rounds |
| **phase** | Debate room round type: `opening / cross / rebuttal / closing`              | `rooms.phase_idx`, `PHASES`                       |
| **turn**  | One statement inside a debate room (`rooms.turn_idx`, side a/b + moderator) | `DEFAULT_SECONDS` clock                           |

"Round" is student dialogue; "turn" is debate-room speech. Never mix them in code or copy.

## Patterns

### D1 access

```ts
// Good — helpers, $named params, awaited
const user = await one<UserRow>(db, "SELECT * FROM users WHERE id = $id", { id });
await db.batch([
  { sql: "INSERT INTO archive_messages (...) VALUES ($id, $aid, 'user', $text, NULL, $at)", params: { id, aid, text, at } },
  { sql: "UPDATE archives SET rounds = $rounds WHERE id = $id", params: { rounds, id } },
]);

// Bad — raw bun-style API (gone), positional ?, unawaited
db.query("SELECT ...").all({...});
run(db, sql, params); // ← missing await: the write is lost after the response
```

- `prepare()` converts `$named` → positional automatically; **keep `$named` in SQL**.
- Every `one/all/run` call **must be awaited** — an unawaited D1 write is dropped when the response returns.
- Atomicity = `db.batch([...])` only. For old `tx(db, () => {...})` blocks: read first, then `batch()` the writes.

### Error contract

```ts
fail(404, "classroom_not_found"); // key must exist in src/messages.ts (zh/en/es)
fail(409, "max_rounds_reached", { n: 20 }); // vars interpolate into the message
throw new Error("already_streaming"); // DO internals: app.onError maps known keys
```

- Never `c.json({ message })` inline from routes — always `fail()` + `src/messages.ts` so all three languages stay in sync.

### Dialogue SSE (frozen contract)

```
event: meta     { provider }        // informational
event: emotion  { emotion }          // once, before first delta
event: delta    { text }             // many; emotion tag already stripped
event: done     { message }          // D1-saved DialogueMessage
event: error    { message, code }    // after streaming started
```

### Adding a provider to the pool

1. Read the ZDR rules in `docs/providers.md` — whitelist only (0-day retention models).
2. Add a `PoolEntry` to `CLASS_POOL`/`DEV_POOL` in `src/providers/whitelist.ts`.
3. Wire its auth in `keyFor()` (pool.ts) or a `createProvider` block; builtin catalogs come from `@earendil-works/pi-ai/providers/all`.
4. `LLM_PROVIDER=mock` tests must still pass — mock never touches the pool chain.

## Boundaries

- **Never** change the SSE event shapes (`delta/emotion/done/error`) — `docs/api-contract.md` is frozen; the frontend must keep working with zero changes
- **Never** swallow a failed `saveTurn` — saved to pi transcript but missing from D1 is a data inconsistency
- **Always** attach `session.events()` **before** `session.submit()` — inverted order misses runs that finish instantly (this bug already happened)
- **Ask first**: changing `PiHarness` settings (retry / afterFailedRun), adding Durable Objects, bumping `@earendil-works/pi-*` (version-locked to `agents`: 0.32 ↔ 1.4)

## Testing conventions

- Integration tests live in `tests/api.test.ts` and are **sequentially coupled** (earlier tests seed data later tests use); `isolatedStorage: false` is intentional
- Tests use `wrangler.vitest.jsonc` (not `cloudflare.config.ts`) + the mock provider; compatibility date is 2026-08-06 (the vitest plugin's workerd ceiling)
- LLM assertions only check shape (a `done` event, an `emotion`, non-empty text) — never content
- Upload/download handlers under test need `app.request(url, init, env)` — the third `env` argument is what puts `c.env` bindings in place (missing it surfaces as `undefined` binding errors)

# AGENTS.md — apps/server (Hono Worker + Pi Durable, v3)

Worker source (Hono API + `PiAgent` / `ActivityEvents` / `Coordinator` / `ReportJob` Durable Objects + provider router). The deployable full-stack project lives in `apps/web` (which holds `cloudflare.config.ts` and bundles this package via `entrypoint: ../server/src/index.ts`) — all rules from the root `AGENTS.md` apply; below are the deltas and deep water.

## Commands

```bash
pnpm test              # canonical check: vitest-pool-workers (real workerd + local D1 + real DOs)
pnpm typecheck         # TS 7 strict
```

- `cf dev/build/deploy` do **not** run here — they run from `apps/web` (the vite root where the plugin finds `cloudflare.config.ts`)
- Tests use `wrangler.vitest.jsonc` (not `cloudflare.config.ts`); its compatibility date is 2026-08-06 (the vitest plugin's workerd ceiling)

## Architecture map (v3 — see docs/architecture.md §13)

| File                       | Role                                                                                         |
| -------------------------- | -------------------------------------------------------------------------------------------- |
| `src/routes/*.ts`          | Chained Hono routes = the `hc<RpcApp>` type source; zod validation; `fail()` + `messages.ts` |
| `src/do/pi-agent.ts`       | One dialogue thread = one DO instance (`activity:{id}:{userId}`); pi 1.5 `watch()` streaming |
| `src/do/events.ts`         | ActivityEvents: snapshot + ring buffer + Last-Event-ID replay                                |
| `src/do/coordinator.ts`    | Per-provider gates (concurrency/RPM), circuit breaker, per-IP rate limits                    |
| `src/do/report-job.ts`     | Report generation: alarm retries, pseudonyms, hexagon/arguments/stances                      |
| `src/providers/catalog.ts` | Declarative provider descriptors (quota model, priority, cost) — the D6 chain                |
| `src/providers/models.ts`  | pi-ai Models registry: builtin catalog + DGX handmade + `createAI` binding models            |
| `src/providers/clef.ts`    | Clef binding-backed classifier (`ProviderClassifier`, pi-native)                             |
| `src/providers/oneshot.ts` | Judgment gateway (D9): `streamSimple` + `response_format: json_object` + schema              |
| `src/auth.ts`              | HMAC signed cookie (hot path, zero DB reads) + PBKDF2 passwords                              |

## Vocabulary

| Term   | Means                                                            |
| ------ | ---------------------------------------------------------------- |
| thread | One student's dialogue in one activity (`activity:{id}:{uid}`)   |
| round  | One student message in a Socratic dialogue (`role = "user"` row) |
| turn   | A dialogue turn as judged by the violation classifier            |

No round limit exists (removed in v3) — activities are bounded by class time and teacher `finish`.

## Patterns

### D1 access

```ts
// Good — helpers, $named params, awaited
const user = await one<UserRow>(db, "SELECT * FROM users WHERE id = $id", { id });
await batch(db, [{ sql: "INSERT ...", params: {...} }]);
```

- `prepare()` converts `$named` → positional automatically; **keep `$named` in SQL**.
- Every `one/all/run/batch` call **must be awaited**.
- Atomicity = `batch(db, [...])` only.

### Error contract

```ts
fail(404, "join_code_invalid"); // code must exist in packages/shared ERROR_CODES; message from src/messages.ts
fail(409, "already_streaming"); // routes: contract codes; DO internals throw Error(message) mapped by routes
```

- Never `c.json({ message })` inline from routes — always `fail()`; codes live in `packages/shared` (single source), localized text in `src/messages.ts` (zh/en/es).

### Dialogue SSE (v3 contract: delta/done/error)

```
event: delta  { text }       // many; sum of deltas === done.message.text
event: done   { message }    // D1-saved DialogueMessage; always last
event: error  { message, code } // replaces done; code from ErrorCode, message localized at client
: ping                       // ~15s heartbeat
```

- No `emotion`/`meta` events (retired, #90). Legacy tags (`[happy]` etc.) are stripped at the DO boundary until the LLM team ships the rewritten prompt (#75).
- Stream errors before first byte → HTTP error; after → `event: error`.

### Judgment (D9)

- Chain: Clef binding classifier → Jev (typesafe-system-one, needs `TYPESAFE_API_KEY`) → oneshot LLM → mock. First non-null wins.
- Question schemas live in `packages/shared` (e.g. `ViolationChoiceSchema`); the model is a catalog/config choice (#55), never hardcoded logic.

### Adding a provider

1. ZDR rules in `docs/providers.md` — whitelist only (0-day retention).
2. Add a descriptor to `src/providers/catalog.ts` (quota model, priority, cost, headers).
3. Chat models: builtin via `getBuiltinModel` when the id exists in pi-ai's catalog; custom endpoints (self-hosted) get a handmade `Model` with `compat`. Binding models register through `createAI({ binding })`.
4. Classifier models: binding-backed (`clef.ts`) or builtin `getBuiltinClassifierModel` (Jev).
5. `LLM_PROVIDER=mock` tests must still pass — mock never touches the chain.

## Boundaries

- **Never** change the SSE event shapes (`delta/done/error`) — `docs/api-contract.md` v3 is the contract; the frontend consumes exactly these.
- **Never** swallow a failed message batch — saved to pi transcript but missing from D1 is a data inconsistency.
- **Always** attach `session.watch()` **before** `session.submit()` — inverted order misses runs that finish instantly (this bug already happened).
- **Ask first**: changing `PiHarness` settings (retry / afterFailedRun), adding Durable Objects, bumping `@earendil-works/pi-*` / `agents` (version-pair lock: 0.33 ↔ 1.5, see docs/pi.md), adding bindings to `cloudflare.config.ts`.

## Testing conventions

- Tests are sequential where fixtures share state (`isolatedStorage: false` is intentional).
- `tests/worker.test.ts` exercises the real Worker entry (`default export`) — the golden path.
- LLM assertions only check shape (a `done` event, deltas ≥ 1, sum === done.text) — never content.
- Route handlers under test need `app.request(url, init, env)` — the third `env` argument is what puts `c.env` bindings in place.

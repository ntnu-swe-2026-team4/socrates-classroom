# AGENTS.md — apps/server

We use pi. pi **really** handles everything: transcript, admission, runs, retries, crash recovery, streaming, tasks, docs. If you are about to write any of that, you are wrong — it already exists in pi-durable. Verify against its source (`node_modules/@earendil-works/pi-durable/dist/harness/types.d.ts`), never from memory.

Everything is an extension. All behavior — prompts, tools, hooks, tasks — lives in pi extensions installed on the registry. DOs only host; transport only moves. If logic isn't in an extension, it's in the wrong place.

Non-negotiables: no queue feature (`whenBusy: "reject"` — a busy thread refuses, never queues); ZDR whitelist for providers (`docs/providers.md`); version-pair lock `agents` 0.33 ↔ pi 1.5 (`docs/pi.md`); tests are real DO + real WebSocket + faux model (`tests/chat.test.ts` is the pattern); no hardcoded model ids — everything routes through `providers.config.yaml`; files over ~200 lines mean you are re-implementing pi.

## Module map

| Module                                                        | Responsibility                                                                                                                                  |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                                    | Worker entry: `/api/*` → Hono, `/agents/*` → WebSocket, exports DO classes + `RpcApp`                                                           |
| `app.ts`                                                      | Hono assembly, middleware, error localization, `RpcApp` type export                                                                             |
| `routes/`                                                     | REST endpoints: zod validation + authorization + thin orchestration; errors only via `fail()`; dialogue has no POST (WS is the only write path) |
| `do/chat.ts`                                                  | Chat DO (thread-level): hosts PiHarness + per-object registry + models with fallback legs                                                       |
| `do/report-runner.ts`                                         | ReportRunner DO (activity-level): alarm-driven report generation, parallel per-student + class report → D1                                      |
| `pi/models.ts`                                                | pi-ai Models registry assembly; fallback legs bound to head model object; zero model ids                                                        |
| `pi/agents/profiles.ts`                                       | Agent profiles (role fields only, never model) + `runProfile` driver; models/registry/env injected by caller                                    |
| `pi/extensions/`                                              | All behavior: `socrates` (prompt), `avatar` (emotion entry), `judgment` (violation task + self-report tool), `websearch` (3 tools)              |
| `routing/`                                                    | Provider policy: YAML schema + build-time config, ledger (cooldown + accounting), chain walk, oneshot                                           |
| `ws/`                                                         | Transport glue: typed protocol + watch/submit/entries over the harness's public API                                                             |
| `prompts/`                                                    | LLM team's prompt assets (`?raw` build-time injection)                                                                                          |
| `auth.ts` + `auth-crypto.ts`                                  | HMAC session cookie, PBKDF2 passwords, AES-GCM key encryption                                                                                   |
| `db/d1.ts`                                                    | The only D1 access: `one/all/run/batch`; atomicity = `batch` only                                                                               |
| `http.ts` / `messages.ts` / `services/members.ts` / `seed.ts` | Request helpers (`fail`/`parseBody`/guards), localized error text, membership queries, demo seed                                                |

Two boundaries worth restating: routing decides _which_ legs / _whose money_ / _whose ledger_ — pi natively owns leg trial-and-error and retry backoff, never re-implement either side. And extensions read their models from `routing/config.gen.ts` (`classifiers.*`) — never hardcode.

## Testing

Real DO + real WebSocket + faux model — no fetch interception, no mocked DOs. Assertions check shape only, never content. See `tests/chat.test.ts` for the pattern; details in `docs/pi.md` §測試.

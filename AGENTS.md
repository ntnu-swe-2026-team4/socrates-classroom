# AGENTS.md — Socrates Classroom (詰問 · 蘇格拉底對話教室)

A classroom debate platform: Socratic one-on-one dialogue, four-stage classroom debates, multi-student discussions, and a stance star-map — running on **Cloudflare Workers** (Hono API + React SPA as static assets) with D1, R2, and a Pi Durable dialogue engine.

## Language

- The project's docs and UI copy are in **Traditional Chinese (zh-TW)**. Match that when writing docs.
- **Commit messages: English Conventional Commits** (`type(scope): imperative summary` — e.g. `feat(server): add classroom list endpoint`). Use zh-TW in the subject or body only when the content is inherently zh-TW (product-level rationale, user-facing wording); never mix languages within one line.
- **All technical terms in docs stay English** (failover, affinity, circuit breaker, ledger, tiering, traffic class, …). zh-TW is for product-level content (features, rationale, spec decisions); never coin Chinese translations for technical terms. Full policy: `docs/AGENTS.md` § Language.
- **No comments in code or config files.** Code must be self-describing; knowledge that doesn't fit the code belongs in `docs/` or the AGENTS.md files. When a comment is unavoidable (config/YAML), it must be **English only**.
- UI copy is i18n'd (`apps/web/src/i18n/index.ts`, typed dictionary): zh-TW / en / es. New user-facing strings need all three.
- This file (and other AGENTS.md files) are in English for agent legibility; everything else is zh-TW.

## Setup commands

```bash
pnpm install                        # pnpm ≥ 12, Node ≥ 26.12 (the cf CLI does not support Bun)
prek install                        # git pre-commit hooks (biome / yamllint / whitespace); needs prek
pnpm dev                        # full-stack dev (vite + workerd + local D1/R2) → http://localhost:5173
pnpm test                           # vitest-pool-workers (real Worker runtime, mock LLM)
pnpm lint && pnpm typecheck         # must be green before any PR
```

`pnpm dev` is the **single dev server**: React SPA (HMR) + Worker API + Durable Objects all on :5173 — no separate backend process or /api proxy.

## Structure & data flow

- `apps/web` — **the deployable full-stack project**: React SPA + `cloudflare.config.ts` + Vite config; `cf dev/build/deploy` run from here (dev secrets in `apps/web/.dev.vars`)
- `apps/server` — Worker source (Hono REST + Chat/ReportRunner Durable Objects + pi-durable extensions + routing) and the vitest setup (`wrangler.vitest.jsonc`); bundled by the build in `apps/web` via `entrypoint: ../server/src/index.ts`
- `packages/shared` — API contract types (single source of truth; changing a type means syncing server and web)
- `apps/server/src/prompts/` — prompt assets (`socrates.md` injected at build time as the system prompt; edit → redeploy takes effect); provider config lives in `apps/server/providers.config.yaml` (build-time compiled)
- `.agents/skills/` — third-party Agent Skills (sources pinned in `skills-lock.json`; update with `npx skills update`, add with `npx skills add … -p`). Project-specific knowledge belongs in `docs/` and the AGENTS.md files — not new skills
- Data: D1 (`apps/server/migrations/`), uploads in R2

## Engineering priorities

- Prioritize code correctness and clarity. Speed and efficiency are secondary priorities unless otherwise specified.
- Do not write organizational or summary comments. Comments only explain **why** the code is written in some way, and only when the reason is tricky / non-obvious.
- Prefer implementing functionality in existing files unless it is a new logical component. Avoid creating many small files.

## Code style

- Biome owns formatting and linting: `pnpm lint` must pass before PRs; `pnpm format` auto-fixes
- YAML (workflows / `pnpm-workspace.yaml`) is linted by **yamllint** (config: `.yamllint.yaml`)
- TypeScript strict; all D1 access goes through `src/db/d1.ts` (`one/all/run/batch`) — `$named` params are auto-converted to positional binds

## Testing

- `pnpm test` = vitest-pool-workers (real runtime + local D1/R2/DO; LLM mocked)
- The WebSocket dialogue protocol (`ws/protocol.ts`: view + chord ops) asserted in `tests/chat.test.ts` must never break; REST shapes follow `docs/api-contract.md`
- Single test: `pnpm --filter @socrates/server exec vitest run -t "<name>"`

## Boundaries

- **Never** route student traffic to models outside the whitelist (ZDR rules — see `apps/server/AGENTS.md`)
- **Never** enable logging/caching on AI Gateway (it would retain student dialogue content, breaking ZDR)
- **Never** put any API key under `apps/web` (bundled into the browser)
- **Ask first** before: changing API shapes covered by `docs/api-contract.md`, adding Cloudflare bindings, touching `PiHarness` settings
- Deploys run through CI (`deploy.yml`) only — do not deploy manually

## Deploy & CLI

- Use the **cf CLI** (`cloudflare.config.ts` lives in `apps/web`); do not create wrangler config files
- cf commands need **Node ≥ 26.12** and **do not support Bun**; run them inside `apps/web` (the full-stack Vite project where `.cloudflare/` output lives)
- `wrangler` exists only as cf's build backend and for `wrangler tail`

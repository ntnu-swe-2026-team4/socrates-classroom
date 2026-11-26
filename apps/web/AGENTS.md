# AGENTS.md — apps/web (React SPA + the deployable full-stack project)

React 19 + TanStack Router/Query + Tailwind v4 SPA, **plus** the Worker deployment: `cloudflare.config.ts` (Worker name/bindings/exports + `assets.notFoundHandling: "single-page-application"`) and the Vite config (`@cloudflare/vite-plugin`) live here. Worker source stays in `apps/server` and is bundled via `entrypoint: ../server/src/index.ts`.

## Commands

```bash
pnpm dev      # single full-stack dev server (SPA HMR + workerd + local D1/R2/DO) → :5173
pnpm build    # tsc + vite build (emits .cloudflare/output with client assets + worker bundle)
pnpm exec cf deploy --prebuilt   # deploy the recorded build (or plain `pnpm deploy`)
pnpm typecheck
```

- `cf dev` / `cf build` / `cf deploy` / `cf d1 …` all run **from this directory** — the plugin resolves `cloudflare.config.ts` from the vite root, and `.cloudflare/` output lives here
- Dev vars/secrets: `.env.local` (this directory, gitignored — see `.env.example`); `cloudflare.config.ts` reads it via `loadEnv` in dev mode only — production builds keep config defaults. `CF_REMOTE_AI` is read from the shell environment

## Deltas & boundaries

- **No `useEffect`** anywhere in `src/` (Biome-enforced: `style/noRestrictedImports` + ratchet test `use-effect.test.ts`); effect-free helpers live in `src/hooks/useSubscription.ts`; animation rAF shares the module-scope loop in `src/lib/frameLoop.ts` (`createFrameLoop`) — except `useVoiceInput`'s meter, which runs its own rAF per recording session
- Query keys always come from a factory: reference the `queryOptions` products of `api/queries.ts` or `api/me.ts` and their `.queryKey` — enforced by `biome-plugin-tanstack-query` (recommended-strict preset, GritQL port of `@tanstack/eslint-plugin-query`) plus the ratchet test `query-keys.test.ts`
- The API layer is only `src/api/` (`httpApi` — the real backend; the v3 mock mode is retired, server-side `LLM_PROVIDER=mock` covers offline dev)
- The dialogue transport is **WebSocket** (`/agents/chat/:name`): message types in `apps/server/src/ws/protocol.ts`, mechanics in `docs/pi.md`; client applies chord ops with `applyImmutable` — never hand-roll a delta applier; REST shapes come from `hc<RpcApi>` (R6; server declarations via `pnpm --filter @socrates/server run build:types` → `dist/types`, consumed through the `@server/*` tsconfig path — direct server-source imports are lint-banned) — any contract change lands in `docs/api-contract.md` + `packages/shared`
- Styling is Tailwind v4 utilities; theme colors are CSS variables (`@theme` in `src/index.css`) — never hardcode color values
- The landing story (`src/routes/index.tsx`) plays pre-rendered WebP sprite sheets from `public/story/` on `<canvas>` — no live 3D, no lottie. The assets are produced outside the repo (Blender renders packed with Pillow); bump `ASSET_VERSION` in that file whenever they are replaced.
- **Never** put any key into a `VITE_*` variable (bundled into the browser)
- **Ask first**: major upgrades of React/TanStack, changes to the route structure (`src/routes/`, file-based), changing `cloudflare.config.ts` bindings

## Quality gates (run before merging — each has caught real bugs in this branch)

1. **Critical user paths**: student `/ → /join/:code (name+ToS) → /dialogue?activityId=…`; teacher `/login → /classrooms (New class dialog) → /classrooms/:id → /t/live/:id → /report/:id`; guards redirect on direct URL hits. Mock identity dies on reload — navigate in-app
2. **RWD**: 2560/1280/768/390 × every route, zero horizontal overflow; visual check at 2560 and 390 (page titles vs the global ☰)
3. **i18n**: `tsc` enforces en/es completeness; every string incl. aria-labels via `t()`; no hardcoded strings; `<html lang>` synced
4. **A11y + dark mode**: keyboard pass, focus, `aria-busy`/`aria-live`, `prefers-reduced-motion`, dark contrast — audit with the `a11y` skill
5. **Interaction edges**: abort→resend, double-submit, interrupt, join `draft` race, long content / CJK wrapping
6. **Load perf**: route payloads, lazy loading, asset weight — audit with the `web-perf` skill (heavy assets: landing story sprite sheets in `public/story/`, dialogue GLB)
7. **Cross-browser**: Firefox is the dev default; re-verify voice paths and three.js on Chrome/Safari
8. **Console**: zero errors/warnings on every page (lint-enforced: `suspicious/noConsole` on `apps/web/src`)
9. **Markdown safety**: react-markdown only — never add `rehype-raw` (lint-enforced: `noRestrictedImports`)

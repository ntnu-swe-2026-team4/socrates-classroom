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
- Dev secrets/vars: `.dev.vars` (this directory, gitignored — see `.env.example`); plain `vars` can be overridden at config evaluation via environment variables (`LLM_PROVIDER`, `DGX_BASE_URL`)
- `VITE_API_MODE=mock` is for offline demo; production deploys must not rely on it (see reviewer note on `src/api/index.ts` default)

## Deltas & boundaries

- The API layer is only `src/api/`: `VITE_API_MODE=mock` (built-in demo data, works offline) | `http` (real backend). Both modes must behave identically
- SSE dialogue parsing lives in `src/api/http.ts` (`delta/emotion/done/error`) — any server contract change lands here too
- Styling is Tailwind v4 utilities; theme colors are CSS variables (`@theme` in `src/index.css`) — never hardcode color values
- `src/landing/` is a prototype-port zone: the Biome linter is off for this directory, keep it tidy yourself
- **Never** put any key into a `VITE_*` variable (bundled into the browser)
- **Ask first**: major upgrades of React/TanStack, changes to the route structure (`src/router.tsx`), changing `cloudflare.config.ts` bindings

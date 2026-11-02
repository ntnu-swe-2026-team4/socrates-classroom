# AGENTS.md — apps/web (React SPA)

Vite + React 19 + TanStack Router/Query + Tailwind v4. The build output is served as the Worker's Static Assets.

## Commands

```bash
pnpm dev      # Vite dev (/api proxies to localhost:8787 — start the backend first)
pnpm build    # tsc + vite build
pnpm typecheck
```

## Deltas & boundaries

- The API layer is only `src/api/`: `VITE_API_MODE=mock` (built-in demo data, works offline) | `http` (real backend). Both modes must behave identically
- SSE dialogue parsing lives in `src/api/http.ts` (`delta/emotion/done/error`) — any server contract change lands here too
- Styling is Tailwind v4 utilities; theme colors are CSS variables (`@theme` in `src/index.css`) — never hardcode color values
- `src/landing/` is a prototype-port zone: the Biome linter is off for this directory, keep it tidy yourself
- **Never** put any key into a `VITE_*` variable (bundled into the browser)
- **Ask first**: major upgrades of React/TanStack, changes to the route structure (`src/router.tsx`)

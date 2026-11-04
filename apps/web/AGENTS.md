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
- `VITE_API_MODE=mock` is for offline demo; production deploys must not rely on it (see reviewer note on `src/api/index.ts` default)

## Deltas & boundaries

- The API layer is only `src/api/`: `VITE_API_MODE=mock` (built-in demo data, works offline) | `http` (real backend). Both modes must behave identically
- SSE dialogue parsing lives in `src/api/http.ts` (`delta/done/error` — emotion protocol retired, #90) — any server contract change lands here too
- Styling is Tailwind v4 utilities; theme colors are CSS variables (`@theme` in `src/index.css`) — never hardcode color values
- `src/landing/` is a prototype-port zone: the Biome linter is off for this directory, keep it tidy yourself
- **Never** put any key into a `VITE_*` variable (bundled into the browser)
- **Ask first**: major upgrades of React/TanStack, changes to the route structure (`src/routes/`, file-based), changing `cloudflare.config.ts` bindings

## Quality gates (run before merging — each has caught real bugs in this branch)

1. **Golden flow** (playwright-cli against `pnpm dev`): student `/ → /join/:code (name+ToS) → /dialogue?activityId=…` (activityId must propagate — never hardcode); teacher `/login → /t/setup → /t/live/:id → Finish → /report/:id`; guards fire on direct URL: `/dialogue` without activityId → `/join/:code`, `/t/*` + `/settings` anonymous → redirect. Mock identity dies on full reload — navigate in-app or re-login
2. **RWD sweep**: viewports 2560 / 1280 / 768 / 390 × every route; objective check `document.documentElement.scrollWidth <= window.innerWidth`; visually verify 2560 (content-column centering, chip/drawer anchoring) and 390 (global ☰ sits at fixed `left-3 top-3` — page titles need `pl-12 md:pl-0`)
3. **i18n**: en/es are typed `Record<MessageKey, string>` — `tsc` fails on any missing key (keep it that way); every user-visible string incl. aria-labels goes through `t()`; re-grep for hardcoded strings and dead keys when adding new ones; `<html lang>` must sync at init and on switch
4. **A11y + dark mode**: keyboard-only pass per page (drawer/panel/popover focus, Esc), `aria-busy`/`aria-live` on streaming, `prefers-reduced-motion` (story tour + avatar), contrast on every page in dark mode
5. **Interaction edges**: streaming abort → resend; double-submit; interrupt then immediately ask; join `draft` auto-send race; long content (long replies/titles, CJK wrapping)
6. **Load perf**: landing lottie set (~15MB JSON) and dialogue GLB (~8.2MB) dominate payload — check route-level lazy loading and network totals before/after changes (#53 lesson)
7. **Cross-browser**: Firefox is the dev default; re-verify voice paths (Web Speech branch vs server STT) and three.js on Chrome/Safari
8. **Console sweep**: zero errors/warnings on every page (strict-mode double-render, key warnings)
9. **Markdown safety**: LLM and term-explanation markdown render via react-markdown — never add `rehype-raw`

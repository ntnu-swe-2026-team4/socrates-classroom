# AGENTS.md — apps/web（React SPA）

Vite + React 19 + TanStack Router/Query + Tailwind v4。打包後掛在 Worker 的 Static Assets。

## 指令

```bash
pnpm dev      # Vite dev（/api 代理到 localhost:8787，需後端先啟動）
pnpm build    # tsc + vite build
pnpm typecheck
```

## 差異與界線

- API 層只有 `src/api/`：`VITE_API_MODE=mock`（內建示範資料，離線可跑）| `http`（真後端）。兩種模式的行為必須一致
- 對話串流解析在 `src/api/http.ts`（SSE：`delta/emotion/done/error`）——伺服器契約改了這裡一定跟著改
- 樣式用 Tailwind v4 utilities；主題色是 CSS 變數（`src/index.css` 的 `@theme`），不要寫死色碼
- `src/landing/` 是原型移植區：Biome linter 對此目錄關閉，改動時自己保持整潔
- **Never** 把任何 key 寫進 `VITE_*` 變數（會被打包進瀏覽器）
- **Ask first**：升級 React/TanStack 大版本、改路由結構（`src/router.tsx`）

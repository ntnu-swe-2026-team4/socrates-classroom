# Roadmap（願景與規劃）

> 這裡只放**規劃中、未實作**的功能與待決設計。實作完成後把條目移至 `changelog.md`，並在 `feature.md` 加上功能列。
> 現況請看 [`feature.md`](./feature.md)——這裡的任何條目都還不存在於程式碼中。

## Provider 路由（BYOK + 內建 pool + cache 親和性）

追蹤 issue：[#49](https://github.com/ntnu-swe-2026-team4/socrates-classroom/issues/49)（含四個待決問題）

```
使用者（設定頁）
  ├─ 有填 key  → BYOK：自己的 provider（pi 支援任一家），天然 sticky
  └─ 沒填 key  → 內建 pool：pre-configured providers 承接 traffic
                  （whitelist + gates：DGX 4 併發 / Workers AI 50 RPM）
```

- **Provider 設定頁**：列出 pi 支援的 providers（`byok.ts` 的 `BYOK_CATALOG`，22 家）＋ API key 輸入；三語、`fail()` 錯誤契約、標註各家 retention 政策
- **金鑰儲存**：D1 migration（user 綁定 provider + 加密欄位）、AES-GCM（key 來自 `BYOK_ENC_KEY`）、永不回傳明文（回傳 last4）
- **Fallback 語意**：沒填 key → 內建 pool；BYOK 失敗時 fallback 或明確報錯（待決）
- **Cache 親和性**：內建 pool 的 per-user sticky routing（記住上次健康的 provider，failover 才換）；跨 DO 重啟需 D1 持久化。PiHarness 每輪重送完整 transcript，sticky 直接影響 prompt cache 命中率與對話一致性
- **待決**：BYOK 層級（學生個人 vs 班級教師代設）、是否允許 whitelist 外 provider、設定頁是否教師核准制

## 上線前（post-merge）

- `cf deploy` + secrets 設定（`OPENCODE_API_KEY` / `OPENROUTER_API_KEY` / `BYOK_ENC_KEY`）+ D1 migrations（見 [`cf.md`](./cf.md)）
- seed + 線上 smoke test（對話 SSE、上傳、四階段活動）
- Workers AI / OpenRouter 額度監控與警示

# 前端 review regression test 套件

> 日期：2026-11-05 ｜ 基準：`fb64b15` ｜ 對應：[review-output.md](../review-output.md)

這是可加入專案的 **test-only overlay**，不是 application patch。內含 6 個 test files、12 個 tests，重整了 review 中的 10 個失敗 probes，另加 2 個 positive controls。沒有新增 dependencies、修改 package scripts、變更 API 或 application code。

**目前預期結果：10 FAIL、2 PASS。** FAIL 是尚未修復的 regression，不要改成 `test.fails`、skip，或反轉 assertion 讓 CI 變綠。修正 production behavior 後，目標才是 12 PASS。

## 放置與執行

根目錄同時提供可讀目錄 `frontend-review-tests/` 與可分享的 `frontend-review-tests.zip`；兩者內容相同。從 ZIP 使用時，先解壓至 repository 根目錄。

使用專案要求的 Node ≥26.12、pnpm ≥12，先安裝 repository 原有 dependencies。確認目標沒有同名自訂檔案後，從 repository 根目錄執行：

```bash
cp -R frontend-review-tests/apps/web/. apps/web/

pnpm --filter @socrates/web exec vitest run --config vitest.review.config.ts
pnpm --filter @socrates/web test
pnpm --filter @socrates/web typecheck
pnpm lint
```

- 第一個 test command 只跑這 12 個 regression/control tests。
- 第二個 command 跑既有 tests 加上新 tests；基準 commit 預期 **34 tests：10 FAIL、24 PASS**。
- root `pnpm test` 目前只跑 server，不能取代 web test command。
- overlay 只新增 `apps/web/vitest.review.config.ts` 與 `apps/web/src/test/review/`，不覆寫現有 `vitest.config.ts` 或原有 tests。獨立 config 沿用原 config 的 environment／alias，只換 include。
- 沒有寫死 `/tmp`、使用者 home path，也不需要 review worktree 或開啟 dev server。

只跑某個問題：

```bash
pnpm --filter @socrates/web exec vitest run --config vitest.review.config.ts -t 'F01'
pnpm --filter @socrates/web exec vitest run --config vitest.review.config.ts -t 'S01'
```

## 已包含的 tests

所有 paths 以下以 `apps/web/src/test/review/` 為基準。

| Test file               | Finding | 驗證行為                                                                                    | 基準結果 |
| ----------------------- | ------- | ------------------------------------------------------------------------------------------- | -------- |
| `routes.test.tsx`       | F01     | 用真實 generated route tree 開 `/join/abcdef`，看到主題、姓名、未勾選 ToS 與 disabled start | FAIL     |
| `routes.test.tsx`       | F03     | 用真實 dialogue route 載入 user/assistant 歷史，學生訊息保留 user bubble                    | FAIL     |
| `logout.test.tsx`       | S01     | 實際 AppShell logout 完成後，shared QueryClient 不留前一帳號的 private report               | FAIL     |
| `dialogue.test.tsx`     | F06     | 已成功持久化的回合遇到 playback failure，再 retry 不得再次 POST dialogue 或刪除回覆         | FAIL     |
| `dialogue.test.tsx`     | F22     | 同一 tick 連續 send，只能接受一次 request／user message                                     | FAIL     |
| `dialogue.test.tsx`     | Control | 正常回合保留兩位 speaker，最後回到 idle、沒有 error                                         | PASS     |
| `voice.test.tsx`        | F04     | 短錄音只有 stop 後的 final chunk，也必須上傳一次、送出一次 transcript                       | FAIL     |
| `voice.test.tsx`        | F04     | 已有 EARLY chunk，stop 後 FINAL chunk 仍須包含於 Blob                                       | FAIL     |
| `voice.test.tsx`        | F05     | unmount 後才允許 mic，晚到 stream 必須立即 stop                                             | FAIL     |
| `voice.test.tsx`        | Control | 已建立的 mic session 在 unmount 時 stop，且不自動送 STT                                     | PASS     |
| `tts.test.ts`           | F07     | decode pending 時 abort，不得在 decode resolve 後開始播放                                   | FAIL     |
| `term-history.test.tsx` | F17     | 真實 TermPanel＋HTTP client 查詞成功後，localStorage history 增加該詞                       | FAIL     |

## 測試邊界與維護注意

- **不是 browser E2E**：jsdom 無真實麥克風、音訊解碼、WebGL、layout 或 browser autoplay policy。MediaRecorder／AudioContext 使用有限的 test doubles，只驗證非同步順序與 resource ownership。若修正改用 EventTarget listener 或其他 browser API，應把 double 擴充為等效行為，不能把缺少 fake method 的 exception 誤當 regression。
- `routes.test.tsx` 保留真實 Router、routes、API client 與 hooks，只隔離 AppShell／重型動畫，network 在 fetch boundary 提供 fixtures。F03 不再於 test 裡自行重寫會丟失 role 的 mapping，避免修好 production route 後 test 仍固定做錯。
- F03 目前藉 `.justify-end` 區分 speaker，因 production bubbles 沒有可直接查詢的 speaker semantics。日後加入 accessible speaker labels 時，改用 role／accessible name assertions；不要因合法 CSS redesign 誤判為資料錯誤。
- route fixture 的 `/topics` 暫回合法資料，以隔離 F03；它**沒有**驗證 teacher-only 授權。F02 另有下方待補測項，不能把這個 fixture 當成正確 backend policy。
- S01 test 明確要求 **logout 清除 private report cache**。它呼叫真實 logout callback，但 navigation 被隔離；它不是完整 teacher→student login E2E，也未覆蓋晚到 response 或全部 query keys。若改採不同 session-scoped architecture，需用真實下一個身份的頁面驗證隔離，不能只換一個任意 query key 使 test 通過。
- F17 保留實際 TermPanel 與 HTTP client，僅 mock fetch，因此允許把持久化責任放在 API layer 或 panel，不把修正綁死於特定 owner。
- F06 目前透過既有 `retryLast()` 測試。如果改成獨立 playback retry UI／hook API，將 test 改為呼叫新播放操作；保留「dialogue 只有一次、回覆未被移除」的 assertions。
- test fixtures 使用虛構身份與文字；沒有 credentials、真實學生資料、node_modules 或 generated assets。

## 仍應增加的測項

下表是 **test plan，不是已實作的 tests**。這個套件涵蓋已重現的核心問題，並不聲稱覆蓋整份 review。

| 優先級 | Findings | 應增加的場景與 assertions                                                                                                                                         | 適合的層級                                   |
| ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| P0     | F01      | 有效 code → name＋ToS → POST join → activityId dialogue；未同意不可送；invalid code 顯示明確錯誤；輸入 code 與 direct URL 都測                                    | 真實 Router integration＋browser E2E         |
| P0     | S01      | teacher→student、student A→B、logout 後 direct report URL、identity transition 時晚到的 report/history response；DOM 與 cache 都不可暴露前一身份資料              | Query／Router integration＋browser E2E       |
| P1     | F02      | `/topics` 回 403，但 activityInfo 可取；應仍顯示正確主題。無 session／錯誤 membership 導向正確入口；finishedAt 已設定時不可送出                                   | Route integration                            |
| P1     | F03      | history 尚未完成就開始互動、完成一輪後離開再快速返回、切 activityId；不得覆蓋新訊息或重用錯活動 transcript                                                        | Hook＋Query integration                      |
| P1     | F04–F05  | Web Speech stop 後才有 final result；pointercancel、blur、60 秒 timer、兩個 pending starts、STT pending 時離頁；停止、取消、dispose 都只送一次或完全不送          | Hook lifecycle＋真實 Firefox／Chrome／Safari |
| P1     | F06–F07  | dialogue HTTP error 與 playback error 分流；TTS fetch/body/decode/playing 各階段 abort；decode rejection 釋放 context；首次播放的 user gesture／suspended context | HTTP／hook＋browser E2E                      |
| P1     | F08      | AI draft 編輯後先 POST topic，拿 persisted id 再 create classroom；保留 prompts；create 失敗有 inline error，可 retry 而不重複建立                                | Teacher page integration                     |
| P1     | F09      | 空 PUBLIC_BASE_URL 回 `/join/code`，copy 與 QR 收到完整 origin URL；已有 absolute URL 不重複加 origin                                                             | Teacher page integration＋QR decode          |
| P1     | F10      | UI provider 集合與 shared schema 合法值一致；每個可選 provider 可送出；clear 失敗保持 key status 並顯示 error                                                     | Settings integration＋contract               |
| P1     | F11      | student login 不走 teacher guard loop；teacher login 到 setup；invite register 保留 code，guest path 不強迫註冊；busy state 可恢復                                | Auth／Router integration                     |
| P1     | F12      | finish 回 500／斷線時留在 live page、有錯誤、可 retry；成功才進 report                                                                                            | Live page integration                        |
| P1     | F13      | fake timers 推進超過兩分鐘的 pending，再回 200 必須呈現 report，或明確 timeout＋retry；report_failed 的 teacher retry                                             | Query lifecycle＋fake timers                 |
| P1     | F14      | 特意讓 server cluster 與 kmeans 結果不一致，legend 仍對應實際使用的 assignments；無時間序列不可顯示虛構 trajectory                                                | Chart data integration                       |
| P1     | F15      | shared DTO／request types 的 compile-time 使用；不靠重複 interface 放寬 provider 等 input；runtime invalid payload 若有 schema guard 應被拒絕                     | Typecheck＋contract tests                    |
| P1     | F16      | Tab、Enter／Space 可錄音與停止；composer 有 accessible name；新回覆有適量 live announcement；focus 不消失                                                         | RTL user-event＋axe＋browser keyboard        |
| P2     | F17      | 查詞去重、30 筆上限、錯誤不落史、重載恢復；term history 的身份 scope                                                                                              | Local storage／component integration         |
| P2     | F18      | 重複切軸／trajectory 後 removed geometry/material 被 dispose；unmount 取消 frame；reduced-motion 無強制長 animation                                               | Scene lifecycle＋browser profiling           |
| P2     | F19–F20  | CI 實際執行 web tests；文件依當前 source 同步，不以 grep 文件字串充當功能測試                                                                                     | CI configuration review                      |
| P2     | F21      | mobile drawer close、Escape、outside click、focus restore；390px 到 2560px layout、TermPanel 展開後不溢出                                                         | Browser E2E／visual inspection               |
| P2     | F22      | interrupt→resend 的舊 finally 不得把新 request phase 改回 idle                                                                                                    | Deferred promise hook tests                  |

## 納入修正 PR 的方式

1. 將相應 test 與該 finding 的修正放同一 PR，保留一個可重現的 RED → GREEN 證據。
2. 如果先採整包 test-only commit，必須明示「預期 RED」，不能把它稱為通過驗收。
3. 修正後執行全部 web tests、typecheck、lint；CI 增加獨立 web test step。保留既有 server tests。
4. 在 production 支援的 Node 版本與真實 browsers 補上述 acceptance；不得以 mock audio tests 代替 Firefox／Safari 實測。

## 本次驗證環境

套件在獨立 review worktree 套入後執行，source 仍為 `fb64b15`；未對 application code 作修正。環境 Node `22.23.4`、Vitest `5.1.0`，因此結果只代表這個環境的 tests，**不是** Node ≥26.12 production build 的驗收。獨立 config 與完整 suite 的實際結果另記於根目錄 `review-output.md` 的測試包附錄。

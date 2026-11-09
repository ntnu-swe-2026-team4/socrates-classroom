# PR #116 完整審查

<verdict>REQUEST_CHANGES</verdict>

<confidence>
HIGH：下列 7 項 findings 均有具體 source evidence；其中 6 項以獨立 runtime／hook／store probe 重現，第 F3 項以 store probe 加上完整 tool 呼叫路徑確認。這不是 production、實際 provider 或瀏覽器視覺驗收。
</confidence>

<summary>

PR：[refactor: rebuild backend on pi-durable and realign frontend (web-next)](https://github.com/ntnu-swe-2026-team4/socrates-classroom/pull/116)

- Branch：`experiment/web-next` → `main`。
- 審查 HEAD：`bd14a304ff82074025588b289f6e3b3b894a0359`。
- Merge base：`5f6192608de880d8ee2fa06ed23beba622b7d3bb`。
- Diff：257 files，18,628 insertions、27,214 deletions。
- 專用 detached、locked worktree：`/tmp/socrates-pr116-deep-review`。
- 全程 solo，未使用 subagents、未修改實作、未 commit、未 deploy；唯一交付變更為原 repository root 的本檔。

架構方向合理：Chat DO 將 conversation ownership 交給 pi，extension boundaries、typed contracts、teacher keys 與 report projection 比舊版清楚。然而，production Workers AI provider ID 對不上，導致平台 fallback chain 被全部過濾；前端也仍將 tool-round assistant entry 誤認為完整回答。另有 redirect authorization bypass、不可讀取的 fetched content，以及 D1 conflict handling 未對齊實際 runtime error。建議修正 F1–F4 與 S1 後再合併；F5–F6 為非 blocking 的可靠性問題。

本次重新執行的 gates：

| Command | 結果 |
| --- | --- |
| `pnpm lint` | PASS，152 files checked，未套用 fixes |
| `pnpm typecheck` | PASS，server 與 web |
| `pnpm test` | PASS，server 83 tests／11 files；web 43 tests／11 files |

測試通過不能抵銷 findings：目前 faux-model tests 不會驗證 production provider registry；前端測試缺少完整 tool round；D1 測試未涵蓋這個 runtime error envelope。未執行 production build、真 provider 請求、瀏覽器 golden flow 或負載測試。

</summary>

<goal_breakdown>

| 目標與來源 | 審查結果 |
| --- | --- |
| PR body、#110：pi 擁有 transcript、run lifecycle、streaming、retry；busy 時 reject、不 queue | 大致符合。Chat／WS 將操作委派給 pi，busy path 有測試。前端 completion 判定仍自行猜測 assistant entry 的語意，F2 顯示這與 pi tool rounds 不相容。 |
| PR body、`docs/pi.md`：行為集中到 extensions | socrates、avatar、judgment、websearch 已分離。websearch 仍有 F3、F6、S1。 |
| PR body、`docs/providers.md`：config-driven routing、平台 fallback、ledger | config／ledger 結構已建立，但 F1 使兩條 Workers AI legs 在真 registry 下不可用。 |
| #82、PR body：teacher BYOK、AES-GCM、教師鏈在前 | 已有 credentials／keys routes／UI／crypto tests；未以真第三方 provider credentials 驗收。教師 key 可用不代表平台 fallback 可用。 |
| #74、PR #109 討論：ReportRunner、pseudonyms、個人與全班報告 | 有 alarm、attempt cap、partial path、schema tools、locale 與 positions；學生 endpoint 不回 `classReport`。未將未證實的 crash-recovery 疑慮當成 blocker。 |
| #67、PR body：前後端契約同步與新 routes | shared schemas、`hc<RpcApi>`、三語 dictionary 已接線；F4 是 conflict response 的 runtime 偏移。 |
| PR body、最新 commit：WebSocket／chord 與 pi transcript paging | 已使用 `ConversationTranscript`；F2 與 F5 顯示完成判定及 loader error lifecycle 還不完整。 |
| PR body：v3 retirement | 舊 SSE／四階段／社群／題庫等刪除屬刻意 scope，不當成 regression 要求恢復。 |

</goal_breakdown>

<constraint_compliance>

- **Review isolation：符合。** 使用上述 locked worktree；dependencies 與 type declarations 僅在 review worktree 產生。沒有修改 source、migration、API shape、bindings 或 PiHarness settings。
- **pi ownership：部分符合。** Server 的 admission／generation 委派給 pi；F2 不符合 pi 的「assistant entry 不一定等於 final answer」語意。修正不應新增第二套 run engine。
- **No queue：符合所查路徑。** WS submit 強制 reject；不建議以 queue 掩蓋 routing capacity 或 F2。
- **SDK compatibility：已對照 lockfile 與安裝內容。** 審查以專案的 agents 0.33 系列／pi-durable 1.5.0 為準，而非憑其他版本 API 推測。
- **Platform ZDR：配置方向符合。** 沒有建議加入未審查 provider 或啟用 AI Gateway logging／caching。F1 應修正 registry mapping，而非移除 `canServe` 或任意 fallback。
- **Privacy：所查 report projection 符合 pseudonym／學生不可讀 class report 的邊界。** 這不等於已證明任意使用者輸入都不含個資。
- **Single source of truth：大致符合。** D1 access 經 wrapper、transcript 來自 pi、model IDs 集中 config；F1 暴露的是 config ID 與 SDK ID 尚未統一。
- **Tests：符合 real DO＋real WebSocket＋faux model 的主要模式，但缺少 production registry、tool-round completion、redirect callback adapter 與真 D1 error 的 assertions。**
- **Deploy：未執行。** 已查看 workflows／secrets 接線；未重複提出先前已修復的 `--secrets-file` finding。

</constraint_compliance>

<findings>

## F1 — CRITICAL：Workers AI 的 provider ID 不一致，平台 fallback chain 不可用

**位置：** `apps/server/src/pi/models.ts:29–44`；`apps/server/src/gateway/router.ts:62–64`；`apps/server/providers.config.yaml:68–77`。

**行為：** YAML 使用 `workers-ai`，但安裝的 `agents/models/pi-ai` 的 `createAI()` 註冊 provider ID 為 `cloudflare`。`buildModels()` 直接以 `ai.provider.id` 註冊；Router 的 `canServe` 卻以 YAML ID 呼叫 `models.getModel()`。因此兩條 Workers AI legs 都被過濾。

**重現：** 真 `buildModels()`＋真 `Router`，僅 stub AI binding，沒有 DGX URL／teacher key：

```text
registered matching providers: cloudflare-ai-gateway, cloudflare-workers-ai, cloudflare
chain without canServe: workers-ai, workers-ai
chain with real models: []
pick: null
```

**影響：** 沒有 DGX／teacher key 的正常平台設定無法對話或執行 routed profiles；有 DGX 時也失去配置承諾的 Workers AI fallback。`Chat.routeSubmit()` 在沒有 decision 時會拋出 `NoAvailableModelError`，不是自動改用 `models.default`。有可用教師 key 的路徑不一定受影響。

**修正：** 在 config、registry 與 Router 之間統一 provider identity，或建立明確 mapping；同步 model.provider／lookup 與 ledger identity。不可只移除 `canServe`，否則後續仍解析不到 model。加入非 mock 的 registry integration test，覆蓋 AI-only 以及 DGX 不可用後的平台 fallback。

## F2 — MAJOR：tool round 被當成最終回答，提早解除 pending 並朗讀中途文字

**位置：** `apps/web/src/hooks/useDialogue.ts:65–71,149–160,190–196`。

**行為：** `answered()` 把任意非 aborted、帶文字的 `pi.assistant` entry 當成完成；但 pi 會先保存 `stopReason: "toolUse"` 的 assistant entry，再執行 tools、繼續 generation。安裝版 `pi-durable/dist/harness/generation.js:598–601` 明確區分 `startToolRound()` 與 final answer。

**重現：** 以真 `useDialogue` hook，stub socket／TTS；送出 user message 後注入含文字 `Let me search.` 與 `web_search` tool call 的 assistant entry：

```text
intermediate tool-call pending: false
spoken: [ 'Let me search.' ]
```

**影響：** 搜尋尚未完成就播放中途文字、解除輸入鎖定；學生可送下一句而遭 server busy rejection。真正回答到達時，原 pending 已清除，不再觸發該輪正常 TTS。`error` assistant entry 含文字時也有同類誤判風險。

**修正：** 依 pi 可觀察的 terminal run／operation state 決定完成；至少排除仍有待執行 tool calls 的 `toolUse`、retry/error 中間狀態。不要把 submit admission receipt 當 final completion。補上 user → assistant tool call → tool result → final assistant，以及 tool round 中 reconnect 的 regression tests。

## F3 — MAJOR：`fetch_content` 回傳的 responseId 無法用 `get_search_content` 讀取

**位置：** `apps/server/src/pi/extensions/websearch/index.ts:86–97,148–154`；`apps/server/src/pi/extensions/websearch/store.ts:58–70`。

**行為：** `fetch_content` 將全文存進 `fetches`，超過 8,000 chars 時回傳 fetch ID 並叫模型使用 `get_search_content`。後者只查 `responses.getStored()`，也就是 `searches`，完全沒有呼叫 `getStoredFetch()`。

**證據：** `storeFetched()` 後，對同一 ID 執行 `getStored(id)` 得到 `null`，`getStoredFetch(id)` 則成功。tool 的缺資料分支必然回覆 `No stored results`。

**影響：** 長文章 8,000 chars 之後的內容無法透過工具取得，分頁／findText 的承諾失效，模型可能僅用不完整內容回答。

**修正：** retrieval tool 同時解析 search 與 fetch records，統一 serialization、paging、findText 與錯誤說明。加入真 extension 的 `web_search → fetch_content → get_search_content` 測試，確認能讀取 preview 以外的 marker。

## F4 — MAJOR：UNIQUE parser 不認得 D1 error envelope，競態回傳 500

**位置：** `apps/server/src/http.ts:58–66`；`apps/server/src/routes/join.ts:76–81,100–104`。

**行為：** 新 parser 只接受以 `UNIQUE constraint failed:` 開始的裸 SQLite message；D1 的外層 message 有 `D1_ERROR:` prefix，內層 `cause.message` 又帶 `SQLITE_CONSTRAINT` suffix。

**重現：** 使用真 Miniflare D1，建立 composite UNIQUE 並插入重複資料：

```text
error.message:
D1_ERROR: UNIQUE constraint failed: members.classroom_id, members.name: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)
cause.message:
UNIQUE constraint failed: members.classroom_id, members.name: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)
current regex match: null
```

**影響：** 兩位使用者通過 precheck 後競爭相同姓名時，預期的 `409 name_taken` 變成 500；同一會員的 raced rejoin 也不能走允許的 recovery path。這不是所有 duplicate requests 都會發生：非競態的 precheck 仍可正確攔截。batch atomicity 本身沒有因此失效。

**修正：** 正規化 D1 wrapper／cause，再精確抽取 table.column 清單，排除 trailing SQLite metadata；或改用不依賴 message 字串的 conflict handling。以真 D1 error 驗證 name、email 與 membership composite conflicts，不能只用手工裸 Error。

## F5 — MINOR：history loader 的 error／disconnect 不會結束 Promise，後續載入被卡住

**位置：** `apps/web/src/hooks/useDialogue.ts:93–100,240–254,269–271`。

**行為：** `entriesWaiters` 只保存 resolve callback，只有 `result` 才會移除並 resolve。對應 entries request 的 `error` 因 ID 不等於 submit ID 被直接忽略；disconnect／unmount 也沒有 settle outstanding loaders。

**重現：** 真 hook 呼叫 `loadEarlier()`，對該 entries ID 回傳 error frame；Promise 持續 pending，再按一次不會送出第二個 entries request。

**影響：** 一次 history request 失敗就讓該 hook instance 的「載入更早訊息」無法重試，通常需重載頁面。

**修正：** waiter 保存 resolve／reject；優先處理匹配 entries ID 的 error，並在 disconnect／unmount／合理 timeout 時 reject、清除 waiter，使 `ConversationTranscript` 能退出 loading 狀態。加入 error 後成功重試的測試。

## F6 — MINOR：search paging 的 next offset 跳過被 hint 擠掉的內容

**位置：** `apps/server/src/pi/extensions/websearch/store.ts:139–147`。

**行為：** `endOffset` 先按原 limit 算好，後續為了讓 hint 塞進 20,000 chars 上限而截短正文，卻沒有同步 next offset。

**重現：** 30,000 個 `x`，offset 0、limit 20,000、ID `example`：正文僅 19,864 chars，但回傳與 hint 的 next offset 都是 20,000。照提示翻頁會漏掉 136 chars。

**影響：** 長 search results 分頁不是連續讀取，可能漏掉來源或關鍵句；即使 F3 修好，fetch paging 也不應沿用這個缺陷。

**修正：** next offset 必須由實際交付的正文長度決定；預留 hint 空間或反覆計算直到長度穩定。測試串接所有頁面的正文必須完整還原原文。

</findings>

<security_findings>

## S1 — MAJOR：redirect callback 收到起始 URL，繞過每一 hop 的 search-hit authorization

**位置：** `apps/server/src/pi/extensions/websearch/fetch.ts:121–128,149–150`；`apps/server/src/pi/extensions/websearch/index.ts:142`。

**行為：** `fetchFollowingRedirects()` 呼叫 `permitHop(startUrl, url)`，但 `fetchPage()` 將單參數 `(target) => isSearchHit(target)` 原樣傳入。JavaScript 允許多傳參數，所以 callback 永遠檢查第一個參數，也就是已獲准的起始 URL，而非 redirect destination。TypeScript 也不會拒絕這個 adapter。

**重現：** 起始 URL 為 `https://zh.wikipedia.org/wiki/Justice`；mock response 302 到 `https://attacker.example/redirected`；guard 只允許起始 URL。結果兩個 URL 都被 fetch，guard 只看見起始 URL，redirected body 成功回傳且標示原始 URL。

**攻擊條件與影響：** 若 search hit 可被控制、遭入侵或提供 open redirect，即可讓 Worker 存取未出現在本對話搜尋結果的任意獲 URL validator 允許的 public destination；並把來源外內容掛在原始 URL 下。這直接違反先 search、再 fetch 的安全邊界，也削弱對惡意頁面內容的限制。

**範圍校準：** 每次 redirect 仍會呼叫 `validateUrl()`；本次沒有證明 private-IP literal protections 被此 bug 繞過，也沒有證明 production internal network 可達。這是已確認的 destination authorization bypass，不把它誇大成已證實的內網資料外洩。

**修正：** 明確 adapter：`(_from, target) => permitTarget(target)`，在發出每次請求之前驗證真正 target；或統一 callback signature 為 destination-only。加一個 guard spy，assert cross-origin 未獲准 target 根本沒有被 fetch；再測 multi-hop 與允許的 target。

### 已查而未重複列為漏洞

- teacher keys 有 AES-GCM、fresh IV、版本格式與 tamper tests；未發現本次新增的明文 key browser exposure。
- Chat 授權涵蓋 connection／reattach，學生 report projection 不含 class report。
- web content fencing 是 defense-in-depth，不能補救 S1，也不能保證完全阻擋 prompt injection。
- 已知 per-isolate rate limit、DNS-related residual risk 不在本次新增為「已重現漏洞」。沒有以偽造 IP-literal probe 重提已修復的 normalization finding。

</security_findings>

<discovered_context>

## Phase 0 — Scope 與完整變更背景

取得 PR metadata、完整 diff、changed-file inventory、分支／merge-base、repository instructions；閱讀主要受影響實作與 callers、contracts、tests、config、workflows 及刪除的舊路徑。大型 static／binary assets 不等於已做視覺或互動驗收。

收集 artifacts：

- `/tmp/pr116-full.diff`
- `/tmp/pr116-changed-files`
- `/tmp/pr116-file-history.txt`
- `/tmp/pr116-context.json`
- `/tmp/pr116-review-comments.json`

## Phase 1 — Git／GitHub archaeology

查閱 PR #116 body、comments／reviews、相關 issue（含 #56、#67、#74、#110）、file history／blame，以及 PR #109／#114／#108 的整合背景。

重要發現：

1. 這不是單純 UI PR，而是 backend ownership 與 API migration；大量刪除是刻意退役 v3。
2. 先前 review 已多輪修復 busy ledger leak、WS authz／hibernation、report locale／partial／positions、secrets deployment 等；本次只列 HEAD 仍有證據的問題。
3. 先前留言明確主張 redirect gate 已在 fetch 前生效；S1 顯示目前 callback adapter 仍檢查錯參數，不能以先前「已修」結論取代 HEAD 驗證。
4. `18426b70`／`f834f418` 的 constraint-handling 修復仍未涵蓋 D1 error envelope，故 F4 是未完成的實際 runtime 修復。
5. 最新 `bd14a304` 將 history paging 交給 `ConversationTranscript`，方向正確，但 transport loader 仍必須處理 failure，不能把 F5 視為 pi 自動承擔。
6. PR #109 作者已同意 report profile 的 high thinking；沒有 on/off 品質反證，因此不把 high thinking 當缺陷。
7. D1 schema reset 有「尚未部署」的明確決策背景；沒有在缺乏既有 production migration 證據時，要求恢復舊 schema 的 forward migration。

## Phase 2 — Goals 與 constraints

對照 `AGENTS.md`、`docs/pi.md`、`docs/providers.md`、`docs/api-contract.md`、architecture／frontend／development／deployment 文件；結果列於 goal breakdown 與 constraint compliance。

一項未當作新 regression 的接線疑問：`Chat` 安裝的是 static `socratesExtension()`，extension 本身只提供通用 prompt；在所查路徑沒有看到活動題目被傳入該 preamble。應另以產品 acceptance test 確認「學生未自行重述題目時，模型是否知道教師所選議題」。未證明這是本 PR 新引入，故不放進 blocking findings。

## Phase 3 — Quality／correctness 驗證

重新執行 lint、typecheck、全部 126 tests，並以 repository 外的 probes 驗證 registry、redirect、真 D1 error、hook completion、paging failure 與 content storage／pagination。沒有將 probe 加入實作或測試檔。

- Hook probe：`/tmp/pr116-hook-probe.mjs`。
- D1 probe：`/tmp/pr116-d1-probe.cjs`。
- Gate logs：`/tmp/pr116-tests.log`、`/tmp/pr116-lint.log`、`/tmp/pr116-typecheck.log`。

ReportRunner 的 crash-safe 宣稱另查過 [Cloudflare alarm 文件](https://developers.cloudflare.com/durable-objects/api/alarms/)：alarm handler 有 at-least-once execution 與 failure retry。僅因使用 in-memory work／watchdog，不能直接斷言「crash 後永遠沒有 alarm」；本次沒有足夠證據建立這個 finding。

## Phase 4 — Security

檢查 session／role／membership、WS ingress／reattach、teacher key storage、provider credential boundary、report privacy、URL validation／redirect、untrusted-content fencing、logging／deployment。已確認問題為 S1；未對真外部服務或 production 做攻擊測試。

</discovered_context>

<missed_requirements>

1. **可工作的 production platform fallback：** F1。faux-model happy path 無法驗收這項需求。
2. **一輪完整回答的 UI／TTS 語意：** F2。需要涵蓋 tools，不只是 text-only generation。
3. **`fetch_content` 宣告的全文 retrieval：** F3；連續 paging 另有 F6。
4. **race-safe、契約一致的 conflict response：** F4。transaction 成功或 rollback 不代表 response classification 正確。
5. **每個 redirect hop 都受相同 destination authorization 約束：** S1。
6. **history request failure 後可恢復：** F5。
7. **尚未驗收而非宣告失敗：** 真 provider 品質／availability、report 的實際模型輸出、browser golden flow／accessibility、負載行為與活動題目接線。不得用本次 126 tests 推導這些已完成。

</missed_requirements>

<blocking_issues>

合併前應修正並加 regression coverage：

1. **F1／CRITICAL：** 統一 Workers AI provider identity，證明 AI-only production registry 能選到 model。
2. **F2／MAJOR：** tool round 不得提早完成 pending 或觸發 final-answer TTS。
3. **F3／MAJOR：** fetch ID 必須能讀回 preview 以外的完整內容。
4. **F4／MAJOR：** 以真 D1 constraint error 驗證預期 conflict／rejoin handling。
5. **S1／MAJOR：** 未獲准 redirect destination 必須在 fetch 前被阻擋。

F5、F6 建議同批修復，但不單獨作為本次拒絕合併的理由。修正後重跑現有 gates 及上述 regression cases；本次審查未修改任何實作。

</blocking_issues>

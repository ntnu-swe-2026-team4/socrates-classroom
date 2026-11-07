<verdict>FAIL</verdict>
<confidence>HIGH</confidence>
<summary>
目前不建議合併：學生邀請入口在實際 route tree 中無法顯示入場表單，登出後的 Query cache 會跨帳號暴露報告，語音與 HTTP 接線也有可重現的 regression。既有 22 個前端測試、web typecheck 與 Biome 通過，但另外 10 個針對正確行為的 review probes 全部失敗；問題主要在跨 component／API 的流程，而不是格式或基本型別。
</summary>

## Phase 0 — Review context

- **GOAL**：審查目前完成的前端 refactor，確認能支援 v3 的學生入場、語音／文字對話、老師開課與報告流程，並可安全接上實際 backend。由本人完成，未使用 subagent，未修改 application code。
- **BACKGROUND**：這不是只改 UI 的單一 commit。`afc79e4` 開始重建，`b4bdbc1` 加入頁面，後續數輪修正，`7c3c28d` 切換 HTTP client，`94fdebb` 後已是 HTTP-only。四階段活動、社群、上傳、舊題庫與音效的移除是 v3 決策，不列 regression。
- **BASE／HEAD**：`5f6192608de880d8ee2fa06ed23beba622b7d3bb`（與 `origin/main` 的 merge-base）→ `fb64b15`（`experiment/web-next`）。工作目錄原先乾淨。`git diff HEAD~1` 只有文件，不能代表這次 refactor，因此擴大到 branch-point diff。
- **WORKTREE**：在 `/tmp/socrates-frontend-review-fb64b15` 建立 detached review worktree 並 lock；未 checkout 或改寫原工作分支。
- **CHANGED_FILES／DIFF**：`git diff --name-status 5f61926 HEAD -- apps/web` 共 **116 個 paths：32 A、16 M、68 D**。完整前端 diff 為 24,254 行，儲存在 `/tmp/socrates-review-full-frontend.diff`；path 清單在 `/tmp/socrates-review-changed-files.txt`。
- **FILE_CONTENTS**：閱讀目前 `apps/web/src` 的 routes、API、hooks、components、i18n、theme、landing、3D scene、generated route tree、所有前端 tests，以及 web manifests/config；交叉檢查 shared schemas、server 對應 routes、report generation、CI、README、frontend/API/roadmap 文件。舊功能的移除依 v3 scope 判定；未對已刪除的舊版功能另作安全認證。
- **RUN_COMMAND**：root `pnpm dev` → `pnpm --filter @socrates/web dev` → Vite，預設 `http://localhost:5173`；Vite plugin 同時載入 Worker，`configureServer` 執行 migrations。本次**未啟動 app、未 seed、未 deploy**。
- **範圍澄清**：未提供獨立 PR 或原始 implementation prompt，且文件對 mock／HTTP／RPC 有矛盾。本報告以目前 source、`docs/api-contract.md`、相關 issues 與 commit history 判定；不把已明確延後的 admin、單人 scope、跨裝置 termHistory 當成缺陷。已出現在 UI 的 P1 功能仍需正確運作。

<goal_breakdown>

- [MISS] 邀請連結／QR／邀請碼 → 名字＋ToS → 對話。
  Evidence: `src/routes/join.tsx:6–14,25–51` 不 render child outlet；generated tree 把 `/join/$code` 放在它下面。實際 RouterProvider probe 只顯示邀請碼輸入框。見 F01。
- [PARTIAL] 正確呈現活動主題並可續聊。
  Evidence: `src/routes/dialogue.tsx:51–63` 使用 teacher-only topics API，且把歷史壓成純文字；F02、F03。
- [PARTIAL] 語音為主、文字為備援，支援停止、打斷、重試。
  Evidence: 基本 SSE phase tests 通過；錄音 final chunk、permission race、TTS retry／abort probes 失敗；F04–F07。
- [PARTIAL] 老師選既有／自訂／AI 主題並分享教室。
  Evidence: 既有與自訂路徑存在；AI draft id 未持久化，relative URL 直接進 QR／clipboard；F08、F09。
- [PARTIAL] 帳號選用，老師與回訪學生都能登入。
  Evidence: `/login` 一律導向 teacher-only setup；邀請頁沒有註冊 UI／client method；F11。
- [PARTIAL] 即時面板與活動結束後的報告。
  Evidence: 有 2.5 秒輪詢、flag 顯示與報告頁；finish 失敗仍導頁，report pending 在約兩分鐘後停止請求卻繼續顯示等待；F12、F13。
- [PARTIAL] 群體與個人報告忠實呈現，學生只能看自己。
  Evidence: report 分流使用 response shape；client cache 未依使用者隔離（S01）；星圖重算 cluster 卻保留 server labels，並虛構起始 trajectory（F14）。
- [PARTIAL] 查詢內嵌、歷史可找回。
  Evidence: Markdown、選詞與 retry 存在；HTTP lookup 沒有寫入 `recordTerm`，持久化 probe 失敗；F17。
- [PARTIAL] 老師 BYOK 設定。
  Evidence: save／clear API 已接；四個 UI provider 中三個一定被 backend 拒絕，合法的 `opencode-go` 不可選；F10。
- [ACHIEVED] 三語 typed dictionary、in-place locale switching 基礎。
  Evidence: `src/i18n/index.ts:459–520`、三個 i18n tests、web typecheck。這不代表所有 server-generated 內容或 browser accessibility 均已驗收。
- [ACHIEVED] 保留故事資產、3D 頭像，移除舊音效與舊活動介面。
  Evidence: `src/landing/*`、`SocratesStage.tsx`、GLB MeshoptDecoder 接線與 branch diff；沒有要求重建已裁撤功能。
- [PARTIAL] Quality gates 可防止 regression。
  Evidence: 現有 22 tests 通過但沒覆蓋真實 route tree 與錄音生命週期；root／CI test command 沒執行 web tests；F20。

</goal_breakdown>

<constraint_compliance>

- [ACHIEVED] React／TanStack Router＋Query／Tailwind SPA，單一 Cloudflare Worker 部署架構 — `main.tsx`、`vite.config.ts`、`cloudflare.config.ts`。本次未改 bindings、PiHarness 或 deployment。
- [ACHIEVED] 網路存取集中在 API layer、同源 cookie 與語言 header — `src/api/http.ts` 的 `/api`、`credentials: "include"`、`Accept-Language`。GLB 預載不是 API bypass。
- [ACHIEVED] v3 `delta/done/error` 與未知 SSE event 容忍 — `http.ts:71–103`；現有 delta／error／unknown-event tests 通過。未將已退役 emotion 協議當成必須恢復的功能。
- [MISS] `packages/shared` 作為 contract single source of truth — `src/api/types.ts` 重複 DTO 與寬鬆的 provider input，已出現實際 drift；F10、F15。
- [MISS] 學生只取得自己的資料、帳號切換清除舊身份資料 — shared QueryClient／unscoped keys／logout 僅改 `me`；S01。
- [MISS] Guest golden flow、刷新與錯誤後仍可恢復 — F01–F07、F11–F13。
- [MISS] 鍵盤可操作、正確 focus／live announcements、reduced motion — voice button 只有 pointer handlers，composer 無 label，stream 無 live region；F16。3D animation 亦未讀 reduced-motion preference。
- [ACHIEVED] en／es 與 zh-TW dictionary key 集合一致、`html.lang` 同步 — i18n tests 與 `setLocale`。狀態錯誤目前多被換成通用文案，詳見 findings。
- [MISS] 使用既有 theme tokens — 新增 `Scene3D.tsx:90–131,262–285` 有獨立 hardcoded palette，且部分 scene frame/grid 顏色沒有採用已宣告的 light palette。不是本次最高優先級，但不符合 web AGENTS 規則。
- [ACHIEVED] Markdown 不允許 raw HTML — `Markdown.tsx` 使用 react-markdown＋remark-gfm，沒有 rehype-raw／dangerouslySetInnerHTML。
- [ACHIEVED] 未發現前端新增 production API secret／`VITE_*` secret、AI Gateway logging/cache 或 student model whitelist bypass — frontend 沒有 provider 直連；不把 demo login 帳密當成 production secret。Backend 安全性不在本次全面認證範圍。
- [ACHIEVED] 本次檢查未改 source/config，也未加入敘事型 code comments；既有 generated／prototype 的 `@ts-nocheck` 未當成新 regression。
- [ACHIEVED] web typecheck、既有 tests 與 Biome — 本次實際執行成功，詳細命令見驗證節。完整 Node 26 production build／browser gates 尚未驗證，不能宣稱通過。

</constraint_compliance>

<findings>

### 阻擋合併

- **[CRITICAL] F01 — Routing：邀請 URL 永遠 render 邀請碼父頁，入場表單不可達。**
  File: `apps/web/src/routes/join.tsx:6–14,25–51`；`apps/web/src/routeTree.gen.ts:47–50`。
  Current: `/join/$code` 的 parent 是 `JoinRoute`，但 `JoinEntry` 沒有 `<Outlet>`。直接開 `/join/abcdef` 或送出邀請碼都只得到父頁，`JoinPage` 沒有 mount，因此不會取得 topic，也無法同意 ToS／加入。
  Suggestion: 將 `/join` 做成有 outlet 的 layout，把邀請碼表單放 index route，或使用 router 支援的 non-nested route 結構；重新產生 route tree，不手改 generated file。補真實 RouterProvider 的 direct-link 與輸入 code tests。已重現，這應第一個修。

- **[MAJOR] F02 — API integration：學生對話頁讀取 teacher-only 主題目錄，而不是活動資料。**
  File: `apps/web/src/routes/dialogue.tsx:33–63`。
  Current: fresh student session 的 `GET /topics` 被 `requireTeacher` 拒絕，結果主題／命題／開場 prompts 消失；若 cache 有其他 topic，fallback `[0]` 又可能顯示錯主題。已有 `api.activityInfo()` 卻沒有 caller，`finishedAt` 也沒有使用，已結束活動仍顯示可送出介面及通用 retry。
  Suggestion: 以 activityId 取得 `ActivityInfo` 作為 topic 與 finished state 的來源；所有 direct URL 都檢查身份並呈現 membership／載入錯誤，對 `activity_finished` 改成唯讀與報告入口。不要擴張 `/topics` 授權來掩蓋前端錯誤。

- **[MAJOR] F03 — Data correctness：刷新後把學生歷史全部標為 assistant。**
  File: `apps/web/src/routes/dialogue.tsx:61–63`；`apps/web/src/hooks/useDialogue.ts:8–18`。
  Current: route 丟掉 `id/role/at`，hook 再把每個字串製成 `role: "assistant"`；probe 輸入 user＋assistant，輸出 assistant＋assistant。另 `send()` 只更新 component state、不更新 history cache，離開後在 staleTime 內回來會先回到舊 transcript。
  Suggestion: hook 接收完整 `DialogueMessage[]`，保留角色與 id；成功送出後同步該使用者／活動的 query cache，初始化不得覆蓋正在進行的回合。補 reload、快速離開再返回、history 延遲到達的 tests。

- **[MAJOR] F04 — Voice：放開錄音時沒有等待 final result，會丟掉短錄音或最後一段。**
  File: `apps/web/src/hooks/useVoiceInput.ts:56–70,209–237`。
  Current: 呼叫 `recorder.stop()` 後立即用目前 chunks 建 Blob；final `dataavailable` 是非同步，短錄音時甚至完全不呼叫 STT。probes 分別得到 0 次 STT、5 bytes 而非完整 10 bytes。Web Speech 路徑也在 `stop()` 前截取 `liveText`，隨即清空 session，使稍後 final result 被忽略。
  Suggestion: 分開「完成錄音」與「取消／dispose」；MediaRecorder 等 final `dataavailable`＋`stop` 後組 Blob，Web Speech 等 final result／end，再清理與送出一次。60 秒自動停止要允許 timer scheduling 誤差，而非超過 60,000ms 就丟掉整段。

- **[MAJOR] F05 — Resource lifecycle／privacy：permission pending 時離頁，晚到的 stream 仍會啟動錄音。**
  File: `apps/web/src/hooks/useVoiceInput.ts:56–58,78–105`。
  Current: unmount 只呼叫 `stopEverything`；尚未取得 stream 時 session 為 null，直接 return，沒有 invalidation。`getUserMedia` 稍後 resolve，`stopRequestedRef` 仍是 false，會建立 recorder／recognition／rAF／timer。probe 驗證 unmount 後 track.stop 呼叫數是 0。
  Suggestion: cleanup 同步標記 disposed 或遞增 session generation；每個 await 後驗證 generation，晚到的 stream 立即 stop。start pending 也要加 synchronous guard，避免兩個尚未 resolve 的 permission requests 覆蓋 session。

- **[MAJOR] F06 — Retry：TTS 失敗會重新送出已成功寫入的對話。**
  File: `apps/web/src/hooks/useDialogue.ts:31–32,47–57,65–70`。
  Current: `sendDialogue` 已完成且 append assistant 後，TTS 仍在同一 try/catch。decode／TTS HTTP 失敗顯示對話 retry；`retryLast` 刪掉最後一筆 assistant，再重送原 user text，造成重複回合與成本。probe 確認 dialogue POST 次數從 1 變 2。
  Suggestion: 分離 dialogue error 與 playback error；done 之後保留回覆，播放失敗只能重播該回覆或退回文字，不能再 POST dialogue。retry 以明確 message id 處理，不用盲目的 `slice(0,-1)`。

- **[MAJOR] F07 — Cancellation：decode 期間 abort 之後仍會開始播放。**
  File: `apps/web/src/api/http.ts:115–136,150–151`。
  Current: `decodeAudioData` await 完才註冊 abort listener，沒有檢查 `signal.aborted`。若此時打斷或離頁，listener 錯過事件，晚到 audio 仍 `source.start()`；probe 已重現。
  Suggestion: 在 decode 前建立 cancellation ownership，每次 await 後檢查 signal；任何出口都關閉 context、清理 listener/rAF 並 settle promise。另須在真實 browser 驗證 user-gesture audio unlock：目前 context 在網路往返後才建立，也沒有 suspended/resume 處理，不能假設首次 TTS 一定可播放。

- **[MAJOR] F08 — Teacher flow：AI 生成主題直接拿暫時 id 建教室，必定找不到主題。**
  File: `apps/web/src/routes/t.setup.tsx:29–36,111–153`。
  Current: 只有 custom 分支呼叫 `createTopic`；AI 選項將 `gen_*` 直接當 topicId。`apps/server/src/routes/topics.ts:53–86` 只回 draft、不寫 topics；`classrooms.ts:31–35` 查 DB 後回 404。UI 同時沒有 `create.isError` 提示，也沒有 #77 要求的生成結果編輯。
  Suggestion: 將 AI 候選帶入可編輯 draft，確認後 POST `/topics`，再以已持久化 id 建教室；保留 prompts；將 create error 顯示在原表單並允許安全 retry。

- **[MAJOR] F09 — Sharing：預設設定下 QR／clipboard 只有 relative path。**
  File: `apps/web/src/routes/t.setup.tsx:48–52,192–193,220–225`。
  Current: 原樣使用 `created.url`。`cloudflare.config.ts` 的 `PUBLIC_BASE_URL` 預設空字串，server 因而回 `/join/<code>`；QR scanner／群組訊息沒有目前網站 origin，不能當成可直接開啟的邀請 URL。
  Suggestion: 先用 `new URL(created.url, window.location.origin).href` 得到 absolute URL，讓畫面、copy 與 QR 使用同一值；或明確保證並測試 server 一定回 absolute URL。補空 PUBLIC_BASE_URL 的分享測試。

- **[MAJOR] F10 — Contract：BYOK provider 選單與 whitelist 不一致。**
  File: `apps/web/src/routes/settings.tsx:17,24–27,83–87`。
  Current: 選項為 openrouter/openai/anthropic/google，但 shared `ByokSetInputSchema` 與 server `isAllowedProvider` 只允許 openrouter/opencode-go；三個選項保證 422，另一個合法 provider 沒入口。
  Suggestion: 從 shared provider schema／常數取得選項與 input type，不要放寬 backend whitelist。另把 clear mutation error 移到有 key／無 key 都會 render 的區塊，目前刪除失敗的提示被藏在另一分支。

- **[MAJOR] F11 — Auth journey：回訪學生登入被送回登入頁，選用註冊尚未接線。**
  File: `apps/web/src/routes/login.tsx:21–33`；`apps/web/src/routes/t.setup.tsx:9–13`；`apps/web/src/routes/join.$code.tsx:77–90`。
  Current: login 成功一律 navigate `/t/setup`，student 又被 guard redirect `/login`，並未完成回訪流程。邀請頁只有名字／ToS，`Api` 也沒有 register method，無法使用已定案的邀請註冊 endpoint。
  Suggestion: 根據 role 與 invite return context 導向 setup 或 join／有效活動，並處理 navigation 後 busy state；在同一邀請流程加選用帳號註冊，維持 guest 為預設，不增加必經門檻。若註冊確定延期，需明確改寫完成範圍，而不是宣稱 #67 flow 已完成。

- **[MAJOR] F12 — Error handling：結束活動失敗仍導向報告。**
  File: `apps/web/src/routes/t.live.$id.tsx:27–30`。
  Current: 空 catch 吞掉 finish 的 network／401／5xx，再 navigate report；老師以為活動已關閉，學生實際可能繼續對話，且報告根本未啟動。
  Suggestion: 僅在 finish 成功時導頁；失敗留在 live panel，顯示本地化錯誤與 retry。不要把 failure 偽裝成成功 navigation。

- **[MAJOR] F13 — Report lifecycle：pending 重試耗盡後永久顯示生成中，但不再查詢。**
  File: `apps/web/src/routes/report.$id.tsx:24–44`。
  Current: 最多 30 次、每次 4 秒，之後進 error branch 顯示 spinner；沒有 refetch interval／retry button。`main.tsx` 又關閉 focus/reconnect refetch。合法的長時間報告即使稍後完成，留在此頁的使用者也看不到。
  Suggestion: 用可取消、帶 backoff 的 pending polling；若設 timeout，明確顯示 timeout 與可操作的 retry。`report_failed` 另提供老師重新觸發 finish 的入口，而非同一個無法恢復的通用錯誤。

- **[MAJOR] F14 — Report integrity：點的顏色與群組語意不對應，trajectory 不是歷史。**
  File: `apps/web/src/routes/report.$id.tsx:118–128,203–218`。
  Current: 不使用 response 的 `point.cluster`，而是每次依可見座標重跑 kmeans；legend 卻使用 backend 的 cluster id／label，兩者沒有映射，因此可能把學生標成相反立場。`history: [zeroVector, point.values]` 又把所有學生畫成從中立出發，API 實際只提供最終點。
  Suggestion: 要呈現報告分群，就保留 server assignment 並對投影後座標重算 centroid；若另做 exploratory clustering，使用清楚區分且一致的新 labels。沒有時間序列時移除／停用 trajectory，不能用補零資料冒充歷史；要新增歷史 contract 需先取得同意。

- **[MAJOR] F15 — Type safety／SSOT：新 HTTP layer 仍靠重複 DTO 與 cast，無法檢查 contract drift。**
  File: `apps/web/src/api/types.ts:1–163`；`apps/web/src/api/http.ts:25–46`。
  Current: 除 ErrorCode 外幾乎全部重新宣告；例如 shared `ClassroomCreated` 有 classroomId，web 版本沒有；BYOK input 接受任意 string，F10 因而通過 tsc。`call<T>` 只是將 JSON cast 成 T，不提供跨層驗證。
  Suggestion: web DTO／request types 從 shared import／re-export，保留必要的 browser Api facade；選擇性在 trust boundary 使用既有 schemas。不要為此新增另一套 RPC framework；先讓已存在的 shared contract 真正被消費。

- **[MAJOR] F16 — Accessibility：主要語音操作沒有鍵盤路徑。**
  File: `apps/web/src/routes/dialogue.tsx:235–258`。
  Current: button 只有 pointer down/up/leave handlers，Enter／Space 的 click 不會錄音；composer 只有 placeholder、沒有 label，streaming 區只有 `aria-busy`、沒有回覆 announcement。這違反明訂 keyboard／screen-reader quality gate，不是外觀偏好。
  Suggestion: 加等效且不重複觸發的 keyboard／assistive click 操作，處理 pointer cancel／blur；為 composer 加三語 accessible name 與 focus indicator；以完成句或完成回覆的 live region 宣告更新，不逐 token 轟炸 screen reader。

### 非最高優先級，但值得修正

- **[MINOR] F17 — Persistence：查詢紀錄沒有 writer。**
  File: `apps/web/src/components/TermPanel.tsx:53–61`；`apps/web/src/api/http.ts:192`。
  Current: 成功查詢只重新讀 localStorage，`recordTerm()` 全 repo 無 caller；sidebar/history 永遠不增加新詞。HTTP lookup probe 得到空歷史。
  Suggestion: 成功查詢後呼叫唯一的 recordTerm owner，將其結果更新 query cache；清楚定義帳號 scope，避免恢復持久化後再產生跨帳號紀錄外洩。

- **[MINOR] F18 — GPU lifecycle：星圖重建 objects 時只有 clear，沒有 dispose。**
  File: `apps/web/src/components/constellation/Scene3D.tsx:589–615`。
  Current: 每次切軸／trajectory 會移除舊 line／centroid group children 並新增 geometry/material；已移除的 objects 不會被最後的 scene.traverse cleanup 找到。
  Suggestion: clear 前 dispose 舊 child geometry/material/texture，或重用 objects；同時給 900ms camera/position animations 加 reduced-motion 分支。這是 source-level resource finding，未量測實機 GPU memory。

- **[MINOR] F19 — Documentation：mock／HTTP／RPC 的現況描述互相矛盾。**
  File: `apps/web/AGENTS.md:16–20`；`docs/frontend.md:69–80`。
  Current: AGENTS 宣稱 HTTP 尚未實作且 export mock，實際 index 永遠 export httpApi、mock 檔已刪除；frontend 文件仍宣稱 Hono RPC／types.ts 退役，實際使用手寫 fetch 與 DTO。
  Suggestion: 文件標清楚「已實作」與「計畫」；若 HTTP-only 是正式決策，移除無效 VITE_API_MODE 指令。不要因此無必要地重新加入 mock 或 RPC。

- **[MINOR] F20 — Testing：前端 tests 沒進 CI，而且 client test 不是 browser E2E。**
  File: `package.json:14`；`.github/workflows/ci.yml:29–30`；`apps/web/src/test/api.e2e.test.ts:22–37`。
  Current: root `pnpm test` 只跑 server；client test stub fetch，沒有載入 route tree、audio browser APIs 或真實頁面。22 tests 全綠不足以覆蓋本次 F01。
  Suggestion: CI 明確執行 `pnpm --filter @socrates/web test`；增加 actual-router golden flow、身份切換與 voice lifecycle tests，將 client contract test 與真正 E2E 命名分開。

- **[MINOR] F21 — Mobile navigation：drawer 的收合按鈕改錯 state。**
  File: `apps/web/src/components/AppShell.tsx:306–313,391–398`。
  Current: mobile 用 `drawerOpen` 控制顯示，但重用的 drawer header button 只 `setExpanded(false)`；按圖示不會關掉 mobile drawer，且沒有 Escape handler／focus management。
  Suggestion: mobile close 應清除 drawerOpen、恢復 trigger focus，提供 Escape 與 modal focus handling；desktop 另外維持 expanded state。

- **[MINOR] F22 — Concurrency：double-submit guard 依賴尚未 commit 的 React state。**
  File: `apps/web/src/hooks/useDialogue.ts:25–34`。
  Current: 同一 tick 連續兩次 send 都讀到 idle，第二次還會 abort 第一次；probe 確認送出兩個 requests。現有 double-submit test 刻意跨兩次 act，未覆蓋此情境。
  Suggestion: 用同步 ref／request generation 做 admission guard，finally 只允許仍擁有該 request 的任務修改 phase；補同一 act 的兩次呼叫測試。

</findings>

<security_findings>

- **[HIGH] S01 — Data exposure：logout／login 不隔離 Query cache，學生可取得前一位老師的完整個人報告。**
  File: `apps/web/src/components/AppShell.tsx:40–47`；`apps/web/src/routes/login.tsx:27–29`；`apps/web/src/routes/report.$id.tsx:24–26,55–58`；`apps/web/src/routes/dialogue.tsx:61`。
  Risk: 同一 browser SPA 中先以老師看 report，登出再換學生身份；cache key 仍是 `["report", activityId]`，在 30 秒 staleTime 內可直接取得含 `individuals` 的舊資料，不需要再次向 server 授權。報告頁再依 `"individuals" in data` 打開 teacher view；history 也有相同問題。已用真實 AppShell logout callback＋QueryObserver 重現，next-user data 仍含 other-student response。這不是 backend 授權缺失，也不是聲稱能跨裝置任意讀 DB。
  Remediation: 在任何 identity transition 取消舊請求、清除 private query/mutation caches，避免晚到 response 重新填回；所有身份相關 query keys 包含 user id／role 或使用 session-scoped QueryClient；清除或按身份 scope currentActivityId／term history。補 teacher→student、student A→B、登出後 direct report URL 的 regression tests。**此項為最高優先級安全阻擋。**

其他檢查結果：沒有在 reviewed frontend 發現確定的 SQL／command injection、raw-HTML XSS sink、production secret logging、自訂 cryptography 或 provider 直連。API 使用 same-origin cookie；實際 AuthZ 仍由 backend 執行。`pnpm audit --prod --json` 本次回報 0 advisories（385 total dependencies），不等於 dependency／supply-chain 絕對安全；未對 backend crypto、rate limits、production headers 或部署權限作全面審查。F05 的離頁後錄音另有 privacy 影響，已列為 MAJOR，未重複計數。

</security_findings>

<discovered_context>

- Source: commits `afc79e4`、`b4bdbc1`、`7c3c28d`、`94fdebb`。
  Finding: refactor 從 mock skeleton 演進到 HTTP-only，頁面多處仍依賴舊 mock 行為；不能只 review HEAD~1。Impact: **IMPORTANT**。
- Source: commit `4a0d314`、`routeTree.gen.ts`。
  Finding: 後加 `/join` entry route，使原 `/join/$code` 自動成為 child；父 component 沒加 outlet。Impact: **BLOCKING**（F01）。
- Source: commits `b77bc79`、`b6a4575`、`f6facc4` 的 messages／blame。
  Finding: 前幾輪已修 re-render teardown、retry 重複訊息與 release-before-permission race；但 unmount-before-permission、final chunk、TTS-only failure 不在同一修正範圍。不能因歷史寫「已修」就跳過相鄰時序。Impact: **IMPORTANT**（F04–F07）。
- Source: `docs/api-contract.md` §§1.1、4、5、7、9；GitHub issues #66、#67、#68、#69、#70、#77、#79。
  Finding: topics 是 teacher-only；generated topics 是 draft；activityInfo 負責刷新恢復；report_pending 要持續查到成功；term history 是 frontend responsibility；帳號註冊選用但不是取消。Impact: **BLOCKING**（相關功能／契約 findings）。
- Source: issue #73 comment `6634959065`、API contract §6。
  Finding: live transport 歷史描述與後續決策不同，目前契約允許 polling，因此沒有把未用 WebSocket/SSE 單獨當 bug。Impact: **FYI**。
- Source: issues #83、#79；commits `817c1d2`、`e0df4c9`。
  Finding: 既有動畫／prototype 應重用；投影後重新分群有歷史理由。F14 指的是仍套用 server labels 與虛構時間序列，不是反對重用 3D 或一概要求刪除 kmeans。Impact: **IMPORTANT**。
- Source: commit `fb64b15`、`docs/roadmap.md`、API contract §11。
  Finding: 手寫 typed dictionary 是明確決策；不要求改 Paraglide。單人 scope、admin、跨裝置查詢歷史已延後，不列缺漏；舊 feature inventory 仍描述 main 的已合併版本，不要求恢復那些舊頁。Impact: **FYI**。
- Source: `gh pr list --state all --head experiment/web-next`、PR #48 review comments。
  Finding: 沒找到此 branch 的 PR。過往 reviewer 曾指出 production mock default、無 assets binding、unsafe URL、語音初始化等風險；本版 HTTP default、SPA assets 與 Markdown renderer 已有對應處理，不重複提出已修項。Impact: **FYI**。
- Source: 每個 added/modified frontend file 的 `git log --oneline -20 -- <path>`、critical-section blame、`git log --all --grep` 與 TODO/FIXME/HACK/revert 搜尋。
  Finding: 相關歷史已收集至 `/tmp/socrates-review-file-history.txt`；沒有找到需要推翻本次判定的相關 revert 或未讀取的實作警告。Impact: **FYI**。
- Source: [TanStack Query query keys](https://tanstack.com/query/latest/docs/framework/react/guides/query-keys)、Context7 QueryClient.clear；installed Query `5.105.1`。
  Finding: query keys 必須唯一描述資料，清 cache 與身份 scope 都是需要明確設計的責任；S01 另有本機 probe 證據。Impact: **IMPORTANT**。
- Source: [MDN MediaRecorder dataavailable](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event)、[Web Audio best practices](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices)。
  Finding: final Blob 應在 recording completion 後組合；AudioContext 需考慮 user gesture／suspended state。Impact: **IMPORTANT**。

### 驗證與限制

| 檢查                                                                            | 本次結果                                                                           |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 既有 web tests：在 review worktree 執行 `apps/web/node_modules/.bin/vitest run` | **5 files、22 tests PASS**                                                         |
| web typecheck：同目錄執行 `./node_modules/.bin/tsc --noEmit`                    | **exit 0**                                                                         |
| root Biome：`./node_modules/.bin/biome check .`                                 | **117 files、exit 0、無自動修正**                                                  |
| `pnpm audit --prod --json`                                                      | **0 advisories**                                                                   |
| 額外 review probes                                                              | **5 files、10 assertions FAIL**；見下列案例                                        |
| tracked code diff                                                               | review 完成前 `git diff --exit-code` 為 **0**；原工作樹亦無 source diff            |
| production build／Worker tests                                                  | **未執行**；本次 frontend scope，環境 Node `22.23.4`，不符合專案要求的 Node ≥26.12 |
| 真實 mic／Chrome、Firefox、Safari／RWD screenshots／axe／Lighthouse             | **未執行**；不可把 jsdom tests 當 browser acceptance                               |

worktree 使用既有 node_modules symlinks。`pnpm --filter` 在此 symlink arrangement 拒絕 task-state path，因此以同一 installed package binaries 執行 tests/typecheck；不能宣稱原 pnpm wrapper 成功。Review probes 全放 `/tmp/socrates-review-probes/`，沒有加入 repo tests 或修改 production code。

重跑 probes：

```bash
cd /tmp/socrates-frontend-review-fb64b15/apps/web
./node_modules/.bin/vitest run --config /tmp/socrates-review-probes/vitest.config.mts
```

這些 tests 是對正確行為的 assertions，失敗是本次發現的證據，不是修正後的通過宣稱。真實 router 使用目前 generated route tree；media probes 模擬 browser 的非同步 callback，沒有冒稱使用實機錄音。

### Behavioral scenarios／edge cases

1. **首次學生打開邀請連結**：真實 RouterProvider 只 render `/join` 輸入框，沒有 topic/name/ToS（probe，F01）。
2. **老師開課**：既有／custom topic 可沿目前 API schema 走；AI topic 不經 createTopic，`gen_*` 不存在於 DB（cross-reference，F08）；空 PUBLIC_BASE_URL 產生不可跨裝置解析的 relative QR（F09）。
3. **學生繼續既有對話**：兩種 role 歷史變成兩筆 assistant（probe，F03）；topics 對學生是 403（server route／contract trace，F02）。
4. **老師看報告後換學生登入**：同 key 直接拿到 teacher cache 的 individuals（probe，S01）。
5. **短錄音未出第一個 timeslice 就放開**：STT 0 calls（probe，F04）。
6. **較長錄音已產出一段，stop 後再出 final chunk**：只上傳 EARLY 的 5 bytes，丟掉 FINAL 的 5 bytes（probe，F04）。
7. **權限提示尚未回答便離頁，再允許 mic**：track 沒有 stop（probe，F05）。
8. **對話成功、TTS decode 失敗、按重試**：dialogue 再 POST 一次（probe，F06）。
9. **decode pending 時打斷**：resolve 後 source.start 仍被呼叫（probe，F07）。
10. **同一 tick 兩次 send**：兩個 requests 都進入（probe，F22）。
11. **成功查詞後重開 history**：仍是空陣列（probe，F17）。
12. **finish 遇到 500／斷線**：錯誤被吞，照樣 navigate report（source trace，F12）。
13. **report 超過約兩分鐘才完成**：retry 已停止，spinner 持續，無自動恢復（source trace，F13）。
14. **只用鍵盤 Enter／Space 啟動語音**：沒有對應 handler；無法觸發 start/stop（source trace，F16）。
15. **切換報告維度／trajectory**：新 cluster id 不保證對應原 legend，舊 GPU objects 被 clear 而未 dispose（source trace，F14、F18）。

### Over-engineering／scope

沒有要求以「更潮」的 router、state library、i18n framework 取代目前 stack。typed Api facade、file routes、3D prototype 重用都有既有脈絡，不因抽象本身扣分。真正多出的風險是第二份 contract 定義（F15），以及在沒有歷史資料時自行補出的 trajectory（F14）；這些應刪除或收斂，而不是要求 backend 配合 UI 的假資料。

</discovered_context>

<missed_requirements>

- 邀請連結本身必須能完成入場，而不只是每個 page component 個別存在。
- HTTP 切換後仍要維持活動主題、歷史 speaker identity、term history 與 AI draft 的完整流程。
- logout／identity transition 必須涵蓋 browser cache、pending requests 與 local identity state，不只是 cookie 與 `me`。
- Voice completion 與 cancellation 是不同生命週期；permission／decode 等待期間的 unmount 也必須收尾。
- 已持久化的 dialogue 成功後，playback 失敗不能造成重送。
- 選用帳號註冊、學生登入的正確 return route；不能強迫 guest 註冊，也不能讓學生走 teacher guard loop。
- pending report 必須可繼續觀察或明確 retry；失敗 finish 不可偽裝成功。
- 報告分群與 trajectory 不可暗中更換語意或虛構學生歷史。
- 實際 route-tree golden flow、身份切換、語音 timing tests 應納入 quality gate。

</missed_requirements>

<blocking_issues>

建議修正順序：

1. **P0：F01 邀請 route nesting、S01 跨帳號 cache exposure。** 前者阻斷所有新學生入場，後者破壞學生資料隔離。
2. **P1：F02–F07。** 正確活動資料與 transcript、錄音 completion、pending mic cleanup、分離 TTS retry、decode cancellation。
3. **P1：F08–F11。** AI draft 持久化、可分享 absolute URL、合法 BYOK 選項、學生／邀請帳號流程。
4. **P1：F12–F14。** finish failure 不導頁、report pending 可恢復、報告資料忠實呈現。
5. **P1：F15–F16。** shared contract 真正成為 single source、核心語音具備 keyboard 等效操作。
6. 重新驗證違反的 quality constraints：golden flow、身份隔離、keyboard／reduced motion 與 theme-token 規範；再於符合版本的 Node 26 環境執行正式 build，並補真實 browser 語音與 RWD acceptance。現有 unit tests 全綠不能替代上述驗收。

</blocking_issues>

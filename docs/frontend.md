# 詰問 · 蘇格拉底對話教室（React 前端）

React 19 + Vite + TypeScript + TanStack（Router / Query）+ Tailwind CSS 4 + shadcn/ui 風格元件。
由純 HTML/JS 原型（分支 `prototype/vanilla-js`）遷移而來。

**沒有後端也能完整跑起來**：預設的 `mock` 模式用記憶體裡的示範資料，AI（蘇格拉底的追問、辯論裡的同學 / 主持人 / 裁判）
都是規則式範本，**不是真正的 LLM**。接上後端只要改一個環境變數。

這份文件分三部分：

1. [各檔案在網站的作用位置](#第一部分各檔案在網站的作用位置)
2. [哪段程式碼與功能需要對應的 API](#第二部分哪段程式碼與功能需要對應的-api)
3. [Linux / macOS / Windows 開啟網站的方法](#第三部分linux--macos--windows-開啟網站的方法)

---

## 第一部分：各檔案在網站的作用位置

### 網站有哪些頁面（路由）

| 網址 | 頁面 | 畫面位置 |
|---|---|---|
| `/login` | 登入前的 Logo 動畫頁 + 登入 | 整個網站的入口，白色主題 |
| `/` | 首頁 | 左側選單「首頁」 |
| `/dialogue?topic=…` | 對話（3D 蘇格拉底 + 聊天） | 選單「單人 → 對話」 |
| `/topics` | 議題（左列表、右詳情） | 選單「單人 → 議題」 |
| `/summary` | 論點總結 | 選單「單人 → 論點總結」 |
| `/bank/private`、`/bank/public` | 私人 / 公開題庫 | 選單「題庫」 |
| `/classrooms` | 教室列表 | 選單「教室」 |
| `/classrooms/:id?tab=home\|announcements\|topics\|members` | 教室：首頁（簡介、公告、統計、最近的議題）、公告、議題列表（老師可新增）、成員 | 點進某個教室 |
| `/classrooms/:id/topics/:id` | 教室議題：說明、相關資料（連結 / 檔案）、開始討論或進入辯論 | 點進某個議題 |
| `/classrooms/:id/activities/:id` | 辯論活動（四個階段 + 結果） | 點進某場辯論 |

### 專案根目錄

| 檔案 | 作用 |
|---|---|
| `index.html` | 網頁的唯一 HTML，只有一個 `<div id="root">`，React 從這裡長出整個網站 |
| `package.json` | 套件清單與指令（`npm run dev`、`npm run build`） |
| `vite.config.ts` | 開發伺服器與打包設定；把 `/api` 代理到後端 `localhost:8000` |
| `tsconfig.json` | TypeScript 設定（`@/` 代表 `src/`） |
| `.env.example` | 環境變數範本：`VITE_API_MODE=mock` 或 `http` |
| `public/socrates.glb` | 3D 蘇格拉底半身像模型（對話頁使用） |
| `public/landing/landing-1~8.json` | 登入前 Logo 頁的 Lottie 動畫（約 21 MB，捲到才載入） |
| `docs/api-contract.md` | 給後端的完整介面說明（每個路徑的資料格式） |

### `src/` 各資料夾

| 路徑 | 作用 | 出現在網站的哪裡 |
|---|---|---|
| `main.tsx` | 程式進入點：掛上主題、TanStack Query、路由 | 整個網站 |
| `router.tsx` | 所有網址與頁面的對應、登入守衛（沒登入導向 `/login`） | 整個網站 |
| `index.css` | 全站顏色（黑 / 白兩套主題變數）與 Tailwind | 整個網站 |
| **`app/`** | | |
| `app/AppShell.tsx` | 左側選單（首頁 / 單人 / 題庫 / 教室）、標題列、黑白切換按鈕、設定視窗（登入身分、登出） | 登入後每一頁的外框 |
| `app/theme.tsx` | 黑白主題狀態（存在瀏覽器） | 選單底部的月亮 / 太陽按鈕 |
| **`landing/`** | | |
| `landing/LandingPage.tsx` | Logo 頁：標題動畫、8 個 Lottie 動畫、身分選擇與登入表單 | `/login` |
| `landing/landing.css` | 這一頁的樣式（從原型搬來，永遠白色主題） | `/login` |
| **`pages/`** | | |
| `pages/HomePage.tsx` | 首頁：提問框、名言、接續上次對話、三個統計卡（對話數 / 論點總結數 / 教室數）、最近議題、教室概況 | `/` |
| `pages/DialoguePage.tsx` | 3D 蘇格拉底 + 聊天面板 + 按住說話 | `/dialogue` |
| `pages/TopicsPage.tsx` | 議題列表與詳情、私人 / 公開 / 論點總結 三個按鈕、繼續對話 | `/topics` |
| `pages/ListPages.tsx` | 論點總結頁、題庫頁、教室列表頁（含新增教室、待處理邀請） | `/summary`、`/bank/*`、`/classrooms` |
| `pages/ClassroomPage.tsx` | 教室內的「首頁」「公告」「議題」「成員」四個分頁：簡介與統計、議題卡片（可依個人 / 團體篩選）、成員表、老師的「新增議題」與「編輯教室」 | `/classrooms/:id` |
| `pages/Announcements.tsx` | 公告分頁（老師新增、編輯、刪除、置頂、排程發布）與教室首頁的公告區 | `/classrooms/:id` |
| `pages/ClassroomFormDialog.tsx` | 新增 / 編輯教室共用的視窗（名稱、簡介） | 教室列表、教室頁 |
| `pages/ClassroomTopicPage.tsx` | 議題詳情：說明、相關資料（老師可加連結、上傳檔案）、學生的「開始討論」、團體議題的辯論入口、老師的編輯與刪除 | `/classrooms/:id/topics/:id` |
| `pages/TopicFormDialog.tsx` | 新增 / 編輯議題的視窗：類型、說明、截止時間、是否收報告；團體議題另有辯論設定（回答方式、價值軸、組別人數） | 教室頁、議題頁 |
| `pages/ActivityPage.tsx` | 辯論活動的外框：標題、橫向進度（設定→調查→提純→比賽→結束）、依階段切換內容 | `/classrooms/:id/activities/:id` |
| `pages/stages/IndividualStage.tsx` | 階段 1：與蘇格拉底對話、調查進度、整理座標視窗；老師視角的成員進度表 | 辯論活動裡 |
| `pages/stages/TeamStage.tsx` | 階段 2：分組、組內討論、AI 整理論點 / 丟反例、投票、分裂、重新分組 | 辯論活動裡 |
| `pages/stages/DebateStage.tsx` | 階段 3：場次、主持人、發言與計時、AI 裁判分數 | 辯論活動裡 |
| `pages/stages/ResultsStage.tsx` | 結果：立場星圖、班級報告、學生報告、計分、儀表板 | 辯論活動結束後 |
| `pages/stages/shared.tsx` | 四個階段共用的小元件（兩欄版面、成員標籤、分數條） | 辯論活動裡 |
| **`components/`** | | |
| `components/ui/*` | 按鈕、輸入框、卡片、標籤、對話視窗（shadcn 風格） | 全站 |
| `components/star/StarMap.tsx` | 立場星圖：3D 畫面、量軸勾選、時間軸、分群、放大 | 階段 2 左側、結果頁 |
| `components/SocratesStage.tsx` | 3D 蘇格拉底的 React 包裝（載入模型、嘴形、主題色） | 對話頁 |
| **`lib/`** | | |
| `lib/star/constellation.ts` | 立場星圖的 three.js 引擎（0–3 維切換、軌跡、群心） | 立場星圖 |
| `lib/star/data.ts` | k-means 分群、群組對齊、群標籤 | 立場星圖 |
| `lib/socrates/scene.ts`、`avatar.ts` | 3D 蘇格拉底的場景、燈光、全息效果、嘴形動畫 | 對話頁 |
| `lib/speech.ts` | 瀏覽器內建的語音辨識與語音合成 | 對話頁的麥克風與朗讀 |
| `lib/debate.ts` | 辯論的常數與小工具（階段名稱、評分項目、組別顏色、票數計算） | 辯論活動 |
| `lib/utils.ts` | `cn()`：合併 CSS class | 全站 |
| **`api/`（前後端的界線，最重要）** | | |
| `api/types.ts` | 所有資料型別（使用者、活動、組別、發言、評分…） | 前後端共同遵守 |
| `api/api.ts` | 前端能呼叫的所有後端功能（一個 `Api` 介面） | 前後端共同遵守 |
| `api/http.ts` | **真後端的實作**：把 `Api` 的每個函式對應成 HTTP 請求與 SSE | `VITE_API_MODE=http` |
| `api/mock.ts` | 假後端：認證、議題、教室；辯論交給 `mock/engine.ts` | `VITE_API_MODE=mock`（預設） |
| `api/queries.ts` | TanStack Query 的資料查詢與更新（頁面都從這裡拿資料）、SSE 事件訂閱 | 全站 |
| `api/index.ts` | 依環境變數決定用 `mock` 還是 `http` | 全站 |
| **`mock/`（只在 mock 模式使用）** | | |
| `mock/engine.ts` | 假的辯論引擎：階段推進、分組、討論、比賽、計時、計分 | mock 模式的辯論 |
| `mock/debate-ai.ts` | 規則式的模擬同學 / 主持人 / 裁判 / k-means 分組 / 計分公式 | mock 模式的辯論 |
| `landing/lottie.d.ts` | Lottie 的型別宣告 | 開發用 |

> 後端上線後，`src/mock/` 與 `src/api/mock.ts` 可以整個刪除；`http` 模式打包時本來就不會包含它們。

---

## 第二部分：哪段程式碼與功能需要對應的 API

前端所有網路請求都集中在 `src/api/`，頁面不會直接寫 `fetch`。頁面呼叫 `api.xxx()`（或 `queries.ts` 的 hook），
`http.ts` 再把它變成下表的請求。**完整的請求與回應格式見 [`docs/api-contract.md`](./api-contract.md) 與 `src/api/types.ts`。**

### 對照表（功能 → 程式碼 → API）

| 功能 | 使用的程式碼 | API |
|---|---|---|
| 登入（選身分按「進入教室」） | `LandingPage.tsx` → `api.login` | `POST /api/auth/login` |
| 登入守衛、取得目前使用者 | `router.tsx`、`queries.ts` 的 `useMe` | `GET /api/me`（未登入回 401） |
| 登出 | `AppShell.tsx` → `api.logout` | `POST /api/auth/logout` |
| 議題列表、論點總結、題庫 | `useArchives`（`TopicsPage`、`ListPages`、`HomePage`） | `GET /api/archives` |
| 加入私人 / 公開 / 論點總結 | `TopicsPage.tsx` → `useUpdateArchive` | `PATCH /api/archives/:id` |
| 首頁提問框開始新對話 | `HomePage.tsx` → `api.createArchive` | `POST /api/archives` |
| 對話頁：載入歷史 | `DialoguePage.tsx` → `api.listTopicDialogue` | `GET /api/archives/:id/dialogue` |
| 對話頁：送出並串流回覆 | `DialoguePage.tsx` → `api.sendTopicDialogue` | `POST /api/archives/:id/dialogue`（**SSE**） |
| 教室列表 / 教室資訊（含首頁的教室數） | `useClassrooms`、`useClassroom` | `GET /api/classrooms`、`GET /api/classrooms/:id` |
| 老師新增教室 | `ClassroomFormDialog.tsx` → `useSaveClassroom` → `api.createClassroom` | `POST /api/classrooms` |
| 老師編輯教室名稱、簡介 | `ClassroomPage.tsx` → `ClassroomFormDialog` → `api.updateClassroom` | `PATCH /api/classrooms/:id` |
| 學生接受 / 拒絕邀請 | `ClassroomsPage` → `api.acceptInvite`、`api.declineInvite` | `POST /api/classrooms/:id/invite/accept`、`…/decline` |
| 教室成員表（成員分頁） | `ClassroomPage.tsx` 的 `MembersTab` → `useClassroomMembers` | `GET /api/classrooms/:id/members` |
| 老師新增 / 移除成員 | `MembersTab` → `api.addClassroomMember`、`api.removeClassroomMember` | `POST /api/classrooms/:id/members`、`DELETE …/members/:memberId` |
| 公告列表（學生只拿得到已發布的；每分鐘重抓一次） | `useAnnouncements`（`Announcements.tsx`） | `GET /api/classrooms/:id/announcements` |
| 老師新增 / 編輯公告（含排程） | `AnnouncementFormDialog` → `useSaveAnnouncement` | `POST /api/classrooms/:id/announcements`、`PATCH /api/announcements/:id` |
| 老師刪除公告 | `Announcements.tsx` 的 `DeleteDialog` → `useDeleteAnnouncement` | `DELETE /api/announcements/:id` |
| 教室議題列表 | `useTopics`（`ClassroomPage.tsx`） | `GET /api/classrooms/:id/topics` |
| 議題詳情 | `useTopic`（`ClassroomTopicPage.tsx`） | `GET /api/topics/:id` |
| 老師新增 / 編輯議題（團體議題同時建立辯論活動） | `TopicFormDialog.tsx` → `useSaveTopic` | `POST /api/classrooms/:id/topics`、`PATCH /api/topics/:id` |
| 老師刪除議題 | `ClassroomTopicPage.tsx` 的 `DeleteDialog` → `api.deleteTopic` | `DELETE /api/topics/:id` |
| 老師加連結 / 上傳檔案 / 移除資料 | `ClassroomTopicPage.tsx` 的 `Resources` | `POST /api/topics/:id/resources`、`POST …/resources/files`（multipart）、`DELETE …/resources/:id` |
| 學生開始個人議題的討論 | `ClassroomTopicPage.tsx` 的 `StartPanel` → `api.startTopicDialogue` | `POST /api/topics/:id/dialogue` |
| 團體議題的辯論進度（卡片上的進度條） | `useActivities`、`useActivity` | `GET /api/classrooms/:id/activities`、`GET /api/activities/:id` |
| 辯論活動資料 | `ActivityPage.tsx` → `useActivity` | `GET /api/activities/:id` |
| 老師推進階段 | `ActivityPage.tsx` 的 `Flow` → `useAdvanceActivity` | `POST /api/activities/:id/advance` |
| 即時更新（階段切換、新訊息、輪到誰） | `queries.ts` 的 `useActivityEvents` → `api.subscribe` | `GET /api/activities/:id/events`（**SSE**） |
| **階段 1** 載入對話 | `IndividualStage.tsx` → `useDialogue` | `GET /api/activities/:id/dialogue` |
| 階段 1 送出並串流回覆 | `IndividualStage.tsx` 的 `ChatPanel` → `api.sendDialogue` | `POST /api/activities/:id/dialogue`（**SSE**） |
| 階段 1 調查進度（四面向、輪數） | `useProgress` | `GET /api/activities/:id/progress` |
| 階段 1 AI 估計座標 | `PositionDialog` → `api.draftPosition` | `POST /api/activities/:id/position/draft` |
| 階段 1 確認座標與論點 | `PositionDialog` → `useConfirmPosition` | `PUT /api/activities/:id/position` |
| 階段 1 讀取座標 | `usePositions` | `GET /api/activities/:id/positions` |
| 老師：成員進度表 | `TeacherIndividual` → `useMembers` | `GET /api/activities/:id/members` |
| **階段 2** 組別列表 | `TeamStage.tsx` → `useGroups` | `GET /api/activities/:id/groups` |
| 階段 2 重新分組（老師） | `RegroupRow` → `api.regroup` | `POST /api/activities/:id/groups/regroup` |
| 階段 2 組內訊息 | `useGroupMessages`、`useMutation(postGroupMessage)` | `GET`、`POST /api/groups/:gid/messages` |
| 階段 2 AI 整理論點 | `api.summarizeGroup` | `POST /api/groups/:gid/ai/summarize` |
| 階段 2 AI 丟反例 | `api.counterexample` | `POST /api/groups/:gid/ai/counterexample` |
| 階段 2 論點列表 | `useArguments` | `GET /api/groups/:gid/arguments` |
| 階段 2 投票 | `api.vote` | `POST /api/arguments/:id/vote` |
| 階段 2 分裂成兩組 | `api.splitGroup` | `POST /api/groups/:gid/split` |
| **階段 3** 場次列表 | `DebateStage.tsx` → `useRooms` | `GET /api/activities/:id/rooms` |
| 階段 3 開始比賽 | `api.startRoom` | `POST /api/rooms/:id/start` |
| 階段 3 發言與評分紀錄 | `useTurns` | `GET /api/rooms/:id/turns` |
| 階段 3 送出發言 | `useMutation(postTurn)` | `POST /api/rooms/:id/turns` |
| 老師覆寫 AI 評分 | `DebateStage`、`ResultsStage` → `api.overrideJudgment` | `PATCH /api/judgments/:id` |
| **結果** 計分表 | `ResultsStage.tsx` → `useScores` | `GET /api/activities/:id/scores` |
| 老師調整分數 | `api.adjustScore` | `PATCH /api/activities/:id/scores/:memberId` |
| **立場星圖**資料（階段 1 老師 / 階段 2 / 結果） | `useStar`（`StarMap.tsx` 使用） | `GET /api/activities/:id/star` |

### 不需要 API 的部分（純前端）

| 功能 | 程式碼 |
|---|---|
| 黑白主題切換 | `app/theme.tsx`（存在瀏覽器） |
| 語音辨識 / 朗讀 | `lib/speech.ts`（瀏覽器內建 Web Speech API；Chrome 上實際是 Google 的服務，之後想統一品質要改接後端語音服務） |
| 3D 蘇格拉底、立場星圖的畫面 | `lib/socrates/`、`lib/star/`（three.js） |
| 登入前的動畫 | `landing/LandingPage.tsx`（Lottie） |

### 兩種 SSE 的格式（後端需要照做）

**1. 對話回覆**（`POST …/dialogue`）：`Content-Type: text/event-stream`

```
event: delta
data: {"text":"有意思。但你剛才"}

event: delta
data: {"text":"那句話裡…"}

event: done
data: {"message":{"id":"m1","role":"assistant","text":"完整回覆","at":"2026-01-01T00:00:00Z"}}
```

**2. 活動即時事件**（`GET /api/activities/:id/events`）：每個事件一行 `data: {…}`，`type` 為
`stage_changed`、`group_message`、`argument_updated`、`turn_created`、`room_updated`（欄位見 `types.ts` 的 `ActivityEvent`）。

### 原本在前端「模擬」、上線後要由後端負責的事

| 原型 / mock 裡的做法（`src/mock/`） | 後端要做什麼 |
|---|---|
| 模擬同學的立場、發言、投票 | 不需要（真人）；測試時另做「機器人成員」 |
| 座標估計、論點整理、反例、主持人、裁判 | LLM 流程（結構化輸出）；`mock/debate-ai.ts` 的規則式裁判可留作保底與測試基準 |
| k-means 分組、人數平衡、配對（立場最遠的先對辯） | 分群服務；可用 `mock/debate-ai.ts` 的 `formGroups`、`pairGroups` 當對照 |
| 階段推進、計時、逾時自動送出、輪到誰發言 | 活動狀態機（FSM）；**一律以伺服器為準** |
| 「示範：讓老師推進」、「模擬同學完成調查」、「模擬全部」 | 不需要；這些只有 `mock` 才有（`api.dev`），`http` 模式不會出現 |
| 計分公式（個人 / 團隊 / 辯論加權，預設 30/30/40） | 計分服務；權重由後端設定 |
| 最多 20 輪對話與收尾條件 | 由後端的 LLM 流程控制，前端只顯示 `Progress` |

### 接上後端的步驟

1. 複製 `.env.example` 為 `.env`，把 `VITE_API_MODE=mock` 改成 `http`。
2. 後端跑在 `http://localhost:8000`（開發時 Vite 會自動代理 `/api`，不用處理 CORS）；若在別處，設定 `VITE_API_BASE`。
3. 登入用 cookie（前端請求都帶 `credentials: include`）；未登入請回 401。
4. 錯誤請回 HTTP 狀態碼與 `{"message": "給使用者看的說明"}`。
5. 一個一個功能替換即可：先做認證與階段 1 的對話串流，最能驗證整條鏈（前端 → 後端 → LLM）通不通。

---

## 第三部分：Linux / macOS / Windows 開啟網站的方法

### 需要準備的東西

| 東西 | 說明 |
|---|---|
| **Node.js 20.19 以上（建議 22 LTS）** | 一定要，用來安裝套件與啟動網站（安裝 Node 時會一併裝好 `npm`） |
| **瀏覽器** | 建議 Chrome 或 Edge（語音辨識最完整）；需支援 WebGL（3D 畫面用，一般電腦都有） |
| Git（選用） | 只有要從 GitHub 下載專案時才需要；直接下載壓縮檔則不用 |
| 網路 | 第一次 `npm install` 需要；跑起來之後不需要（3D 引擎、動畫都已包在專案裡） |

**不需要**：資料庫、Docker、Python、後端（mock 模式下）。

先檢查是否已安裝：打開終端機輸入 `node -v`，看到 `v20.19` 以上（例如 `v22.x.x`）就可以跳到「啟動網站」。

### 🪟 Windows

1. **安裝 Node.js**：到 <https://nodejs.org> 下載 **LTS** 版安裝檔，一路按「下一步」。
   或用命令列（Windows 10/11）：`winget install OpenJS.NodeJS.LTS`。
2. **重新開啟** PowerShell（安裝完要關掉重開，才抓得到 `node`）。
3. 確認：`node -v`、`npm -v`。
4. 進入專案資料夾（解壓縮後含 `package.json` 的那一層）：
   ```powershell
   cd C:\Users\你的名字\Downloads\react-frontend
   npm install
   npm run dev
   ```
5. 終端機會顯示 `http://localhost:5173/`，用瀏覽器打開。

常見問題：
- 出現「無法載入檔案 npm.ps1，因為這個系統上已停用指令碼執行」：執行一次
  `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`，選 `Y`，再重來。
- 防火牆跳出視窗：選「允許」或直接關掉都可以，只在本機使用。

### 🍎 macOS

1. **安裝 Node.js**，二選一：
   - 有 Homebrew：`brew install node`（沒有 Homebrew 就到 <https://brew.sh> 看安裝方式）。
   - 或到 <https://nodejs.org> 下載 **LTS** 的 `.pkg` 安裝檔。
2. 開啟「終端機」，確認：`node -v`。
3. 啟動：
   ```bash
   cd ~/Downloads/react-frontend
   npm install
   npm run dev
   ```
4. 瀏覽器打開終端機顯示的 `http://localhost:5173/`。

### 🐧 Linux

1. **安裝 Node.js**（**版本要 20.19 以上**；各發行版套件庫的版本常常太舊，建議用 nvm）：
   - 通用做法（Ubuntu / Debian / Fedora / Arch 都適用）：依 nvm 官方說明（<https://github.com/nvm-sh/nvm>）安裝後執行
     ```bash
     nvm install 22
     nvm use 22
     ```
   - 或用套件管理員（先確認版本夠新）：
     Fedora `sudo dnf install nodejs npm`、Arch `sudo pacman -S nodejs npm`。
     Ubuntu / Debian 的 `apt install nodejs` 版本可能過舊，不建議。
2. 確認：`node -v`。
3. 啟動：
   ```bash
   cd ~/Downloads/react-frontend
   npm install
   npm run dev
   ```
4. 瀏覽器打開 `http://localhost:5173/`。

### 三個系統共通的指令

| 指令 | 作用 |
|---|---|
| `npm install` | 下載並安裝套件（只需做一次，或 `package.json` 有變動時） |
| `npm run dev` | 啟動開發用網站（改程式會即時更新），預設網址 `http://localhost:5173/` |
| `npm run build` | 型別檢查並打包成正式版，輸出在 `dist/` |
| `npm run preview` | 在本機預覽 `dist/` 的打包結果 |
| `npm run typecheck` | 只做 TypeScript 型別檢查 |

要停止網站：在終端機按 `Ctrl + C`。

### 使用網站

1. 打開後會先看到 Logo 動畫頁，往下捲（或按右上角「Login」）到登入區。
2. 選「學生」或「教師」，按「進入教室」。
3. 想體驗辯論：選單「教室」→「高二哲學選修 A」→「議題」→「正義是否只是強者的利益？」→「進入辯論」。
   - 學生：左邊進度下方有「示範：讓老師推進」，可以自己走完四個階段。
   - 老師：可以新增個人或團體議題、上傳資料、推進階段、看報告。
4. 對話頁的語音功能需要瀏覽器允許麥克風；不支援時可直接打字。

### 常見問題

| 狀況 | 處理 |
|---|---|
| `node` 不是內部或外部命令 / command not found | 沒裝好，或安裝後沒有重開終端機 |
| 執行 `npm run dev` 出現版本錯誤（`engine` / `Unsupported`） | Node 太舊，升級到 20.19 以上 |
| 5173 已被占用 | Vite 會自動改用別的埠號，看終端機顯示的網址 |
| 3D 畫面一片空白 | 瀏覽器或顯示卡驅動不支援 WebGL；換 Chrome / 更新驅動 |
| 對話沒有聲音 | 瀏覽器內建語音要先與網頁互動過才會播放；也請確認系統音量 |
| 網站能開但資料是假的 | 正常，`mock` 模式就是示範資料；要接後端見第二部分最後的步驟 |

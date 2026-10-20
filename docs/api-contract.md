# 前後端 API 契約（給後端）

型別定義在 `src/api/types.ts`，介面在 `src/api/api.ts`，HTTP 實作在 `src/api/http.ts`。
後端只要照下表提供路徑與 JSON，把 `.env` 設成 `VITE_API_MODE=http`，前端不用改頁面程式。
JSON 欄位用 camelCase；id 為字串；時間為 ISO 8601；登入用 cookie（`credentials: include`）。
語言：前端每個請求都帶 `Accept-Language: zh-TW | en | es`（使用者在設定選的介面語言）。後端用這個語言產生給使用者看的文字——錯誤訊息的 `message`、AI 蘇格拉底的追問與辯論主持 / 裁判的發言、系統訊息；資料本身（教室名稱、公告、使用者輸入）原樣保存，不翻譯。
錯誤格式：HTTP 狀態碼 + `{ "message": "給使用者看的說明" }`；未登入回 401。

## 認證
| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/auth/login` | `{ role, name }` → `User`（目前示範用，之後換真的登入） |
| GET | `/api/me` | 目前使用者；未登入 401 |
| PATCH | `/api/me` | `{ name?, avatarUrl? }` → `User`。`avatarUrl` 是前端縮成 256×256 的圖片 data URL（約 20–60 KB，後端可限制在 200 KB 內，或改存成檔案後回傳網址）；`null` = 移除頭像（回到預設的黑色頭像） |
| POST | `/api/auth/logout` | 204 |

## 議題與題庫
| GET | `/api/archives` | `Archive[]` |
|---|---|---|
| POST | `/api/archives` | `{ title }` → `Archive`（首頁提問框開始一段新對話） |
| GET | `/api/archives/:id/dialogue` | `DialogueMessage[]`（議題的自由對話） |
| POST | `/api/archives/:id/dialogue` | `{ text }` → **SSE**（`delta` / `done` / `error`），詳見下方〈對話 API〉 |
| PATCH | `/api/archives/:id` | `{ bank?: "private"\|"public"\|null, inSummary?: boolean, sharedWithIds?: string[] }` → `Archive`（私人 / 公開只能擇一由後端保證） |
| GET | `/api/me/share-targets` | `ShareTarget[]` = `{ id, name, role }`（私人題庫可以分享給誰：同教室的同學、助教與老師） |

**私人題庫的協作：** `sharedWithIds` 是整份取代的名單，只有題目的擁有者可以改（別人分享給你的題目要擋下來，回 403）。
被分享的人在自己的 `GET /api/archives` 裡看得到這道題目，`sharedBy` = 分享者的名字、`sharedWithIds` 為空陣列，且不能再轉分享。

## 對話 API（AI 蘇格拉底，LLM 用 OpenRouter）

適用兩個端點，格式完全相同：

| 端點 | 用在哪裡 | 前端函式 |
|---|---|---|
| `POST /api/archives/:id/dialogue` | 單人 → 對話（`DialoguePage.tsx`） | `api.sendTopicDialogue` |
| `POST /api/activities/:id/dialogue` | 辯論階段 1 個人調查（`IndividualStage.tsx`） | `api.sendDialogue` |

歷史紀錄用對應的 `GET`（回 `DialogueMessage[]`，依時間舊到新）。

### 架構與 API key

```
瀏覽器 ──POST /api/…/dialogue──▶ 後端（Bun + Hono） ──POST /api/v1/chat/completions (stream)──▶ OpenRouter
       ◀──SSE: delta… done─────             ◀──SSE: choices[0].delta.content…─────────
```

- **OpenRouter API key 只放在後端**的環境變數 `OPENROUTER_API_KEY`（`.env`，不進 git）。**絕對不要**放進前端或任何 `VITE_` 開頭的變數：`VITE_` 變數會被打包進瀏覽器的 JS，任何人打開網頁都能看到。前端永遠只呼叫我們自己的 `/api/...`。
- 模型 id 用環境變數 `OPENROUTER_MODEL`（或 LLM 組維護的 `llm/providers/models.json`，見 `llm/README.md`），換模型不用改程式。
- 後端沒有設定 key 時，對話端點回 `503 { message }`，不要讓伺服器啟動失敗（其他功能照常可用）。

### 請求

```http
POST /api/archives/n1/dialogue
Content-Type: application/json
Accept: text/event-stream
Accept-Language: zh-TW

{ "text": "我覺得說謊有時候是對的" }
```

- `text`：去頭尾空白後不可為空，最長 2000 字；不符合回 `422`。
- `Accept-Language`（`zh-TW` / `en` / `es`）決定蘇格拉底用哪個語言回覆。

### 回應：SSE

Headers：`Content-Type: text/event-stream`、`Cache-Control: no-cache`、`Connection: keep-alive`（有反向代理時加 `X-Accel-Buffering: no`，避免被緩衝）。

```
event: emotion
data: {"emotion":"confused"}

event: delta
data: {"text":"有意思。但你剛才"}

event: delta
data: {"text":"說「有時候」——"}

event: done
data: {"message":{"id":"m42","role":"assistant","text":"有意思。但你剛才說「有時候」——……","at":"2026-10-12T14:03:00.000Z"}}

```

| 事件 | data | 說明 |
|---|---|---|
| `emotion` | `{ "emotion": Emotion }` | AI 對學生這句話的當下反應（見〈情緒〉），**在第一個 `delta` 之前送一次**。前端收到就先做表情（例如先笑），文字與朗讀接在後面 |
| `delta` | `{ "text": string }` | 新產生的一段文字（零到多次）。前端照順序接起來即時顯示 |
| `done` | `{ "message": DialogueMessage }` | **一定是最後一個事件**，`message` 是已存進資料庫的完整回覆（`role: "assistant"`，含 `emotion`，見下方〈情緒〉）。前端以它為準，並重新讀取歷史 |
| `error` | `{ "message": string, "code": string }` | 串流開始後才出錯時用，取代 `done` 當最後一個事件；`message` 直接顯示給使用者（依 `Accept-Language`） |
| 註解行 | `: ping` | 心跳（建議每 15 秒一次，避免閒置連線被切），前端忽略 |

規則：每個事件之間空一行；送出 `done` 或 `error` 之後就關閉連線。所有 `delta` 接起來應等於 `done.message.text`。

### 錯誤

**還沒開始串流**（驗證、權限、AI 沒設定）→ 一般 HTTP 錯誤 + `{ "message": "…" }`，不要開 SSE：

| 狀態 | 情況 |
|---|---|
| 401 | 未登入 |
| 403 | 不是這個議題的擁有者 / 不是活動成員；活動不在階段 1（`individual`） |
| 404 | 議題或活動不存在 |
| 409 | 同一段對話已經有一則回覆在產生中（同一時間只允許一個請求） |
| 422 | `text` 空白或太長；階段 1 已經達到 `maxRounds`（20 輪） |
| 429 | 這個使用者送得太頻繁，或 OpenRouter 回 429 |
| 503 | 沒設定 `OPENROUTER_API_KEY`；OpenRouter 回 401 / 402（key 無效、額度用完）或 5xx |

**已經開始串流**（OpenRouter 中途出錯、逾時）→ 送 `event: error`，`code` 用：

| `code` | 情況 |
|---|---|
| `llm_unavailable` | OpenRouter 或模型供應商出錯 |
| `llm_rate_limited` | 被 OpenRouter 限流 |
| `llm_timeout` | 超過 60 秒沒有收到新的文字 |
| `llm_error` | 其他 |

給使用者看的 `message` 不要包含 key、OpenRouter 的原始錯誤或模型名稱（例如統一寫「蘇格拉底暫時無法回應，請稍後再試」）；細節寫在伺服器 log。

### 情緒（AI 控制 3D 模型的表情）

蘇格拉底的每則回覆都帶一個情緒，代表他聽到學生這句話的當下反應。前端一收到 `event: emotion` 就先播對應的表情動畫（模型內建大笑、疑惑、生氣三段），表情開始至少 1.2 秒後才開口朗讀——像「先笑，再回話」：

| `emotion` | 何時用（由 AI 判斷） | 前端表情 |
|---|---|---|
| `neutral` | 一般追問 | 不播 |
| `happy` | 學生說了開心、好笑或溫暖的話（「我喜歡你」），或提出好理由、想法有進步 | 大笑（`Happy`） |
| `confused` | 學生的話真的聽不懂：模糊、矛盾、用詞沒定義 | 疑惑（`Confused`） |
| `angry` | 學生無禮、敷衍、拒絕思考（克制地板起臉） | 生氣（`Angry`） |

學生要求「演示某種情緒」時，AI 直接用那個情緒（例如「你能演示生氣嗎」→ `angry`，回覆「這就是我生氣的樣子！好啦，不開玩笑了…」）。

做法：提示詞（`llm/prompts/socrates.md`）要求 AI 在回覆**最前面**寫一個標記，例如 `[confused] 你說的「善意」是指…`。後端要：

1. 讀 OpenRouter 串流時，先把開頭的文字暫存起來，直到能判斷有沒有標記（符合 `^\s*\[(neutral|happy|confused|angry)\]\s*` 就取出情緒；開頭不是 `[` 或超過 24 字還沒對上，就當作 `neutral`，原文照送）。
2. **標記不能出現在任何 `delta` 裡**，也不存進 `text`（不然會顯示在對話框、被朗讀出來）。
3. 情緒一確定就送 `event: emotion`（在第一個 `delta` 之前），並存進資料庫，放在 `done.message.emotion`；`GET …/dialogue` 的歷史也帶這個欄位（使用者的訊息沒有）。

開發用的轉接器 `frontend/dev/llm-bridge.ts` 的 `push()` 就是這個邏輯，可以直接參考。

### 資料保存

- **成功（送出 `done` 前）**才把「使用者訊息 + 蘇格拉底回覆」一起存進資料庫（同一個 transaction）。
- **失敗（`error` 或 HTTP 錯誤）**兩則都不存，使用者可以直接重送，不會出現重複的提問。
- 使用者中途關掉頁面（連線斷開）：後端照樣把回覆產生完並保存，下次打開看得到完整對話。
- 成功後更新議題：`rounds` = 使用者訊息數、`snippet` = 最新回覆的前 60 字左右、`date`。階段 1 另外更新 `Progress`（`rounds`、`coverage`、`readyToSummarize`）。

### 後端呼叫 OpenRouter 的方式

OpenRouter 是 OpenAI 相容的 API：

```http
POST https://openrouter.ai/api/v1/chat/completions
Authorization: Bearer ${OPENROUTER_API_KEY}
Content-Type: application/json
HTTP-Referer: <網站網址，可省略，用於 OpenRouter 後台統計>
X-Title: 詰問 · 蘇格拉底對話教室

{
  "model": "${OPENROUTER_MODEL}",
  "stream": true,
  "max_tokens": 600,
  "temperature": 0.7,
  "messages": [
    { "role": "system", "content": "<llm/prompts 的蘇格拉底提示詞> + 議題標題 / 活動論題 + 「請用 繁體中文 / English / Español 回覆」" },
    { "role": "user", "content": "（歷史）…" },
    { "role": "assistant", "content": "（歷史）…" },
    { "role": "user", "content": "這次的 text" }
  ]
}
```

- **提示詞**：由 LLM 組放在 `llm/prompts/`（目前是 `socrates.md`：蘇格拉底的提問原則與情緒標記；之後加上階段 1 的收尾協議），後端讀檔注入 `system`。回覆語言依 `Accept-Language` 加在 `system` 最後。
- **歷史**：資料庫裡這段對話的訊息依時間排列；階段 1 最多 20 輪，不用截斷；單人對話若很長，只帶最近 40 則。
- **讀 OpenRouter 的串流**：每行 `data: {…}`，取 `choices[0].delta.content`（可能是空字串，略過），拆掉開頭的情緒標記後，每段轉成我們的 `event: delta`；`data: [DONE]` 表示結束；`:` 開頭的行（例如 `: OPENROUTER PROCESSING`）是註解，略過。
- **OpenRouter 中途出錯**：串流中會出現帶 `error` 欄位的 chunk（`finish_reason: "error"`），收到就送我們的 `event: error`。
- **還沒開始就失敗**：OpenRouter 直接回 HTTP 錯誤（400 請求錯誤、401 key 無效、402 額度不足、408 逾時、429 限流、502 / 503 模型供應商無法使用），依上面的錯誤表轉成我們的狀態碼。

### 用 curl 測試

```bash
# 先登入拿 cookie
curl -c jar.txt -H 'Content-Type: application/json' -d '{"role":"student","name":"測試"}' localhost:8000/api/auth/login
# -N 關閉緩衝，才看得到一段一段的 delta
curl -N -b jar.txt -H 'Content-Type: application/json' -H 'Accept: text/event-stream' -H 'Accept-Language: zh-TW' \
  -d '{"text":"我覺得說謊有時候是對的"}' localhost:8000/api/archives/n1/dialogue
```

前端驗證：`frontend/.env` 設 `VITE_API_MODE=http`，後端跑在 `:8000`（Vite 會代理 `/api`），到「單人 → 對話」送一句話，應該看到回覆一段一段出現，結束後蘇格拉底開始朗讀。

## 教室與活動
| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/classrooms` | `Classroom[]` |
| GET | `/api/classrooms/:id` | `Classroom`（含 `description` 簡介） |
| POST | `/api/classrooms` | `ClassroomInput` = `{ name, description }`（僅老師）→ `Classroom` |
| PATCH | `/api/classrooms/:id` | `Partial<ClassroomInput>`（僅老師）→ `Classroom` |
| POST | `/api/classrooms/:id/invite/accept` | 學生接受邀請 → `Classroom`（`joined` 變成 true） |
| POST | `/api/classrooms/:id/invite/decline` | 學生拒絕邀請，204 |
| GET | `/api/classrooms/:id/members` | `ClassroomMember[]`（姓名、在線、最近一次對話、完成度） |
| POST | `/api/classrooms/:id/members` | `{ name }`（僅老師）→ `ClassroomMember` |
| POST | `/api/classrooms/:id/members/import` | `{ names: string[] }`（僅老師，每個是帳號或姓名）→ `ImportMembersResult`（`added` 與 `skipped`，不因單筆失敗整批失敗） |
| DELETE | `/api/classrooms/:id/members/:memberId` | 僅老師，204 |
| PATCH | `/api/classrooms/:id/members/:memberId` | `{ role: "student" \| "assistant" }`（僅老師）→ `ClassroomMember`。助教可發公告、編輯行事曆、上傳 / 移除辯論資料；不能管理成員、教室設定與辯論階段 |
| GET | `/api/classrooms/:id/activities` | `Activity[]`（這間教室所有辯論活動） |
| GET | `/api/activities/:id` | `Activity`（含 `kind`、`stageDeadline`、`topicId`） |
| POST | `/api/activities/:id/advance` | 僅老師；**由活動狀態機（FSM）決定能否推進**；個人調查→團隊提純時由後端分組 |
| POST | `/api/activities/:id/finish` | 僅老師；從任何階段直接進入 `done`，用目前已有的資料計分 → `Activity` |
| PUT | `/api/activities/:id/deadline` | `{ deadline: string\|null }`（僅老師）→ `Activity`。**到時間只提醒、不自動推進**；換階段時後端清為 null；變更時發 `deadline_changed` 事件 |
| GET | `/api/activities/:id/events` | **SSE**，事件見 `ActivityEvent`（階段切換、組內訊息、輪到誰、新發言與評分、截止時間變更、成員準備好了） |
| GET | `/api/activities/:id/members` | `Member[]`（含 `ready`） |
| PUT | `/api/activities/:id/ready` | `{ ready: boolean }`（學生）→ 204；換階段時後端全部重設為 false；發 `member_ready` 事件 |

## 加入教室（邀請碼、公開探索、審核問卷）
加入流程：學生用**邀請碼**或從**探索教室**找到教室 → 若 `requireApproval = false` 直接加入；
若為 true，須填老師自訂的問卷並送出申請，老師審核通過後才成為成員。
| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/classrooms/:id/join-policy` | 僅老師 → `JoinPolicy` |
| PATCH | `/api/classrooms/:id/join-policy` | `Partial<{ codeEnabled, discoverable, requireApproval, questionnaire }>`（僅老師）→ `JoinPolicy`。改問卷不影響已送出的申請 |
| POST | `/api/classrooms/:id/join-policy/code` | 重新產生邀請碼，舊碼立即失效（僅老師）→ `JoinPolicy` |
| GET | `/api/classrooms/discover?q=` | 學生 → `ClassroomPreview[]`（只列 `discoverable = true` 的教室） |
| GET | `/api/join-codes/:code` | 學生 → `ClassroomPreview`；代碼不存在或已關閉回 404 |
| POST | `/api/classrooms/:id/join` | `JoinInput` = `{ code?, answers? }`（學生）→ `JoinResult`。教室不可探索時必須帶有效 `code`；需要審核時必填題目沒回答回 422；已有 pending 申請回 409 |
| GET | `/api/me/applications` | 學生 → 自己的 `JoinApplication[]` |
| DELETE | `/api/applications/:id` | 學生取消自己的 pending 申請，204 |
| GET | `/api/classrooms/:id/applications?status=` | 僅老師 → `JoinApplication[]` |
| POST | `/api/applications/:id/review` | `{ decision: "approve"\|"reject", note: string\|null }`（僅老師）→ `JoinApplication`；通過時同時把學生加入教室 |

## 公告
| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/classrooms/:id/announcements` | `Announcement[]`，置頂優先、再依 `publishAt` 新到舊。**學生只拿得到 `publishAt` 已到的**（以伺服器時間為準）；老師拿得到全部 |
| POST | `/api/classrooms/:id/announcements` | `AnnouncementInput` = `{ title, body, pinned, publishAt }`（老師或助教；`publishAt = null` 表示立即）→ `Announcement` |
| PATCH | `/api/announcements/:id` | `Partial<AnnouncementInput>`（老師或助教）→ `Announcement` |
| DELETE | `/api/announcements/:id` | 老師或助教，204 |

只做排程發布，不做推播或 email。

## 教室議題
> 畫面上稱為「**辯論**」（網址 `/classrooms/:id/debates/:id`）；API 名稱沿用 `topics`。

建立議題時，後端同時建立一個 `Activity`（`title` / `statement` 用議題標題），並把 `activityId` 填回議題。活動是四階段辯論（個人調查 → 團隊提純 → 辯論比賽 → 結果），由老師推進。
| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/classrooms/:id/topics` | `ClassroomTopic[]` |
| GET | `/api/topics/:id` | `ClassroomTopic` |
| POST | `/api/classrooms/:id/topics` | `TopicInput`（僅老師）。`activity`（回答方式、價值軸、組別人數）必填 → `ClassroomTopic` |
| PATCH | `/api/topics/:id` | `Partial<TopicInput>`（僅老師）。`activity` 設定只能在還沒有學生開始對話前修改，否則回 409 |
| DELETE | `/api/topics/:id` | 僅老師，204；連同辯論活動一起刪除 |
| POST | `/api/topics/:id/resources` | `{ name, url }` 新增連結（老師或助教）→ `TopicResource` |
| POST | `/api/topics/:id/resources/files` | **multipart/form-data**，欄位 `file`（老師或助教）→ `TopicResource`。超過大小上限回 413 |
| DELETE | `/api/topics/:id/resources/:resourceId` | 老師或助教，204 |
| GET | `/api/topics/:id/reports` | `TopicReport[]`（老師：全班；學生：只有自己） |
| POST | `/api/topics/:id/reports` | **multipart/form-data**，欄位 `file`、`comment`（學生；`acceptsReports = false` 時回 403）→ `TopicReport`。再次上傳取代舊檔 |
| DELETE | `/api/reports/:id` | 作者本人，204 |

`FileRef.url` 是後端提供的下載網址，需要登入（cookie）才能下載；權限與議題相同。

## 討論區
每個教室有一個教室討論區（`topicId = null`），每個議題各有一個議題討論區。回覆只有一層（`parentId` 指向主貼文）。
| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/classrooms/:id/posts?topicId=` | `DiscussionPost[]`（省略 `topicId` = 教室討論區），依時間舊到新 |
| POST | `/api/classrooms/:id/posts` | `PostInput` = `{ topicId, parentId?, body, anonymous }` → `DiscussionPost` |
| DELETE | `/api/posts/:id` | 作者本人或老師，204；有回覆的貼文改成 `deleted = true` 保留位置 |

**匿名規則（必須由後端過濾，不能只靠前端隱藏）：** 匿名貼文回傳給其他學生時，`authorLabel = "匿名同學"`、`authorId = null`；
回傳給老師或作者本人時帶本名與 `authorId`（作者本人另看到 `isMine = true`）。老師的貼文一律實名。

## 多人討論（老師出一題，同學各自跟 AI 對話）
老師（或助教）出一個統一的題目，教室裡每位學生各有**自己的一段對話**（彼此看不到），聊完寫下結論；
老師在同一頁看全班的討論成果，可以點開任一位同學的完整對話。畫面上稱為「多人討論」，API 名稱用 `discussions`。

| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/classrooms/:id/discussions` | `DiscussionTask[]`，依建立時間新到舊。學生另外拿到 `myStatus` |
| GET | `/api/discussions/:id` | `DiscussionTask` |
| POST | `/api/classrooms/:id/discussions` | `DiscussionTaskInput` = `{ title, prompt, conclusionHint, dueAt, maxRounds }`（老師或助教）→ `DiscussionTask` |
| PATCH | `/api/discussions/:id` | `Partial<DiscussionTaskInput>`（老師或助教）→ `DiscussionTask` |
| PUT | `/api/discussions/:id/status` | `{ status: "open" \| "closed" }`（老師或助教）→ `DiscussionTask`；`closed` 後學生只能回看 |
| DELETE | `/api/discussions/:id` | 老師或助教，204；連同全班的對話與結論一起刪除 |
| GET | `/api/discussions/:id/sessions` | `DiscussionSession[]`（**只有老師與助教**），不含逐句對話 |
| GET | `/api/discussions/:id/sessions/:studentId` | `DiscussionSessionDetail`（含 `messages`）。`:studentId` = `me` 代表自己；要看別人一律需要老師或助教 |
| POST | `/api/discussions/:id/sessions/me/messages` | `{ text }` → **SSE**（`emotion` / `delta` / `done` / `error`），格式與〈對話 API〉完全相同 |
| PUT | `/api/discussions/:id/sessions/me/conclusion` | `{ conclusion: string \| null }` → `DiscussionSessionDetail`；`null` = 收回結論，回到「對話中」 |

**規則（由後端保證）**
- 學生只讀寫得到自己的那段對話；`GET /sessions`（全班）與別人的 `/sessions/:studentId` 對學生回 403。
- `maxRounds` 是每位同學的提問上限（2–40）；達到上限後 `POST …/messages` 回 409，畫面改成只能寫結論。
- 討論 `closed` 之後，送訊息與送結論都回 409。
- 還沒有任何對話就送結論回 422（先聊過才能下結論）。
- `DiscussionTask.stats` = `{ total, started, submitted, avgRounds }`，由後端統計；`coverage` 與個人調查用同一套判斷（主張 / 理由 / 證據 / 反例的回應）。
- `dueAt` 會出現在行事曆，`kind: "discussion_due"`、帶 `discussionId`。

## 行事曆
| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/classrooms/:id/calendar?from=&to=` | 單一教室的 `CalendarEvent[]`（系統事件之外，還有 `kind: "custom"` 的自訂事件） |
| POST | `/api/classrooms/:id/calendar-events` | `CalendarEventInput` = `{ title, at, note? }`（老師或助教）→ `CalendarEvent`（`kind: "custom"`） |
| PATCH | `/api/calendar-events/:id` | `Partial<CalendarEventInput>`（老師或助教；只能改 custom 事件）→ `CalendarEvent` |
| DELETE | `/api/calendar-events/:id` | 老師或助教，204 |

事件由後端從現有資料整理，不需要另外建立：議題截止日（`topic_due`）、已發布或已排程的公告（`announcement`，學生只看得到已發布的）、
活動階段截止時間（`stage_deadline`）、多人討論的截止時間（`discussion_due`）。

## 階段 1：個人調查
| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/activities/:id/dialogue` | `DialogueMessage[]`（只有自己的） |
| POST | `/api/activities/:id/dialogue` | `{ text }` → **SSE**（`delta` / `done` / `error`），格式、錯誤與 OpenRouter 呼叫方式見〈對話 API〉。最多 20 輪與收尾條件由後端控制 |
| GET | `/api/activities/:id/progress` | `Progress`（四個面向 `coverage`、`rounds`、`maxRounds`、`readyToSummarize`） |
| POST | `/api/activities/:id/position/draft` | AI 依對話整理論點 → `PositionDraft` = `{ summary }`（**不含座標**） |
| PUT | `/api/activities/:id/position` | `{ summary }`（學生確認或修改論點；階段 1 結束前可再改）→ `Position`。座標由後端依對話估算後保存，學生不送座標 |
| GET | `/api/activities/:id/positions` | 老師：全班；學生：只有自己。**活動 `stage !== "done"` 前，學生拿到的 `coords` 為 `null`** |
| GET | `/api/activities/:id/notes` | 自己的 `ThinkingNote[]`（重點標註與想法，**只有本人看得到，老師也看不到**） |
| POST | `/api/activities/:id/notes` | `NoteInput` = `{ kind: "highlight"\|"thought", sourceMessageId?, text }` → `ThinkingNote` |
| PATCH | `/api/notes/:id` | `{ text }` → `ThinkingNote`（本人） |
| DELETE | `/api/notes/:id` | 本人，204 |

## 階段 2：團隊提純
| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/activities/:id/groups` | `Group[]` |
| POST | `/api/activities/:id/groups/regroup` | `{ groupSize }`（僅老師） |
| GET/POST | `/api/groups/:gid/messages` | 組內聊天 |
| POST | `/api/groups/:gid/ai/summarize` | AI 整理論點 → `GroupArgument[]` |
| POST | `/api/groups/:gid/ai/counterexample` | AI 對一條主張丟反例 → `GroupMessage`（`ai_counterexample`） |
| GET | `/api/groups/:gid/arguments` | `GroupArgument[]` |
| POST | `/api/arguments/:id/vote` | `{ vote: "endorse"\|"revise"\|"oppose" }`；狀態（active/revised/dropped/contested）由後端重算 |
| POST | `/api/groups/:gid/split` | 出現分歧時把不同意的人分成新組 |

## 階段 3：辯論比賽
| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/activities/:id/rooms` | `Room[]`（配對由後端做：中心距離最遠的先配） |
| POST | `/api/rooms/:id/start` | 開始比賽（主持人開場） |
| GET | `/api/rooms/:id/turns` | `{ turns, judgments }` |
| POST | `/api/rooms/:id/turns` | `{ text }`；**輪到誰、計時、逾時都由後端判定**；同時產生 `Judgment`（AI 裁判） |
| PATCH | `/api/judgments/:id` | `{ teacherScore: number\|null }`（僅老師覆寫） |

## 立場星圖
| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/activities/:id/star` | `StarData`。階段 1：老師只看到已確認的人、沒有分組；階段 2 之後含分組；活動結束後多一步「團隊提純後」。**活動結束前學生呼叫回 403**；結束後學生看得到，但看不到其他人的名字 |

## 結果
| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/activities/:id/scores` | `ScoreRow[]`（老師：全班；學生：自己） |
| PATCH | `/api/activities/:id/scores/:memberId` | `{ adjust }`（僅老師） |

## 原型裡「模擬」的部分，對應到後端要做的事
| 原型（`debate-ai.js`） | 後端 |
|---|---|
| 模擬同學的立場與發言 | 不需要：真人；測試時另做「機器人成員」 |
| 座標估計、論點整理、反例、主持人、裁判 | LLM 流程（結構化輸出）；規則式裁判可保留當保底與測試基準 |
| k-means 分組、分組平衡、配對 | 分群服務 |
| 計分公式（個人 / 團隊 / 辯論加權） | 計分服務；權重由老師設定 |
| 「示範：讓老師推進」按鈕 | 移除，只有老師能推進 |

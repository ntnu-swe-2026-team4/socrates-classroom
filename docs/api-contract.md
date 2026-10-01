# 前後端 API 契約（給後端）

型別定義在 `src/api/types.ts`，介面在 `src/api/api.ts`，HTTP 實作在 `src/api/http.ts`。
後端只要照下表提供路徑與 JSON，把 `.env` 設成 `VITE_API_MODE=http`，前端不用改頁面程式。
JSON 欄位用 camelCase；id 為字串；時間為 ISO 8601；登入用 cookie（`credentials: include`）。
錯誤格式：HTTP 狀態碼 + `{ "message": "給使用者看的說明" }`；未登入回 401。

## 認證
| 方法 | 路徑 | 說明 |
|---|---|---|
| POST | `/api/auth/login` | `{ role, name }` → `User`（目前示範用，之後換真的登入） |
| GET | `/api/me` | 目前使用者；未登入 401 |
| POST | `/api/auth/logout` | 204 |

## 議題與題庫
| GET | `/api/archives` | `Archive[]` |
|---|---|---|
| POST | `/api/archives` | `{ title }` → `Archive`（首頁提問框開始一段新對話） |
| GET | `/api/archives/:id/dialogue` | `DialogueMessage[]`（議題的自由對話） |
| POST | `/api/archives/:id/dialogue` | `{ text }`，回應同階段 1 的 **SSE** 格式（`delta` / `done`） |
| PATCH | `/api/archives/:id` | `{ bank?: "private"\|"public"\|null, inSummary?: boolean }` → `Archive`（私人 / 公開只能擇一由後端保證） |

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
| GET | `/api/classrooms/:id/activities` | `Activity[]` |
| POST | `/api/classrooms/:id/activities` | `CreateActivityInput`（僅老師）→ `Activity`。P4 之後改由「新增團體議題」建立，這條保留給舊畫面 |
| GET | `/api/activities/:id` | `Activity`（含 `stageDeadline`、`topicId`） |
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
| POST | `/api/classrooms/:id/announcements` | `AnnouncementInput` = `{ title, body, pinned, publishAt }`（僅老師；`publishAt = null` 表示立即）→ `Announcement` |
| PATCH | `/api/announcements/:id` | `Partial<AnnouncementInput>`（僅老師）→ `Announcement` |
| DELETE | `/api/announcements/:id` | 僅老師，204 |

只做排程發布，不做推播或 email。

## 教室議題
議題分**個人**與**團體**。團體議題建立時，後端同時建立一個辯論 `Activity`（`title` / `statement` 用議題標題），
並把 `activityId` 填回議題；個人議題的「開始討論」會建立或取回該學生在這個議題的 `Archive`（`topicId` 指向議題）。
| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/classrooms/:id/topics` | `ClassroomTopic[]` |
| GET | `/api/topics/:id` | `ClassroomTopic` |
| POST | `/api/classrooms/:id/topics` | `TopicInput`（僅老師）。`type = "group"` 時 `activity` 必填 → `ClassroomTopic` |
| PATCH | `/api/topics/:id` | `Partial<TopicInput>`，不能改 `type`（僅老師）。團體議題的 `activity` 設定只能在還沒有學生開始對話前修改，否則回 409 |
| DELETE | `/api/topics/:id` | 僅老師，204；團體議題連同辯論活動一起刪除 |
| POST | `/api/topics/:id/resources` | `{ name, url }` 新增連結（僅老師）→ `TopicResource` |
| POST | `/api/topics/:id/resources/files` | **multipart/form-data**，欄位 `file`（僅老師）→ `TopicResource`。超過大小上限回 413 |
| DELETE | `/api/topics/:id/resources/:resourceId` | 僅老師，204 |
| POST | `/api/topics/:id/dialogue` | 個人議題「開始討論」→ `Archive`（已存在就回傳原本那筆）。之後的對話沿用 `/api/archives/:id/dialogue` |
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

## 行事曆
| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/calendar?from=&to=` | 自己所有教室的 `CalendarEvent[]` |
| GET | `/api/classrooms/:id/calendar?from=&to=` | 單一教室的 `CalendarEvent[]` |

事件由後端從現有資料整理，不需要另外建立：議題截止日（`topic_due`）、已發布或已排程的公告（`announcement`，學生只看得到已發布的）、
活動階段截止時間（`stage_deadline`）。

## 階段 1：個人調查
| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/activities/:id/dialogue` | `DialogueMessage[]`（只有自己的） |
| POST | `/api/activities/:id/dialogue` | `{ text }`，回應為 **SSE**：`event: delta` `data: {"text":"…"}` 多次，最後 `event: done` `data: {"message": DialogueMessage}`。最多 20 輪與收尾條件由後端控制 |
| GET | `/api/activities/:id/progress` | `Progress`（四個面向 `coverage`、`rounds`、`maxRounds`、`readyToSummarize`） |
| POST | `/api/activities/:id/position/draft` | AI 依對話估計座標與論點 → `PositionDraft` |
| PUT | `/api/activities/:id/position` | 學生確認 → `Position`（階段 1 結束前可再改） |
| GET | `/api/activities/:id/positions` | 老師：全班；學生：只有自己（階段 2 分組前不公開他人座標） |
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
| GET | `/api/activities/:id/star` | `StarData`。階段 1：老師只看到已確認的人、沒有分組；階段 2 之後含分組；活動結束後多一步「團隊提純後」。學生看不到其他人的名字 |

## 結果
| 方法 | 路徑 | 說明 |
|---|---|---|
| GET | `/api/activities/:id/scores` | `ScoreRow[]`（老師：全班；學生：自己） |
| PATCH | `/api/activities/:id/scores/:memberId` | `{ adjust }`（僅老師） |

## 已定案、尚未實作：立場座標延到活動結束才給學生看（P8）
以下是**既有 API 的行為與格式變更**，前端會在 P8 一起改，後端可以直接照新規則做：
- `POST /api/activities/:id/position/draft`：學生只拿到 AI 整理的論點 `summary`，**不含座標**；座標由後端依對話估算後保存。
- `PUT /api/activities/:id/position`：學生只送出（或修改）`summary`，不送座標。
- `GET /api/activities/:id/positions`：活動 `stage !== "done"` 前，學生拿到的自己那筆 `coords` 為 `null`。
- `GET /api/activities/:id/star`：活動結束前，學生呼叫回 403（老師不受影響）。
- 活動結束後，學生在結果頁看得到自己的座標與星圖（其他人仍不具名）。

## 原型裡「模擬」的部分，對應到後端要做的事
| 原型（`debate-ai.js`） | 後端 |
|---|---|
| 模擬同學的立場與發言 | 不需要：真人；測試時另做「機器人成員」 |
| 座標估計、論點整理、反例、主持人、裁判 | LLM 流程（結構化輸出）；規則式裁判可保留當保底與測試基準 |
| k-means 分組、分組平衡、配對 | 分群服務 |
| 計分公式（個人 / 團隊 / 辯論加權） | 計分服務；權重由老師設定 |
| 「示範：讓老師推進」按鈕 | 移除，只有老師能推進 |

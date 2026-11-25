# 貢獻指南（Contributing）

本文件定義團隊協作流程：issue 慣例、PR 前置討論（issue-first）與文件同步義務。開發環境與指令見 [README](README.md)；commit message 規範見 [AGENTS.md](AGENTS.md) § Language；文件維護規則（SSOT map）見 [docs/AGENTS.md](docs/AGENTS.md)。

## Issue

### Type（分類）

每個 issue 有一個 type，由 [issue form](.github/ISSUE_TEMPLATE/) 自動設定；**標題不加前綴**，標題就是一句話描述。

| type              | 定義                   | 完成時改變的 SSOT                             | template                                                      |
| ----------------- | ---------------------- | --------------------------------------------- | ------------------------------------------------------------- |
| `epic`            | 跨 feature 的交付批次  | 子單全關                                      | [Epic](.github/ISSUE_TEMPLATE/epic.yml)                       |
| `feature`         | 新能力                 | `docs/feature.md` 新增一列                    | [Feature](.github/ISSUE_TEMPLATE/feature.yml)                 |
| `user story`      | 使用者可觀察的行為增量 | `docs/feature.md` 既有那一列的行為改變        | [User Story](.github/ISSUE_TEMPLATE/user-story.yml)           |
| `technical story` | 內部技術工作，行為不變 | `docs/api-contract.md` 或 AGENTS.md 非妥協項  | [Technical Story](.github/ISSUE_TEMPLATE/technical-story.yml) |
| `bug`             | 實作偏離文件描述       | 程式回到 `feature.md` 既有描述                | [Bug](.github/ISSUE_TEMPLATE/bug.yml)                         |
| `task`            | 可直接實作的工程工作   | 什麼文件都不變                                | [Task](.github/ISSUE_TEMPLATE/task.yml)                       |
| `decision`        | 決策，不改程式         | `docs/architecture.md` 或 `docs/providers.md` | [Decision](.github/ISSUE_TEMPLATE/decision.yml)               |

Type 在 organization 層定義，不能 per-repo 自訂；用 gh CLI 開單時加 `--type`。名稱以 organization 上的定義為準（`Task`、`Bug`、`Feature`、`User Story`、`Technical Story`、`Decision`、`Epic`）。

從 blank issue 開的單不經過 form，type 會是空的：這種情況要事後補 type（`gh issue edit <N> --type <name>`），否則它不屬於任何一類、也不會被 § Status 的必要欄位檢查涵蓋。

- `task` 與 `decision` 的分界：task 可以直接實作，decision 不會改程式。**兩者混合時不屬於這兩種**，拆成 decision 加另一張，不要挑「比較像的」硬塞。
- `feature` 與 `User Story` 的先後：承諾在 feature（要不要做）、切法在 User Story（怎麼交付）。**一個 User Story 就能完成的能力不開 feature**；第 2 個 story 出現時才補開 feature 當容器。
- `epic` 是交付批次，不是大 feature；主題由 domain label 表達，epic 不承擔主題。
- `epic` 不填 `Size` 與 `Priority`；`decision` 不填 `Size`（Size 的單位是 PR 數，決策不產生 PR）。
- decision 的〈決議〉是 PR〈設計審查〉段的來源：決策不在 issue 與 PR 各寫一次。關單前必須填落地方式（docs 條目／後續 issue／No-go 理由）。

### 撰寫慣例

- 描述**觀察到的症狀**，不是猜測的成因：寫「切換議題後訊息未清空」，不寫「WebSocket state 沒清」。
- 一個 issue 一件事；多個症狀分開開。
- 標題要能不點開就懂範圍：寫出頁面或模組名，不寫「壞掉了」「不能動」。

### Fields

Backlog 的 issue 可以缺任何欄位；**離開 Backlog 時下列欄位要齊備**（填寫建議與語意檢查，不硬性阻擋）：

| field        | 規則                                                                          |
| ------------ | ----------------------------------------------------------------------------- |
| `Type`       | 必填，由 template 帶入                                                        |
| `Team`       | 必填 — `Frontend` / `Backend` / `LLM` / `Common`                              |
| `Size`       | 必填（`epic` 與 `decision` 除外），單位是 PR 數，見下表                       |
| domain label | 必填 — `教室` / `對話` / `查詢` / `防濫用` / `成本` / `報告` / `管理`，可多重 |
| 驗收段       | 必填，body 要有可驗證的驗收條件                                               |
| `Priority`   | 必填 — `Urgent` / `High` / `Medium` / `Low`；值由開發者判斷，agent 不代填     |

`Priority` 與 `Size` 都是 organization 層的 **issue field**，不是 project item field：值存在 issue 上、建立 issue 時就看得到、可經 REST／GraphQL 讀寫（`gh api /orgs/{org}/issue-fields`、`setIssueFieldValue`），因此 CI 驗得動。代價是 pinning 只能在組織設定（Planning → Issue fields）操作，沒有 API，所以設定不可版控。兩種欄位的完整差異與取捨見 #436 的附錄。

issue fields 沒有 required 屬性（官方 [Managing issue fields](https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/managing-issue-fields) 只提供 pinning 與 visibility），所以「必填」靠三層落實：

1. **Pin 到對應的 type 加「Issues without a type」**：建立畫面與 issue 側欄才看得到（pinning 無 API）
2. **saved view**：`Status != Backlog AND <field> is empty` 當作每日 triage 清單；Backlog 的單不計入
3. **CI**：用 issue field 的 API 驗證——`gh project item-list` 讀不到 issue field 的值，用錯來源會得到「全部為空」的假訊號

`Size` 的錨點是「幾個 PR」：

| Size | 定義                                                | 對應動作                         |
| ---- | --------------------------------------------------- | -------------------------------- |
| `XS` | 單檔或單段文字                                      | —                                |
| `S`  | 1 個 PR，單層（一條 route 或一個 component 加測試） | —                                |
| `M`  | 1 個 PR，一個 vertical slice（API + UI + 測試）     | —                                |
| `L`  | 需要拆 2–3 個 PR                                    | 先開 sub-issue                   |
| `XL` | 拆分波母單                                          | 必須是 `epic`，且已列 sub-issues |

`Estimate` 已移除（與 `Size` 重複計量）；`Start date` / `Target date` 目前不使用。

### Labels

- **domain label**（產品面，可多重）：`教室` / `對話` / `查詢` / `防濫用` / `成本` / `報告` / `管理`。不必與 epic 對齊——epic 是交付批次，domain 是領域。
- **跨領域**：`accessibility`（對應 `apps/web/AGENTS.md` 的 quality gate 4）。
- **狀態類**：`good first issue`、`question`。
- type 不再用 label 表達：`實作` / `設計決策` / `bug` / `enhancement` / `removal` / `documentation` 已由 Issue Type 取代，不要再新增。
- 重複或作廢的 issue 用 `gh issue close --reason duplicate` 關閉，body 寫 `Superseded by #NN` 並雙向連結，不要靠 label。
- 上線後清理的工作是 `task` 加 milestone `P2 removal`，不是一種 type。

### Status

| 狀態             | 語意                                     | 進入條件          |
| ---------------- | ---------------------------------------- | ----------------- |
| `Backlog`        | 尚未排程                                 | 任何欄位可缺      |
| `Needs Decision` | 這張單本身是尚未拍板的決策（`decision`） | 決議未定          |
| `Ready`          | 已排定、可開工                           | 必要欄位齊備      |
| `Pending`        | 在等別人，不可開工                       | 已建立 blocked-by |
| `In progress`    | 有人在做                                 | 有 assignee       |
| `In review`      | PR 已開                                  | PR 已連結         |
| `Done`           | 已交付                                   | issue 已關閉      |

「needs decision」分兩層，不要混用：**決策本身的單**用 `Needs Decision`；**在等決策的實作單**用 `Pending` 加 blocked-by 關係。決策拍板後，被它擋住的 issue 要解除 blocked-by 並回到 `Ready`，否則等待會無聲延續。

### 加入 Project

issue 開完後必須加入 GitHub Project [`ntnu-swe-team4-kanban`](https://github.com/orgs/ntnu-swe-2026-team4/projects/2)，properties 不留空（在 issue 側欄填寫，或用 gh CLI 設定）：

- `Status`：轉移規則見 [§ Status](#status)。
- `Team`：負責模組 — `Frontend` / `Backend` / `LLM` / `Common`。
- `Size` 與 assignee 的填寫時機見 [§ Fields](#fields)；欄位與 option 以 project 上的定義為準。

用 gh CLI 時分兩步：`gh project item-add 2 --owner ntnu-swe-2026-team4 --url <issue-url>` 把 issue 加進板，再用 `gh project item-edit` 設定 `Status` 與 `Team`（欄位與 option id 用 `gh project field-list 2 --owner ntnu-swe-2026-team4` 查詢）。

## PR 前置討論（issue-first）

借鏡 Next.js（新功能先開 discussion 收 feedback 再實作）與 Django（除 docs／tests 外，PR 需先有 accepted ticket）的慣例：**預計實作的新功能或重大變更，先開 issue 與團隊討論、達成共識後才開始實作**。

- 需要 issue-first 的變更：新功能、既有行為變更、API 契約（`packages/shared`）變更、D1 schema migration、新增 Cloudflare binding 或 LLM provider。
- 流程：開 `feature` 或 `User Story` issue → 在 issue 內討論並留下決議 → 團隊同意後實作 → PR 連結該 issue（`Closes #NN`）。
- bug fix 與 docs 可直接開 PR（有對應 issue 就連結）；拿不準算不算「重大」時，先開 issue 問。

## Pull Request

1. Branch 從最新 `main` 切出。
2. PR 標題依 Conventional Commits（例：`feat(web): add stance map export`）；merge 採 squash，PR 標題即最終 commit message。
3. 描述填齊 [PR template](.github/PULL_REQUEST_TEMPLATE.md) 每個 section：「關聯 Issue」附上討論過的 issue；「文件更新」列出本次更新了哪些文件（沒有就寫「無」）。
4. PR body 必須含 closing keyword（`Closes #NN`）：`In review` 與 `Done` 的狀態轉移、issue 的自動關閉都靠這個連結，只把編號寫進標題不算。
5. CI（`pnpm lint`、`pnpm typecheck`、`pnpm test`）綠燈後請隊友 review；CODEOWNERS 見 [.github/CODEOWNERS](.github/CODEOWNERS)。
6. Review 意見處理完，由 reviewer merge。

## 文件同步

文件是 SSOT 制：一個事實只寫在一個地方（規則與 SSOT map 見 [docs/AGENTS.md](docs/AGENTS.md)）。改程式時同時問：哪份文件的哪個事實變了？

- 功能合併進 `main` 後三步驟：`docs/roadmap.md` 移除條目 → `docs/changelog.md` 加條目 → `docs/feature.md` 加功能列。
- Issue Type 與文件的對應（見 [§ Type](#type分類)）就是這三步驟的判準：`Feature` 完成要新增一列、`User Story` 完成要改既有列、`Bug` 完成要讓程式回到文件描述、`Decision` 完成要在 `architecture.md`／`providers.md` 留下決議段落。
- API 請求／回覆變更 → `docs/api-contract.md`；系統決策變更 → `docs/architecture.md`。
- 文件與程式碼矛盾視同 bug，看到就修（併入相關 PR，或另開一個 `docs: …` 標題的 PR）。
- PR template 的「文件更新」填寫與 self-review 的「文件無偏移」checkbox 就是在驗證這件事。

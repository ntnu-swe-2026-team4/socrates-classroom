# 貢獻指南（Contributing）

本文件定義團隊協作流程：issue 慣例、PR 前置討論（issue-first）與文件同步義務。開發環境與指令見 [README](README.md)；commit message 規範見 [AGENTS.md](AGENTS.md) § Language；文件維護規則（SSOT map）見 [docs/AGENTS.md](docs/AGENTS.md)。

## Issue

### 標題格式

```
[type] 一句話描述
```

`type` 對應 Conventional Commits 的語意，全部小寫：

| type       | 用途                                       |
| ---------- | ------------------------------------------ |
| `bug`      | 預期外的行為、故障（對應 commit 的 `fix`） |
| `feat`     | 新功能或既有行為的實質變更                 |
| `docs`     | 文件補齊或修正                             |
| `refactor` | 不改變行為的重構                           |
| `chore`    | CI、依賴、build 設定等雜務                 |

`[bug]`（[Bug report template](.github/ISSUE_TEMPLATE/bug_report.md)）與 `[feat]`（[Feature request template](.github/ISSUE_TEMPLATE/feature_request.md)）由 template 自動帶入前綴；其他 type 開 blank issue 時請自行加上。

```
[bug] 對話頁切換議題後訊息未清空
[feat] 報告頁新增立場分佈匯出
[docs] 補充 gateway cooldown 行為
```

### 撰寫慣例

- 描述**觀察到的症狀**，不是猜測的成因：寫「切換議題後訊息未清空」，不寫「WebSocket state 沒清」。
- 一個 issue 一件事；多個症狀分開開。
- 標題要能不點開就懂範圍：寫出頁面或模組名，不寫「壞掉了」「不能動」。

### 加入 Project

issue 開完後必須加入 GitHub Project [`ntnu-swe-team4-kanban`](https://github.com/orgs/ntnu-swe-2026-team4/projects/2)，properties 不留空（在 issue 側欄填寫，或用 gh CLI 設定）：

- `Status`：未排程用 `Backlog`，已排定、可開工用 `Ready`；有對應 branch 就設 `In progress`，開了 PR 就設 `In review`，merge 後設 `Done`。
- `Team`：負責模組 — `Frontend` / `Backend` / `LLM` / `PM`。
- `Size`、`Priority`、`Assignees` 目前未強制，可不填；欄位與 option 以 project 上的定義為準。

用 gh CLI 時分兩步：`gh project item-add 2 --owner ntnu-swe-2026-team4 --url <issue-url>` 把 issue 加進板，再用 `gh project item-edit` 設定 `Status` 與 `Team`（欄位與 option id 用 `gh project field-list 2 --owner ntnu-swe-2026-team4` 查詢）。

## PR 前置討論（issue-first）

借鏡 Next.js（新功能先開 discussion 收 feedback 再實作）與 Django（除 docs／tests 外，PR 需先有 accepted ticket）的慣例：**預計實作的新功能或重大變更，先開 issue 與團隊討論、達成共識後才開始實作**。

- 需要 issue-first 的變更：新功能、既有行為變更、API 契約（`packages/shared`）變更、D1 schema migration、新增 Cloudflare binding 或 LLM provider。
- 流程：開 `[feat]` issue → 在 issue 內討論並留下決議 → 團隊同意後實作 → PR 連結該 issue（`Closes #NN`）。
- bug fix 與 docs 可直接開 PR（有對應 issue 就連結）；拿不準算不算「重大」時，先開 issue 問。

## Pull Request

1. Branch 從最新 `main` 切出。
2. PR 標題依 Conventional Commits（例：`feat(web): add stance map export`）；merge 採 squash，PR 標題即最終 commit message。
3. 描述填齊 [PR template](.github/PULL_REQUEST_TEMPLATE.md) 每個 section：「關聯 Issue」附上討論過的 issue；「文件更新」列出本次更新了哪些文件（沒有就寫「無」）。
4. CI（`pnpm lint`、`pnpm typecheck`、`pnpm test`）綠燈後請隊友 review；CODEOWNERS 見 [.github/CODEOWNERS](.github/CODEOWNERS)。
5. Review 意見處理完，由 reviewer merge。

## 文件同步

文件是 SSOT 制：一個事實只寫在一個地方（規則與 SSOT map 見 [docs/AGENTS.md](docs/AGENTS.md)）。改程式時同時問：哪份文件的哪個事實變了？

- 功能合併進 `main` 後三步驟：`docs/roadmap.md` 移除條目 → `docs/changelog.md` 加條目 → `docs/feature.md` 加功能列。
- API 請求／回覆變更 → `docs/api-contract.md`；系統決策變更 → `docs/architecture.md`。
- 文件與程式碼矛盾視同 bug，看到就修（併入相關 PR，或開獨立的 `[docs]` PR）。
- PR template 的「文件更新」填寫與 self-review 的「文件無偏移」checkbox 就是在驗證這件事。

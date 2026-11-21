## 內容與動機（What/Why）

這個 PR 解決什麼問題、如何解決，以及為什麼需要這個變更？
每個被解決的 issue 請使用 "Closes #123" 標記。
請附上測試時產出的成果：before/after 截圖、GIF、影片或 benchmark。

## 設計審查（Design Review）

逐項自問，並在項目下方寫下說明。

- [ ] API 設計是 best practice 嗎？
- [ ] 實作細節是 well-designed 嗎？有沒有更好的設計？
- [ ] 有沒有留下未完成事項，或能做到更完美、杜絕後患的設計？
- [ ] 上述沒有完成的，為何不實作？請給出真正工程上合理的理由。
- [ ] 此次實作中，是否有發現其他問題（包含原始設計就有問題者），但是沒有修復（fix in this PR）或沒有回報（open an issue）？

## 測試（Testing）

請手動測試你的變更並回報結果；必要時註明測試平台。
Reviewer 要如何快速驗證？請提供環境設定與操作步驟。

## 關聯 Issue

新功能與重大變更：請附上與團隊討論過的 issue 連結（流程見 [CONTRIBUTING.md](CONTRIBUTING.md) § issue-first）。
純 docs／chore PR 可寫 N/A。

## 文件更新（Docs）

依 [docs/AGENTS.md](docs/AGENTS.md) 的 SSOT map，列出本次更新了哪些文件；沒有就寫「無」。

## 自我審查（Self-review）

- [ ] 我已檢視自己的 diff，確認品質、安全（security）、可靠度與效能。
- [ ] UI 變更已遵循 checklist。
- [ ] 測試已涵蓋新增或變更的行為。
- [ ] 文件無偏移：該更新的文件都已更新，並列在「文件更新」。

## Release Notes：

- N/A 或 Added/Fixed/Improved ...

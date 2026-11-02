# AGENTS.md — docs/（文件維護規則）

這個目錄是整個專案的**文件 SSOT**。每份文件擁有一個領域；領域知識只出現在一個地方——其他地方用連結，不要複製。

## SSOT 地圖

| 領域                                | 唯一來源          | 更新時機                              |
| ----------------------------------- | ----------------- | ------------------------------------- |
| 功能清單（功能 ↔ 路由 ↔ 頁面）      | `feature.md`      | 新增/修改/移除任何功能時              |
| API 請求/回覆格式                   | `api-contract.md` | 改任何 route 的輸入/輸出時            |
| 系統架構與決策                      | `architecture.md` | 新增 bindings/DO/服務、架構決策變更時 |
| LLM providers（端點/用量/併發/ZDR） | `providers.md`    | 新增/更換 provider、配額或條款查證後  |
| Cloudflare CLI 使用                 | `cf.md`           | cf 工作流變更時                       |
| Pi Durable / PiHarness 使用         | `pi.md`           | pi/agents 版本升級、pi 相關踩坑時     |
| 快速開始（人類用）                  | `../README.md`    | 指令或前置需求變更時                  |

## 規則

- **Never** 在兩份文件寫同一件事——寫其中一份，其他地方放連結（含錨點）
- **Never** 保留過時內容：文件與程式碼/事實不符 = bug，當場修或刪
- **Never** 新建文件而不指定它的領域（先更新上面的 SSOT 地圖）
- 改 API 時：`api-contract.md` 與 `feature.md` 一起看——契約管格式、feature 管存在
- 邊界與禁令（ZDR、金鑰）同時屬於 `providers.md` 與各層 `AGENTS.md`——以 providers.md 為準，AGENTS.md 只放「行動指令」
- 語言：繁體中文（`AGENTS.md` 們為英文，供 agent 閱讀）
- Biome 會格式化 Markdown——格式化後檢查表格與語意沒有被破壞

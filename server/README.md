# server/ — Backend（Bun + Hono）

所有權：`@ntnu-swe-2026-team4/backend`

| 議題 | 內容 |
|---|---|
| #23 | Scaffold：Bun + Hono（:8000）+ Bun.sql + migrations + bun:test |
| #24 | 帳號系統：email 登入（cookie session）+ 三層角色 |
| #25 | 空間與活動骨架：classrooms/archives/activities + FSM + events SSE |

決策依據：ADR-0005（形式 C：pi SDK in-process；§6 條件成立 → Hono）。
API 契約：[`docs/api-contract.md`](../docs/api-contract.md)（前端擁有，變更走 PR）。

# AGENTS.md — docs/ (documentation rules)

This directory is the project's **documentation SSOT**. Each document owns one domain; domain knowledge lives in exactly one place — elsewhere, link to it. Never copy.

## SSOT map

| Domain                                                    | Single source     | Update when                                              |
| --------------------------------------------------------- | ----------------- | -------------------------------------------------------- |
| Feature inventory (current state: feature ↔ route ↔ page) | `feature.md`      | when a feature merges to main (existing & testable only) |
| Vision & planning (not yet built)                         | `roadmap.md`      | when a plan is decided; remove the entry once shipped    |
| Changelog (done)                                          | `changelog.md`    | after a feature merges to main                           |
| API request/response formats                              | `api-contract.md` | when any route's input/output changes                    |
| System architecture & decisions                           | `architecture.md` | when bindings/DOs/services are added or decisions change |
| LLM providers (endpoints/quotas/concurrency/ZDR)          | `providers.md`    | on provider/quota/terms changes or new verifications     |
| Cloudflare CLI usage                                      | `cf.md`           | when the cf workflow changes                             |
| Pi Durable / PiHarness usage                              | `pi.md`           | on pi/agents version bumps and pi-related pitfalls       |
| Quickstart (for humans)                                   | `../README.md`    | when commands or prerequisites change                    |
| Local development (zero-account, DB, dialogue)            | `development.md`  | when the dev flow or local simulation behavior changes   |

## Rules

- **Never** state the same fact in two documents — write it in one, link from the others (anchors welcome).
- **Current state vs. vision**: `feature.md` lists only features that **exist and are testable** (an unwired capability listed there = a bug); ideas, plans, and pending designs belong in `roadmap.md`. On completion, follow three steps: remove the roadmap entry → add a changelog entry → add the feature row.
- **Never** keep stale content: a doc contradicting code/facts is a bug — fix or delete it on sight.
- **Never** create a document without assigning its domain (update the SSOT map first).
- When changing an API, read `api-contract.md` and `feature.md` together — the contract owns formats, feature owns existence.
- Boundaries and prohibitions (ZDR, secrets) appear in both `providers.md` and the per-layer `AGENTS.md` files — `providers.md` is authoritative; AGENTS.md files carry only action directives.
- Biome formats Markdown — after formatting, verify tables and semantics survived.
- **Never** write an ambiguous date. Doc dates, verification stamps, and changelog entries are `YYYY-MM-DD`; a year-month alone is unverifiable, and "recently"/"lately" is not a date.
- **Never** draw diagrams as ASCII art — always use Mermaid (`flowchart` / `sequenceDiagram` / `stateDiagram`, any diagram type). GitHub and most Markdown renderers render it natively.

## Language

- Docs prose is **zh-TW**, but **all technical details are English**: component names, mechanism and architecture terms (e.g. failover, affinity, circuit breaker, ledger, projection, tiering, traffic class, sliding window, hibernation), identifiers, config keys, CLI flags, HTTP semantics. Never coin a Chinese translation for a technical term — the English term is what you grep for and what upstream docs use.
- Use zh-TW where the content is product-level: feature names, user-facing copy, business rationale, spec/product decisions (主題集、老師即時面板、去識別化、停損…).
- No gratuitous English in product prose, no gratuitous Chinese in technical description. If the codebase, the platform, or upstream docs establish an English name for something, use that name.
- This file (and every `AGENTS.md`) is **English only** — they are agent-facing.

# AGENTS.md — packages/llm (prompts & provider settings)

The LLM team's configuration layer, owned by non-engineers too: zero-code by design.

- `prompts/socrates.md` is the Socrates system prompt — injected into the Worker at **build time**; editing requires a redeploy to take effect
- Prompt editing rules:
  - Change one behavior experiment at a time (e.g. only the emotion-tag rules), otherwise effects cannot be attributed
  - The leading emotion tag format `[neutral|happy|confused|angry]` is a **protocol** — `apps/server/src/providers/emotion.ts` depends on it; the format must not change
  - Biome formats this file: after formatting, verify the numbered rules, indentation, and example dialogues still mean what they meant
- `providers/models.json` is read by `runtime/` for the reports (baseUrl, defaultModel, params); dialogue routing still lives in `apps/server/src/providers/whitelist.ts` (read the ZDR rules in `docs/providers.md` before changing models)

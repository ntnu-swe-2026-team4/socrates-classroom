# AGENTS.md — packages/llm（提示詞與 provider 設定）

LLM 組（非工程師也會改）的設定層：zero-code by design。

- `prompts/socrates.md` 是蘇格拉底的 system prompt——**建置期**注入 Worker，改檔後需重新部署才生效
- 編輯提示詞的規則：
  - 一次只改一個行為實驗（例如只調情緒標記規則），否則無法歸因效果
  - 情緒標記格式 `[neutral|happy|confused|angry]` 開頭是**協議**，`apps/server/src/providers/emotion.ts` 依賴它——格式不能動
  - Biome 會格式化此檔：確認格式化後編號、縮排、範例對話的意義不變
- `providers/models.json` 目前僅供文件參考；實際路由在 `apps/server/src/providers/whitelist.ts`（改模型前先讀 `docs/providers.md` 的 ZDR 規則）

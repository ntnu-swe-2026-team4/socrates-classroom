# LLM Providers 紀錄

> 查證日期：2026-11-03（providers.md 首版；後續查證見各節標注）｜ 更新日期：2026-11-08｜ 狀態：供 LLM 組與後端共用的 provider 參考
> 配套文件：[`cf.md`](./cf.md)（Cloudflare CLI）、[`pi.md`](./pi.md)（Pi Durable）

## Pool 定位

| 角色                          | Provider                        | 模型                                                | ZDR                                        |
| ----------------------------- | ------------------------------- | --------------------------------------------------- | ------------------------------------------ |
| 開發專用                      | GLM Coding Plan Global（`zai`） | GLM-5.3 / GLM-5.3-Flash                             | ✗（且條款禁產品後端）                      |
| 生產主力                      | 自架 DGX Spark ×2               | GLM-5.3-Flash EXL3（1M ctx）                        | ✓（資料不出門）                            |
| 第一溢位                      | OpenCode Go（`opencode-go`）    | **鎖 GLM-5.3-Flash**                                | ✓（官方每模型表：0 days）                  |
| 壓底                          | CF Workers AI（`AI` binding）   | `@cf/zai-org/glm-4.7-flash`                         | ✓（官方明文 Zero retention + No training） |
| 雲端 fallback／學生 BYOK 通道 | OpenRouter（`openrouter`）      | `z-ai/glm-5.3-flash`（$0.0285/M in・$0.0923/M out） | ✓（帳戶強制 `zdr` + 官方不留資料）         |

**學生流量（生產鏈）只走後三段（全 ZDR）；Coding Plan 不碰學生資料。**
fallback 必須**鎖模型白名單**（只准 0-day retention 的模型），不能只鎖 provider。

---

## 1. 自架 DGX Spark ×2（生產主力）

- **端點**（來源：`~/.pi/agent/models.json` 的 `dgx-spark-x2`；對外一律經 **Cloudflare Tunnel** 暴露，原文 IP 已移除，內網位址見 team 內部紀錄）：
  - 2× DGX Spark — GLM-5.3-Flash EXL3，1M ctx（僅此一組，無其他 Spark）
- **協定**：`openai-completions`、`apiKey: none`
- **compat 設定**（必抄）：`supportsDeveloperRole: false`、`supportsReasoningEffort: false`、`maxTokensField: "max_tokens"`
- **併發 4**（團隊實測）、token 無上限、ZDR 本質成立
- ✅ **外部連通已定案：Cloudflare Tunnel**（團隊確認會把自架推理服務掛上 Tunnel）。設定時注意：(1) 用 Access policy 限制只有自家 Worker 能呼叫；(2) Tunnel 會多一跳（學生 → CF edge → tunnel → 實驗室網路 → Spark），爆發期延遲要實測；(3) 自架端點的 prompt cache 策略由推理伺服器決定，與 `x-opencode-session` 式親和無關。
- 容量估算：4 併發 × 短回覆（≤3 句）≈ 60–120 輪/分鐘，一班爆發期學生排隊數秒。
- **Serving stack**：[MiaAI-Lab/GLM-5.3-Flash-EXL3-2x-DGX-Sparks-TensorFold](https://github.com/MiaAI-Lab/GLM-5.3-Flash-EXL3-2x-DGX-Sparks-TensorFold)（engine：[ashhart/TensorFold](https://github.com/ashhart/TensorFold)，Zig、CUDA backend；recipe 跑 TensorFold v0.6.0＋96 patches）——2× DGX Spark（GB10 128GB，CX7 互連 TP=2）、4 concurrent、完整 1,048,576-token context、kept-state pool（NVMe spill tier，shared system prompt 跨對話保狀態）
- ⚠️ **容量狀態（2026-11-04，team lead 回報）**：大部分時間 **memory ~95% 滿載**——既有推理（GLM-5.3-Flash EXL3，2× Spark TP=2）已占滿，**不可再加 self-hosted 工作負載**：whisper STT、Clef 判斷模型、TTS 的「自架 DGX」選項全部出局（#55、#56 的自架評估項視同關閉）。自架擴容＝加機器（新 catalog entry），不在現有 DGX 加載。

## 2. OpenCode Go（第一溢位）

- **Provider**：pi 內建 `opencode-go`（env：`OPENCODE_API_KEY`）；端點 `https://opencode.ai/inference/go/…`（依模型走 openai chat completions 或 anthropic-messages）
- **官方用量**（每模型請求估算，依典型用量換算）：
  - Go $10/月：GLM-5.3-Flash **6,320 req/5h**・15,790/週・31,580/月；GLM-5.3 220/5h
  - Go Plus $40/月：GLM-5.3-Flash **18,960/5h**、GLM-5.3 1,760/5h
  - Go Teams $20/人/月：每人獨立額度（約 Go +5%）
- **併發**：未公布數字；設計上多工作階段（要求自報 user-agent + 每對話固定 `x-opencode-session`，可貼 prompt-cache 節點）
- **ZDR（官方每模型 Privacy 表）**：GLM-5.3-Flash／GLM-5.3／GLM-5.2／Kimi／Qwen／MiniMax／MiMo 等 = training: Not used + retention: **0 days** ✅；⚠️ Grok／GPT Luna／Claude Haiku = 30 天、Muse Spark／Iceman = **會拿資料訓練**（不可進 fallback）、DeepSeek = 0 days 但協議按月續約（現至 2026-11-30）
- **條款**：沒有「僅限產品內」硬規定（"designed for OpenCode and other coding agents that produce similar types of requests"），第三方客戶端有官方 Harnesses 文件；我們不是 coding agent 屬灰色地帶，**上線前寄信問官方**
- **客戶端要求**：`User-Agent: socrates-classroom/1.0`（勿用泛用 SDK 名）+ 每對話執行緒一個固定 `x-opencode-session`

## 3. GLM Coding Plan Global（開發專用）

- **Provider**：pi 內建 `zai`（env：`ZAI_API_KEY`）；OpenAI 相容端點 `https://api.z.ai/api/coding/paas/v4`（另有 Anthropic `/api/anthropic`、Responses `/api/v1`）
- **模型**：僅 GLM-5.3、GLM-5.3-Flash（coding plan 限定；一般 BigModel key 要另外自訂 endpoint）
- **用量**：5 小時 + 每週雙窗口。credits 制：Lite 2,000/5h・10,000/週、Pro 12,000・60,000、Max 28,000・140,000；離峰五折，峰時（週一～五 14:00–18:00 UTC+8）Flash 0.4×／5.3 為 1.2×／3×。對話用量用不完
- **併發**：官方不公布數字（只說 Max > Pro > Lite、動態調整）；社群實測 Lite/Pro ≈ **1**、Max 動態約 30，且有 5→2→1 收緊前例（zai-org/GLM-4 #802）
- **條款**：⚠️ 「限官方支援工具與產品環境」（ZCode／Claude Code／Cline／Roo Code／Kilo／Goose／OpenCode…）＋「禁止帳號共享／多用戶」→ **不可當課堂產品後端**，僅開發與老師個人助理
- 錯誤碼對照（cooldown 分類見 `apps/server/src/routing/ledger.ts`）：1302/1305 限流過載、1308/1310/1316/1317 窗口用盡、1313 公平使用限速、1309 訂閱過期

## 4. CF Workers AI（壓底）

- **接入**：`AI` binding——`agents/models/pi-ai` 的 `createAI({ binding, id })`（回 pi-ai Provider，id `cloudflare`，靜態清單＝全部 Workers AI id）；直接 `env.AI.run` 亦可
- **免費額度（2026-11-05 官方 pricing/limits 查證）**：**10,000 Neurons/day**（Free 與 Paid 方案皆有，00:00 UTC 重置）；超過按 **$0.011/1k Neurons**（需 Workers Paid）。⚠️ **local dev（wrangler/vite remote）的推論也計入 limits**
- **付費模型清單**（需 Workers Paid **或** 預付 AI Gateway credits）：`@cf/zai-org/glm-5.2`／`glm-5.3`／**`glm-5.3-flash`**、`@cf/moonshotai/kimi-k2.6`／`kimi-k2.7-code`、`@cf/deepseek-ai/deepseek-v4*`——**注意：`@cf/zai-org/glm-4.7-flash` 不在清單（免費 neurons 可用）**
- **速率**：文字生成預設 **300 req/min**；付費清單模型：標準計費 **20 req/min**、預付 credits **50 req/min**（每帳號每模型）
- **壓底策略（同模型不換腦）**：`@cf/zai-org/glm-5.3-flash`＝與自架頭部同模型（failover 語氣連續）→ 排第一，402/403（未付費）由 breaker 降級 → `glm-4.7-flash`（免費 neurons、300 rpm）收尾。5.3-flash 是否可用取決於帳號方案，catalog 兩個都列
- **AI Gateway credits（2026-11-05 官方 Unified Billing）**：**純預付、無免費月度額度**，購買收 5% 手續費（僅信用卡）；推論價格 pass-through。Web Search API（ceramic $0.25/1k）與付費清單模型都吃這個——**402 web_search_payment_required＝credits 為零**，載入後即通
- **語音模型（#56/#69，2026-11-05 官方目錄查證）**：
  - STT：`@cf/openai/whisper-large-v3-turbo`（ZDR yes、$0.000513/audio-min）；binding 輸入＝base64 字串（schema `audio: string｜{body,contentType}`）
  - TTS：`@cf/myshell-ai/melotts`（ZDR yes、$0.000205/audio-min、zh 支援）；binding 參數 `prompt`＋`lang`，回 base64 WAV 文字流——**已實測**（216KB WAV→whisper 閉環轉錄）
- **ZDR**：官方明文「Zero data retention」+「No training」；⚠️ 例外：**AI Gateway 開 logging/caching 會存內容**——學生流量不要開

## 5. OpenRouter（聚合器／BYOK 路由）

- **接入**：pi 內建 `openrouter`（env：`OPENROUTER_API_KEY`）；Cloudflare AI Gateway 的 provider-native 清單也含 OpenRouter（可直接 BYOK 走 gateway）
- **GLM 可用性與價格**：`z-ai/glm-5.3-flash` $0.0285/M input・$0.0923/M output（1M ctx，**比 Workers AI 的 glm-4.7-flash 便宜一半以上**，且就是自架同款模型）；35+ providers 自動 failover、3 天 uptime 100%；`z-ai/glm-5.3` $0.0699/$1.40；`GLM Flash Latest` 自動跟最新；batch 版再低（$0.05/$0.18）
- **速率**：付費模型無固定帳號 RPM（全域容量調度、依模型不同）；免費 `:free` 模型才有 20 RPM・50–1000 req/day
- **ZDR**：帳戶／guardrail／per-request 可強制 `zdr: true`——只路由到 0-day 端點、失敗就報錯（fail closed）；OpenRouter 本身不留 prompts/responses（除非自願開 logging 或同意資料使用換 1% 折扣——**保持關閉**）；訓練選擇退出是帳戶級設定（付費／免費分開）
- **BYOK**：60+ providers；免平台費額度按 list-price 推理價值計（Pay-as-you-go **$25k/月**、Enterprise $200k），超出收 5%；可選 key 額度用盡時 failover 回 OpenRouter 路由

## 6. BYOK 模式（三種層次）

| 層次                            | 機制                                                                                                | 適用                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| AI Gateway BYOK                 | key 存 CF gateway，Worker 完全不碰 key；僅限 provider-native 清單（**無智譜**）                     | 想統一觀測/計費且只用清單內 provider 時                                                 |
| OpenRouter BYOK                 | 60+ providers、統一 API 與分析；$25k/月內免費、之後 5%                                              | 用自己的 Z.AI/其他 key 但要 OpenRouter 的路由與 failover                                |
| **產品級 BYOK（學生自帶 key）** | 學生填自己的 OpenRouter key（加密存 D1），每請求帶自己的 key + 強制 `zdr`；沒 key 的學生走班級 pool | **課堂最乾淨的合規解**：一人一帳號，共享條款與額度問題消失；班級 pool 只當公用 fallback |

## 7. Judgment 模型（逐輪違規判斷）

- **基準**：以下內容基於 commit [`e899b03`](https://github.com/ntnu-swe-2026-team4/socrates-classroom/commit/e899b03acbfde76014a7615a41ab2892179c9b47) 的當前狀況撰寫
- **用途**：#71 逐輪違規標記——每則 assistant reply 後背景非同步分類，不進對話主迴圈（[#71](https://github.com/ntnu-swe-2026-team4/socrates-classroom/issues/71)；設計見 [`architecture.md`](./architecture.md) §13 D9）。avatar 的 emotion 分類同樣用 Clef-flash（[`avatar/index.ts`](../apps/server/src/pi/extensions/avatar/index.ts)，2026-11-08 檢查）。violation 分類會讀到學生原話，適用與 generation 相同的 ZDR 硬門檻（不過就出局）
- **候選**：

| 候選                 | Provider                      | 模型                                  | ZDR                         | Input 價格                 | 定位                                                                                     |
| -------------------- | ----------------------------- | ------------------------------------- | --------------------------- | -------------------------- | ---------------------------------------------------------------------------------------- |
| Clef-flash           | CF Workers AI（`AI` binding） | `@cf/cloudflare/clef-flash`（9B）     | ✓（官方明文，見 7.1）       | $0.038/M・3,455 neurons/M  | 主力（[`providers.config.yaml`](../apps/server/providers.config.yaml) 的 `classifiers`） |
| Clef                 | CF Workers AI（`AI` binding） | `@cf/cloudflare/clef`（27B）          | ✓（官方明文，見 7.1）       | $0.240/M・21,818 neurons/M | 備選（未設定）                                                                           |
| Jev（直連）          | TypeSafe（`api.typesafe.ai`） | `jev-latest`（alias → `jev-1.14.0`）  | ✗（一般帳戶無 ZDR，見 7.2） | $0.042/M                   | 不通過（程式碼未接線）                                                                   |
| Jev（經 OpenCode）   | OpenCode Zen                  | `jev-1.13`／`jev-1.13-free`           | ⚠️ 未證實（見 7.2）         | $0.042/M（free 限時）      | 未證實、未接線                                                                           |
| Jev（經 Workers AI） | CF Workers AI（REST）         | `typesafe/jev`／`typesafe/jev-1.14.0` | ⚠️ 未證實（見 7.2）         | $0.042/M                   | 未證實、未接線；Cloudflare 官方目錄未列出                                                |

- **自架 DGX**：容量出局，見 §1
- **延遲（2026-11-08 實測）**：自本機經 REST 依序呼叫，每組 20 次，單題 `choice`（五選項，同 violation 分類）；輸入分短句（15 字）與長文（2,000 字，即 [`classify.ts`](../apps/server/src/pi/extensions/judgment/classify.ts) 的截斷上限）。單位 ms；「暖機」為不計入統計的第 1 次請求；120 次請求全數回 200。

  | 模型                                | 輸入 | n   | min | p50 | p95   | max   | 暖機  |
  | ----------------------------------- | ---- | --- | --- | --- | ----- | ----- | ----- |
  | Clef-flash                          | 短句 | 20  | 192 | 216 | 365   | 376   | 1,280 |
  | Clef-flash                          | 長文 | 20  | 205 | 227 | 319   | 1,154 | 258   |
  | Clef                                | 短句 | 20  | 332 | 524 | 1,145 | 1,779 | 1,357 |
  | Clef                                | 長文 | 20  | 299 | 540 | 1,025 | 1,546 | 1,245 |
  | Jev（`jev-1.13-free`，經 OpenCode） | 短句 | 20  | 418 | 464 | 578   | 637   | 787   |
  | Jev（`jev-1.13-free`，經 OpenCode） | 長文 | 20  | 447 | 479 | 629   | 1,972 | 602   |

  條件限制：量到的是本機公網往返加推論，不等於正式環境 Worker 以 binding 呼叫的延遲；n=20 時 p95 實為第二大值，僅供模型間相對比較；Jev 只測經 OpenCode 的 free 版，直連與經 Workers AI 未測

### 7.1 Clef

- **Clef 是什麼**：Cloudflare 自訓的 decision model（非 text generation）——讀入 `state` 與一組 typed questions，回傳每個允許選項的 probability；Clef 27B、Clef-flash 9B，2026-10-01 發布於 Workers AI，權重以 Apache 2.0 開源於 Hugging Face；沿用 System One API，可由 Jev 整合改端點與 model 切換（[發布文](https://blog.cloudflare.com/clef-decision-models/)、[changelog](https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/)；Clef-flash 模型卡標示 Apache-2.0、base model 為 Qwen3.5-9B：[Hugging Face](https://huggingface.co/Cloudflare/clef-flash)；2026-11-08 查證）
- **Clef context window**：`clef` 65,536 tokens、`clef-flash` **24,576** tokens、`clef-omni` 64,000 tokens（[clef](https://developers.cloudflare.com/workers-ai/models/clef/)、[clef-flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/)、[clef-omni](https://developers.cloudflare.com/workers-ai/models/clef-omni/)；2026-11-08 查證）。⚠️ 2026-10-01 的 [changelog](https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/) 表格寫 `clef`、`clef-flash` 皆為 64K，與 `clef-flash` 模型頁不一致；本文件採模型頁數字，pi-ai 1.5.0 catalog 的數字相同（[#55 留言](https://github.com/ntnu-swe-2026-team4/socrates-classroom/issues/55#issuecomment-6709993905)；套件原始檔，2026-11-08）
- **Clef 接入（現行程式碼）**：Workers AI binding，`env.AI.run(model, { state, questions })`；model ID 由 [`providers.config.yaml`](../apps/server/providers.config.yaml) 的 `classifiers.violation`／`classifiers.emotion` 決定，目前皆為 `@cf/cloudflare/clef-flash`；呼叫在 [`judgment/classify.ts`](../apps/server/src/pi/extensions/judgment/classify.ts) 與 [`avatar/index.ts`](../apps/server/src/pi/extensions/avatar/index.ts)（2026-11-08 檢查）
- **Clef 接入（替代方案）**：pi-ai 1.5 的 builtin catalog 含 `@cf/cloudflare/clef`／`clef-flash`／`clef-omni`（api `cloudflare-workers-ai-system-one`），以 REST `POST /accounts/{account}/ai/run` 呼叫，需 account id 與 API token；binding 版不需 env token，兩者擇一尚未決定（[#55 留言](https://github.com/ntnu-swe-2026-team4/socrates-classroom/issues/55#issuecomment-6709993905)，2026-11-07；pi-ai 1.5.0 套件原始檔，2026-11-08）。請求形狀見 [input schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-input.json)
- **Clef 題型**：每次請求 1 到 64 題；`noul`（yes/no，回 yes 的 probability）、`choice`（2 到 255 個選項，回選中選項、各選項 probability 與 confidence）、`score`（2 到 10 級，回加權分數）（[changelog](https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/)、[input schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-input.json)、[output schema](https://developers.cloudflare.com/workers-ai/models/clef/schema-output.json)；2026-11-08 查證）。本專案用 `choice`：violation 選項即 [`ViolationType`](../packages/shared/src/index.ts)，emotion 選項為 `happy`／`angry`／`confused`／`neutral`（[`avatar/index.ts`](../apps/server/src/pi/extensions/avatar/index.ts)，2026-11-08 檢查）
- **Clef 送出的內容**：violation 分類只送 `state: { latest }`——學生最新一句，截斷至 2000 字，**不含對話歷史**（[`judgment/classify.ts`](../apps/server/src/pi/extensions/judgment/classify.ts)，2026-11-08 檢查）；emotion 分類送的是 **assistant 回覆文字**，不是學生輸入（[`avatar/index.ts`](../apps/server/src/pi/extensions/avatar/index.ts) 的 `answerOf`，2026-11-08 檢查）
- **Clef 價格與額度**：Input 價格見上表，output 不計費（「Clef models do not charge for output tokens」）；共用 Workers AI 帳號層級的 **10,000 Neurons/day** 免費額度，見 §4；Clef 兩款不在 pricing 頁「需付費」清單內（[定價](https://developers.cloudflare.com/workers-ai/platform/pricing/)，頁面標示 2026-10-20 更新；[clef](https://developers.cloudflare.com/workers-ai/models/clef/)、[clef-flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/)；2026-11-08 查證）
- **Clef ZDR**：
  - 模型頁：`clef`、`clef-flash`、`clef-omni` 皆標「Zero data retention: Yes」（[clef](https://developers.cloudflare.com/workers-ai/models/clef/)、[clef-flash](https://developers.cloudflare.com/workers-ai/models/clef-flash/)、[clef-omni](https://developers.cloudflare.com/workers-ai/models/clef-omni/)；2026-11-08 查證）
  - 發布文：「we don’t read, store, or train on your requests or responses (unless you want to use our fine-tuning product, which we go into below)」（[發布文](https://blog.cloudflare.com/clef-decision-models/)；2026-11-08 查證）
  - Data usage 頁（2026-10-16 更新）：「For standard inference requests that do not invoke a stateful feature, Cloudflare does not retain inputs or outputs after they are no longer needed to process the request and deliver the response, subject to the limited exceptions below」，並寫「No training: Cloudflare does not use Customer Content processed by Workers AI to train AI models」。⚠️ 承諾不排除由你指示的儲存：使用 R2／KV／Durable Objects／Vectorize、在 AI Gateway 開 logging 或 caching、把內容寫進應用程式日誌、使用 asynchronous 或 batch 功能、上傳檔案或 adapters、其他 stateful 功能時，Customer Content 可能被儲存。另可能保留 operational metadata（account 與 model identifiers、timestamps、request 與 response sizes、token 或 neuron 數、latency、request source、normalized status 或 error codes），不含 Customer Content；為履行法律義務而分析或保留的內容不用於訓練（[Data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)；2026-11-08 查證）
- **Clef 約束**：⚠️ 呼叫不得經 AI Gateway（binding 或 REST 皆同，會落入 logging／caching 例外，見 §4 ZDR）；report 批次評分不得使用 Workers AI 的 asynchronous 或 batch 功能。現況：`classify.ts`、`avatar/index.ts` 以 `ai.run` 直呼、未指定 gateway；`apps/server/src` 未找到 asynchronous／batch 呼叫（唯一的 `gatewayId` 在 `websearch` 的網頁搜尋，不是 Clef 呼叫），`oneshot` 的 traffic class `batch` 是 router 內部分類（2026-11-08 檢查：[`classify.ts`](../apps/server/src/pi/extensions/judgment/classify.ts)、[`oneshot.ts`](../apps/server/src/routing/oneshot.ts)；例外依據：[Data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)）
- **Clef 資料位置**：⚠️ 發布文與 Data usage 頁沒有 region／data residency 的說明；changelog 只寫「Requests run on GPUs across Cloudflare's network, running close to your users」（[發布文](https://blog.cloudflare.com/clef-decision-models/)、[Data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)、[changelog](https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/)；2026-11-08 查證）。學生可能為未成年人，資料位置屬未決風險，與 #57（去識別化）、#70（ToS）一併決定
- **Clef-omni（非候選）**：30B MoE（3B active），可讀 audio（最多 4 段，每段 8 MiB 且 300 秒）與 video（最多 2 段，每段 16 MiB 且 60 秒）；$0.15/M、13,636 neurons/M；ZDR 標「Yes」；本專案只處理文字，不列入候選（[clef-omni](https://developers.cloudflare.com/workers-ai/models/clef-omni/)、[定價](https://developers.cloudflare.com/workers-ai/platform/pricing/)；2026-11-08 查證）

### 7.2 Jev

- **Jev 是什麼**：TypeSafe AI 的 System One model，與 Clef 同類（輸出 typed decisions 與 probabilities，非 text generation）。Jev 1.14 為最新版，2026-10-14 起提供；model ID `jev-1.14.0`、`jev-1.13.0`；alias `jev-latest`、`jev-preview` 目前皆指向 `jev-1.14.0`，**隨版本移動**，`jev-preview` 在有預覽版時會領先 `jev-latest`（[models](https://docs.typesafe.ai/models.md)、[typesafe.ai](https://typesafe.ai/)、[Cloudflare 發布文](https://blog.cloudflare.com/clef-decision-models/)；2026-11-08 查證）
- **Jev 接入路徑（三條）**：
  - 直連 TypeSafe：`POST https://api.typesafe.ai/v1/systemone`，Bearer API key（[quickstart](https://docs.typesafe.ai/introduction/quickstart.md)；2026-11-08 查證）；pi-ai 1.5.0 的 `typesafe` provider 為同一位址，model `jev-latest`、env `TYPESAFE_API_KEY`（套件原始檔，2026-11-07）
  - 經 OpenCode Zen：`jev-1.13`（input $0.042、output Free）與 `jev-1.13-free`，端點 `https://opencode.ai/inference/systemone/v1/systemone`；「Jev 1.13 Free is available on OpenCode for a limited time」（[Zen](https://opencode.ai/docs/zen/)；2026-11-08 查證）
  - 經 Workers AI：pi-ai 1.5.0 的 `cloudflare-workers-ai` catalog 列出 `typesafe/jev`、`typesafe/jev-1.14.0`（context 32,000、$0.042/M），[#55 留言](https://github.com/ntnu-swe-2026-team4/socrates-classroom/issues/55#issuecomment-6709993905)同樣列出（套件原始檔，2026-11-08）；但 Cloudflare 的[模型目錄](https://developers.cloudflare.com/workers-ai/models/)與[定價頁](https://developers.cloudflare.com/workers-ai/platform/pricing/)均未列出此模型（2026-11-08 查證）
- **Jev 現行程式碼**：沒有任何 Jev 接線——`jev.ts` 已移除，[`providers.config.yaml`](../apps/server/providers.config.yaml) 的 `classifiers` 只有 `@cf/cloudflare/clef-flash`，`apps`、`packages` 的程式碼與設定找不到 `typesafe`／`jev`（`git grep` 2026-11-08）
- **Jev 價格與限制**：Input $0.042/M、output 免費；context 每請求 64k、每題 32k，加 `TypeSafe-Danger-Zone-Long-Context: true` header 可提高至 262k；rate limit 依組織設定（tokens per second 與 requests per second），超過回 `429`（[models](https://docs.typesafe.ai/models.md)）；單一請求 body 上限 32 MiB，超過回 `413`（[errors](https://docs.typesafe.ai/api/errors.md)）（2026-11-08 查證）
- **Jev ZDR（直連）**：⚠️ **一般帳戶沒有 ZDR**。
  - 官方文件：「Jev is not trained on customer requests or responses」（[models](https://docs.typesafe.ai/models.md) 的 Data handling）；「We also offer zero data retention (ZDR) for enterprise customers」，需填 support request form（[legal](https://docs.typesafe.ai/legal.md)；2026-11-08 查證）
  - 隱私政策（2025-11-19 更新）：「We retain personal data about you for as long as reasonably necessary to provide you with the Services, or otherwise in support of our business or commercial purposes」；可應要求刪除或去識別化，法律要求保留者除外；「We will not train or fine tune any artificial intelligence or machine learning models on your prompts or other Input」；用途包含「To generate anonymized or aggregated data that we may use for lawful purposes」（[Privacy Policy](https://typesafe.ai/legal/privacy)；2026-11-08 查證）
  - DPA（2026-04-24 更新）：「Customer Personal Data will be retained for as long as necessary taking into account the purpose of the Processing, and in compliance with applicable laws」，未載明保留天數（[DPA](https://typesafe.ai/legal/data-processing)；2026-11-08 查證）
  - → 不符合 ZDR 硬門檻
- **Jev 資料位置與兒童條款（直連）**：隱私政策寫「The Services are hosted in the United States」，並聲明「We do not knowingly collect, maintain, or use personal data from children under 18 years of age, and no part of the Services is directed to children」（[Privacy Policy](https://typesafe.ai/legal/privacy)；2026-11-08 查證）。學生可能為未成年人，屬使用範圍衝突風險。DPA 對 subprocessors 採一般授權，清單見 [Trust Center](https://trust.typesafe.ai/subprocessors)（[DPA](https://typesafe.ai/legal/data-processing)）
- **Jev 經 OpenCode**：Zen 的 Privacy 段落寫「All our models are hosted in the US and EU. Our providers follow a zero-retention policy and do not use your data for model training, with the following exceptions」，例外清單（Big Pickle、Iceman Free、Inkling 2 Small Free、Crouton Alpha Free、Flint 40B Free、MiMo-V2.6-Flash Free、NVIDIA free endpoints、OpenAI／Anthropic／Mistral APIs、Beam Free）**沒有 Jev**，但頁面沒有 Jev 專屬的隱私聲明，也未說明由 OpenCode 自行託管或轉送 TypeSafe，版本停在 1.13（[Zen](https://opencode.ai/docs/zen/)；2026-11-08 查證）。⚠️ 未證實，程式碼未接這條路
- **Jev 經 Workers AI**：Data usage 頁寫「Cloudflare does not create or train the third-party AI models made available through Workers AI. Those models may be subject to open source, acceptable use policies, or other license terms between you and the model provider.」，同頁沒有寫明 ZDR 是否適用第三方託管模型（[Data usage](https://developers.cloudflare.com/workers-ai/platform/data-usage/)；2026-11-08 查證）。⚠️ 託管方與資料條款未知；`typesafe/jev` 是否真的由 Workers AI 提供尚未確認
- **Jev 結論與約束**：直連路徑未通過 ZDR 硬門檻，經 OpenCode、經 Workers AI 兩條路徑未證實。⚠️ `providers.config.yaml` 的 `classifiers`（以及任何 provider catalog）**不得加入 Jev**（`jev-latest`、OpenCode 的 `jev-1.13*`、`typesafe/jev*` 皆是）；日後若取得 TypeSafe 的 enterprise ZDR 書面承諾，或 OpenCode／Cloudflare 對 Jev 提出專屬的 zero-retention 聲明，再重新評估（依據：上列各條與其來源）

---

1. **學生流量鏈**：自架（4 併發 + CF Tunnel + 佇列）→ opencode-go（鎖 `glm-5.3-flash`）→ OpenRouter（強制 `zdr:true`、鎖 `z-ai/glm-5.3-flash`）→ Workers AI。四段全 ZDR。
2. **學生 BYOK**：有 key 的學生優先走自己的 OpenRouter key（帳戶隔離、無共享條款問題）；班級 pool 只當公用 fallback。
3. **模型白名單**（可進 fallback 的）：GLM-5.3-Flash、GLM-5.3、GLM-5.2、Kimi／Qwen／MiniMax／MiMo 等 0-day retention 模型。禁入：Muse Spark、Iceman（會訓練）、Grok／GPT Luna／Claude Haiku（30 天）。
4. **開發流量**：Coding Plan 優先（額度大、離峰五折），任何 provider 皆可。
5. **應用層限流**：保留每人 20 req/min（`server/src/services/dialogue.ts`）；併發閘對自架 = 4、對未公布併發的雲端 provider 以 429 為準自動 fallback。

## 待辦 / 未定

- [ ] 上線前 email OpenCode 確認 Go 用於非 coding-agent 產品後端的立場
- [ ] Cloudflare Tunnel 設定（團隊自建）——記得套 Access policy 限制僅自家 Worker 可呼叫
- [ ] opencode-go 的實際併發實測（官方無數字）
- [x] BYOK 定案（2026-11-06，#82）：teacher keys（一 provider 一把 key，D1 AES-GCM）；**學生無 BYOK 入口**
- [x] runtime 設定層：已定案 `providers.config.yaml`（build-time 編譯，provider×credential×priority×traffic class；2026-11-06）——whitelist/pool.ts 退役，准入由 YAML providers 節把關
- [x] server-side TTS 選型查證：**已定案 `@cf/myshell-ai/melotts`**（ZDR yes、$0.000205/audio-min、zh 支援；2026-11-05 官方目錄查證＋實測閉環，見 §4 語音模型；自架 DGX 已出局）
- [x] #55 Clef／Clef-flash ZDR 查證：**已完成**（官方明文零保留／不訓練；例外、約束與資料位置見 §7.1；2026-11-08）
- [ ] judgment 流量的資料位置（region）確認（官方未說明）
- [x] #55 Jev ZDR 查證：**已完成**（直連 ✗；經 OpenCode、經 Workers AI 未證實；見 §7.2；2026-11-08）
- [ ] 確認 `typesafe/jev` 是否真的由 Workers AI 提供（pi-ai catalog 列出，Cloudflare 官方目錄與定價頁查無）

## 來源

- OpenCode Go（方案／用量表／Privacy 每模型表／客戶端要求）：https://opencode.ai/docs/go/
- pi × OpenCode：https://opencode.ai/v2/docs/console/harnesses/pi/
- Z.AI Coding Plan（用量／credits）：https://docs.z.ai/devpack/overview
- Z.AI Usage Policy（併發原則／共享禁令）：https://docs.z.ai/devpack/usage-policy
- Z.AI 支援工具清單：https://docs.z.ai/devpack/tool/others
- Z.AI 錯誤碼：https://docs.z.ai/api-reference/api-code
- Workers AI 速率限制：https://developers.cloudflare.com/workers-ai/platform/limits/
- Workers AI 隱私（Zero retention / No training）：https://developers.cloudflare.com/workers-ai/platform/privacy/
- OpenRouter GLM 模型頁（價格/providers/EU 路由）：https://openrouter.ai/z-ai/glm-5.3-flash
- OpenRouter BYOK：https://openrouter.ai/docs/guides/overview/auth/byok
- OpenRouter ZDR：https://openrouter.ai/docs/guides/features/zdr
- OpenRouter 速率限制：https://openrouter.ai/docs/api-reference/limits
- Workers AI GLM 模型頁：https://developers.cloudflare.com/ai/models/%40cf/zai-org/glm-5.3/
- Clef 發布文（ZDR 保證）：https://blog.cloudflare.com/clef-decision-models/
- Clef changelog（model ID／題型／參數量）：https://developers.cloudflare.com/changelog/post/2026-10-01-clef-workers-ai/
- Workers AI 定價（Clef／Clef-flash 價格與 neurons）：https://developers.cloudflare.com/workers-ai/platform/pricing/
- Clef-flash 開放權重（Apache-2.0）：https://huggingface.co/Cloudflare/clef-flash
- Jev 模型與價格（端點／版本／別名）：https://docs.typesafe.ai/models.md
- Jev 法務與資料處理（ZDR 僅企業）：https://docs.typesafe.ai/legal.md
- TypeSafe Privacy Policy：https://typesafe.ai/legal/privacy
- TypeSafe DPA：https://typesafe.ai/legal/data-processing
- OpenCode Zen（Jev 模型與 Privacy 段落）：https://opencode.ai/docs/zen/
- Workers AI Clef 模型頁（context／價格／ZDR 欄位）：https://developers.cloudflare.com/workers-ai/models/clef/
- Workers AI Clef-flash 模型頁：https://developers.cloudflare.com/workers-ai/models/clef-flash/
- Workers AI Clef-omni 模型頁：https://developers.cloudflare.com/workers-ai/models/clef-omni/
- Clef input schema（題型／限制）：https://developers.cloudflare.com/workers-ai/models/clef/schema-input.json
- Clef output schema（回應形狀）：https://developers.cloudflare.com/workers-ai/models/clef/schema-output.json
- Workers AI 資料使用（ZDR 例外／第三方模型）：https://developers.cloudflare.com/workers-ai/platform/data-usage/
- Workers AI 模型目錄：https://developers.cloudflare.com/workers-ai/models/
- TypeSafe 首頁：https://typesafe.ai/
- TypeSafe quickstart（端點）：https://docs.typesafe.ai/introduction/quickstart.md
- TypeSafe Trust Center（subprocessors）：https://trust.typesafe.ai/subprocessors
- #55 留言（pi-ai builtin classifier models，2026-11-07）：https://github.com/ntnu-swe-2026-team4/socrates-classroom/issues/55#issuecomment-6709993905

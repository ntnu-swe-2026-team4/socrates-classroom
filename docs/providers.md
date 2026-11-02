# LLM Providers 紀錄

> 查證日期：2026-11 ｜ 狀態：供 LLM 組與後端共用的 provider 參考
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

- **端點**（來源：`~/.pi/agent/models.json` 的 `dgx-spark-x2`）：
  - `http://100.102.84.36:8888/v1` — 2× DGX Spark，GLM-5.3-Flash EXL3，1M ctx（Tailscale IP）
  - `http://192.168.101.70:8888/v1` — 1× DGX Spark，DeepSeek V4 Flash，384k ctx（內網 IP）
- **協定**：`openai-completions`、`apiKey: none`
- **compat 設定**（必抄）：`supportsDeveloperRole: false`、`supportsReasoningEffort: false`、`maxTokensField: "max_tokens"`
- **併發 4**（團隊實測）、token 無上限、ZDR 本質成立
- ✅ **外部連通已定案：Cloudflare Tunnel**（團隊確認會把自架推理服務掛上 Tunnel）。設定時注意：(1) 用 Access policy 限制只有自家 Worker 能呼叫；(2) Tunnel 會多一跳（學生 → CF edge → tunnel → 實驗室網路 → Spark），爆發期延遲要實測；(3) 自架端點的 prompt cache 策略由推理伺服器決定，與 `x-opencode-session` 式親和無關。
- 容量估算：4 併發 × 短回覆（≤3 句）≈ 60–120 輪/分鐘，一班爆發期學生排隊數秒。

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
- 錯誤碼對照（分類見 `apps/server/src/providers/pool.ts`）：1302/1305 限流過載、1308/1310/1316/1317 窗口用盡、1313 公平使用限速、1309 訂閱過期

## 4. CF Workers AI（壓底）

- **接入**：`AI` binding（`agents/models/pi-ai` 的 `createAI` 或直接 `env.AI.run`）
- **模型**：`@cf/zai-org/glm-4.7-flash`（約 $0.0605/M input、$0.40/M output）；`@cf/zai-org/glm-5.3`（1M ctx，需 Workers 付費方案）
- **速率**：文字生成預設 **300 req/min**；需付費方案的模型：標準計費 **20 req/min**、預付 AI Gateway credits **50 req/min**（每帳號每模型）——整班爆發期要吃預付 credits
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
- [ ] 產品級 BYOK：學生 key 的加密儲存（D1）與 `zdr` 強制路由設計
- [ ] `CLASS_POOL`（`apps/server/src/providers/whitelist.ts`）之外是否需要更多 runtime 設定層（模型/併發目前寫死在 pool.ts）

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

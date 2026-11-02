/**
 * Pi Durable 最小範例：一個對話執行緒 = 一個 Durable Object instance。
 * 對應 docs/cf-migration.md Phase 1/2 的形狀；prompt 先寫死，正式版改讀 llm/prompts/。
 *
 * 依據官方文件範例（agents/harnesses/pi）改寫，版本錨定：
 *   agents ^0.32.0 ↔ @earendil-works/pi-* ~1.4.0
 */
import { DurableObject } from "cloudflare:workers";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { createAI } from "agents/models/pi-ai";

/** glm-4.7-flash：免費額度內可跑、多語系；要 1M context 換 @cf/zai-org/glm-5.3（需付費方案）。 */
const MODEL_ID = "@cf/zai-org/glm-4.7-flash";

/** 正式版：從 llm/prompts/socrates.md build-time import（?raw），LLM 組照舊改檔即部署生效。 */
const PREAMBLE = `你是蘇格拉底，正在和一位學生進行哲學對話。你的目標不是給答案，而是用提問幫學生把自己的想法想清楚。
一次只問一個問題；先釐清學生的主張與理由，再檢驗它站不站得住、有沒有例外。
語氣溫和、好奇、帶一點幽默；不說教、不長篇大論。
每次回覆控制在三句話以內（約 80 字），最後以一個問題結尾。用繁體中文回覆。`;

export interface Env {
  AI: Ai;
  PiAgent: DurableObjectNamespace<PiAgent>;
}

export class PiAgent extends DurableObject<Env> {
  /** Workers AI 經 pi-ai provider：免 GLM key，請求走 AI binding。 */
  readonly ai = createAI({ binding: this.env.AI });
  readonly registry = createRegistry();

  readonly harness = new PiHarness({
    // factory 在物件啟動時執行（storage 錯誤重開時會再跑一次），要可以重複執行。
    harness: ({ storage, context, onWake }) => {
      // Pi extension：system prompt section。之後工具（題庫查詢等）也掛在這個 registry。
      this.registry.install({
        name: "socrates",
        sections: [{ key: "preamble", render: () => PREAMBLE, tag: false }],
      });
      const models = createModels();
      models.setProvider(this.ai.provider);
      return Harness.open(
        storage,
        {
          models,
          registry: this.registry,
          onWake, // Pi 睡中（重試退避等）靠物件的 alarm 叫醒，物件其他時間可以休眠
          settings: {
            // 指數退避：1、2、4、8、16 秒，模型限流約有 30 秒恢復窗口
            retry: { enabled: true, maxRetries: 5, baseDelayMs: 1000 },
          },
          onReport: (error) => console.warn("pi report", error),
        },
        context,
      );
    },
    defaults: { model: this.ai(MODEL_ID), thinkingLevel: "low" },
  });

  readonly lifecycle = Lifecycle.install(this).use(this.harness);

  /** 送 prompt 進 root session 並等答案；正式版對話端點改用 session.events() 串 SSE。 */
  async ask(prompt: string): Promise<string> {
    const { text, status, reason } = await this.harness.prompt(prompt);
    // 沒有模型、模型失敗且重試用盡時是 unanswered；把原因帶回給呼叫端。
    if (text === undefined) throw new Error(`unanswered: ${status}${reason ? ` (${reason})` : ""}`);
    return text;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/ask" && request.method === "POST") {
      const body = (await request.json().catch(() => ({}))) as { prompt?: string; thread?: string };
      const prompt = body.prompt?.trim();
      if (!prompt) return Response.json({ error: "prompt_required" }, { status: 422 });
      // 一個對話執行緒一個 DO instance；同名 thread 自動續用同一份 transcript。
      const agent = env.PiAgent.getByName(body.thread?.trim() || "demo");
      return Response.json({ text: await agent.ask(prompt) });
    }
    return Response.json({ ok: true, usage: "POST /api/ask { prompt, thread? }" });
  },
} satisfies ExportedHandler<Env>;

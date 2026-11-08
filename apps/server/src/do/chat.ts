import { DurableObject } from "cloudflare:workers";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import {
  fauxAssistantMessage,
  fauxText,
  fauxToolCall,
  type AssistantMessage,
  type Message,
  type TextContent,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { WebSockets } from "agents/websockets";
import type { Env } from "../env";
import { createAvatarExtension } from "../pi/extensions/avatar";
import { createJudgmentExtension } from "../pi/extensions/judgment";
import { createWebSearchExtension } from "../pi/extensions/websearch";
import { socratesExtension } from "../pi/extensions/socrates";
import { buildModels } from "../pi/models";
import { ChatSockets } from "../ws/sockets";

export class Chat extends DurableObject<Env> {
  readonly registry = createRegistry();
  readonly models = buildModels(this.env);

  readonly harness = new PiHarness({
    harness: ({ storage, context, onWake }) => {
      this.registry.install(socratesExtension());
      this.registry.install(createAvatarExtension(this.env.AI));
      this.registry.install(
        createJudgmentExtension(this.env.AI, async (violation) => {
          console.warn("[judgment:sink]", JSON.stringify(violation));
        }),
      );
      this.registry.install(createWebSearchExtension(this.env.AI));
      return Harness.open(
        storage,
        {
          models: this.models.models,
          registry: this.registry,
          onWake,
          settings: {
            retry: { enabled: true, maxRetries: 5, baseDelayMs: 1000 },
            afterFailedRun: "continue",
          },
          onReport: (report) => console.warn("[pi]", report),
        },
        context,
      );
    },
    defaults: { model: this.models.default, thinkingLevel: "low" },
  });

  readonly sockets = new ChatSockets(this.harness, this.registry, (tag) => this.ctx.getWebSockets(tag));
  readonly webSockets = new WebSockets(this.sockets.options());
  readonly lifecycle = Lifecycle.install(this).use(this.webSockets).use(this.harness);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (this.models.faux) this.models.faux.setResponses([fauxSocraticScript]);
  }

  async onStart(): Promise<void> {
    await this.sockets.reattach();
  }
}

function fauxSocraticScript(context: TranscriptContext): AssistantMessage {
  const last = context.messages.filter((message) => message.role !== "system").at(-1);
  const said = last?.role === "user" ? textOf(last.content) : "";
  if (/python|排序|數學|程式/.test(said)) {
    return fauxAssistantMessage([fauxToolCall("report_violation", { type: "coding", excerpt: said })], {
      stopReason: "toolUse",
    });
  }
  return fauxAssistantMessage([fauxText(`你提到「${said}」。先別急著找標準答案——你的直覺判斷是什麼？為什麼？`)]);
}

function textOf(content: Message["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("");
}

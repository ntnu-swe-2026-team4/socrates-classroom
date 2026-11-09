import type { UserInput } from "@earendil-works/pi-durable";
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
import { PiHarness, type PiReceipt, type PiSession, type PiSubmitOptions, ROOT_SESSION } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { WebSockets } from "agents/websockets";
import type { Env } from "../env";
import { SESSION_COOKIE, userFromSessionToken } from "../auth";
import { requireMembership } from "../services/members";
import { createAvatarExtension } from "../pi/extensions/avatar";
import { createJudgmentExtension } from "../pi/extensions/judgment";
import { createWebSearchExtension } from "../pi/extensions/websearch";
import { fauxReplayExtension } from "../pi/extensions/faux-replay";
import { socratesExtension } from "../pi/extensions/socrates";
import { buildModels } from "../pi/models";
import { teacherLegsOf, teacherOfActivity, type TeacherLeg } from "../pi/credentials";
import { one } from "../db/d1";
import { getRouter } from "../routing/router";
import { ChatSockets } from "../ws/sockets";

export class Chat extends DurableObject<Env> {
  readonly registry = createRegistry();
  readonly models = buildModels(this.env, { teacherOf: () => this.teacherId() });
  #teacherId: string | null | undefined;
  #sessionModel: { provider: string; id: string } | undefined;

  readonly harness = new PiHarness({
    harness: ({ storage, context, onWake }) => {
      this.registry.install(socratesExtension());
      this.registry.install(createAvatarExtension(this.env.AI));
      this.registry.install(
        createJudgmentExtension(this.env.AI, async (violation) => {
          console.warn("[judgment:sink]", violation.type, violation.source);
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

  readonly sockets = new ChatSockets(
    this.harness,
    this.registry,
    (tag) => this.ctx.getWebSockets(tag),
    (request) => this.authorize(request),
    (handle, input, options) => this.routeSubmit(handle, input, options),
  );
  readonly webSockets = new WebSockets(this.sockets.options());
  readonly lifecycle = Lifecycle.install(this).use(this.webSockets).use(this.harness);

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (this.models.faux) {
      this.models.faux.setResponses([fauxSocraticScript]);
      this.registry.install(fauxReplayExtension(this.models.faux, fauxSocraticScript));
    }
  }

  async onStart(): Promise<void> {
    await this.sockets.reattach();
  }

  private async teacherId(): Promise<string | null> {
    if (this.#teacherId === undefined) {
      const activityId = this.ctx.id.name?.split(":")[0] ?? "";
      this.#teacherId = activityId ? await teacherOfActivity(this.env, activityId) : null;
    }
    return this.#teacherId;
  }

  private async teacherLegs(): Promise<TeacherLeg[]> {
    return teacherLegsOf(this.env, await this.teacherId());
  }

  private async routeSubmit(handle: PiSession, input: UserInput, options: PiSubmitOptions): Promise<PiReceipt> {
    const activityId = this.ctx.id.name?.split(":")[0] ?? "";
    const activity = await one<{ finished_at: string | null }>(
      this.env.DB,
      "SELECT finished_at FROM activities WHERE id = $id",
      { id: activityId },
    );
    if (activity?.finished_at) throw new Error("activity_finished");
    const router = getRouter(this.env);
    const canServe = (entry: { provider: string; model: string }): boolean =>
      this.models.models.getModel(entry.provider, entry.model) !== undefined;
    const decision = router.pick("interactive", canServe, await this.teacherLegs());
    if (decision) {
      const model = this.models.models.getModel(decision.entry.provider, decision.model);
      if (model && (this.#sessionModel?.provider !== model.provider || this.#sessionModel?.id !== model.id)) {
        await handle.setModel({ provider: model.provider, id: model.id });
        this.#sessionModel = { provider: model.provider, id: model.id };
      }
    }
    let receipt: PiReceipt;
    try {
      receipt = await handle.submit(input, options);
    } catch (error) {
      if (decision) router.settle(decision, "error");
      throw error;
    }
    if (decision) {
      void handle
        .wait(receipt.operationId)
        .then((result) =>
          router.settle(
            decision,
            result.status === "done" || (result.status === "unanswered" && result.reason === "aborted")
              ? "ok"
              : "error",
          ),
        )
        .catch(() => {
          if (router.ledger.inFlight(decision.key) > 0) router.settle(decision, "error");
        });
    }
    return receipt;
  }

  async onRequest(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname !== "/transcript") return new Response("Not found", { status: 404 });
    return Response.json(await this.transcript());
  }

  private async transcript(): Promise<{
    messages: Array<{ role: "user" | "assistant"; turn: number; text: string }>;
    violations: Array<{ turn: number; type: string; excerpt: string }>;
  }> {
    const entries = await this.harness.session(ROOT_SESSION).entries({ order: "descending" }, TRANSCRIPT_MAX_ENTRIES);
    const items = [...entries.items].reverse();
    const messages: Array<{ role: "user" | "assistant"; turn: number; text: string }> = [];
    const violations: Array<{ turn: number; type: string; excerpt: string }> = [];
    let turn = 0;
    for (const entry of items) {
      if (entry.kind === "pi.user") {
        turn += 1;
        messages.push({ role: "user", turn, text: entryText(entry) });
      } else if (entry.kind === "pi.assistant") {
        messages.push({ role: "assistant", turn, text: entryText(entry) });
      } else if (entry.kind === "app.violation") {
        const data = entry.data as { type?: string; excerpt?: string };
        violations.push({ turn, type: data.type ?? "other", excerpt: data.excerpt ?? "" });
      }
    }
    return { messages, violations };
  }

  private async authorize(request: Request): Promise<boolean> {
    const name = decodeURIComponent(new URL(request.url).pathname.split("/chat/").at(-1) ?? "");
    const [activityId, studentId] = name.split(":");
    if (!activityId || !studentId) return false;
    const cookie = request.headers.get("Cookie") ?? "";
    const token = cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
    const user = await userFromSessionToken({ env: this.env }, token);
    if (!user) return false;
    try {
      const { isTeacher } = await requireMembership(this.env.DB, activityId, user);
      return isTeacher || user.id === studentId;
    } catch {
      return false;
    }
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

const TRANSCRIPT_MAX_ENTRIES = 1000;

function textOf(content: Message["content"]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part): part is TextContent => part.type === "text")
    .map((part) => part.text)
    .join("");
}

function entryText(entry: { model?: readonly Message[] }): string {
  return textOf(entry.model?.[0]?.content ?? "");
}

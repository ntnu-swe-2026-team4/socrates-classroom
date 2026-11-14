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
import { SESSION_COOKIE, resolveSession } from "../auth";
import { requireMembership } from "../services/members";
import { createAvatarExtension } from "../pi/extensions/avatar";
import { createJudgmentExtension } from "../pi/extensions/judgment";
import { createWebSearchExtension } from "../pi/extensions/websearch";
import { fauxReplayExtension } from "../pi/extensions/faux-replay";
import { socratesExtension } from "../pi/extensions/socrates";
import { btwExtension, forkBtw } from "../pi/extensions/btw";
import { NoAvailableModelError, PROFILES } from "../pi/agents/profiles";
import { buildModels } from "../pi/models";
import { teacherLegsOf, teacherOfActivity, withPinnedCredential, type TeacherLeg } from "../pi/credentials";
import { one, run } from "../db/d1";
import { SOLO_PREFIX, ownedSoloChat } from "../routes/solo";
import { getRouter } from "../gateway/router";
import { ApiError } from "@socrates/shared";
import { ChatSockets } from "../ws/sockets";

class ActivityFinishedError extends Error {
  constructor() {
    super("activity_finished");
    this.name = "ActivityFinished";
  }
}

const LAST_ACTIVE_KEY = "lastActiveAt";

export class Chat extends DurableObject<Env> {
  readonly registry = createRegistry();
  readonly models = buildModels(this.env, { teacherOf: () => this.teacherId() });
  #teacherId: string | null | undefined;
  readonly #sessionModels = new Map<string, { provider: string; id: string }>();

  readonly btw = btwExtension();

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
      this.registry.install(this.btw);
      const registry = this.registry;
      const btw = this.btw.name;
      return Harness.open(
        storage,
        {
          models: this.models.models,
          registry: this.registry,
          onWake,
          settings: {
            get extensions() {
              return registry
                .snapshot()
                .installed()
                .filter((extension) => extension.name !== btw);
            },
            retry: { enabled: true, maxRetries: 5, baseDelayMs: 1000 },
            afterFailedRun: "continue",
          },
          onReport: (report) =>
            console.warn("[pi]", report.kind, report.error instanceof Error ? report.error.name : typeof report.error),
        },
        context,
      );
    },
    defaults: { model: this.models.default, thinkingLevel: PROFILES.socrates.thinkingLevel },
  });

  readonly sockets = new ChatSockets(
    this.harness,
    this.registry,
    (tag) => this.ctx.getWebSockets(tag),
    (request) => this.authorize(request),
    (handle, input, options) => this.routeSubmit(handle, input, options),
    (userId) => userId === this.studentId,
    () => forkBtw(this.harness, this.btw),
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
    await this.sockets.reattach(this.webSockets.getConnections(), (userId) => this.reverify(userId));
  }

  private async teacherId(): Promise<string | null> {
    if (this.#teacherId === undefined) {
      const [threadId = "", ownerId = ""] = this.ctx.id.name?.split(":") ?? [];
      if (threadId.startsWith(SOLO_PREFIX)) {
        this.#teacherId = (await ownedSoloChat(this.env.DB, threadId, ownerId)) ? ownerId : null;
      } else {
        this.#teacherId = threadId ? await teacherOfActivity(this.env, threadId) : null;
      }
    }
    return this.#teacherId;
  }

  private async teacherLegs(): Promise<TeacherLeg[]> {
    return teacherLegsOf(this.env, await this.teacherId());
  }

  private async routeSubmit(handle: PiSession, input: UserInput, options: PiSubmitOptions): Promise<PiReceipt> {
    const threadId = this.ctx.id.name?.split(":")[0] ?? "";
    if (threadId.startsWith(SOLO_PREFIX)) {
      await run(this.env.DB, "UPDATE solo_chats SET updated_at = $at WHERE id = $id", {
        id: threadId,
        at: new Date().toISOString(),
      });
    } else {
      const activity = await one<{ finished_at: string | null }>(
        this.env.DB,
        "SELECT finished_at FROM activities WHERE id = $id",
        { id: threadId },
      );
      if (activity?.finished_at) throw new ActivityFinishedError();
      await this.ctx.storage.put(LAST_ACTIVE_KEY, new Date().toISOString());
    }
    const router = getRouter(this.env);
    const canServe = (entry: { provider: string; model: string }): boolean =>
      this.models.models.getModel(entry.provider, entry.model) !== undefined;
    const decision = router.pick("interactive", canServe, await this.teacherLegs());
    if (!decision && !this.models.faux) throw new NoAvailableModelError();
    if (!decision) return handle.submit(input, options);
    const model = this.models.models.getModel(decision.entry.provider, decision.model);
    const receipt = await router.withRoute(decision, async () => {
      const current = this.#sessionModels.get(handle.id);
      if (model && (current?.provider !== model.provider || current?.id !== model.id)) {
        await handle.setModel({ provider: model.provider, id: model.id });
        this.#sessionModels.set(handle.id, { provider: model.provider, id: model.id });
      }
      return withPinnedCredential(decision.entry.credential, () => handle.submit(input, options));
    });
    void handle
      .wait(receipt.operationId)
      .then((result) => {
        const ok = result.status === "done" || (result.status === "unanswered" && result.reason === "aborted");
        router.settle(decision, ok ? "ok" : "error");
        if (!ok) this.sockets.notifyRunFailure(handle.id);
      })
      .catch(() => {
        if (router.ledger.inFlight(decision.key) > 0) router.settle(decision, "error");
        this.sockets.notifyRunFailure(handle.id);
      });
    return receipt;
  }

  async transcript(): Promise<{
    messages: Array<{ role: "user" | "assistant"; turn: number; text: string }>;
    violations: Array<{ turn: number; type: string; excerpt: string }>;
  }> {
    const items = await this.harness.session(ROOT_SESSION).messages();
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
    const seen = new Set<string>();
    const deduped = violations.filter((violation) => {
      const key = `${violation.turn}:${violation.type}:${violation.excerpt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    return { messages, violations: deduped };
  }

  async live(): Promise<{
    rounds: number;
    lastUtterance: string;
    lastActiveAt: string | null;
    flags: Array<{ turn: number; type: string; excerpt: string }>;
  }> {
    const { messages, violations } = await this.transcript();
    const said = messages.filter((message) => message.role === "user");
    return {
      rounds: said.length,
      lastUtterance: said.at(-1)?.text ?? "",
      lastActiveAt: (await this.ctx.storage.get<string>(LAST_ACTIVE_KEY)) ?? null,
      flags: violations,
    };
  }

  private get studentId(): string {
    return this.ctx.id.name?.split(":")[1] ?? "";
  }

  private async authorize(request: Request): Promise<string | null> {
    const name = decodeURIComponent(new URL(request.url).pathname.split("/chat/").at(-1) ?? "");
    const [activityId, studentId] = name.split(":");
    if (!activityId || !studentId) return null;
    const cookie = request.headers.get("Cookie") ?? "";
    const token = cookie
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${SESSION_COOKIE}=`))
      ?.slice(SESSION_COOKIE.length + 1);
    const { user } = await resolveSession(this.env, token);
    if (!user) return null;
    if (activityId.startsWith(SOLO_PREFIX)) {
      return user.id === studentId && (await ownedSoloChat(this.env.DB, activityId, user.id)) ? user.id : null;
    }
    try {
      const { isTeacher } = await requireMembership(this.env.DB, activityId, user);
      return isTeacher || user.id === studentId ? user.id : null;
    } catch {
      return null;
    }
  }

  private async reverify(userId: string): Promise<"member" | "revoked" | "error"> {
    const [activityId, studentId] = this.ctx.id.name?.split(":") ?? [];
    if (!activityId) return "revoked";
    if (activityId.startsWith(SOLO_PREFIX)) {
      try {
        return userId === studentId && (await ownedSoloChat(this.env.DB, activityId, userId)) ? "member" : "revoked";
      } catch {
        return "error";
      }
    }
    try {
      const { isTeacher } = await requireMembership(this.env.DB, activityId, {
        id: userId,
        name: "",
        guest: true,
      });
      return isTeacher || userId === studentId ? "member" : "revoked";
    } catch (error) {
      return error instanceof ApiError ? "revoked" : "error";
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
  const userTurns = context.messages.filter((message) => message.role === "user");
  const lastUser = userTurns.at(-1);
  const replies = FAUX_REPLY[languageOf(lastUser ? textOf(lastUser.content) : "")];
  const reply = replies[Math.max(0, userTurns.length - 1) % replies.length]!;
  return fauxAssistantMessage([fauxText(reply(said))]);
}

const FAUX_REPLY = {
  zh: [
    (said: string) => `你提到「${said}」。先別急著找標準答案——你的直覺判斷是什麼？為什麼？`,
    (said: string) => `「${said}」——這句話背後，你先假設了什麼？`,
    (said: string) => `如果有人反對「${said}」，他最可能怎麼說？你會怎麼回應？`,
    (said: string) => `你說「${said}」。能舉一個具體的例子嗎？`,
    (said: string) => `在什麼情況下，「${said}」會不成立？`,
  ],
  en: [
    (said: string) => `You said “${said}”. Don’t rush to a textbook answer — what is your gut judgment, and why?`,
    (said: string) => `“${said}” — what are you assuming before you even say that?`,
    (said: string) => `If someone disagreed with “${said}”, what would they say, and how would you answer?`,
    (said: string) => `You said “${said}”. Can you give me a concrete example?`,
    (said: string) => `When would “${said}” stop being true?`,
  ],
  es: [
    (said: string) => `Dijiste «${said}». No busques aún la respuesta de manual: ¿cuál es tu intuición y por qué?`,
    (said: string) => `«${said}»: ¿qué das por supuesto antes de decirlo?`,
    (said: string) => `Si alguien no estuviera de acuerdo con «${said}», ¿qué diría y cómo responderías?`,
    (said: string) => `Dijiste «${said}». ¿Puedes darme un ejemplo concreto?`,
    (said: string) => `¿En qué caso «${said}» dejaría de ser cierto?`,
  ],
} as const;

function languageOf(text: string): keyof typeof FAUX_REPLY {
  if (/[\u3400-\u9fff]/.test(text)) return "zh";
  if (/[¿¡ñáéíóú]/i.test(text)) return "es";
  return /[a-z]/i.test(text) ? "en" : "zh";
}

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

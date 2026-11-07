import { DurableObject } from "cloudflare:workers";
import { createRegistry } from "@earendil-works/pi-durable";
import { PiHarness } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import type { AnyModel } from "@earendil-works/pi-ai";
import type { DialogueMessage } from "@socrates/shared";
import { LANG_NAMES, ViolationChoiceSchema, type Lang, type ViolationType } from "@socrates/shared";
import PREAMBLE_RAW from "../../../../packages/llm/prompts/socrates.md?raw";
import type { Env } from "../env";
import { all, batch, one } from "../db/d1";
import { buildModels, fauxTurn } from "../providers/models";
import { mockSocratesReply } from "../providers/mock-socrates";
import { ProviderRouter, type SettleKind } from "../providers/router";
import { oneshot } from "../providers/oneshot";
import { classifyViolationViaClef } from "../providers/clef";

function classifyMock(text: string): { type: ViolationType; probability: number } {
  const lowered = text.toLowerCase();
  if (/math|數學|方程|微積分|因式分解|作業/.test(lowered)) return { type: "math", probability: 0.92 };
  if (/code|程式|python|javascript|debug|寫程式/.test(lowered)) return { type: "coding", probability: 0.9 };
  if (/ignore (all|previous)|system prompt|忽略(以上|先前)/i.test(text))
    return { type: "injection", probability: 0.95 };
  return { type: "on_topic", probability: 0.98 };
}

interface PromptResult {
  status: "done" | "unanswered";
  reason?: string;
  text?: string;
}

interface WatchCall {
  kind: string;
  value?: unknown;
}

interface WatchHandleLike {
  start(listener: (call: WatchCall) => Promise<void>): void;
  stop(): Promise<unknown>;
}

interface SessionLike {
  submit(input: string): Promise<{ operationId: string }>;
  wait(operationId: string): Promise<PromptResult>;
  setModel(model: unknown): Promise<void>;
  messages(): Promise<Array<{ kind?: string }>>;
  watch(): Promise<WatchHandleLike>;
}

export class PiAgent extends DurableObject<Env> {
  private readonly sessionKey = this.ctx.id.name ?? "socrates";
  readonly models = buildModels(this.env, this.sessionKey);
  readonly registry = createRegistry();
  readonly router = new ProviderRouter(this.env);

  readonly harness = new PiHarness({
    harness: ({ storage, context, onWake }) => {
      this.registry.install({
        name: "socrates",
        sections: [
          { key: "preamble", render: () => PREAMBLE_RAW.trim(), tag: false },
          {
            key: "language",
            render: () =>
              `Language: the student is conversing in ${LANG_NAMES[this.threadLang]}. Always reply in ${LANG_NAMES[this.threadLang]}, regardless of the language of this instruction.`,
            tag: false,
          },
        ],
      });
      return import("@earendil-works/pi-durable").then(({ Harness }) =>
        Harness.open(
          storage,
          {
            models: this.models.models,
            registry: this.registry,
            onWake,
            settings: {
              retry: { enabled: true, maxRetries: 5, baseDelayMs: 1000 },
              afterFailedRun: "continue",
            },
            onReport: (error) => console.warn("[pi] report", error),
          },
          context,
        ),
      );
    },
    defaults: { model: this.headModel(), thinkingLevel: "low" },
  });

  readonly lifecycle = Lifecycle.install(this).use(this.harness);

  private busy = false;

  private headModel(): AnyModel | undefined {
    for (const model of this.models.byId.values()) return model;
    return undefined;
  }

  private events(activityId: string) {
    return this.env.ActivityEvents.getByName(activityId);
  }

  private threadLang: Lang = "zh";

  async dialogue(input: {
    activityId: string;
    userId: string;
    userText: string;
    title: string;
    lang?: Lang;
    solo?: boolean;
  }): Promise<Response> {
    if (input.lang) this.threadLang = input.lang;
    if (this.busy) throw new Error("already_streaming");
    this.busy = true;
    let released = false;
    const release = () => {
      if (!released) {
        released = true;
        this.busy = false;
      }
    };

    const db = this.env.DB;
    try {
      if (input.solo) {
        const chat = await one<{ id: string }>(db, "SELECT id FROM solo_chats WHERE id = $id AND user_id = $uid", {
          id: input.activityId,
          uid: input.userId,
        });
        if (!chat) throw new Error("activity_missing");
      } else {
        const activity = await one<{ finished_at: string | null }>(
          db,
          "SELECT finished_at FROM activities WHERE id = $id",
          { id: input.activityId },
        );
        if (!activity) throw new Error("activity_missing");
        if (activity.finished_at) throw new Error("activity_finished");
      }

      const threadKey = `${input.solo ? "solo" : "activity"}:${input.activityId}:${input.userId}`;
      const homeProvider = (await this.ctx.storage.get<string>("home")) ?? undefined;
      const lease = await this.router.acquire(threadKey, homeProvider);
      await this.ctx.storage.put("home", lease.provider.id);

      const session = this.harness.session() as unknown as SessionLike;
      const encoder = new TextEncoder();
      let closed = false;
      const body = new ReadableStream<Uint8Array>({
        start: (controller) => {
          const send = (event: string, data: unknown) => {
            if (closed) return;
            try {
              controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
            } catch {
              closed = true;
            }
          };
          const pump = async () => {
            const ping = setInterval(() => {
              if (closed) return;
              try {
                controller.enqueue(encoder.encode(": ping\n\n"));
              } catch {}
            }, 15_000);
            try {
              if (lease.provider.id === "mock" && this.models.faux) {
                const existing = (await session.messages()) as unknown as Array<{ kind?: string }>;
                const turn = existing.filter((entry) => entry.kind?.startsWith("pi.user")).length;
                const reply = mockSocratesReply(input.userText, turn);
                if (input.userText.endsWith("…")) {
                  fauxTurn(this.models.faux, reply, 400);
                } else {
                  fauxTurn(this.models.faux, reply);
                }
              }
              const model = this.models.byId.get(lease.provider.id);
              if (model) await session.setModel(model).catch(() => {});

              const stream = await session.watch();
              let sent = 0;
              stream.start(async (call) => {
                if (call.kind !== "value") return;
                const partial = livePartialText(call.value);
                if (partial.length > sent) {
                  send("delta", { text: partial.slice(sent) });
                  sent = partial.length;
                }
              });

              const receipt = await session.submit(input.userText);
              const result = await session.wait(receipt.operationId);
              const final = (result.text ?? "").trim();
              if (result.status !== "done" || !final) {
                throw new Error(`llm_unavailable:${result.reason ?? ""}`);
              }
              if (final.length > sent) {
                send("delta", { text: final.slice(sent) });
              }
              await stream.stop().catch(() => {});

              const at = new Date().toISOString();
              const userMessage: DialogueMessage = {
                id: crypto.randomUUID(),
                role: "user",
                text: input.userText,
                at,
              };
              const assistantMessage: DialogueMessage = {
                id: crypto.randomUUID(),
                role: "assistant",
                text: final,
                at,
              };
              if (input.solo) {
                await batch(db, [
                  {
                    sql: "INSERT INTO solo_messages (id, chat_id, role, text, at) VALUES ($id, $cid, 'user', $text, $at)",
                    params: { id: userMessage.id, cid: input.activityId, text: userMessage.text, at },
                  },
                  {
                    sql: "INSERT INTO solo_messages (id, chat_id, role, text, at) VALUES ($id, $cid, 'assistant', $text, $at)",
                    params: { id: assistantMessage.id, cid: input.activityId, text: assistantMessage.text, at },
                  },
                  {
                    sql: "UPDATE solo_chats SET updated_at = $at WHERE id = $cid",
                    params: { cid: input.activityId, at },
                  },
                ]);
              } else {
                await batch(db, [
                  {
                    sql: "INSERT INTO messages (id, activity_id, student_id, role, text, at) VALUES ($id, $aid, $sid, 'user', $text, $at)",
                    params: {
                      id: userMessage.id,
                      aid: input.activityId,
                      sid: input.userId,
                      text: userMessage.text,
                      at,
                    },
                  },
                  {
                    sql: "INSERT INTO messages (id, activity_id, student_id, role, text, at) VALUES ($id, $aid, $sid, 'assistant', $text, $at)",
                    params: {
                      id: assistantMessage.id,
                      aid: input.activityId,
                      sid: input.userId,
                      text: assistantMessage.text,
                      at,
                    },
                  },
                ]);
              }
              send("done", { message: assistantMessage });
              await this.router.settle(lease, "ok");
              release();
              if (!input.solo) await this.afterTurn(db, input.activityId, input.userId, input.userText, final);
            } catch (error) {
              const raw = error instanceof Error ? error.message : String(error);
              const kind: SettleKind = /rate|429|concurren/i.test(raw)
                ? "rate"
                : /abort|timeout/i.test(raw)
                  ? "timeout"
                  : "error";
              await this.router.settle(lease, kind).catch(() => {});
              const code =
                kind === "rate" ? "llm_rate_limited" : kind === "timeout" ? "llm_timeout" : "llm_unavailable";
              send("error", { message: raw.slice(0, 200), code });
              release();
            } finally {
              clearInterval(ping);
              closed = true;
              release();
              try {
                controller.close();
              } catch {}
            }
          };
          void pump();
        },
        cancel: () => {
          closed = true;
        },
      });

      return new Response(body, {
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
          "X-Accel-Buffering": "no",
        },
      });
    } catch (error) {
      release();
      throw error;
    }
  }

  private async afterTurn(
    db: D1Database,
    activityId: string,
    userId: string,
    userText: string,
    replyText: string,
  ): Promise<void> {
    try {
      const rounds = await one<{ n: number }>(
        db,
        "SELECT COUNT(*) AS n FROM messages WHERE activity_id = $aid AND student_id = $sid AND role = 'user'",
        { aid: activityId, sid: userId },
      );
      const turn = rounds?.n ?? 1;
      const transcript = await all<{ role: string; text: string }>(
        db,
        "SELECT role, text FROM messages WHERE activity_id = $aid AND student_id = $sid ORDER BY at, rowid",
        { aid: activityId, sid: userId },
      );
      let choice: { type: ViolationType; probability: number } | null = this.models.clef
        ? await classifyViolationViaClef(
            this.env,
            this.models.models as unknown as Parameters<typeof classifyViolationViaClef>[1],
            this.models.clef.model,
            transcript,
            userText,
          )
        : null;
      if (!choice) {
        choice = await oneshot(this.env, this.models, {
          system:
            "You are a classroom safety classifier for a Socratic philosophy dialogue app. Classify the student's latest message intent.",
          user: `Student said: ${userText}\nAssistant replied: ${replyText.slice(0, 300)}`,
          schema: ViolationChoiceSchema,
          mock: () => classifyMock(userText),
        });
      }
      if (choice.type !== "on_topic") {
        await batch(db, [
          {
            sql: "INSERT INTO violations (id, activity_id, student_id, turn, type, probability, excerpt, created_at) VALUES ($id, $aid, $sid, $turn, $type, $p, $excerpt, $at)",
            params: {
              id: crypto.randomUUID(),
              aid: activityId,
              sid: userId,
              turn,
              type: choice.type,
              p: choice.probability,
              excerpt: userText.slice(0, 120),
              at: new Date().toISOString(),
            },
          },
        ]);
        await this.events(activityId).publishViolation({
          studentId: userId,
          turn,
          type: choice.type,
          excerpt: userText.slice(0, 120),
        });
      }
      const snapshot = await this.events(activityId).snapshot(activityId);
      const row = snapshot.find((student) => student.id === userId);
      if (row) await this.events(activityId).publishUpdate(row);
    } catch {
      void 0;
    }
  }

  async history(activityId: string, studentId: string): Promise<DialogueMessage[]> {
    const rows = await all<{ id: string; role: string; text: string; at: string }>(
      this.env.DB,
      "SELECT id, role, text, at FROM messages WHERE activity_id = $aid AND student_id = $sid ORDER BY at, rowid",
      { aid: activityId, sid: studentId },
    );
    return rows.map((row) => ({
      id: row.id,
      role: row.role === "assistant" ? "assistant" : "user",
      text: row.text,
      at: row.at,
    }));
  }

  status() {
    return {
      busy: this.busy,
      providers: [...this.models.byId.keys()],
    };
  }
}

function livePartialText(view: unknown): string {
  const docs = (view as { docs?: Record<string, unknown> }).docs;
  const live = docs?.["pi.live"] as
    | { generation?: { message?: { content?: Array<{ type?: string; text?: string }> } } }
    | undefined;
  const content = live?.generation?.message?.content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((block) => block?.type === "text")
    .map((block) => block.text ?? "")
    .join("");
}

import { DurableObject } from "cloudflare:workers";
import { createRegistry, type Harness } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { fauxAssistantMessage, type AssistantMessage, type TranscriptContext } from "@earendil-works/pi-ai";
import type { Env } from "../env";
import { buildModels } from "../pi/models";
import { all, one, run } from "../db/d1";
import { nowIso } from "../http";
import {
  ClassReportSchema,
  StudentAnalysisSchema,
  type ClassReport,
  type StudentAnalysis,
  type ViolationSlice,
  type ViolationType,
} from "@socrates/shared";
import { Router } from "../routing/router";
import { fauxReplayExtension } from "../pi/extensions/faux-replay";

const PSEUDONYM_PREFIX = "學生";
const MAX_STUDENT_ATTEMPTS = 2;

export class ReportRunner extends DurableObject<Env> {
  readonly models = buildModels(this.env);
  readonly router = new Router(this.env);
  readonly registry = createRegistry();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    if (this.models.faux) {
      this.models.faux.setResponses([fauxReportScript]);
      this.registry.install(fauxReplayExtension(this.models.faux, fauxReportScript));
    }
  }

  async startReport(input: { activityId: string }): Promise<"started" | "ready"> {
    const db = this.env.DB;
    const row = await one<{ status: string }>(db, "SELECT status FROM reports WHERE activity_id = $id", {
      id: input.activityId,
    });
    if (row?.status === "ready") return "ready";
    if (!row) {
      await run(
        db,
        "INSERT INTO reports (activity_id, status, created_at, updated_at) VALUES ($id, 'pending', $at, $at)",
        {
          id: input.activityId,
          at: nowIso(),
        },
      );
    } else {
      await run(db, "UPDATE reports SET status = 'pending', updated_at = $at WHERE activity_id = $id", {
        id: input.activityId,
        at: nowIso(),
      });
    }
    await this.ctx.storage.put("attempts", 0);
    await this.ctx.storage.setAlarm(Date.now() + 50);
    return "started";
  }

  async alarm(): Promise<void> {
    const activityId = this.ctx.id.name ?? "";
    const row = await one<{ status: string }>(this.env.DB, "SELECT status FROM reports WHERE activity_id = $id", {
      id: activityId,
    });
    if (row?.status === "ready" || row?.status === "failed") return;
    const attempts = ((await this.ctx.storage.get<number>("attempts")) ?? 0) + 1;
    await this.ctx.storage.put("attempts", attempts);
    if (attempts > 3) {
      await run(this.env.DB, "UPDATE reports SET status = 'failed', updated_at = $at WHERE activity_id = $id", {
        id: activityId,
        at: nowIso(),
      });
      return;
    }
    try {
      await this.generate(activityId);
    } catch (error) {
      console.error("[report] generation failed", error);
      await this.ctx.storage.setAlarm(Date.now() + attempts * 4_000);
    }
  }

  async status(activityId: string): Promise<{ status: string }> {
    const row = await one<{ status: string }>(this.env.DB, "SELECT status FROM reports WHERE activity_id = $id", {
      id: activityId,
    });
    return { status: row?.status ?? "none" };
  }

  async generate(activityId: string): Promise<void> {
    const db = this.env.DB;
    const activity = await one<{ title: string; statement: string; classroom_id: string }>(
      db,
      `SELECT t.title, t.statement, a.classroom_id
       FROM activities a JOIN topics t ON t.id = a.topic_id WHERE a.id = $id`,
      { id: activityId },
    );
    if (!activity) throw new Error("activity_missing");
    const members = await all<{ user_id: string; name: string }>(
      db,
      "SELECT user_id, name FROM members WHERE classroom_id = $cid ORDER BY joined_at, user_id",
      { cid: activity.classroom_id },
    );

    const pseudonyms = new Map<string, string>();
    for (const [index, member] of members.entries()) {
      const existing = await one<{ pseudonym: string }>(
        db,
        "SELECT pseudonym FROM pseudonyms WHERE activity_id = $aid AND student_id = $sid",
        { aid: activityId, sid: member.user_id },
      );
      const pseudonym = existing?.pseudonym ?? `${PSEUDONYM_PREFIX}${String.fromCharCode(65 + (index % 26))}`;
      pseudonyms.set(member.user_id, pseudonym);
      if (!existing) {
        await run(db, "INSERT INTO pseudonyms (activity_id, student_id, pseudonym) VALUES ($aid, $sid, $p)", {
          aid: activityId,
          sid: member.user_id,
          p: pseudonym,
        });
      }
    }

    const batch = this.batchSize(members.length);
    const transcripts = new Map<string, { text: string; violations: ViolationSlice[] }>();
    for (let i = 0; i < members.length; i += batch) {
      await Promise.all(
        members.slice(i, i + batch).map(async (member) => {
          transcripts.set(member.user_id, await this.transcriptOf(activityId, member.user_id, pseudonyms));
        }),
      );
    }

    const harness = await this.openHarness();
    const studentAnalyses = new Map<string, StudentAnalysis | null>();
    for (let i = 0; i < members.length; i += batch) {
      await Promise.all(
        members.slice(i, i + batch).map(async (member) => {
          const transcript = transcripts.get(member.user_id)?.text ?? "";
          if (!transcript.trim()) {
            studentAnalyses.set(member.user_id, null);
            return;
          }
          for (let attempt = 0; attempt < MAX_STUDENT_ATTEMPTS; attempt += 1) {
            const { text } = await this.runAgent(
              harness,
              "report-analyst",
              this.studentReportPrompt(activity, transcript),
            );
            try {
              studentAnalyses.set(member.user_id, StudentAnalysisSchema.parse(JSON.parse(text)));
              break;
            } catch {
              if (attempt === MAX_STUDENT_ATTEMPTS - 1) studentAnalyses.set(member.user_id, null);
            }
          }
        }),
      );
    }

    const classInput = this.classReportPrompt(activity, members, transcripts, pseudonyms);
    const { text: classText } = await this.runAgent(harness, "report-analyst", classInput);
    const classReport = ClassReportSchema.parse(JSON.parse(classText));

    await this.persist(activityId, activity.title, classReport, studentAnalyses, pseudonyms, transcripts);
  }

  private async openHarness(): Promise<Harness> {
    const { Harness: HarnessCtor } = (await import("@earendil-works/pi-durable")) as unknown as {
      Harness: { open: (storage: unknown, options: unknown, context: unknown) => Promise<Harness> };
    };
    const { MemoryStorage } = (await import("@earendil-works/pi-durable/storage/memory")) as unknown as {
      MemoryStorage: new () => unknown;
    };
    return HarnessCtor.open(
      new MemoryStorage(),
      { models: this.models.models, registry: this.registry },
      BACKGROUND_CONTEXT,
    );
  }

  private async runAgent(harness: Harness, profile: "report-analyst", input: string): Promise<{ text: string }> {
    const { runProfile } = (await import("../pi/agents/profiles")) as unknown as {
      runProfile: (h: Harness, r: unknown, p: "report-analyst", i: string) => Promise<{ text: string }>;
    };
    return runProfile(harness, { models: this.models, registry: this.registry, env: this.env }, profile, input);
  }

  private batchSize(memberCount: number): number {
    const budget = this.router.budget("batch");
    return budget > 0 ? budget : memberCount;
  }

  private async transcriptOf(
    activityId: string,
    studentId: string,
    pseudonyms: Map<string, string>,
  ): Promise<{ text: string; violations: ViolationSlice[] }> {
    const stub = this.env.Chat.get(this.env.Chat.idFromName(`${activityId}:${studentId}`));
    const res = await stub.fetch("https://chat/transcript");
    if (!res.ok) return { text: "", violations: [] };
    const data = (await res.json()) as {
      messages: Array<{ role: "user" | "assistant"; turn: number; text: string }>;
      violations: Array<{ turn: number; type: string; excerpt: string }>;
    };
    const pseudonym = pseudonyms.get(studentId) ?? studentId;
    const text = data.messages
      .map((message) =>
        message.role === "user" ? `${pseudonym}（${message.turn}）：${message.text}` : `AI：${message.text}`,
      )
      .join("\n");
    return {
      text,
      violations: data.violations.map((violation) => ({
        turn: violation.turn,
        type: violation.type as ViolationType,
        excerpt: violation.excerpt,
      })),
    };
  }

  private studentReportPrompt(activity: { title: string; statement: string }, transcript: string): string {
    return `## Topic: ${activity.title}\n${activity.statement}\n\n## Conversation\n${transcript}`;
  }

  private classReportPrompt(
    activity: { title: string; statement: string },
    members: Array<{ user_id: string }>,
    transcripts: Map<string, { text: string; violations: ViolationSlice[] }>,
    pseudonyms: Map<string, string>,
  ): string {
    const roster = members.map((m) => pseudonyms.get(m.user_id) ?? "").filter(Boolean);
    const conversations = members
      .map((m) => `### ${pseudonyms.get(m.user_id) ?? m.user_id}\n${transcripts.get(m.user_id)?.text ?? ""}`)
      .join("\n\n");
    return `## Topic: ${activity.title}\n${activity.statement}\n\n## Roster: ${roster.length} students in the class\n${roster.join(", ")}\n\n## The whole class's conversations\n${conversations}`;
  }

  private async persist(
    activityId: string,
    topicTitle: string,
    classReport: ClassReport,
    studentAnalyses: Map<string, StudentAnalysis | null>,
    pseudonyms: Map<string, string>,
    transcripts: Map<string, { text: string; violations: ViolationSlice[] }>,
  ): Promise<void> {
    const students: Record<string, unknown> = {};
    for (const [studentId, analysis] of studentAnalyses) {
      students[studentId] = {
        pseudonym: pseudonyms.get(studentId) ?? studentId,
        analysis,
        violations: transcripts.get(studentId)?.violations ?? [],
      };
    }

    await run(
      this.env.DB,
      `UPDATE reports SET status = 'ready',
        teacher_report = $teacher, student_reports = $students, updated_at = $at
       WHERE activity_id = $id`,
      {
        id: activityId,
        teacher: JSON.stringify({ topicTitle, classReport }),
        students: JSON.stringify(students),
        at: nowIso(),
      },
    );
  }
}

function textOf(content: string | readonly unknown[]): string {
  if (typeof content === "string") return content;
  return (content as Array<{ type: string; text?: string }>)
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("");
}

function fauxReportScript(context: TranscriptContext): AssistantMessage {
  const last = context.messages.filter((message) => message.role !== "system").at(-1);
  const prompt = last?.role === "user" ? textOf(last.content) : "";
  if (prompt.includes("## Roster:")) {
    return fauxAssistantMessage(
      JSON.stringify({
        students: [{ id: "學生A", summary: [{ step: "提出直覺判斷並被追問理由", turns: [1] }] }],
        unstated: [],
        axes: [
          {
            name: "契約與承諾",
            low: "契約至上",
            high: "人情優先",
            positions: [
              { id: "學生A", turns: [1], view: "先守約再談情", end: "middle", at: 50 },
              { id: "學生B", turns: [1], view: "契約就是契約", end: "low", at: 10 },
            ],
            why: "全班多數先守約，但接受例外",
          },
        ],
        overview: ["全班集中在契約與人情的取捨"],
      }),
    );
  }
  return fauxAssistantMessage(
    JSON.stringify({
      stated: true,
      claim: { text: "契約應該被遵守", turns: [1] },
      reasons: { text: "因為雙方事先同意", turns: [1] },
      tension: null,
    }),
  );
}

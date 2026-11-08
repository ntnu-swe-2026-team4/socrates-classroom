import { DurableObject } from "cloudflare:workers";
import { createRegistry, type Harness } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { Env } from "../env";
import { buildModels } from "../pi/models";
import { all, one, run } from "../db/d1";
import { nowIso } from "../http";
import { ClassReportSchema, StudentAnalysisSchema, type ClassReport, type StudentAnalysis } from "@socrates/shared";
import { Router } from "../routing/router";

const PSEUDONYM_PREFIX = "學生";
const MAX_STUDENT_ATTEMPTS = 2;

export class ReportRunner extends DurableObject<Env> {
  readonly models = buildModels(this.env);
  readonly router = new Router(this.env);
  readonly registry = createRegistry();

  readonly harness = new (class {
    constructor(private runner: ReportRunner) {}
  })(this);

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

    const transcripts = new Map<string, string>();
    for (const member of members) {
      transcripts.set(member.user_id, await this.transcriptOf(activityId, member.user_id, pseudonyms));
    }

    const harness = await this.openHarness();
    const studentAnalyses = new Map<string, StudentAnalysis | null>();
    await Promise.all(
      members.map(async (member) => {
        const transcript = transcripts.get(member.user_id) ?? "";
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

    const classInput = this.classReportPrompt(activity, members, transcripts, pseudonyms);
    const { text: classText } = await this.runAgent(harness, "report-analyst", classInput);
    const classReport = ClassReportSchema.parse(JSON.parse(classText));

    await this.persist(activityId, activity.title, classReport, studentAnalyses, pseudonyms);
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

  private async transcriptOf(activityId: string, studentId: string, _pseudonyms: Map<string, string>): Promise<string> {
    const rows = await all<{ role: string; text: string }>(
      this.env.DB,
      "SELECT role, text FROM messages WHERE activity_id = $aid AND student_id = $sid ORDER BY at, rowid",
      { aid: activityId, sid: studentId },
    );
    let turn = 0;
    return rows
      .map((row) => (row.role === "user" ? `${PSEUDONYM_PREFIX}（${++turn}）：${row.text}` : `AI：${row.text}`))
      .join("\n");
  }

  private studentReportPrompt(activity: { title: string; statement: string }, transcript: string): string {
    return `## Topic: ${activity.title}\n${activity.statement}\n\n## Conversation\n${transcript}`;
  }

  private classReportPrompt(
    activity: { title: string; statement: string },
    members: Array<{ user_id: string }>,
    transcripts: Map<string, string>,
    pseudonyms: Map<string, string>,
  ): string {
    const roster = members.map((m) => pseudonyms.get(m.user_id) ?? "").filter(Boolean);
    const conversations = members
      .map((m) => `### ${pseudonyms.get(m.user_id) ?? m.user_id}\n${transcripts.get(m.user_id) ?? ""}`)
      .join("\n\n");
    return `## Topic: ${activity.title}\n${activity.statement}\n\n## Roster: ${roster.length} students in the class\n${roster.join(", ")}\n\n## The whole class's conversations\n${conversations}`;
  }

  private async persist(
    activityId: string,
    topicTitle: string,
    classReport: ClassReport,
    studentAnalyses: Map<string, StudentAnalysis | null>,
    pseudonyms: Map<string, string>,
  ): Promise<void> {
    const db = this.env.DB;
    const violations = await all<{ student_id: string; turn: number; type: string; excerpt: string }>(
      db,
      "SELECT student_id, turn, type, excerpt FROM violations WHERE activity_id = $aid ORDER BY turn",
      { aid: activityId },
    );
    const violationsBy = new Map<string, Array<{ turn: number; type: string; excerpt: string }>>();
    for (const row of violations) {
      const list = violationsBy.get(row.student_id) ?? [];
      list.push({ turn: row.turn, type: row.type, excerpt: row.excerpt });
      violationsBy.set(row.student_id, list);
    }

    const students: Record<string, unknown> = {};
    for (const [studentId, analysis] of studentAnalyses) {
      students[studentId] = {
        pseudonym: pseudonyms.get(studentId) ?? studentId,
        analysis,
        violations: violationsBy.get(studentId) ?? [],
      };
    }

    await run(
      db,
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

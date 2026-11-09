import { DurableObject } from "cloudflare:workers";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory";
import type { JsonObject } from "@earendil-works/pi-durable";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type AssistantMessage,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import type { Env } from "../env";
import { buildModels } from "../pi/models";
import { runProfile } from "../pi/agents/profiles";
import { teacherLegsOf, teacherOfActivity, type TeacherLeg } from "../pi/credentials";
import { reportSubmitExtension, SUBMIT_CLASS_REPORT, SUBMIT_STUDENT_ANALYSIS } from "../pi/extensions/report-submit";
import { all, one, run } from "../db/d1";
import { nowIso } from "../http";
import {
  ClassReportSchema,
  StudentAnalysisSchema,
  type ClassReport,
  type Lang,
  type ReportPosition,
  type StudentAnalysis,
  type ViolationSlice,
  type ViolationType,
} from "@socrates/shared";
import { getRouter } from "../routing/router";
import { routingConfig } from "../routing/config.gen";
import { fauxReplayExtension } from "../pi/extensions/faux-replay";

export class ReportRunner extends DurableObject<Env> {
  #inFlight: Promise<void> | null = null;
  readonly models = buildModels(this.env, {
    teacherOf: () => teacherOfActivity(this.env, this.ctx.id.name ?? ""),
  });
  readonly registry = createRegistry();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.registry.install(reportSubmitExtension);
    if (this.models.faux) {
      this.models.faux.setResponses([fauxReportScript]);
      this.registry.install(fauxReplayExtension(this.models.faux, fauxReportScript));
    }
  }

  async startReport(input: { activityId: string }): Promise<"started" | "ready"> {
    const db = this.env.DB;
    await this.ctx.storage.setAlarm(Date.now() + 50);
    await this.ctx.storage.put("attempts", 0);
    const row = await one<{ status: string }>(db, "SELECT status FROM reports WHERE activity_id = $id", {
      id: input.activityId,
    });
    if (row?.status === "ready") return "ready";
    if (!row) {
      await run(
        db,
        `INSERT INTO reports (activity_id, status, created_at, updated_at)
         VALUES ($id, 'pending', $at, $at)
         ON CONFLICT(activity_id) DO UPDATE SET status = 'pending', updated_at = $at`,
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
    return "started";
  }

  async alarm(): Promise<void> {
    const { report } = routingConfig;
    const activityId = this.ctx.id.name ?? "";
    if (this.#inFlight) {
      await this.ctx.storage.setAlarm(Date.now() + report.alarmTimeoutMs);
      return;
    }
    const db = this.env.DB;
    const row = await one<{ status: string }>(db, "SELECT status FROM reports WHERE activity_id = $id", {
      id: activityId,
    });
    if (row?.status === "ready" || row?.status === "failed") return;
    if (!row) {
      await run(
        db,
        `INSERT INTO reports (activity_id, status, created_at, updated_at)
         VALUES ($id, 'pending', $at, $at)
         ON CONFLICT(activity_id) DO NOTHING`,
        { id: activityId, at: nowIso() },
      );
    }
    const attempts = ((await this.ctx.storage.get<number>("attempts")) ?? 0) + 1;
    await this.ctx.storage.put("attempts", attempts);
    if (attempts > report.alarmAttempts) {
      await run(
        db,
        "UPDATE reports SET status = CASE WHEN student_reports IS NOT NULL THEN 'partial' ELSE 'failed' END, updated_at = $at WHERE activity_id = $id",
        { id: activityId, at: nowIso() },
      );
      return;
    }
    this.#inFlight = this.generate(activityId).finally(() => {
      this.#inFlight = null;
    });
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.#inFlight,
        new Promise<never>((_, reject) => {
          watchdog = setTimeout(() => reject(new Error("report_generation_timeout")), report.alarmTimeoutMs);
        }),
      ]);
    } catch (error) {
      console.error("[report] generation failed", error instanceof Error ? error.name : typeof error);
      await this.ctx.storage.setAlarm(Date.now() + attempts * report.alarmBackoffMs);
    } finally {
      clearTimeout(watchdog);
    }
  }

  async status(activityId: string): Promise<{ status: string }> {
    const row = await one<{ status: string }>(this.env.DB, "SELECT status FROM reports WHERE activity_id = $id", {
      id: activityId,
    });
    return { status: row?.status ?? "none" };
  }

  async generate(activityId: string): Promise<void> {
    const { report } = routingConfig;
    const db = this.env.DB;
    const activity = await one<{ title: string; statement: string; classroom_id: string }>(
      db,
      `SELECT t.title, t.statement, a.classroom_id
       FROM activities a JOIN topics t ON t.id = a.topic_id WHERE a.id = $id`,
      { id: activityId },
    );
    if (!activity) throw new Error("activity_missing");
    const members = await all<{ user_id: string; name: string; lang: "zh" | "en" | "es" }>(
      db,
      "SELECT m.user_id, m.name, u.lang FROM members m JOIN users u ON u.id = m.user_id WHERE m.classroom_id = $cid ORDER BY m.joined_at, m.user_id",
      { cid: activity.classroom_id },
    );

    const pseudonyms = new Map<string, string>();
    for (const [index, member] of members.entries()) {
      const existing = await one<{ pseudonym: string }>(
        db,
        "SELECT pseudonym FROM pseudonyms WHERE activity_id = $aid AND student_id = $sid",
        { aid: activityId, sid: member.user_id },
      );
      const pseudonym = existing?.pseudonym ?? `${report.pseudonymPrefix}${index + 1}`;
      pseudonyms.set(member.user_id, pseudonym);
      if (!existing) {
        await run(
          db,
          "INSERT INTO pseudonyms (activity_id, student_id, pseudonym) VALUES ($aid, $sid, $p) ON CONFLICT DO NOTHING",
          {
            aid: activityId,
            sid: member.user_id,
            p: pseudonym,
          },
        );
      }
    }

    const legs = await this.teacherLegs();
    const teacherLang = await this.teacherLanguage();
    const batch = this.batchSize(members.length, legs);
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
          for (let attempt = 0; attempt < report.studentAttempts; attempt += 1) {
            const { text, payload } = await this.runAgent(
              harness,
              "student-report",
              this.studentReportPrompt(activity, transcript),
              legs,
              { lang: member.lang, submitTool: SUBMIT_STUDENT_ANALYSIS },
            );
            try {
              studentAnalyses.set(member.user_id, StudentAnalysisSchema.parse(payloadOf(text, payload, "report")));
              break;
            } catch (error) {
              console.error(
                "[report] student analysis parse failed",
                error instanceof Error ? error.name : typeof error,
              );
              if (attempt === report.studentAttempts - 1) studentAnalyses.set(member.user_id, null);
            }
          }
        }),
      );
    }

    const classInput = this.classReportPrompt(activity, members, transcripts, pseudonyms);
    try {
      const { text: classText, payload: classPayload } = await this.runAgent(
        harness,
        "class-report",
        classInput,
        legs,
        { lang: teacherLang, submitTool: SUBMIT_CLASS_REPORT },
      );
      const classReport = ClassReportSchema.parse(payloadOf(classText, classPayload));
      await this.persist(activityId, activity.title, classReport, studentAnalyses, pseudonyms, transcripts);
    } catch (error) {
      console.error("[report] class report failed", error instanceof Error ? error.name : typeof error);
      await this.persist(activityId, activity.title, null, studentAnalyses, pseudonyms, transcripts);
      throw error;
    }
  }

  private async openHarness(): Promise<Harness> {
    return Harness.open(
      new MemoryStorage(),
      { models: this.models.models, registry: this.registry },
      BACKGROUND_CONTEXT,
    );
  }

  private async runAgent(
    harness: Harness,
    profile: "student-report" | "class-report",
    input: string,
    legs: TeacherLeg[],
    options: { lang: Lang; submitTool: string },
  ): Promise<{ text: string; payload: JsonObject | null }> {
    return runProfile(
      harness,
      { models: this.models, registry: this.registry, env: this.env },
      profile,
      input,
      legs,
      options,
    );
  }

  private async teacherLanguage(): Promise<Lang> {
    const teacherId = await teacherOfActivity(this.env, this.ctx.id.name ?? "");
    if (!teacherId) return "zh";
    const row = await one<{ lang: Lang }>(this.env.DB, "SELECT lang FROM users WHERE id = $id", {
      id: teacherId,
    });
    return row?.lang ?? "zh";
  }

  private batchSize(memberCount: number, legs: TeacherLeg[]): number {
    const budget = getRouter(this.env).budget("batch", legs);
    return budget > 0 ? Math.min(budget, memberCount) : Math.min(8, memberCount);
  }

  private async teacherLegs(): Promise<TeacherLeg[]> {
    return teacherLegsOf(this.env, await teacherOfActivity(this.env, this.ctx.id.name ?? ""));
  }

  private async transcriptOf(
    activityId: string,
    studentId: string,
    pseudonyms: Map<string, string>,
  ): Promise<{ text: string; violations: ViolationSlice[] }> {
    const stub = this.env.Chat.get(this.env.Chat.idFromName(`${activityId}:${studentId}`));
    const data = await stub.transcript();
    const pseudonym = pseudonyms.get(studentId) ?? studentId;
    const text = data.messages
      .map((message) =>
        message.role === "user"
          ? `${pseudonym}（${message.turn}）：${indentedContinuations(message.text)}`
          : `AI：${message.text}`,
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
    classReport: ClassReport | null,
    studentAnalyses: Map<string, StudentAnalysis | null>,
    pseudonyms: Map<string, string>,
    transcripts: Map<string, { text: string; violations: ViolationSlice[] }>,
  ): Promise<void> {
    const students: Record<string, unknown> = {};
    for (const [studentId, analysis] of studentAnalyses) {
      const pseudonym = pseudonyms.get(studentId) ?? studentId;
      students[studentId] = {
        pseudonym,
        analysis,
        violations: transcripts.get(studentId)?.violations ?? [],
        positions: positionsOf(classReport, pseudonym),
      };
    }

    await run(
      this.env.DB,
      `UPDATE reports SET status = $status,
        teacher_report = $teacher, student_reports = $students, updated_at = $at
       WHERE activity_id = $id`,
      {
        id: activityId,
        status: classReport ? "ready" : "partial",
        teacher: JSON.stringify({ topicTitle, classReport }),
        students: JSON.stringify(students),
        at: nowIso(),
      },
    );
  }
}

function positionsOf(classReport: ClassReport | null, pseudonym: string): ReportPosition[] {
  if (!classReport) return [];
  const positions: ReportPosition[] = [];
  for (const axis of classReport.axes) {
    for (const position of axis.positions) {
      if (position.id === pseudonym) {
        positions.push({ axis: axis.name, view: position.view, end: position.end, at: position.at });
      }
    }
  }
  return positions;
}

function payloadOf(text: string, payload: JsonObject | null, key?: string): unknown {
  if (payload !== null) {
    const value = key === undefined ? payload : payload[key];
    if (value === undefined) throw new Error("tool_payload_missing_key");
    return value;
  }
  const stripped = text
    .replace(/^\s*```(?:json)?\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const start = stripped.indexOf("{");
  const end = stripped.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no_json_object_in_text");
  return JSON.parse(stripped.slice(start, end + 1));
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
      [
        fauxToolCall(SUBMIT_CLASS_REPORT, {
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
      ],
      { stopReason: "toolUse" },
    );
  }
  return fauxAssistantMessage(
    [
      fauxToolCall(SUBMIT_STUDENT_ANALYSIS, {
        report: {
          stated: true,
          claim: { text: "契約應該被遵守", turns: [1] },
          reasons: { text: "因為雙方事先同意", turns: [1] },
          tension: null,
        },
      }),
    ],
    { stopReason: "toolUse" },
  );
}

function indentedContinuations(text: string): string {
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? line : `  ${line}`))
    .join("\n");
}

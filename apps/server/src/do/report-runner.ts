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
import { secretOf } from "../auth";
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
import { getRouter } from "../gateway/router";
import { gatewayConfig } from "../gateway/config.gen";
import { fauxReplayExtension } from "../pi/extensions/faux-replay";
import { createUsageExtension } from "../pi/extensions/usage";

export type ReportAlarmPlan =
  | { action: "terminal" }
  | { action: "rearm"; delayMs: number }
  | { action: "generate"; backoffMs: number };

interface RawTranscript {
  messages: Array<{ role: "user" | "assistant"; turn: number; text: string }>;
  turns: number;
  violations: ViolationSlice[];
}

function renderTranscript(
  participantId: string,
  transcript: RawTranscript | undefined,
  pseudonyms: Map<string, string>,
): { text: string; violations: ViolationSlice[] } {
  const pseudonym = pseudonyms.get(participantId) ?? participantId;
  const text = (transcript?.messages ?? [])
    .map((message) =>
      message.role === "user"
        ? `${pseudonym}（${message.turn}）：${indentedContinuations(message.text)}`
        : `AI：${message.text}`,
    )
    .join("\n");
  return { text, violations: transcript?.violations ?? [] };
}

export function reportAlarmPlan(input: {
  attempts: number;
  cap: number;
  inFlight: boolean;
  timeoutMs: number;
  backoffMs: number;
}): ReportAlarmPlan {
  if (input.attempts > input.cap) return { action: "terminal" };
  if (input.inFlight) return { action: "rearm", delayMs: input.timeoutMs };
  return { action: "generate", backoffMs: input.attempts * input.backoffMs };
}

export class ReportRunner extends DurableObject<Env> {
  #inFlight: Promise<void> | null = null;
  readonly models = buildModels(this.env, {
    teacherOf: () => teacherOfActivity(this.env, this.ctx.id.name ?? ""),
  });
  readonly registry = createRegistry();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.registry.install(reportSubmitExtension);
    this.registry.install(createUsageExtension(this.env, () => teacherOfActivity(this.env, this.ctx.id.name ?? "")));
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
        `INSERT INTO reports (activity_id, status, created_at, updated_at)
         VALUES ($id, 'pending', $at, $at)
         ON CONFLICT(activity_id) DO UPDATE SET status = 'pending', teacher_report = NULL, student_reports = NULL, updated_at = $at`,
        {
          id: input.activityId,
          at: nowIso(),
        },
      );
    } else {
      await run(
        db,
        "UPDATE reports SET status = 'pending', teacher_report = NULL, student_reports = NULL, updated_at = $at WHERE activity_id = $id",
        {
          id: input.activityId,
          at: nowIso(),
        },
      );
    }
    if (!this.#inFlight) await this.ctx.storage.put("attempts", 0);
    await this.ctx.storage.setAlarm(Date.now() + 50);
    return "started";
  }

  async alarm(): Promise<void> {
    const { report } = gatewayConfig;
    const activityId = this.ctx.id.name ?? "";
    const db = this.env.DB;
    if (this.#inFlight) {
      const attempts = ((await this.ctx.storage.get<number>("attempts")) ?? 0) + 1;
      await this.ctx.storage.put("attempts", attempts);
      const plan = reportAlarmPlan({
        attempts,
        cap: report.alarmAttempts,
        inFlight: true,
        timeoutMs: report.alarmTimeoutMs,
        backoffMs: report.alarmBackoffMs,
      });
      if (plan.action === "terminal") {
        await this.#markTerminal(db, activityId);
        return;
      }
      const delayMs = plan.action === "rearm" ? plan.delayMs : report.alarmTimeoutMs;
      await this.ctx.storage.setAlarm(Date.now() + delayMs);
      return;
    }
    const row = await one<{ status: string }>(db, "SELECT status FROM reports WHERE activity_id = $id", {
      id: activityId,
    });
    if (row?.status === "ready" || row?.status === "partial" || row?.status === "failed") return;
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
    const plan = reportAlarmPlan({
      attempts,
      cap: report.alarmAttempts,
      inFlight: false,
      timeoutMs: report.alarmTimeoutMs,
      backoffMs: report.alarmBackoffMs,
    });
    if (plan.action === "terminal") {
      await this.#markTerminal(db, activityId);
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
      const backoffMs = plan.action === "generate" ? plan.backoffMs : report.alarmBackoffMs;
      await this.ctx.storage.setAlarm(Date.now() + backoffMs);
    } finally {
      clearTimeout(watchdog);
    }
  }

  async #markTerminal(db: D1Database, activityId: string): Promise<void> {
    await run(
      db,
      "UPDATE reports SET status = CASE WHEN student_reports IS NOT NULL THEN 'partial' ELSE 'failed' END, updated_at = $at WHERE activity_id = $id",
      { id: activityId, at: nowIso() },
    );
  }

  async status(activityId: string): Promise<{ status: string }> {
    const row = await one<{ status: string }>(this.env.DB, "SELECT status FROM reports WHERE activity_id = $id", {
      id: activityId,
    });
    return { status: row?.status ?? "none" };
  }

  async generate(activityId: string): Promise<void> {
    const { report } = gatewayConfig;
    const db = this.env.DB;
    const activity = await one<{ title: string; statement: string }>(
      db,
      `SELECT t.title, t.statement
       FROM activities a JOIN topics t ON t.id = a.topic_id WHERE a.id = $id`,
      { id: activityId },
    );
    if (!activity) throw new Error("activity_missing");
    if (this.models.faux && activity.statement.includes(FAUX_GENERATE_FAILURE_MARKER)) {
      throw new Error("faux_report_generate_failure");
    }
    const participants = await all<{ id: string; display_name: string; lang: Lang }>(
      db,
      `SELECT p.id, p.display_name, COALESCE(u.lang, 'zh') AS lang
       FROM activity_participants p
       LEFT JOIN users u ON u.id = p.user_id
       WHERE p.activity_id = $aid
       ORDER BY p.joined_at, p.id`,
      { aid: activityId },
    );

    const legs = await this.teacherLegs();
    const batch = this.batchSize(participants.length, legs);
    const transcripts = new Map<string, RawTranscript>();
    for (let i = 0; i < participants.length; i += batch) {
      await Promise.all(
        participants.slice(i, i + batch).map(async (participant) => {
          try {
            transcripts.set(participant.id, await this.transcriptOf(activityId, participant.id));
          } catch (error) {
            console.error("[report] transcript fetch failed", error instanceof Error ? error.name : typeof error);
          }
        }),
      );
    }

    const roster = participants.filter((participant) => {
      const transcript = transcripts.get(participant.id);
      return transcript === undefined || transcript.turns > 0;
    });

    const pseudonyms = new Map<string, string>();
    const ranks = await pseudonymRanks(
      secretOf({ env: this.env }),
      activityId,
      roster.map((p) => p.id),
    );
    for (const participant of roster) {
      const existing = await one<{ pseudonym: string }>(
        db,
        "SELECT pseudonym FROM pseudonyms WHERE activity_id = $aid AND participant_id = $pid",
        { aid: activityId, pid: participant.id },
      );
      let pseudonym = existing?.pseudonym ?? "";
      if (!pseudonym) {
        let serial = ranks.get(participant.id) ?? 1;
        while ([...pseudonyms.values()].includes(`${report.pseudonymPrefix}${serial}`)) serial += 1;
        pseudonym = `${report.pseudonymPrefix}${serial}`;
      }
      pseudonyms.set(participant.id, pseudonym);
      if (!existing) {
        await run(
          db,
          "INSERT INTO pseudonyms (activity_id, participant_id, pseudonym) VALUES ($aid, $pid, $p) ON CONFLICT DO NOTHING",
          {
            aid: activityId,
            pid: participant.id,
            p: pseudonym,
          },
        );
      }
    }

    const teacherLang = await this.teacherLanguage();
    const rendered = new Map<string, { text: string; violations: ViolationSlice[] }>();
    for (const participant of roster) {
      rendered.set(participant.id, renderTranscript(participant.id, transcripts.get(participant.id), pseudonyms));
    }

    const harness = await this.openHarness();
    const studentAnalyses = new Map<string, StudentAnalysis | null>();
    for (let i = 0; i < roster.length; i += batch) {
      await Promise.all(
        roster.slice(i, i + batch).map(async (participant) => {
          const transcript = rendered.get(participant.id)?.text ?? "";
          if (!transcript.trim()) {
            studentAnalyses.set(participant.id, null);
            return;
          }
          try {
            for (let attempt = 0; attempt < report.studentAttempts; attempt += 1) {
              const { text, payload } = await this.runAgent(
                harness,
                "student-report",
                this.studentReportPrompt(activity, transcript),
                legs,
                { lang: participant.lang, submitTool: SUBMIT_STUDENT_ANALYSIS },
              );
              try {
                studentAnalyses.set(participant.id, StudentAnalysisSchema.parse(payloadOf(text, payload, "report")));
                break;
              } catch (error) {
                console.error(
                  "[report] student analysis parse failed",
                  error instanceof Error ? error.name : typeof error,
                );
                if (attempt === report.studentAttempts - 1) studentAnalyses.set(participant.id, null);
              }
            }
          } catch (error) {
            console.error("[report] student analysis failed", error instanceof Error ? error.name : typeof error);
            studentAnalyses.set(participant.id, null);
          }
        }),
      );
    }

    const classInput = this.classReportPrompt(activity, roster, rendered, pseudonyms);
    try {
      const { text: classText, payload: classPayload } = await this.runAgent(
        harness,
        "class-report",
        classInput,
        legs,
        { lang: teacherLang, submitTool: SUBMIT_CLASS_REPORT },
      );
      const classReport = ClassReportSchema.parse(payloadOf(classText, classPayload));
      await this.persist(activityId, activity.title, classReport, roster, studentAnalyses, pseudonyms, rendered);
    } catch (error) {
      console.error("[report] class report failed", error instanceof Error ? error.name : typeof error);
      await this.persist(activityId, activity.title, null, roster, studentAnalyses, pseudonyms, rendered);
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

  private batchSize(participantCount: number, legs: TeacherLeg[]): number {
    const budget = getRouter(this.env).budget("batch", legs);
    return budget > 0 ? Math.min(budget, participantCount) : Math.min(8, participantCount);
  }

  private async teacherLegs(): Promise<TeacherLeg[]> {
    return teacherLegsOf(this.env, await teacherOfActivity(this.env, this.ctx.id.name ?? ""));
  }

  private async transcriptOf(activityId: string, participantId: string): Promise<RawTranscript> {
    const stub = this.env.Chat.get(this.env.Chat.idFromName(`${activityId}:${participantId}`));
    const data = await stub.transcript();
    return {
      messages: data.messages,
      turns: data.messages.filter((message) => message.role === "user").length,
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
    roster: Array<{ id: string }>,
    transcripts: Map<string, { text: string; violations: ViolationSlice[] }>,
    pseudonyms: Map<string, string>,
  ): string {
    const names = roster.map((p) => pseudonyms.get(p.id) ?? "").filter(Boolean);
    const conversations = roster
      .map((p) => `### ${pseudonyms.get(p.id) ?? p.id}\n${transcripts.get(p.id)?.text ?? ""}`)
      .join("\n\n");
    return `## Topic: ${activity.title}\n${activity.statement}\n\n## Roster: ${names.length} students in the class\n${names.join(", ")}\n\n## The whole class's conversations\n${conversations}`;
  }

  private async persist(
    activityId: string,
    topicTitle: string,
    classReport: ClassReport | null,
    roster: Array<{ id: string; display_name: string }>,
    studentAnalyses: Map<string, StudentAnalysis | null>,
    pseudonyms: Map<string, string>,
    transcripts: Map<string, { text: string; violations: ViolationSlice[] }>,
  ): Promise<void> {
    const students: Record<string, unknown> = {};
    for (const participant of roster) {
      const participantId = participant.id;
      const analysis = studentAnalyses.get(participantId) ?? null;
      const pseudonym = pseudonyms.get(participantId) ?? participantId;
      students[participantId] = {
        participantName: participant.display_name,
        pseudonym,
        analysis,
        violations: transcripts.get(participantId)?.violations ?? [],
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

export async function pseudonymRanks(
  secret: string,
  activityId: string,
  participantIds: readonly string[],
): Promise<Map<string, number>> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const ranked = await Promise.all(
    participantIds.map(async (id) => {
      const mac = new Uint8Array(
        await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${activityId}:${id}`)),
      );
      return { id, digest: [...mac].map((byte) => byte.toString(16).padStart(2, "0")).join("") };
    }),
  );
  ranked.sort((a, b) => (a.digest === b.digest ? a.id.localeCompare(b.id) : a.digest < b.digest ? -1 : 1));
  return new Map(ranked.map((entry, index) => [entry.id, index + 1]));
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

const FAUX_CLASS_FAILURE_MARKER = "FORCE-CLASS-REPORT-FAILURE";
const FAUX_GENERATE_FAILURE_MARKER = "FORCE-REPORT-GENERATE-FAILURE";

function fauxReportScript(context: TranscriptContext): AssistantMessage {
  const last = context.messages.filter((message) => message.role !== "system").at(-1);
  const prompt = last?.role === "user" ? textOf(last.content) : "";
  if (prompt.includes("## Roster:")) {
    if (prompt.includes(FAUX_CLASS_FAILURE_MARKER)) {
      return fauxAssistantMessage([fauxToolCall(SUBMIT_CLASS_REPORT, { students: "schema-mismatch-on-purpose" })], {
        stopReason: "toolUse",
      });
    }
    const rosterLine = prompt.split("## Roster:")[1]!.split("\n")[1] ?? "";
    const roster = rosterLine
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    const first = roster[0] ?? "學生A";
    const second = roster[1] ?? first;
    return fauxAssistantMessage(
      [
        fauxToolCall(SUBMIT_CLASS_REPORT, {
          students: [{ id: first, summary: [{ step: "提出直覺判斷並被追問理由", turns: [1] }] }],
          unstated: [],
          axes: [
            {
              name: "契約與承諾",
              low: "契約至上",
              high: "人情優先",
              positions: [
                { id: first, turns: [1], view: "先守約再談情", end: "middle", at: 50 },
                { id: second, turns: [1], view: "契約就是契約", end: "low", at: 10 },
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

import { DurableObject } from "cloudflare:workers";
import { createRegistry, Harness, type Registry } from "@earendil-works/pi-durable";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { MemoryStorage } from "@earendil-works/pi-durable/storage/memory";
import type { JsonObject } from "@earendil-works/pi-durable";
import {
  fauxAssistantMessage,
  fauxToolCall,
  type AssistantMessage,
  type TranscriptContext,
} from "@earendil-works/pi-ai";
import { byCodeUnit } from "@socrates/shared";
import type { Env } from "../env";
import { secretOf } from "../auth";
import { buildModels } from "../pi/models";
import { runProfile } from "../pi/agents/profiles";
import { teacherLegsOf, teacherOfActivity, type TeacherLeg } from "../pi/credentials";
import {
  PlannedClassReportSubmissionSchema,
  ReportAxesPlanSchema,
  reportSubmitAxesExtension,
  type PlannedClassReportSubmission,
  type ReportAxesPlan,
  reportSubmitExtension,
  SUBMIT_CLASS_AXES_REPORT,
  SUBMIT_CLASS_REPORT,
  SUBMIT_STUDENT_ANALYSIS,
} from "../pi/extensions/report-submit";
import { all, one, run } from "../db/d1";
import { nowIso } from "../http";
import { classReportInput, studentReportInput } from "../prompts/assemble";
import {
  ClassReportSubmissionSchema,
  StudentAnalysisSchema,
  type ClassReport,
  type ClassReportSubmission,
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

export function collapseViolations(violations: readonly ViolationSlice[]): ViolationSlice[] {
  const seen = new Set<string>();
  return violations.filter((violation) => {
    const key = `${violation.turn}:${violation.type}:${violation.excerpt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
  readonly axesRegistry = createRegistry();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.registry.install(reportSubmitExtension);
    this.axesRegistry.install(reportSubmitAxesExtension);
    for (const registry of [this.registry, this.axesRegistry]) {
      registry.install(createUsageExtension(this.env, () => teacherOfActivity(this.env, this.ctx.id.name ?? "")));
    }
    if (this.models.faux) {
      this.models.faux.setResponses([fauxReportScript]);
      for (const registry of [this.registry, this.axesRegistry]) {
        registry.install(fauxReplayExtension(this.models.faux, fauxReportScript));
      }
    }
  }

  async startReport(input: { activityId: string; axes?: ReportAxesPlan }): Promise<"started" | "ready"> {
    const axes = input.axes === undefined ? undefined : ReportAxesPlanSchema.parse(input.axes);
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
    if (axes) await this.ctx.storage.put(AXES_PLAN_KEY, axes);
    else await this.ctx.storage.delete(AXES_PLAN_KEY);
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
    const axesPlan = await this.ctx.storage.get<ReportAxesPlan>(AXES_PLAN_KEY);
    if (this.models.faux && activity.statement.includes(FAUX_GENERATE_FAILURE_MARKER)) {
      throw new Error("faux_report_generate_failure");
    }
    const participants = await all<{ id: string; display_name: string }>(
      db,
      `SELECT p.id, p.display_name
       FROM activity_participants p
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
                studentReportInput(activity, transcript),
                legs,
                { lang: teacherLang, submitTool: SUBMIT_STUDENT_ANALYSIS },
              );
              try {
                const analysis = StudentAnalysisSchema.parse(payloadOf(text, payload, "report"));
                if (!citesSpokenLines(analysis, transcripts.get(participant.id)?.turns ?? 0)) {
                  throw new Error("report_turn_not_spoken");
                }
                studentAnalyses.set(participant.id, analysis);
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

    const classRoster = roster.map((p) => pseudonyms.get(p.id) ?? "").filter(Boolean);
    const classInput = classReportInput(
      activity,
      classRoster,
      roster.map((p) => ({ id: pseudonyms.get(p.id) ?? p.id, transcript: rendered.get(p.id)?.text ?? "" })),
      axesPlan,
    );
    try {
      const classReport = axesPlan
        ? await this.plannedClassReport(axesPlan, classRoster, classInput, legs, teacherLang)
        : await this.openClassReport(harness, classInput, legs, teacherLang);
      await this.persist(activityId, activity.title, classReport, roster, studentAnalyses, pseudonyms, rendered);
    } catch (error) {
      console.error("[report] class report failed", error instanceof Error ? error.name : typeof error);
      await this.persist(activityId, activity.title, null, roster, studentAnalyses, pseudonyms, rendered);
      throw error;
    }
  }

  private async openClassReport(harness: Harness, input: string, legs: TeacherLeg[], lang: Lang): Promise<ClassReport> {
    const { text, payload } = await this.runAgent(harness, "class-report", input, legs, {
      lang,
      submitTool: SUBMIT_CLASS_REPORT,
    });
    return toClassReport(ClassReportSubmissionSchema.parse(payloadOf(text, payload)));
  }

  private async plannedClassReport(
    plan: ReportAxesPlan,
    roster: string[],
    input: string,
    legs: TeacherLeg[],
    lang: Lang,
  ): Promise<ClassReport> {
    const harness = await this.openHarness(this.axesRegistry);
    const { text, payload } = await this.runAgent(
      harness,
      "class-report-axes",
      input,
      legs,
      { lang, submitTool: SUBMIT_CLASS_AXES_REPORT },
      this.axesRegistry,
    );
    return toPlannedClassReport(plan, roster, PlannedClassReportSubmissionSchema.parse(payloadOf(text, payload)));
  }

  private async openHarness(registry: Registry = this.registry): Promise<Harness> {
    return Harness.open(new MemoryStorage(), { models: this.models.models, registry }, BACKGROUND_CONTEXT);
  }

  private async runAgent(
    harness: Harness,
    profile: "student-report" | "class-report" | "class-report-axes",
    input: string,
    legs: TeacherLeg[],
    options: { lang: Lang; submitTool: string },
    registry: Registry = this.registry,
  ): Promise<{ text: string; payload: JsonObject | null }> {
    return runProfile(harness, { models: this.models, registry, env: this.env }, profile, input, legs, options);
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
      violations: collapseViolations(
        data.violations.map((violation) => ({
          turn: violation.turn,
          type: violation.type as ViolationType,
          excerpt: violation.excerpt,
        })),
      ),
    };
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

export function pointOnAxis(
  side: "left" | "middle" | "right",
  strength: number,
): { end: "low" | "middle" | "high"; at: number } {
  if (side === "middle") return { end: "middle", at: 50 };
  return side === "left" ? { end: "low", at: 50 - strength * 10 } : { end: "high", at: 50 + strength * 10 };
}

export function toPlannedClassReport(
  plan: ReportAxesPlan,
  roster: string[],
  submission: PlannedClassReportSubmission,
): ClassReport {
  if (submission.teacherAxes.length !== plan.teacher.length) throw new Error("report_teacher_axes_mismatch");
  if (plan.teacher.length + submission.addedAxes.length > plan.count) throw new Error("report_axes_over_count");
  const { teacherAxes, addedAxes, ...rest } = submission;
  const axes = [
    ...teacherAxes.map(({ positions, why }, index) => ({ ...plan.teacher[index]!, positions, why })),
    ...addedAxes,
  ];
  const everyone = [...roster].sort(byCodeUnit);
  for (const axis of axes) {
    const listed = axis.positions.map(({ id }) => id).sort();
    if (listed.length !== everyone.length || listed.some((id, index) => id !== everyone[index])) {
      throw new Error("report_axis_roster_mismatch");
    }
  }
  return toClassReport({ ...rest, axes });
}

export function toClassReport(submission: ClassReportSubmission): ClassReport {
  return {
    ...submission,
    axes: submission.axes.map(({ name, left, right, positions, why }) => ({
      name,
      low: left,
      high: right,
      positions: positions.map(({ id, turns, view, side, strength }) => ({
        id,
        turns,
        view,
        ...pointOnAxis(side, strength),
      })),
      why,
    })),
  };
}

export function citesSpokenLines(analysis: StudentAnalysis, spokenLines: number): boolean {
  const cited = analysis.stated
    ? [...analysis.claim.turns, ...analysis.reasons.turns, ...(analysis.tension?.turns ?? [])]
    : analysis.doing.turns;
  return cited.every((turn) => turn <= spokenLines);
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

const AXES_PLAN_KEY = "axesPlan";
const FAUX_CLASS_FAILURE_MARKER = "FORCE-CLASS-REPORT-FAILURE";
const FAUX_GENERATE_FAILURE_MARKER = "FORCE-REPORT-GENERATE-FAILURE";
const FAUX_UNSPOKEN_TURN_MARKER = "FORCE-UNSPOKEN-TURN";
const fauxUnspokenCited = new Set<string>();

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
    const axesHeader = /^## Axes: (\d+) in total; the teacher set (\d+|none)$/m.exec(
      prompt.split("## Roster:")[0] ?? "",
    );
    if (axesHeader) {
      const everyone = roster.map((id) => ({ id, turns: [1], view: "v", side: "middle", strength: 1 }));
      const count = Number(axesHeader[1]);
      const teacher = axesHeader[2] === "none" ? 0 : Number(axesHeader[2]);
      return fauxAssistantMessage(
        [
          fauxToolCall(SUBMIT_CLASS_AXES_REPORT, {
            students: [{ id: first, summary: [{ step: "守約→會拉", turns: [1] }] }],
            unstated: [],
            teacherAxes: Array.from({ length: teacher }, () => ({
              positions: everyone,
              why: "x",
            })),
            addedAxes: Array.from({ length: count - teacher }, (_, index) => ({
              name: `補${index + 1}`,
              left: "甲",
              right: "乙",
              positions: everyone,
              why: "x",
            })),
            overview: ["x"],
          }),
        ],
        { stopReason: "toolUse" },
      );
    }
    return fauxAssistantMessage(
      [
        fauxToolCall(SUBMIT_CLASS_REPORT, {
          students: [{ id: first, summary: [{ step: "提出直覺判斷並被追問理由", turns: [1] }] }],
          unstated: [],
          axes: [
            {
              name: "契約與承諾",
              left: "契約至上",
              right: "人情優先",
              positions: [
                { id: first, turns: [1], view: "先守約再談情", side: "middle", strength: 1 },
                { id: second, turns: [1], view: "契約就是契約", side: "left", strength: 4 },
              ],
              why: "多數先守約",
            },
          ],
          overview: ["契約與人情的取捨"],
        }),
      ],
      { stopReason: "toolUse" },
    );
  }
  const citesUnspoken = prompt.includes(FAUX_UNSPOKEN_TURN_MARKER) && !fauxUnspokenCited.has(prompt);
  if (citesUnspoken) fauxUnspokenCited.add(prompt);
  const claimTurns = citesUnspoken ? [99] : [1];
  return fauxAssistantMessage(
    [
      fauxToolCall(SUBMIT_STUDENT_ANALYSIS, {
        report: {
          stated: true,
          claim: { text: "契約應該被遵守", turns: claimTurns },
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

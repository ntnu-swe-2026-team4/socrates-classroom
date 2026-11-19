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
import {
  submittedArguments,
  SUBMIT_CLASS_AXES_REPORT,
  reportSubmitExtension,
  SUBMIT_CLASS_REPORT,
  SUBMIT_STUDENT_ANALYSIS,
} from "../pi/extensions/report-submit";
import { all, one, run } from "../db/d1";
import { nowIso } from "../http";
import { classReportInput, studentReportInput } from "../prompts/assemble";
import { reportAxesOf } from "../services/settings";
import {
  AxisSchema,
  ClassAxesPlacementSchema,
  ReportAxesSchema,
  ClassPlacementSchema,
  StudentAnalysisSchema,
  type Axis,
  type ClassAxesPlacement,
  type ClassPlacement,
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

export type ReportAlarmPlan =
  | { action: "terminal" }
  | { action: "rearm"; delayMs: number }
  | { action: "generate"; backoffMs: number };

interface RawTranscript {
  messages: Array<{ role: "user" | "assistant"; turn: number; text: string }>;
  turns: number;
  violations: ViolationSlice[];
}

/** The line numbers the student actually said; a report may only cite these. */
function spokenTurns(transcript: RawTranscript | undefined): number[] {
  return (transcript?.messages ?? []).filter((message) => message.role === "user").map((message) => message.turn);
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
    const row = await one<{ title: string; statement: string; axes: string; report_axes: string | null }>(
      db,
      `SELECT t.title, t.statement, t.axes, a.report_axes
       FROM activities a JOIN topics t ON t.id = a.topic_id WHERE a.id = $id`,
      { id: activityId },
    );
    if (!row) throw new Error("activity_missing");
    // The teacher's axes; a topic saved before axes existed has none, and its class report is the overview alone.
    const activity = { ...row, axes: AxisSchema.array().parse(JSON.parse(row.axes || "[]")) };
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
              // Student reports follow the teacher's language, like the class report (product decision): the teacher is
              // their main reader, though the student also sees their own.
              const { text, payload } = await this.runAgent(
                harness,
                "student-report",
                studentReportInput(activity, transcript),
                legs,
                { lang: teacherLang, submitTool: SUBMIT_STUDENT_ANALYSIS },
              );
              try {
                const analysis = StudentAnalysisSchema.parse(
                  payloadOf(text, payload, SUBMIT_STUDENT_ANALYSIS, "report"),
                );
                assertTurnsSpoken(analysisTurns(analysis), spokenTurns(transcripts.get(participant.id)));
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

    // Who stated a position comes from the student reports only; the class model never decides it again, so the two
    // reports cannot disagree. The class model reads the student reports instead of every raw conversation and only
    // places the students on the teacher's axes and writes the overview, which is what keeps it fast for a large class.
    const stated: Array<{ id: string; analysis: Extract<StudentAnalysis, { stated: true }> }> = [];
    const unstated: string[] = [];
    // Students we cannot place: their transcript could not be fetched, or they spoke but no analysis survived. They are
    // neither stated nor unstated; the teacher sees their missing analysis in the individual view.
    const unaccounted: string[] = [];
    for (const participant of roster) {
      const id = pseudonyms.get(participant.id) ?? participant.id;
      const analysis = studentAnalyses.get(participant.id) ?? null;
      const fetched = transcripts.has(participant.id);
      if (analysis?.stated) stated.push({ id, analysis });
      else if (analysis || (fetched && !rendered.get(participant.id)?.text.trim())) unstated.push(id);
      else unaccounted.push(id);
    }
    if (unaccounted.length > 0) console.warn("[report] students without an analysis", unaccounted.length);
    try {
      // "Nobody stated a position" is only true when every student is accounted for; otherwise the class report fails
      // instead of claiming it: stored as partial, like any class-report failure (finishing again regenerates).
      if (stated.length === 0 && unaccounted.length > 0) throw new Error("report_student_analyses_missing");
      // Who sets the axes (#159): the setting the activity started with (the current one for activities started before
      // it was kept): the teacher on the topic, or the model.
      const reportAxes = ReportAxesSchema.safeParse(row.report_axes);
      const teacherAxes = (reportAxes.success ? reportAxes.data : await reportAxesOf(db)) === "teacher";
      const classTool = teacherAxes ? SUBMIT_CLASS_REPORT : SUBMIT_CLASS_AXES_REPORT;
      const noneStated = { axes: [], overview: [NO_STATED_OVERVIEW[teacherLang]] };
      let placed = teacherAxes ? placeOnAxes(activity.axes, noneStated, [], "") : noneStated;
      // A class report the model did not submit, cut off, or sent in the wrong shape is tried again before the whole
      // class report is given up (glm-4.7-flash fails this way now and then on the same input it passes on another run).
      for (let attempt = 0; stated.length > 0; attempt += 1) {
        try {
          const { text: classText, payload: classPayload } = await this.runAgent(
            harness,
            teacherAxes ? "class-report" : "class-report-ai",
            classReportInput(teacherAxes ? activity : { title: activity.title, statement: activity.statement }, stated),
            legs,
            { lang: teacherLang, submitTool: classTool },
          );
          const submitted = payloadOf(classText, classPayload, classTool);
          placed = teacherAxes
            ? placeOnAxes(activity.axes, ClassPlacementSchema.parse(submitted), stated, report.pseudonymPrefix)
            : placeOnModelAxes(ClassAxesPlacementSchema.parse(submitted), stated, report.pseudonymPrefix);
          break;
        } catch (error) {
          if (attempt >= report.classAttempts - 1) throw error;
          console.error("[report] class report attempt failed", error instanceof Error ? error.name : typeof error);
        }
      }
      const classReport: ClassReport = {
        students: stated.map(({ id, analysis }) => ({ id, summary: summaryOf(analysis) })),
        unstated,
        ...placed,
      };
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
    profile: "student-report" | "class-report" | "class-report-ai",
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

/** The class overview when nobody stated a position: there is nothing for the class model to compare. */
const NO_STATED_OVERVIEW: Record<Lang, string> = {
  zh: "全班沒有人表態，沒有可比較的立場。",
  en: "No student stated a position, so there are no positions to compare.",
  es: "Ningún estudiante expresó una postura, así que no hay posturas que comparar.",
};

function analysisTurns(analysis: StudentAnalysis): number[] {
  if (!analysis.stated) return analysis.doing.turns;
  return [...analysis.claim.turns, ...analysis.reasons.turns, ...(analysis.tension?.turns ?? [])];
}

/** A report citing a line the student never said is not grounded in the conversation; it is retried like a bad shape. */
function assertTurnsSpoken(cited: number[], spoken: number[]): void {
  const said = new Set(spoken);
  if (cited.some((turn) => !said.has(turn))) throw new Error("report_turn_not_spoken");
}

function summaryOf(analysis: Extract<StudentAnalysis, { stated: true }>): ClassReport["students"][number]["summary"] {
  return [analysis.claim, analysis.reasons, ...(analysis.tension ? [analysis.tension] : [])].map((part) => ({
    step: part.text,
    turns: part.turns,
  }));
}

/**
 * The class report's axes are the teacher's, in the topic's order; the model only supplies positions, by axis number.
 * Positions may only place students whose own report says they stated a position, citing only lines from that report.
 * Turns outside the report are removed; a position left with none, for a student not on the roster, for an axis number
 * the topic does not have, or a second one for the same student on the same axis, is dropped rather than shown to the
 * teacher.
 */
type ReportAxisPosition = ClassReport["axes"][number]["positions"][number];

/** The stored end and point on the axis (0 = fully left, 100 = fully right) from the side and how firmly it is held. */
export function pointOnAxis(
  side: "left" | "middle" | "right",
  strength: number,
): { end: "low" | "middle" | "high"; at: number } {
  if (side === "middle") return { end: "middle", at: 50 };
  return side === "left" ? { end: "low", at: 50 - strength * 10 } : { end: "high", at: 50 + strength * 10 };
}

type Stated = Array<{ id: string; analysis: Extract<StudentAnalysis, { stated: true }> }>;

/**
 * Adds the model's positions on one axis to `positions`, keeping only students whose own report stated a position and
 * only lines cited in that report; one position per student per axis.
 */
function keepPositions(
  raw: ClassPlacement["axes"][number]["positions"],
  stated: Stated,
  pseudonymPrefix: string,
  positions: ReportAxisPosition[],
): void {
  const cited = new Map(stated.map(({ id, analysis }) => [id, new Set(analysisTurns(analysis))]));
  // Roster IDs are the prefix plus a serial. Some models rewrite the prefix ("1", or "学生1" in simplified characters
  // for "學生1"); an ID not on the roster is read by its trailing serial, which is still the same student.
  const rosterId = (value: string): string => {
    const id = value.trim();
    if (cited.has(id)) return id;
    const serial = /(\d+)$/.exec(id)?.[1];
    return serial ? `${pseudonymPrefix}${Number(serial)}` : id;
  };
  for (const position of raw) {
    const id = rosterId(position.id);
    const allowed = cited.get(id);
    const turns = allowed ? position.turns.filter((turn) => allowed.has(turn)) : [];
    if (turns.length === 0) {
      console.warn("[report] dropped a position outside the student reports");
      continue;
    }
    // one position per student per axis; a second one for the same student is dropped like any other
    if (positions.some((other) => other.id === id)) continue;
    positions.push({ id, turns, view: position.view, ...pointOnAxis(position.side, position.strength) });
  }
}

/** Axes set by the teacher: the topic's axes in order; the model only places students on them, by axis number. */
export function placeOnAxes(
  teacherAxes: Axis[],
  report: ClassPlacement,
  stated: Stated,
  pseudonymPrefix: string,
): Pick<ClassReport, "axes" | "overview"> {
  const placed: ReportAxisPosition[][] = teacherAxes.map(() => []);
  for (const entry of report.axes) {
    const positions = placed[entry.axis - 1];
    if (!positions) {
      if (entry.positions.length > 0) console.warn("[report] dropped positions on an axis the topic does not have");
      continue;
    }
    keepPositions(entry.positions, stated, pseudonymPrefix, positions);
  }
  return {
    axes: teacherAxes.map((axis, index) => ({
      name: axis.name,
      low: axis.left,
      high: axis.right,
      positions: placed[index]!,
    })),
    overview: report.overview,
  };
}

/**
 * Axes set by the model (report.axes = ai): its axes for this class, in its order. An axis left with no positions, or
 * with the name of an earlier one, places no one and is dropped.
 */
export function placeOnModelAxes(
  report: ClassAxesPlacement,
  stated: Stated,
  pseudonymPrefix: string,
): Pick<ClassReport, "axes" | "overview"> {
  const axes: ClassReport["axes"] = [];
  for (const entry of report.axes) {
    const name = entry.name.trim();
    if (!name || axes.some((axis) => axis.name === name)) continue;
    const positions: ReportAxisPosition[] = [];
    keepPositions(entry.positions, stated, pseudonymPrefix, positions);
    if (positions.length === 0) {
      console.warn("[report] dropped an axis with no positions left");
      continue;
    }
    axes.push({ name, low: entry.left, high: entry.right, positions, why: entry.why });
  }
  return { axes, overview: report.overview };
}

/** The payload is read from the assistant's tool call; submittedArguments turns it back into what the tool accepted. */
function payloadOf(text: string, payload: JsonObject | null, tool: string, key?: string): unknown {
  if (payload !== null) {
    const repaired = submittedArguments(tool, payload) as JsonObject;
    const value = key === undefined ? repaired : repaired[key];
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
const FAUX_OFF_TOPIC_MARKER = "python";
const FAUX_UNSPOKEN_TURN_MARKER = "FORCE-UNSPOKEN-TURN";
/** The class report fails on its first attempt only (each class prompt is failed once). */
const FAUX_CLASS_FLAKY_MARKER = "FORCE-CLASS-REPORT-FLAKY";
const fauxFlakyFailed = new Set<string>();

function fauxReportScript(context: TranscriptContext): AssistantMessage {
  const last = context.messages.filter((message) => message.role !== "system").at(-1);
  const prompt = last?.role === "user" ? textOf(last.content) : "";
  if (prompt.includes("## Roster:")) {
    const flakyFirst = prompt.includes(FAUX_CLASS_FLAKY_MARKER) && !fauxFlakyFailed.has(prompt);
    if (flakyFirst) fauxFlakyFailed.add(prompt);
    if (prompt.includes(FAUX_CLASS_FAILURE_MARKER) || flakyFirst) {
      return fauxAssistantMessage([fauxToolCall(SUBMIT_CLASS_REPORT, { axes: "schema-mismatch-on-purpose" })], {
        stopReason: "toolUse",
      });
    }
    const teacherAxes = prompt.includes("## The teacher's axes");
    const rosterLine = prompt.split("## Roster:")[1]!.split("\n")[1] ?? "";
    const roster = rosterLine
      .split(",")
      .map((name) => name.trim())
      .filter(Boolean);
    const first = roster[0] ?? "學生A";
    const second = roster[1] ?? first;
    return fauxAssistantMessage(
      [
        fauxToolCall(teacherAxes ? SUBMIT_CLASS_REPORT : SUBMIT_CLASS_AXES_REPORT, {
          axes: [
            {
              ...(teacherAxes ? { axis: 1 } : { name: "契約", left: "守約", right: "人情", why: "分歧" }),
              positions: [
                { id: first, turns: [1], view: "先守約再談情", side: "middle", strength: 1 },
                // written without the pseudonym prefix, as some models do; the runner maps it back to the roster ID
                {
                  id: second.replace(gatewayConfig.report.pseudonymPrefix, ""),
                  turns: [1],
                  view: "契約就是契約",
                  side: "left",
                  strength: 4,
                },
              ],
            },
            // an axis number the topic does not have: dropped by the runner (teacher-set axes only)
            ...(teacherAxes
              ? [{ axis: 9, positions: [{ id: first, turns: [1], view: "不存在的軸", side: "right", strength: 3 }] }]
              : []),
          ],
          overview: ["全班集中在契約與人情的取捨"],
        }),
      ],
      { stopReason: "toolUse" },
    );
  }
  // The class report reads the student reports, not the conversations, so the class-failure marker a student typed is
  // carried into the claim for the class step to see.
  const claim =
    [FAUX_CLASS_FAILURE_MARKER, FAUX_CLASS_FLAKY_MARKER].find((marker) => prompt.includes(marker)) ?? "契約應該被遵守";
  // A student who only asked for other work took no position.
  if (prompt.includes(FAUX_OFF_TOPIC_MARKER)) {
    return fauxAssistantMessage(
      [fauxToolCall(SUBMIT_STUDENT_ANALYSIS, { report: { stated: false, doing: { text: "要求寫程式", turns: [1] } } })],
      { stopReason: "toolUse" },
    );
  }
  // A report citing a line the student never said: rejected on every attempt, so the student ends with no analysis.
  const turns = prompt.includes(FAUX_UNSPOKEN_TURN_MARKER) ? [99] : [1];
  return fauxAssistantMessage(
    [
      fauxToolCall(SUBMIT_STUDENT_ANALYSIS, {
        report: {
          stated: true,
          claim: { text: claim, turns },
          reasons: { text: "因為雙方事先同意", turns },
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

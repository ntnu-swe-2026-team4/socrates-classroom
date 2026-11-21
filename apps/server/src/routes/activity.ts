import { Hono } from "hono";
import type { ZodType } from "zod";
import { z } from "zod";
import type { ActivityInfo, ActivitySlot, StudentReport, TeacherReport, ViolationType } from "@socrates/shared";
import {
  ACTIVITY_SLOT_MAX,
  ActivitySlotCreateInputSchema,
  StoredStudentReportsSchema,
  StoredTeacherReportSchema,
} from "@socrates/shared";
import { all, batch, one, run } from "../db/d1";
import {
  enforceIpLimit,
  fail,
  guardUser,
  langOf,
  newId,
  nowIso,
  requireUser,
  uniqueViolationColumns,
  validateJson,
  validateQuery,
  type AppEnv,
} from "../http";
import type { Env } from "../env";
import { activityAccess, activityAccessOf, ensureParticipant, participantOf, topicOf } from "../services/members";

const SLOT_NAME: Record<"zh" | "en" | "es", string> = { zh: "測試", en: "Test", es: "Prueba" };
const ActivityQuerySchema = z.object({ participantId: z.string().optional() });

function storedReport<T>(raw: string | null, schema: ZodType<T>): T | undefined {
  if (raw === null) return undefined;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

interface SlotRow {
  id: string;
  display_name: string;
}

async function slotStats(env: Env, activityId: string, slot: SlotRow): Promise<ActivitySlot> {
  try {
    const stub = env.Chat.get(env.Chat.idFromName(`${activityId}:${slot.id}`));
    const { messages } = await stub.transcript();
    const said = messages.filter((message) => message.role === "user").map((message) => message.text);
    return {
      id: slot.id,
      name: slot.display_name,
      rounds: said.length,
      lastUtterance: said.at(-1) ?? "",
    };
  } catch {
    return { id: slot.id, name: slot.display_name, rounds: 0, lastUtterance: "" };
  }
}

async function slotsPayload(env: Env, activityId: string) {
  const rows = await all<SlotRow>(
    env.DB,
    `SELECT id, display_name FROM activity_participants
     WHERE activity_id = $aid AND kind = 'teacher'
     ORDER BY joined_at, id`,
    { aid: activityId },
  );
  const slots = await Promise.all(rows.map((row) => slotStats(env, activityId, row)));
  return { activityId, mode: "test" as const, maxSlots: ACTIVITY_SLOT_MAX, slots };
}

export function activityRoutes() {
  return new Hono<AppEnv>()
    .get("/activities/:id", validateQuery(ActivityQuerySchema), async (c) => {
      const requested = c.req.valid("query").participantId;
      const { activity, classroom, participant, member, isTeacher, user } = await activityAccessOf(
        c,
        c.req.param("id"),
      );
      let self =
        isTeacher || activity.finished_at || !user
          ? participant
          : (participant ??
            (await ensureParticipant(c.env.DB, activity.id, { id: user.id, name: member?.name ?? user.id }, nowIso())));
      if (isTeacher && requested) {
        const slot = activity.mode === "test" ? await participantOf(c.env.DB, activity.id, requested) : null;
        if (slot?.kind !== "teacher" || slot.user_id !== user?.id) fail(403, "forbidden");
        self = slot;
      }
      const topic = await topicOf(c.env.DB, activity.topic_id);
      const payload: ActivityInfo = {
        id: activity.id,
        classroomId: classroom.id,
        classroomName: classroom.name,
        participantId: self?.id ?? null,
        mode: activity.mode,
        topic,
        finishedAt: activity.finished_at,
      };
      return c.json(payload);
    })
    .get("/activities/:id/slots", async (c) => {
      const user = requireUser(c);
      const { activity, classroom } = await activityAccess(c.env.DB, c.req.param("id"), {
        user,
        participant: null,
      });
      if (classroom.teacher_id !== user.id) fail(403, "forbidden");
      if (activity.mode !== "test") fail(409, "conflict");
      return c.json(await slotsPayload(c.env, activity.id));
    })
    .post("/activities/:id/slots", guardUser(), validateJson(ActivitySlotCreateInputSchema), async (c) => {
      const user = requireUser(c);
      const input = c.req.valid("json");
      const { activity, classroom } = await activityAccess(c.env.DB, c.req.param("id"), {
        user,
        participant: null,
      });
      if (classroom.teacher_id !== user.id) fail(403, "forbidden");
      if (activity.mode !== "test") fail(409, "conflict");
      if (activity.finished_at) fail(409, "activity_finished");
      const existing = await one<{ n: number }>(
        c.env.DB,
        "SELECT COUNT(*) AS n FROM activity_participants WHERE activity_id = $aid AND kind = 'teacher'",
        { aid: activity.id },
      );
      const taken = existing?.n ?? 0;
      if (taken + input.count > ACTIVITY_SLOT_MAX) fail(409, "conflict");
      const label = SLOT_NAME[langOf(c)];
      const at = nowIso();
      const used = new Set(
        (
          await all<{ display_name: string }>(
            c.env.DB,
            "SELECT display_name FROM activity_participants WHERE activity_id = $aid",
            { aid: activity.id },
          )
        ).map((row) => row.display_name),
      );
      let next = taken + 1;
      try {
        await batch(
          c.env.DB,
          Array.from({ length: input.count }, (_unused, index) => {
            while (used.has(`${label} ${next}`)) next++;
            const name = `${label} ${next}`;
            used.add(name);
            next++;
            return {
              sql: `INSERT INTO activity_participants (activity_id, id, user_id, kind, display_name, tos_accepted_at, joined_at)
                    SELECT $aid, $pid, $uid, 'teacher', $name, $at, $at
                    WHERE (SELECT COUNT(*) FROM activity_participants
                           WHERE activity_id = $aid AND kind = 'teacher') < $room`,
              params: {
                aid: activity.id,
                pid: newId("p_"),
                uid: user.id,
                name,
                at,
                room: ACTIVITY_SLOT_MAX - taken - index,
              },
            };
          }),
        );
      } catch (error) {
        const stolen = uniqueViolationColumns(error).some(
          ([table, column]) => table === "activity_participants" && column === "display_name",
        );
        if (stolen) fail(409, "name_taken");
        throw error;
      }
      const created = await one<{ n: number }>(
        c.env.DB,
        "SELECT COUNT(*) AS n FROM activity_participants WHERE activity_id = $aid AND kind = 'teacher'",
        { aid: activity.id },
      );
      if ((created?.n ?? 0) !== taken + input.count) fail(409, "conflict");
      return c.json(await slotsPayload(c.env, activity.id), 201);
    })
    .post("/activities/:id/finish", async (c) => {
      await enforceIpLimit(c, "activity-finish", 6);
      const user = requireUser(c);
      const { activity, classroom } = await activityAccess(c.env.DB, c.req.param("id"), {
        user,
        participant: null,
      });
      if (classroom.teacher_id !== user.id) fail(403, "forbidden");
      if (!activity.finished_at) {
        await run(c.env.DB, "UPDATE activities SET finished_at = $at WHERE id = $id", {
          id: activity.id,
          at: new Date().toISOString(),
        });
      }
      await c.env.ReportRunner.getByName(activity.id).startReport({ activityId: activity.id });
      return c.body(null, 204);
    })
    .get("/activities/:id/report", async (c) => {
      c.header("Cache-Control", "no-store");
      const access = await activityAccessOf(c, c.req.param("id"));
      const { activity, participant, isTeacher } = access;
      if (!access.user) fail(403, "forbidden");
      const row = await one<{ status: string; teacher_report: string | null; student_reports: string | null }>(
        c.env.DB,
        "SELECT status, teacher_report, student_reports FROM reports WHERE activity_id = $id",
        { id: activity.id },
      );
      if (!row || row.status === "pending") fail(404, "report_pending");
      if (row.status === "failed") fail(500, "report_failed");
      const topic = await topicOf(c.env.DB, activity.topic_id);
      const stored = storedReport(row.teacher_report, StoredTeacherReportSchema);
      const students = storedReport(row.student_reports, StoredStudentReportsSchema);
      if (stored === undefined || students === undefined) fail(500, "report_failed");
      if (isTeacher) {
        const report: TeacherReport = {
          topicTitle: topic.title,
          classReport: stored?.classReport ?? null,
          students: Object.entries(students).map(([participantId, own]) => ({
            participantId,
            participantName: own.participantName ?? own.pseudonym,
            pseudonym: own.pseudonym,
            analysis: own.analysis,
            violations: own.violations.map((violation) => ({ ...violation, type: violation.type as ViolationType })),
            positions: own.positions ?? [],
          })),
        };
        return c.json(report);
      }
      const own = participant ? students[participant.id] : undefined;
      if (!own) fail(404, "not_found");
      const report: StudentReport = {
        topicTitle: topic.title,
        participantName: own.participantName ?? own.pseudonym,
        pseudonym: own.pseudonym,
        analysis: own.analysis,
        violations: own.violations.map((violation) => ({ ...violation, type: violation.type as ViolationType })),
        positions: own.positions ?? [],
      };
      return c.json(report);
    });
}

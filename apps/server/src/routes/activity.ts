import { Hono } from "hono";
import type { ZodType } from "zod";
import { z } from "zod";
import type {
  ActivityInfo,
  ActivitySlot,
  EngagementVisibility,
  StudentReport,
  TeacherReport,
  ViolationType,
} from "@socrates/shared";
import {
  ACTIVITY_SLOT_MAX,
  ActivitySlotCreateInputSchema,
  ClassroomPageQuerySchema,
  EngagementVisibilitySchema,
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
import {
  type ActivityRow,
  activityAccess,
  activityAccessOf,
  activityOf,
  classroomAccess,
  ensureParticipant,
  participantOf,
  topicOf,
} from "../services/members";
import { publishClassroom } from "../do/classroom-events";
import { pageBounds, pageOf } from "../services/pagination";
import { activityLiveSnapshot } from "../services/activity-live";

const LIVE_BACKFILL_PER_POLL = 8;

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

function engagementVisibilityOf(activity: ActivityRow): EngagementVisibility {
  return { classReport: activity.engagement_to_class === 1, student: activity.engagement_to_student === 1 };
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
    .get("/activities/:id/live", async (c) => {
      const user = requireUser(c);
      const { activity, classroom } = await activityOf(c.env.DB, c.req.param("id"));
      if (classroom.teacher_id !== user.id) fail(403, "forbidden");
      if (activity.mode !== "live") fail(409, "conflict");
      const snapshot = await activityLiveSnapshot(c.env.DB, activity.id);
      if (!snapshot) fail(404, "not_found");
      if (!snapshot.finishedAt) {
        const pending = snapshot.students.filter((student) => student.status === "unknown");
        if (pending.length) {
          const count = Math.min(pending.length, LIVE_BACKFILL_PER_POLL);
          const offset = (Math.floor(Date.now() / 5000) * LIVE_BACKFILL_PER_POLL) % pending.length;
          const selected = Array.from({ length: count }, (_, index) => pending[(offset + index) % pending.length]);
          c.executionCtx.waitUntil(
            Promise.allSettled(
              selected.map(({ id }) => c.env.Chat.getByName(`${activity.id}:${id}`).scheduleLiveProgress()),
            ),
          );
        }
      }
      return c.json(snapshot);
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
      const teacherAxes = activity.report_axes === "teacher" ? (await topicOf(c.env.DB, activity.topic_id)).axes : null;
      const finished = await run(
        c.env.DB,
        "UPDATE activities SET finished_at = $at WHERE id = $id AND finished_at IS NULL",
        {
          id: activity.id,
          at: nowIso(),
        },
      );
      if (finished.meta.changes && activity.mode === "live") await publishClassroom(c.env, classroom.id, "activities");
      await c.env.ReportRunner.getByName(activity.id).startReport({
        activityId: activity.id,
        ...(teacherAxes ? { axes: { count: teacherAxes.length, teacher: teacherAxes } } : {}),
      });
      return c.body(null, 204);
    })
    .put("/activities/:id/engagement-visibility", guardUser(), validateJson(EngagementVisibilitySchema), async (c) => {
      const user = requireUser(c);
      const visibility = c.req.valid("json");
      const { activity, classroom } = await activityAccess(c.env.DB, c.req.param("id"), {
        user,
        participant: null,
      });
      if (classroom.teacher_id !== user.id) fail(403, "forbidden");
      await run(
        c.env.DB,
        "UPDATE activities SET engagement_to_class = $cls, engagement_to_student = $stu WHERE id = $id",
        { id: activity.id, cls: visibility.classReport ? 1 : 0, stu: visibility.student ? 1 : 0 },
      );
      const payload: EngagementVisibility = visibility;
      return c.json(payload);
    })
    .get("/me/reports", guardUser(), validateQuery(ClassroomPageQuerySchema), async (c) => {
      const user = requireUser(c);
      const { limit, at, after } = pageBounds(c.req.valid("query"));
      const rows = await all<{
        id: string;
        classroom_id: string;
        classroom_name: string;
        topic_title: string;
        finished_at: string | null;
        report_created_at: string;
      }>(
        c.env.DB,
        `SELECT a.id, a.classroom_id, c.name AS classroom_name, t.title AS topic_title, a.finished_at, r.created_at AS report_created_at
         FROM activity_participants p
         JOIN activities a ON a.id = p.activity_id
         JOIN classrooms c ON c.id = a.classroom_id
         JOIN topics t ON t.id = a.topic_id
         JOIN reports r ON r.activity_id = a.id
         WHERE p.user_id = $uid AND a.mode = 'live' AND r.status IN ('partial', 'ready')
           AND ($at IS NULL OR (r.created_at, a.id) < ($at, $after))
           AND EXISTS (SELECT 1 FROM json_each(CASE WHEN json_valid(r.student_reports) THEN r.student_reports END)
                       WHERE key = p.id)
         GROUP BY a.id ORDER BY r.created_at DESC, a.id DESC LIMIT $limit`,
        { uid: user.id, at, after, limit: limit + 1 },
      );
      return c.json(
        pageOf(
          rows,
          limit,
          (row) => [row.report_created_at, row.id],
          (row) => ({
            activityId: row.id,
            classroomId: row.classroom_id,
            classroomName: row.classroom_name,
            topicTitle: row.topic_title,
            finishedAt: row.finished_at,
          }),
        ),
      );
    })
    .get("/activities/:id/report", async (c) => {
      c.header("Cache-Control", "no-store");
      const activityId = c.req.param("id");
      const user = c.get("user");
      if (!user) {
        await activityAccessOf(c, activityId);
        fail(403, "forbidden");
      }
      const { activity, classroom } = await activityOf(c.env.DB, activityId);
      const isTeacher = classroom.teacher_id === user.id;
      if (!isTeacher && activity.mode === "test") fail(403, "forbidden");
      const owned = isTeacher
        ? []
        : await all<{ id: string }>(
            c.env.DB,
            "SELECT id FROM activity_participants WHERE activity_id = $aid AND user_id = $uid ORDER BY joined_at, id",
            { aid: activity.id, uid: user.id },
          );
      if (!isTeacher && !owned.length) await classroomAccess(c.env.DB, classroom.id, user);
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
          engagementVisibility: engagementVisibilityOf(activity),
          students: Object.entries(students).map(([participantId, own]) => ({
            participantId,
            participantName: own.participantName ?? own.pseudonym,
            pseudonym: own.pseudonym,
            analysis: own.analysis,
            indicators: own.indicators ?? null,
            engagement: own.engagement ?? null,
            violations: own.violations.map((violation) => ({ ...violation, type: violation.type as ViolationType })),
            positions: own.positions ?? [],
          })),
        };
        return c.json(report);
      }
      const own = owned.map(({ id }) => students[id]).find((entry) => entry !== undefined);
      if (!own) fail(404, "not_found");
      const report: StudentReport = {
        topicTitle: topic.title,
        participantName: own.participantName ?? own.pseudonym,
        pseudonym: own.pseudonym,
        analysis: own.analysis,
        indicators: own.indicators ?? null,
        engagement: engagementVisibilityOf(activity).student ? (own.engagement ?? null) : null,
        violations: own.violations.map((violation) => ({ ...violation, type: violation.type as ViolationType })),
        positions: own.positions ?? [],
      };
      return c.json(report);
    });
}

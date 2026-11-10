import { Hono } from "hono";
import type { ZodType } from "zod";
import type { StudentReport, TeacherReport, ViolationType } from "@socrates/shared";
import { StoredStudentReportsSchema, StoredTeacherReportSchema } from "@socrates/shared";
import { one, run } from "../db/d1";
import { enforceIpLimit, fail, requireUser, type AppEnv } from "../http";
import { requireMembership, topicOf } from "../services/members";

function storedReport<T>(raw: string | null, schema: ZodType<T>): T | undefined {
  if (raw === null) return undefined;
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export function activityRoutes() {
  return new Hono<AppEnv>()
    .get("/activities/:id", async (c) => {
      const user = requireUser(c);
      const { activity, classroom } = await requireMembership(c.env.DB, c.req.param("id"), user);
      const topic = await topicOf(c.env.DB, activity.topic_id);
      return c.json({
        id: activity.id,
        classroomId: classroom.id,
        classroomName: classroom.name,
        topic,
        finishedAt: activity.finished_at,
      });
    })
    .post("/activities/:id/finish", async (c) => {
      await enforceIpLimit(c, "activity-finish", 6);
      const user = requireUser(c);
      const { activity, classroom } = await requireMembership(c.env.DB, c.req.param("id"), user);
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
      const user = requireUser(c);
      const { activity, isTeacher } = await requireMembership(c.env.DB, c.req.param("id"), user);
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
          students: Object.entries(students).map(([studentId, own]) => ({
            studentId,
            pseudonym: own.pseudonym,
            analysis: own.analysis,
            violations: own.violations.map((violation) => ({ ...violation, type: violation.type as ViolationType })),
            positions: own.positions ?? [],
          })),
        };
        return c.json(report);
      }
      const own = students[user.id];
      if (!own) fail(404, "not_found");
      const report: StudentReport = {
        topicTitle: topic.title,
        pseudonym: own.pseudonym,
        analysis: own.analysis,
        violations: own.violations.map((violation) => ({ ...violation, type: violation.type as ViolationType })),
        positions: own.positions ?? [],
      };
      return c.json(report);
    });
}

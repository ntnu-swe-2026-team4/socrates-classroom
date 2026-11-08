import { Hono } from "hono";
import type { StudentReport, TeacherReport } from "@socrates/shared";
import { one, run } from "../db/d1";
import { fail, requireUser, type AppEnv } from "../http";
import { requireMembership, topicOf } from "../services/members";

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
      const user = requireUser(c);
      const { activity, classroom, isTeacher } = await requireMembership(c.env.DB, c.req.param("id"), user);
      const row = await one<{ status: string; teacher_report: string | null; student_reports: string | null }>(
        c.env.DB,
        "SELECT status, teacher_report, student_reports FROM reports WHERE activity_id = $id",
        { id: activity.id },
      );
      if (!row || row.status === "pending") fail(404, "report_pending");
      if (row.status === "failed") fail(500, "report_failed");
      const topic = await topicOf(c.env.DB, activity.topic_id);
      const teacherPart = row.teacher_report
        ? (JSON.parse(row.teacher_report) as { group: TeacherReport["group"] })
        : null;
      const students = row.student_reports
        ? (JSON.parse(row.student_reports) as Record<string, TeacherReport["individuals"][number]>)
        : {};
      if (!teacherPart) fail(500, "report_failed");
      if (isTeacher || user.id === classroom.teacher_id) {
        const report: TeacherReport = {
          topicTitle: topic.title,
          group: teacherPart.group,
          individuals: Object.values(students),
        };
        return c.json(report);
      }
      const own = students[user.id];
      if (!own) fail(404, "not_found");
      const report: StudentReport = {
        topicTitle: topic.title,
        group: teacherPart.group,
        individual: own,
      };
      return c.json(report);
    });
}

import { Hono } from "hono";
import type { DialogueMessage, StudentReport, TeacherReport } from "@socrates/shared";
import { one, run } from "../db/d1";
import { fail, parseBody, requireUser, type AppEnv } from "../http";
import { DialogueInputSchema } from "@socrates/shared";
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
    .get("/activities/:id/dialogue", async (c) => {
      const user = requireUser(c);
      const { activity, isTeacher } = await requireMembership(c.env.DB, c.req.param("id"), user);
      const requested = c.req.query("studentId");
      let studentId: string;
      if (isTeacher) {
        if (!requested) fail(422, "validation");
        studentId = requested;
      } else {
        studentId = requested && requested !== user.id ? (fail(403, "forbidden") as never) : user.id;
      }
      const stub = c.env.PiAgent.getByName(`${activity.id}:${studentId}`);
      const history: DialogueMessage[] = await stub.history(activity.id, studentId);
      return c.json(history);
    })
    .post("/activities/:id/dialogue", async (c) => {
      const user = requireUser(c);
      if (user.role !== "student") fail(403, "only_student");
      const input = await parseBody(c, DialogueInputSchema);
      const { activity } = await requireMembership(c.env.DB, c.req.param("id"), user);
      if (activity.finished_at) fail(409, "activity_finished");
      const topic = await topicOf(c.env.DB, activity.topic_id);
      const stub = c.env.PiAgent.getByName(`${activity.id}:${user.id}`);
      try {
        return await stub.dialogue({
          activityId: activity.id,
          userId: user.id,
          userText: input.text,
          title: topic.title,
        });
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        if (raw.includes("already_streaming")) fail(409, "already_streaming");
        if (raw.includes("activity_finished")) fail(409, "activity_finished");
        fail(503, "llm_unavailable");
      }
    })
    .get("/activities/:id/live", async (c) => {
      const user = requireUser(c);
      const { activity, isTeacher } = await requireMembership(c.env.DB, c.req.param("id"), user);
      if (!isTeacher) fail(403, "forbidden");
      const snapshot = await c.env.ActivityEvents.getByName(activity.id).snapshot(activity.id);
      return c.json(snapshot);
    })
    .get("/activities/:id/events", async (c) => {
      const user = requireUser(c);
      const { activity, isTeacher } = await requireMembership(c.env.DB, c.req.param("id"), user);
      if (!isTeacher) fail(403, "forbidden");
      const since = Number(c.req.header("Last-Event-ID") ?? c.req.query("since") ?? 0);
      return c.env.ActivityEvents.getByName(activity.id).stream(Number.isFinite(since) ? since : 0);
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
      await c.env.ReportJob.getByName(activity.id).start();
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

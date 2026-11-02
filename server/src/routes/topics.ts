import { Hono } from "hono";
import type { Config } from "../config";
import type { DB } from "../db";
import { all, one, run, tx } from "../db";
import { requireUser } from "../auth";
import { bodyOf, fail, isoOrNull, newId, nowIso, type AppEnv } from "../http";
import { accessClassroom, accessClassroomStaff, accessClassroomTeacher, accessTopic } from "../services/access";
import { hasStarted } from "../services/activities";
import { makeAxes } from "../services/debate";
import { deleteFile, fileDownloadResponse, saveUpload } from "../services/files";
import { fileRef, topicJson } from "../services/serialize";

function axesOrFail(input: unknown) {
  try {
    return makeAxes(input);
  } catch {
    fail(422, "invalid_axis");
  }
}

function answerModeOrFail(value: unknown) {
  if (value === "text" || value === "voice" || value === "both") return value;
  fail(422, "invalid_answer_mode");
}

function groupSizeOrFail(value: unknown): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 2 || n > 8) fail(422, "invalid_group_size");
  return n;
}

function reportJson(db: DB, row: any) {
  const student = one<{ name: string }>(db, "SELECT name FROM users WHERE id = $id", { id: row.student_id });
  const file = one<any>(db, "SELECT * FROM files WHERE id = $id", { id: row.file_id });
  return {
    id: row.id,
    topicId: row.topic_id,
    studentId: row.student_id,
    studentName: student?.name ?? "",
    file: file ? fileRef(file) : { name: "", url: "", size: 0, mimeType: "application/octet-stream" },
    comment: row.comment,
    submittedAt: row.submitted_at,
  };
}

export function topicRoutes(db: DB, config: Config) {
  const r = new Hono<AppEnv>();

  r.get("/classrooms/:id/topics", (c) => {
    const user = requireUser(c);
    const { classroom } = accessClassroom(db, c.req.param("id"), user);
    const rows = all<any>(db, "SELECT * FROM topics WHERE classroom_id = $cid ORDER BY created_at DESC", { cid: classroom.id });
    return c.json(rows.map((row) => topicJson(db, row)));
  });

  r.get("/topics/:id", (c) => {
    const user = requireUser(c);
    const { topic } = accessTopic(db, c.req.param("id"), user);
    return c.json(topicJson(db, topic));
  });

  r.post("/classrooms/:id/topics", async (c) => {
    const user = requireUser(c);
    const classroom = accessClassroomTeacher(db, c.req.param("id"), user);
    const body = await bodyOf(c);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) fail(422, "topic_title_required");
    const description = typeof body.description === "string" ? body.description.trim().slice(0, 10000) : "";
    const dueAt = body.dueAt === null || body.dueAt === undefined || body.dueAt === "" ? null : isoOrNull(body.dueAt);
    if (body.dueAt && !dueAt) fail(422, "invalid_datetime");
    const acceptsReports = body.acceptsReports === true;
    const raw = body.activity as any;
    if (!raw || typeof raw !== "object") fail(422, "activity_settings_required");
    const axes = axesOrFail(raw.axes);
    const answerMode = answerModeOrFail(raw.answerMode);
    const groupSize = groupSizeOrFail(raw.groupSize);
    const at = nowIso();
    const topicId = newId("t_");
    const activityId = newId("d_");
    tx(db, () => {
      run(
        db,
        `INSERT INTO topics (id, classroom_id, title, description, due_at, accepts_reports, activity_id, created_at, updated_at)
         VALUES ($id, $cid, $title, $description, $dueAt, $accepts, NULL, $at, $at)`,
        { id: topicId, cid: classroom.id, title, description, dueAt, accepts: acceptsReports ? 1 : 0, at },
      );
      run(
        db,
        `INSERT INTO activities (id, classroom_id, title, statement, answer_mode, axes, group_size, stage, stage_deadline, topic_id, created_at, updated_at)
         VALUES ($id, $cid, $title, $statement, $mode, $axes, $groupSize, 'individual', NULL, $topicId, $at, $at)`,
        { id: activityId, cid: classroom.id, title, statement: title, mode: answerMode, axes: JSON.stringify(axes), groupSize, topicId, at },
      );
      run(db, "UPDATE topics SET activity_id = $aid WHERE id = $id", { aid: activityId, id: topicId });
    });
    return c.json(topicJson(db, one<any>(db, "SELECT * FROM topics WHERE id = $id", { id: topicId })!));
  });

  r.patch("/topics/:id", async (c) => {
    const user = requireUser(c);
    const { topic } = accessTopic(db, c.req.param("id"), user);
    const classroom = accessClassroomTeacher(db, topic.classroom_id, user);
    void classroom;
    const body = await bodyOf(c);
    const activity = topic.activity_id ? one<any>(db, "SELECT * FROM activities WHERE id = $id", { id: topic.activity_id }) : null;
    if (body.activity !== undefined) {
      if (!activity) fail(422, "activity_settings_required");
      if (!body.activity || typeof body.activity !== "object" || Array.isArray(body.activity)) fail(422, "validation");
      if (hasStarted(db, activity.id)) fail(409, "settings_locked");
      const raw = body.activity as any;
      if (raw.answerMode !== undefined) {
        run(db, "UPDATE activities SET answer_mode = $v WHERE id = $id", { v: answerModeOrFail(raw.answerMode), id: activity.id });
      }
      if (raw.groupSize !== undefined) {
        run(db, "UPDATE activities SET group_size = $v WHERE id = $id", { v: groupSizeOrFail(raw.groupSize), id: activity.id });
      }
      if (raw.axes !== undefined) {
        run(db, "UPDATE activities SET axes = $v WHERE id = $id", { v: JSON.stringify(axesOrFail(raw.axes)), id: activity.id });
      }
    }
    if (body.title !== undefined) {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      if (!title) fail(422, "topic_title_required");
      run(db, "UPDATE topics SET title = $v WHERE id = $id", { v: title.slice(0, 200), id: topic.id });
      if (activity) run(db, "UPDATE activities SET title = $v, statement = $v WHERE id = $id", { v: title.slice(0, 200), id: activity.id });
    }
    if (body.description !== undefined) {
      if (typeof body.description !== "string") fail(422, "validation");
      run(db, "UPDATE topics SET description = $v WHERE id = $id", { v: body.description.trim().slice(0, 10000), id: topic.id });
    }
    if (body.dueAt !== undefined) {
      const dueAt = body.dueAt === null || body.dueAt === "" ? null : isoOrNull(body.dueAt);
      if (body.dueAt && !dueAt) fail(422, "invalid_datetime");
      run(db, "UPDATE topics SET due_at = $v WHERE id = $id", { v: dueAt, id: topic.id });
    }
    if (body.acceptsReports !== undefined) {
      if (typeof body.acceptsReports !== "boolean") fail(422, "validation");
      run(db, "UPDATE topics SET accepts_reports = $v WHERE id = $id", { v: body.acceptsReports ? 1 : 0, id: topic.id });
    }
    run(db, "UPDATE topics SET updated_at = $at WHERE id = $id", { at: nowIso(), id: topic.id });
    return c.json(topicJson(db, one<any>(db, "SELECT * FROM topics WHERE id = $id", { id: topic.id })!));
  });

  r.delete("/topics/:id", (c) => {
    const user = requireUser(c);
    const { topic } = accessTopic(db, c.req.param("id"), user);
    accessClassroomTeacher(db, topic.classroom_id, user);
    const fileIds: string[] = [];
    for (const res of all<any>(db, "SELECT file_id FROM topic_resources WHERE topic_id = $id AND file_id IS NOT NULL", { id: topic.id })) fileIds.push(res.file_id);
    for (const rep of all<any>(db, "SELECT file_id FROM topic_reports WHERE topic_id = $id", { id: topic.id })) fileIds.push(rep.file_id);
    tx(db, () => {
      if (topic.activity_id) run(db, "DELETE FROM activities WHERE id = $id", { id: topic.activity_id });
      run(db, "DELETE FROM activities WHERE topic_id = $id", { id: topic.id });
      run(db, "DELETE FROM topics WHERE id = $id", { id: topic.id });
    });
    for (const fileId of fileIds) deleteFile(db, fileId);
    return c.body(null, 204);
  });

  r.post("/topics/:id/resources", async (c) => {
    const user = requireUser(c);
    const { topic } = accessTopic(db, c.req.param("id"), user);
    accessClassroomStaff(db, topic.classroom_id, user);
    const body = await bodyOf(c);
    const url = typeof body.url === "string" ? body.url.trim() : "";
    if (!/^https?:\/\//i.test(url)) fail(422, "link_invalid");
    const name = (typeof body.name === "string" && body.name.trim() ? body.name.trim() : url).slice(0, 300);
    const seq = one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM topic_resources WHERE topic_id = $id", { id: topic.id })?.n ?? 0;
    const id = newId("r_");
    run(
      db,
      "INSERT INTO topic_resources (id, topic_id, kind, name, url, file_id, added_at, seq) VALUES ($id, $tid, 'link', $name, $url, NULL, $at, $seq)",
      { id, tid: topic.id, name, url, at: nowIso(), seq },
    );
    run(db, "UPDATE topics SET updated_at = $at WHERE id = $id", { at: nowIso(), id: topic.id });
    return c.json({ id, kind: "link", name, url, addedAt: nowIso() });
  });

  r.post("/topics/:id/resources/files", async (c) => {
    const user = requireUser(c);
    const { topic } = accessTopic(db, c.req.param("id"), user);
    accessClassroomStaff(db, topic.classroom_id, user);
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) fail(422, "file_missing");
    const saved = await saveUpload(db, config, file, user.id, "topic_resource", topic.id);
    const seq = one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM topic_resources WHERE topic_id = $id", { id: topic.id })?.n ?? 0;
    const id = newId("r_");
    run(
      db,
      "INSERT INTO topic_resources (id, topic_id, kind, name, url, file_id, added_at, seq) VALUES ($id, $tid, 'file', $name, NULL, $fileId, $at, $seq)",
      { id, tid: topic.id, name: saved.name, fileId: saved.id, at: nowIso(), seq },
    );
    run(db, "UPDATE topics SET updated_at = $at WHERE id = $id", { at: nowIso(), id: topic.id });
    return c.json({ id, kind: "file", name: saved.name, file: fileRef(saved), addedAt: saved.created_at });
  });

  r.delete("/topics/:id/resources/:resourceId", (c) => {
    const user = requireUser(c);
    const { topic } = accessTopic(db, c.req.param("id"), user);
    accessClassroomStaff(db, topic.classroom_id, user);
    const resource = one<any>(db, "SELECT * FROM topic_resources WHERE id = $id AND topic_id = $tid", { id: c.req.param("resourceId"), tid: topic.id });
    if (!resource) fail(404, "resource_not_found");
    run(db, "DELETE FROM topic_resources WHERE id = $id", { id: resource.id });
    if (resource.file_id) deleteFile(db, resource.file_id);
    run(db, "UPDATE topics SET updated_at = $at WHERE id = $id", { at: nowIso(), id: topic.id });
    return c.body(null, 204);
  });

  r.get("/topics/:id/reports", (c) => {
    const user = requireUser(c);
    const { topic, role } = accessTopic(db, c.req.param("id"), user);
    const staff = role === "teacher" || role === "assistant";
    const rows = all<any>(
      db,
      `SELECT * FROM topic_reports WHERE topic_id = $tid ${staff ? "" : "AND student_id = $sid"} ORDER BY submitted_at DESC`,
      staff ? { tid: topic.id } : { tid: topic.id, sid: user.id },
    );
    return c.json(rows.map((row) => reportJson(db, row)));
  });

  r.post("/topics/:id/reports", async (c) => {
    const user = requireUser(c);
    const { topic, role } = accessTopic(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    if (!topic.accepts_reports) fail(403, "reports_disabled");
    const form = await c.req.parseBody();
    const file = form.file;
    if (!(file instanceof File)) fail(422, "file_missing");
    const comment = typeof form.comment === "string" ? form.comment.trim().slice(0, 4000) : "";
    const saved = await saveUpload(db, config, file, user.id, "topic_report", topic.id);
    const old = one<any>(db, "SELECT * FROM topic_reports WHERE topic_id = $tid AND student_id = $sid", { tid: topic.id, sid: user.id });
    const id = newId("rp_");
    tx(db, () => {
      if (old) run(db, "DELETE FROM topic_reports WHERE id = $id", { id: old.id });
      run(
        db,
        "INSERT INTO topic_reports (id, topic_id, student_id, file_id, comment, submitted_at) VALUES ($id, $tid, $sid, $fileId, $comment, $at)",
        { id, tid: topic.id, sid: user.id, fileId: saved.id, comment, at: nowIso() },
      );
    });
    if (old?.file_id) deleteFile(db, old.file_id);
    return c.json(reportJson(db, one<any>(db, "SELECT * FROM topic_reports WHERE id = $id", { id })!));
  });

  r.delete("/reports/:id", (c) => {
    const user = requireUser(c);
    const row = one<any>(db, "SELECT * FROM topic_reports WHERE id = $id", { id: c.req.param("id") });
    if (!row) fail(404, "report_not_found");
    accessTopic(db, row.topic_id, user);
    if (row.student_id !== user.id) fail(403, "forbidden");
    run(db, "DELETE FROM topic_reports WHERE id = $id", { id: row.id });
    deleteFile(db, row.file_id);
    return c.body(null, 204);
  });

  r.get("/files/:id", (c) => {
    const user = requireUser(c);
    const row = one<any>(db, "SELECT * FROM files WHERE id = $id", { id: c.req.param("id") });
    if (!row) fail(404, "file_not_found");
    const { role } = accessTopic(db, row.scope_id, user);
    if (row.scope_type === "topic_report") {
      // 結論報告只有本人與老師/助教能下載；教材等其他檔案仍是議題教室成員皆可
      const report = one<any>(db, "SELECT * FROM topic_reports WHERE file_id = $id", { id: row.id });
      const staff = role === "teacher" || role === "assistant";
      if (!report || (report.student_id !== user.id && !staff)) fail(403, "forbidden");
    }
    return fileDownloadResponse(row);
  });

  return r;
}

export { reportJson, axesOrFail, answerModeOrFail, groupSizeOrFail };

import { Hono } from "hono";
import type { DB } from "../db";
import { all, one, run } from "../db";
import { requireUser } from "../auth";
import { bodyOf, fail, isoOrNull, newId, nowIso, type AppEnv } from "../http";
import { accessClassroom, accessClassroomStaff } from "../services/access";
import { customEventJson } from "../services/serialize";

export function calendarRoutes(db: DB) {
  const r = new Hono<AppEnv>();

  r.get("/classrooms/:id/calendar", (c) => {
    const user = requireUser(c);
    const { classroom, role } = accessClassroom(db, c.req.param("id"), user);
    const now = nowIso();
    const from = isoOrNull(c.req.query("from")) ?? new Date(Date.now() - 365 * 864e5).toISOString();
    const to = isoOrNull(c.req.query("to")) ?? new Date(Date.now() + 365 * 864e5).toISOString();
    const staff = role === "teacher" || role === "assistant";
    const base = { classroomId: classroom.id, classroomName: classroom.name };
    const events: any[] = [];
    for (const t of all<any>(db, "SELECT * FROM topics WHERE classroom_id = $cid AND due_at IS NOT NULL", { cid: classroom.id })) {
      events.push({ ...base, id: `topic_due:${t.id}`, kind: "topic_due", title: t.title, at: t.due_at, topicId: t.id, ...(t.activity_id ? { activityId: t.activity_id } : {}) });
    }
    for (const a of all<any>(
      db,
      `SELECT * FROM announcements WHERE classroom_id = $cid ${staff ? "" : "AND publish_at <= $now"}`,
      staff ? { cid: classroom.id } : { cid: classroom.id, now },
    )) {
      events.push({ ...base, id: `announcement:${a.id}`, kind: "announcement", title: a.title, at: a.publish_at, announcementId: a.id });
    }
    for (const a of all<any>(db, "SELECT * FROM activities WHERE classroom_id = $cid AND stage_deadline IS NOT NULL", { cid: classroom.id })) {
      events.push({ ...base, id: `stage_deadline:${a.id}`, kind: "stage_deadline", title: a.title, at: a.stage_deadline, activityId: a.id, ...(a.topic_id ? { topicId: a.topic_id } : {}) });
    }
    for (const d of all<any>(db, "SELECT * FROM discussions WHERE classroom_id = $cid AND due_at IS NOT NULL", { cid: classroom.id })) {
      events.push({ ...base, id: `discussion_due:${d.id}`, kind: "discussion_due", title: d.title, at: d.due_at, discussionId: d.id });
    }
    for (const e of all<any>(db, "SELECT * FROM calendar_events WHERE classroom_id = $cid", { cid: classroom.id })) {
      events.push(customEventJson(e, classroom.name));
    }
    return c.json(events.filter((e) => e.at >= from && e.at < to).sort((a, b) => a.at.localeCompare(b.at)));
  });

  r.post("/classrooms/:id/calendar-events", async (c) => {
    const user = requireUser(c);
    const { classroom } = accessClassroomStaff(db, c.req.param("id"), user);
    const body = await bodyOf(c);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) fail(422, "event_title_required");
    const at = isoOrNull(body.at);
    if (!at) fail(422, "invalid_datetime");
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 2000) : null;
    const id = newId("ce_");
    run(db, "INSERT INTO calendar_events (id, classroom_id, title, at, note, created_by, created_at) VALUES ($id, $cid, $title, $at, $note, $by, $now)", {
      id, cid: classroom.id, title: title.slice(0, 200), at, note, by: user.id, now: nowIso(),
    });
    return c.json(customEventJson(one<any>(db, "SELECT * FROM calendar_events WHERE id = $id", { id }), classroom.name));
  });

  r.patch("/calendar-events/:id", async (c) => {
    const user = requireUser(c);
    const row = one<any>(db, "SELECT * FROM calendar_events WHERE id = $id", { id: c.req.param("id") });
    if (!row) fail(404, "calendar_not_found");
    const { classroom } = accessClassroomStaff(db, row.classroom_id, user);
    const body = await bodyOf(c);
    if (body.title !== undefined) {
      if (typeof body.title !== "string" || !body.title.trim()) fail(422, "event_title_required");
      run(db, "UPDATE calendar_events SET title = $v WHERE id = $id", { v: body.title.trim().slice(0, 200), id: row.id });
    }
    if (body.at !== undefined) {
      const at = isoOrNull(body.at);
      if (!at) fail(422, "invalid_datetime");
      run(db, "UPDATE calendar_events SET at = $v WHERE id = $id", { v: at, id: row.id });
    }
    if (body.note !== undefined) {
      const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 2000) : null;
      run(db, "UPDATE calendar_events SET note = $v WHERE id = $id", { v: note, id: row.id });
    }
    return c.json(customEventJson(one<any>(db, "SELECT * FROM calendar_events WHERE id = $id", { id: row.id }), classroom.name));
  });

  r.delete("/calendar-events/:id", (c) => {
    const user = requireUser(c);
    const row = one<any>(db, "SELECT * FROM calendar_events WHERE id = $id", { id: c.req.param("id") });
    if (!row) fail(404, "calendar_not_found");
    accessClassroomStaff(db, row.classroom_id, user);
    run(db, "DELETE FROM calendar_events WHERE id = $id", { id: row.id });
    return c.body(null, 204);
  });

  return r;
}

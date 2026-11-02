import { Hono } from "hono";
import type { DB } from "../db";
import { all, one, run } from "../db";
import { requireUser } from "../auth";
import { bodyOf, fail, isoOrNull, newId, nowIso, str, type AppEnv } from "../http";
import { accessClassroom, accessClassroomStaff } from "../services/access";
import { announcementJson } from "../services/serialize";

export function announcementRoutes(db: DB) {
  const r = new Hono<AppEnv>();

  r.get("/classrooms/:id/announcements", (c) => {
    const user = requireUser(c);
    const { classroom, role } = accessClassroom(db, c.req.param("id"), user);
    const staff = role === "teacher" || role === "assistant";
    const rows = all<any>(
      db,
      `SELECT * FROM announcements WHERE classroom_id = $cid ${staff ? "" : "AND publish_at <= $now"}
       ORDER BY pinned DESC, publish_at DESC`,
      staff ? { cid: classroom.id } : { cid: classroom.id, now: nowIso() },
    );
    return c.json(rows.map((row) => announcementJson(db, row)));
  });

  r.post("/classrooms/:id/announcements", async (c) => {
    const user = requireUser(c);
    const { classroom } = accessClassroomStaff(db, c.req.param("id"), user);
    const body = await bodyOf(c);
    const title = str(body.title, "announcement_title_required", { min: 1, max: 200 });
    const text = typeof body.body === "string" ? body.body.trim().slice(0, 20000) : "";
    const pinned = body.pinned === true;
    const publishAt = body.publishAt === null || body.publishAt === undefined ? nowIso() : isoOrNull(body.publishAt);
    if (!publishAt) fail(422, "invalid_datetime");
    const at = nowIso();
    const id = newId("an_");
    run(
      db,
      `INSERT INTO announcements (id, classroom_id, title, body, pinned, publish_at, author_id, created_at, updated_at)
       VALUES ($id, $cid, $title, $body, $pinned, $publishAt, $author, $at, $at)`,
      { id, cid: classroom.id, title, body: text, pinned: pinned ? 1 : 0, publishAt, author: user.id, at },
    );
    return c.json(announcementJson(db, one<any>(db, "SELECT * FROM announcements WHERE id = $id", { id })));
  });

  r.patch("/announcements/:id", async (c) => {
    const user = requireUser(c);
    const row = one<any>(db, "SELECT * FROM announcements WHERE id = $id", { id: c.req.param("id") });
    if (!row) fail(404, "announcement_not_found");
    accessClassroomStaff(db, row.classroom_id, user);
    const body = await bodyOf(c);
    if (body.title !== undefined) {
      const title = str(body.title, "announcement_title_required", { min: 1, max: 200 });
      run(db, "UPDATE announcements SET title = $v WHERE id = $id", { v: title, id: row.id });
    }
    if (body.body !== undefined) {
      if (typeof body.body !== "string") fail(422, "validation");
      run(db, "UPDATE announcements SET body = $v WHERE id = $id", { v: body.body.trim().slice(0, 20000), id: row.id });
    }
    if (body.pinned !== undefined) {
      if (typeof body.pinned !== "boolean") fail(422, "validation");
      run(db, "UPDATE announcements SET pinned = $v WHERE id = $id", { v: body.pinned ? 1 : 0, id: row.id });
    }
    if (body.publishAt !== undefined) {
      const publishAt = body.publishAt === null ? nowIso() : isoOrNull(body.publishAt);
      if (!publishAt) fail(422, "invalid_datetime");
      run(db, "UPDATE announcements SET publish_at = $v WHERE id = $id", { v: publishAt, id: row.id });
    }
    run(db, "UPDATE announcements SET updated_at = $at WHERE id = $id", { at: nowIso(), id: row.id });
    return c.json(announcementJson(db, one<any>(db, "SELECT * FROM announcements WHERE id = $id", { id: row.id })));
  });

  r.delete("/announcements/:id", (c) => {
    const user = requireUser(c);
    const row = one<any>(db, "SELECT * FROM announcements WHERE id = $id", { id: c.req.param("id") });
    if (!row) fail(404, "announcement_not_found");
    accessClassroomStaff(db, row.classroom_id, user);
    run(db, "DELETE FROM announcements WHERE id = $id", { id: row.id });
    return c.body(null, 204);
  });

  return r;
}

import { Hono } from "hono";
import type { Db } from "../db/d1";
import { all, one, run } from "../db/d1";
import { requireUser } from "../auth";
import { bodyOf, fail, newId, nowIso, type AppEnv, type UserRow } from "../http";
import { accessClassroom, topicById, type ClassroomRole } from "../services/access";

async function postJson(db: Db, row: any, user: UserRow, role: ClassroomRole, lang: string) {
  const author = await one<UserRow>(db, "SELECT id, name, role, avatar_url, created_at FROM users WHERE id = $id", {
    id: row.author_id,
  });
  const mine = row.author_id === user.id;
  const teacher = role === "teacher";
  const reveal = !row.anonymous || teacher || mine;
  let authorLabel = author?.name ?? "";
  if (row.anonymous) {
    if (mine) authorLabel = lang === "en" ? "You (anonymous)" : lang === "es" ? "Tú (anónimo)" : "你（匿名）";
    else if (teacher)
      authorLabel =
        lang === "en"
          ? `${author?.name ?? ""} (anonymous)`
          : lang === "es"
            ? `${author?.name ?? ""} (anónimo)`
            : `${author?.name ?? ""}（匿名）`;
    else authorLabel = lang === "en" ? "Anonymous classmate" : lang === "es" ? "Compañero anónimo" : "匿名同學";
  }
  return {
    id: row.id,
    classroomId: row.classroom_id,
    topicId: row.topic_id,
    parentId: row.parent_id,
    body: row.deleted ? "" : row.body,
    anonymous: !!row.anonymous,
    authorLabel,
    authorId: reveal ? row.author_id : null,
    authorRole: row.author_role,
    isMine: mine,
    createdAt: row.created_at,
    deleted: !!row.deleted,
  };
}

export function postRoutes(db: Db) {
  const r = new Hono<AppEnv>();

  r.get("/classrooms/:id/posts", async (c) => {
    const user = requireUser(c);
    const { classroom, role } = await accessClassroom(db, c.req.param("id"), user);
    const topicId = c.req.query("topicId") || null; // 空字串視同未指定，行為與省略參數一致
    if (topicId) {
      const topic = await topicById(db, topicId);
      if (!topic || topic.classroom_id !== classroom.id) fail(404, "topic_not_found");
    }
    const rows = await all<any>(
      db,
      `SELECT p.* FROM posts p
       WHERE p.classroom_id = $cid AND (p.topic_id IS $tid)
         AND (p.deleted = 0 OR EXISTS (SELECT 1 FROM posts r WHERE r.parent_id = p.id AND r.deleted = 0))
       ORDER BY p.created_at, p.rowid`,
      { cid: classroom.id, tid: topicId },
    );
    const lang = c.get("lang");
    return c.json(await Promise.all(rows.map((row) => postJson(db, row, user, role, lang))));
  });

  r.post("/classrooms/:id/posts", async (c) => {
    const user = requireUser(c);
    const { classroom, role } = await accessClassroom(db, c.req.param("id"), user);
    const body = await bodyOf(c);
    const text = typeof body.body === "string" ? body.body.trim() : "";
    if (!text) fail(422, "post_empty");
    if (text.length > 2000) fail(422, "post_too_long");
    const topicId = body.topicId === null || body.topicId === undefined ? null : String(body.topicId);
    if (topicId) {
      const topic = await topicById(db, topicId);
      if (!topic || topic.classroom_id !== classroom.id) fail(404, "topic_not_found");
    }
    const parentId = body.parentId === null || body.parentId === undefined ? null : String(body.parentId);
    if (parentId) {
      const parent = await one<any>(db, "SELECT * FROM posts WHERE id = $id", { id: parentId });
      if (!parent || parent.parent_id !== null || parent.topic_id !== topicId || parent.classroom_id !== classroom.id)
        fail(422, "reply_scope");
    }
    const teacher = role === "teacher";
    const anonymous = !teacher && body.anonymous === true;
    const id = newId("p_");
    await run(
      db,
      `INSERT INTO posts (id, classroom_id, topic_id, parent_id, author_id, body, anonymous, author_role, deleted, created_at)
       VALUES ($id, $cid, $tid, $pid, $author, $body, $anonymous, $role, 0, $at)`,
      {
        id,
        cid: classroom.id,
        tid: topicId,
        pid: parentId,
        author: user.id,
        body: text,
        anonymous: anonymous ? 1 : 0,
        role: teacher ? "teacher" : "student",
        at: nowIso(),
      },
    );
    return c.json(
      await postJson(db, await one<any>(db, "SELECT * FROM posts WHERE id = $id", { id }), user, role, c.get("lang")),
    );
  });

  r.delete("/posts/:id", async (c) => {
    const user = requireUser(c);
    const row = await one<any>(db, "SELECT * FROM posts WHERE id = $id", { id: c.req.param("id") });
    if (!row) fail(404, "post_not_found");
    const { role } = await accessClassroom(db, row.classroom_id, user);
    if (row.author_id !== user.id && role !== "teacher") fail(403, "forbidden");
    const replies = await one<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM posts WHERE parent_id = $id AND deleted = 0",
      { id: row.id },
    );
    if ((replies?.n ?? 0) > 0) await run(db, "UPDATE posts SET deleted = 1 WHERE id = $id", { id: row.id });
    else await run(db, "DELETE FROM posts WHERE id = $id", { id: row.id });
    return c.body(null, 204);
  });

  return r;
}

import { Hono } from "hono";
import {
  AnnouncementInputSchema,
  PostInputSchema,
  type Announcement,
  type ClassroomActivity,
  type ClassroomMembers,
  type Post,
  type PostReply,
} from "@socrates/shared";
import { all, one, run, type Db } from "../db/d1";
import { enforceIpLimit, fail, newId, nowIso, parseBody, requireUser, type AppEnv } from "../http";
import { classroomAccess } from "../services/members";

interface PostRow {
  id: string;
  parent_id: string | null;
  body: string;
  author_id: string;
  author_name: string;
  created_at: string;
}

function toReply(row: PostRow, teacherId: string): PostReply {
  return {
    id: row.id,
    body: row.body,
    authorId: row.author_id,
    authorName: row.author_name,
    isTeacher: row.author_id === teacherId,
    createdAt: row.created_at,
  };
}

async function listPosts(db: Db, classroomId: string, teacherId: string): Promise<Post[]> {
  const rows = await all<PostRow>(
    db,
    `SELECT p.id, p.parent_id, p.body, p.author_id, COALESCE(m.name, u.name) AS author_name, p.created_at
     FROM posts p
     JOIN users u ON u.id = p.author_id
     LEFT JOIN members m ON m.classroom_id = p.classroom_id AND m.user_id = p.author_id
     WHERE p.classroom_id = $cid
     ORDER BY p.created_at ASC, p.rowid ASC`,
    { cid: classroomId },
  );
  const threads = new Map<string, Post>();
  for (const row of rows) {
    if (row.parent_id === null) threads.set(row.id, { ...toReply(row, teacherId), replies: [] });
  }
  for (const row of rows) {
    if (row.parent_id !== null) threads.get(row.parent_id)?.replies.push(toReply(row, teacherId));
  }
  return [...threads.values()].reverse();
}

export function communityRoutes() {
  return new Hono<AppEnv>()
    .get("/classrooms/:id/announcements", async (c) => {
      const user = requireUser(c);
      const { classroom } = await classroomAccess(c.env.DB, c.req.param("id"), user);
      const rows = await all<{ id: string; body: string; author_name: string; created_at: string }>(
        c.env.DB,
        `SELECT a.id, a.body, u.name AS author_name, a.created_at
         FROM announcements a JOIN users u ON u.id = a.author_id
         WHERE a.classroom_id = $cid
         ORDER BY a.created_at DESC, a.rowid DESC`,
        { cid: classroom.id },
      );
      return c.json(
        rows.map(
          (row): Announcement => ({
            id: row.id,
            body: row.body,
            authorName: row.author_name,
            createdAt: row.created_at,
          }),
        ),
      );
    })
    .post("/classrooms/:id/announcements", async (c) => {
      await enforceIpLimit(c, "community-announce", 30);
      const user = requireUser(c);
      const { classroom, isTeacher } = await classroomAccess(c.env.DB, c.req.param("id"), user);
      if (!isTeacher) fail(403, "forbidden");
      const input = await parseBody(c, AnnouncementInputSchema);
      const author = await one<{ name: string }>(c.env.DB, "SELECT name FROM users WHERE id = $id", {
        id: user.id,
      });
      const announcement: Announcement = {
        id: newId("an_"),
        body: input.body,
        authorName: author?.name ?? "",
        createdAt: nowIso(),
      };
      await run(
        c.env.DB,
        "INSERT INTO announcements (id, classroom_id, author_id, body, created_at) VALUES ($id, $cid, $uid, $body, $at)",
        { id: announcement.id, cid: classroom.id, uid: user.id, body: announcement.body, at: announcement.createdAt },
      );
      return c.json(announcement, 201);
    })
    .delete("/classrooms/:id/announcements/:announcementId", async (c) => {
      const user = requireUser(c);
      const { classroom, isTeacher } = await classroomAccess(c.env.DB, c.req.param("id"), user);
      if (!isTeacher) fail(403, "forbidden");
      const result = await run(c.env.DB, "DELETE FROM announcements WHERE id = $id AND classroom_id = $cid", {
        id: c.req.param("announcementId"),
        cid: classroom.id,
      });
      if (!result.meta.changes) fail(404, "not_found");
      return c.body(null, 204);
    })
    .get("/classrooms/:id/members", async (c) => {
      const user = requireUser(c);
      const { classroom } = await classroomAccess(c.env.DB, c.req.param("id"), user);
      const teacher = await one<{ name: string }>(c.env.DB, "SELECT name FROM users WHERE id = $id", {
        id: classroom.teacher_id,
      });
      const rows = await all<{ user_id: string; name: string; joined_at: string }>(
        c.env.DB,
        `SELECT m.user_id, m.name, m.joined_at
         FROM members m
         WHERE m.classroom_id = $cid
         ORDER BY m.joined_at ASC, m.rowid ASC`,
        { cid: classroom.id },
      );
      const body: ClassroomMembers = {
        teacher: { id: classroom.teacher_id, name: teacher?.name ?? "" },
        members: rows.map((row) => ({ id: row.user_id, name: row.name, joinedAt: row.joined_at })),
      };
      return c.json(body);
    })
    .delete("/classrooms/:id/members/:userId", async (c) => {
      const user = requireUser(c);
      const { classroom, isTeacher } = await classroomAccess(c.env.DB, c.req.param("id"), user);
      const target = c.req.param("userId");
      if (target === classroom.teacher_id) fail(403, "forbidden");
      if (!isTeacher && target !== user.id) fail(403, "forbidden");
      const result = await run(c.env.DB, "DELETE FROM members WHERE classroom_id = $cid AND user_id = $uid", {
        cid: classroom.id,
        uid: target,
      });
      if (!result.meta.changes) fail(404, "not_found");
      return c.body(null, 204);
    })
    .get("/classrooms/:id/posts", async (c) => {
      const user = requireUser(c);
      const { classroom } = await classroomAccess(c.env.DB, c.req.param("id"), user);
      return c.json(await listPosts(c.env.DB, classroom.id, classroom.teacher_id));
    })
    .post("/classrooms/:id/posts", async (c) => {
      await enforceIpLimit(c, "community-post", 30);
      const user = requireUser(c);
      const { classroom } = await classroomAccess(c.env.DB, c.req.param("id"), user);
      const input = await parseBody(c, PostInputSchema);
      if (input.parentId) {
        const parent = await one<{ id: string }>(
          c.env.DB,
          "SELECT id FROM posts WHERE id = $pid AND classroom_id = $cid AND parent_id IS NULL",
          { pid: input.parentId, cid: classroom.id },
        );
        if (!parent) fail(404, "not_found");
      }
      const id = newId("p_");
      await run(
        c.env.DB,
        "INSERT INTO posts (id, classroom_id, author_id, parent_id, body, created_at) VALUES ($id, $cid, $uid, $pid, $body, $at)",
        { id, cid: classroom.id, uid: user.id, pid: input.parentId ?? null, body: input.body, at: nowIso() },
      );
      const row = await one<PostRow>(
        c.env.DB,
        `SELECT p.id, p.parent_id, p.body, p.author_id, COALESCE(m.name, u.name) AS author_name, p.created_at
         FROM posts p
         JOIN users u ON u.id = p.author_id
         LEFT JOIN members m ON m.classroom_id = p.classroom_id AND m.user_id = p.author_id
         WHERE p.id = $id`,
        { id },
      );
      if (!row) fail(500, "internal_error");
      return c.json({ ...toReply(row, classroom.teacher_id), replies: [] }, 201);
    })
    .delete("/classrooms/:id/posts/:postId", async (c) => {
      const user = requireUser(c);
      const { classroom, isTeacher } = await classroomAccess(c.env.DB, c.req.param("id"), user);
      const post = await one<{ id: string; author_id: string }>(
        c.env.DB,
        "SELECT id, author_id FROM posts WHERE id = $id AND classroom_id = $cid",
        { id: c.req.param("postId"), cid: classroom.id },
      );
      if (!post) fail(404, "not_found");
      if (!isTeacher && post.author_id !== user.id) fail(403, "forbidden");
      await run(c.env.DB, "DELETE FROM posts WHERE id = $id", { id: post.id });
      return c.body(null, 204);
    })
    .get("/classrooms/:id/activities", async (c) => {
      const user = requireUser(c);
      const { classroom } = await classroomAccess(c.env.DB, c.req.param("id"), user);
      const rows = await all<{
        id: string;
        mode: "live" | "test";
        finished_at: string | null;
        created_at: string;
        topic_title: string;
      }>(
        c.env.DB,
        `SELECT a.id, a.mode, a.finished_at, a.created_at, t.title AS topic_title
         FROM activities a JOIN topics t ON t.id = a.topic_id
         WHERE a.classroom_id = $cid
         ORDER BY a.created_at DESC, a.rowid DESC`,
        { cid: classroom.id },
      );
      return c.json(
        rows.map(
          (row): ClassroomActivity => ({
            id: row.id,
            mode: row.mode,
            topicTitle: row.topic_title,
            finishedAt: row.finished_at,
            createdAt: row.created_at,
          }),
        ),
      );
    });
}

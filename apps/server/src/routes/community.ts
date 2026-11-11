import { Hono } from "hono";
import {
  AnnouncementInputSchema,
  PostInputSchema,
  type Announcement,
  type ClassroomMembers,
  type Post,
  type PostReply,
  type User,
} from "@socrates/shared";
import { all, one, run, type Db } from "../db/d1";
import { enforceIpLimit, fail, newId, nowIso, parseBody, requireUser, type AppEnv, type Ctx } from "../http";

interface Access {
  user: User;
  classroomId: string;
  teacherId: string;
  teacherName: string;
  owner: boolean;
  authorName: string;
}

interface PostRow {
  id: string;
  parent_id: string | null;
  body: string;
  author_id: string;
  author_name: string;
  created_at: string;
}

async function access(c: Ctx, classroomId: string): Promise<Access> {
  const user = requireUser(c);
  const row = await one<{ id: string; teacher_id: string; teacher_name: string; member_name: string | null }>(
    c.env.DB,
    `SELECT c.id, c.teacher_id, t.name AS teacher_name, m.name AS member_name
     FROM classrooms c
     JOIN users t ON t.id = c.teacher_id
     LEFT JOIN members m ON m.classroom_id = c.id AND m.user_id = $uid
     WHERE c.id = $cid AND (c.teacher_id = $uid OR m.user_id IS NOT NULL)`,
    { cid: classroomId, uid: user.id },
  );
  if (!row) fail(404, "not_found");
  const owner = row.teacher_id === user.id;
  return {
    user,
    classroomId: row.id,
    teacherId: row.teacher_id,
    teacherName: row.teacher_name,
    owner,
    authorName: owner ? row.teacher_name : (row.member_name ?? user.name),
  };
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

async function listPosts(db: Db, room: Access): Promise<Post[]> {
  const rows = await all<PostRow>(
    db,
    `SELECT p.id, p.parent_id, p.body, p.author_id, COALESCE(m.name, u.name) AS author_name, p.created_at
     FROM posts p
     JOIN users u ON u.id = p.author_id
     LEFT JOIN members m ON m.classroom_id = p.classroom_id AND m.user_id = p.author_id
     WHERE p.classroom_id = $cid
     ORDER BY p.created_at ASC, p.rowid ASC`,
    { cid: room.classroomId },
  );
  const threads = new Map<string, Post>();
  for (const row of rows) {
    if (row.parent_id === null) threads.set(row.id, { ...toReply(row, room.teacherId), replies: [] });
  }
  for (const row of rows) {
    if (row.parent_id !== null) threads.get(row.parent_id)?.replies.push(toReply(row, room.teacherId));
  }
  return [...threads.values()].reverse();
}

export function communityRoutes() {
  return new Hono<AppEnv>()
    .get("/classrooms/:id/announcements", async (c) => {
      const room = await access(c, c.req.param("id"));
      const rows = await all<{ id: string; body: string; author_name: string; created_at: string }>(
        c.env.DB,
        `SELECT a.id, a.body, u.name AS author_name, a.created_at
         FROM announcements a JOIN users u ON u.id = a.author_id
         WHERE a.classroom_id = $cid
         ORDER BY a.created_at DESC, a.rowid DESC`,
        { cid: room.classroomId },
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
      const room = await access(c, c.req.param("id"));
      if (!room.owner) fail(403, "forbidden");
      const input = await parseBody(c, AnnouncementInputSchema);
      const announcement: Announcement = {
        id: newId("an_"),
        body: input.body,
        authorName: room.teacherName,
        createdAt: nowIso(),
      };
      await run(
        c.env.DB,
        "INSERT INTO announcements (id, classroom_id, author_id, body, created_at) VALUES ($id, $cid, $uid, $body, $at)",
        {
          id: announcement.id,
          cid: room.classroomId,
          uid: room.user.id,
          body: announcement.body,
          at: announcement.createdAt,
        },
      );
      return c.json(announcement, 201);
    })
    .delete("/classrooms/:id/announcements/:announcementId", async (c) => {
      const room = await access(c, c.req.param("id"));
      if (!room.owner) fail(403, "forbidden");
      const result = await run(c.env.DB, "DELETE FROM announcements WHERE id = $id AND classroom_id = $cid", {
        id: c.req.param("announcementId"),
        cid: room.classroomId,
      });
      if (!result.meta.changes) fail(404, "not_found");
      return c.body(null, 204);
    })
    .get("/classrooms/:id/members", async (c) => {
      const room = await access(c, c.req.param("id"));
      const rows = await all<{ user_id: string; name: string; joined_at: string }>(
        c.env.DB,
        `SELECT m.user_id, m.name, m.joined_at
         FROM members m JOIN users u ON u.id = m.user_id
         WHERE m.classroom_id = $cid AND u.preview_classroom_id IS NULL
         ORDER BY m.joined_at ASC, m.rowid ASC`,
        { cid: room.classroomId },
      );
      const body: ClassroomMembers = {
        teacher: { id: room.teacherId, name: room.teacherName },
        members: rows.map((row) => ({ id: row.user_id, name: row.name, joinedAt: row.joined_at })),
      };
      return c.json(body);
    })
    .delete("/classrooms/:id/members/:userId", async (c) => {
      const room = await access(c, c.req.param("id"));
      const target = c.req.param("userId");
      if (target === room.teacherId) fail(403, "forbidden");
      if (!room.owner && target !== room.user.id) fail(403, "forbidden");
      const result = await run(c.env.DB, "DELETE FROM members WHERE classroom_id = $cid AND user_id = $uid", {
        cid: room.classroomId,
        uid: target,
      });
      if (!result.meta.changes) fail(404, "not_found");
      return c.body(null, 204);
    })
    .get("/classrooms/:id/posts", async (c) => {
      const room = await access(c, c.req.param("id"));
      return c.json(await listPosts(c.env.DB, room));
    })
    .post("/classrooms/:id/posts", async (c) => {
      await enforceIpLimit(c, "community-post", 30);
      const room = await access(c, c.req.param("id"));
      const input = await parseBody(c, PostInputSchema);
      if (input.parentId) {
        const parent = await one<{ id: string }>(
          c.env.DB,
          "SELECT id FROM posts WHERE id = $pid AND classroom_id = $cid AND parent_id IS NULL",
          { pid: input.parentId, cid: room.classroomId },
        );
        if (!parent) fail(404, "not_found");
      }
      const post: Post = {
        id: newId("p_"),
        body: input.body,
        authorId: room.user.id,
        authorName: room.authorName,
        isTeacher: room.owner,
        createdAt: nowIso(),
        replies: [],
      };
      await run(
        c.env.DB,
        "INSERT INTO posts (id, classroom_id, author_id, parent_id, body, created_at) VALUES ($id, $cid, $uid, $pid, $body, $at)",
        {
          id: post.id,
          cid: room.classroomId,
          uid: room.user.id,
          pid: input.parentId ?? null,
          body: post.body,
          at: post.createdAt,
        },
      );
      return c.json(post, 201);
    })
    .delete("/classrooms/:id/posts/:postId", async (c) => {
      const room = await access(c, c.req.param("id"));
      const post = await one<{ id: string; author_id: string }>(
        c.env.DB,
        "SELECT id, author_id FROM posts WHERE id = $id AND classroom_id = $cid",
        { id: c.req.param("postId"), cid: room.classroomId },
      );
      if (!post) fail(404, "not_found");
      if (!room.owner && post.author_id !== room.user.id) fail(403, "forbidden");
      await run(c.env.DB, "DELETE FROM posts WHERE id = $id", { id: post.id });
      return c.body(null, 204);
    });
}

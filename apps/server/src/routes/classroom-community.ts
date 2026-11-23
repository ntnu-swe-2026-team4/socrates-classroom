import { Hono } from "hono";
import { ClassroomPageQuerySchema, type ActivityMode } from "@socrates/shared";
import { all, one, run } from "../db/d1";
import type { Env } from "../env";
import { publishClassroom } from "../do/classroom-events";
import { fail, guardUser, requireUser, validateQuery, type AppEnv } from "../http";
import { classroomAccess } from "../services/members";
import { pageBounds, pageOf } from "../services/pagination";

interface RosterMember {
  id: string;
  name: string;
  joined_at: string;
}

interface ListedActivity {
  id: string;
  mode: ActivityMode;
  topic_title: string;
  created_at: string;
  finished_at: string | null;
}

async function disconnectMemberThreads(env: Env, classroomId: string, userId: string): Promise<void> {
  try {
    const threads = await all<{ activity_id: string; id: string }>(
      env.DB,
      `SELECT p.activity_id, p.id FROM activity_participants p JOIN activities a ON a.id = p.activity_id
       WHERE a.classroom_id = $cid AND a.finished_at IS NULL AND p.user_id = $uid AND p.kind = 'member'`,
      { cid: classroomId, uid: userId },
    );
    const results = await Promise.allSettled(
      threads.map((thread) => env.Chat.getByName(`${thread.activity_id}:${thread.id}`).disconnectMember(userId)),
    );
    for (const result of results) {
      if (result.status === "rejected") console.warn("activity disconnect failed", result.reason);
    }
  } catch (error) {
    console.warn("activity disconnect lookup failed", error);
  }
}

export function classroomCommunityRoutes() {
  return new Hono<AppEnv>()
    .get("/classrooms/:id/members", guardUser(), validateQuery(ClassroomPageQuerySchema), async (c) => {
      const { classroom } = await classroomAccess(c.env.DB, c.req.param("id"), requireUser(c));
      const { limit, at, after } = pageBounds(c.req.valid("query"));
      const teacher = await one<{ id: string; name: string }>(c.env.DB, "SELECT id, name FROM users WHERE id = $id", {
        id: classroom.teacher_id,
      });
      if (!teacher) fail(404, "not_found");
      const rows = await all<RosterMember>(
        c.env.DB,
        `SELECT user_id AS id, name, joined_at FROM members
         WHERE classroom_id = $cid AND user_id <> $teacher AND ($at IS NULL OR (joined_at, user_id) > ($at, $after))
         ORDER BY joined_at, user_id LIMIT $limit`,
        { cid: classroom.id, teacher: teacher.id, at, after, limit: limit + 1 },
      );
      return c.json({
        teacher,
        ...pageOf(
          rows,
          limit,
          (row) => [row.joined_at, row.id],
          (row) => ({ id: row.id, name: row.name, joinedAt: row.joined_at }),
        ),
      });
    })
    .delete("/classrooms/:id/members/:userId", async (c) => {
      const user = requireUser(c);
      const { classroom, isTeacher } = await classroomAccess(c.env.DB, c.req.param("id"), user);
      const target = c.req.param("userId");
      if (target === classroom.teacher_id || (!isTeacher && target !== user.id)) fail(403, "forbidden");
      const removed = await run(c.env.DB, "DELETE FROM members WHERE classroom_id = $cid AND user_id = $uid", {
        cid: classroom.id,
        uid: target,
      });
      if (removed.meta.changes)
        await Promise.all([
          publishClassroom(c.env, classroom.id, "members", target),
          disconnectMemberThreads(c.env, classroom.id, target),
        ]);
      return c.body(null, 204);
    })
    .get("/classrooms/:id/activities", guardUser(), validateQuery(ClassroomPageQuerySchema), async (c) => {
      const { classroom, isTeacher } = await classroomAccess(c.env.DB, c.req.param("id"), requireUser(c));
      const { limit, at, after } = pageBounds(c.req.valid("query"));
      const rows = await all<ListedActivity>(
        c.env.DB,
        `SELECT a.id, a.mode, a.created_at, a.finished_at, t.title AS topic_title
         FROM activities a JOIN topics t ON t.id = a.topic_id
         WHERE a.classroom_id = $cid AND ($teacher OR a.mode = 'live')
           AND ($at IS NULL OR (a.created_at, a.id) < ($at, $after))
         ORDER BY a.created_at DESC, a.id DESC LIMIT $limit`,
        { cid: classroom.id, teacher: isTeacher ? 1 : 0, at, after, limit: limit + 1 },
      );
      return c.json(
        pageOf(
          rows,
          limit,
          (row) => [row.created_at, row.id],
          (row) => ({
            id: row.id,
            mode: row.mode,
            topicTitle: row.topic_title,
            createdAt: row.created_at,
            finishedAt: row.finished_at,
          }),
        ),
      );
    })
    .get("/classrooms/:id/events", guardUser(), (c) =>
      c.env.ClassroomEvents.getByName(c.req.param("id")).fetch(c.req.raw),
    );
}

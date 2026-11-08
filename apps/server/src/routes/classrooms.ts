import { Hono } from "hono";
import { ClassroomCreateInputSchema } from "@socrates/shared";
import { one, run } from "../db/d1";
import { fail, newId, nowIso, parseBody, requireTeacher, type AppEnv } from "../http";
import type { ClassroomRow } from "../services/members";

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]!).join("");
}

async function createActivity(db: D1Database, classroomId: string, topicId: string): Promise<string> {
  const id = newId("a_");
  await run(db, "INSERT INTO activities (id, classroom_id, topic_id, created_at) VALUES ($id, $cid, $tid, $at)", {
    id,
    cid: classroomId,
    tid: topicId,
    at: nowIso(),
  });
  await run(db, "UPDATE classrooms SET current_activity_id = $aid WHERE id = $cid", { aid: id, cid: classroomId });
  return id;
}

export function classroomsRoutes() {
  return new Hono<AppEnv>()
    .post("/classrooms", async (c) => {
      const user = requireTeacher(c);
      const input = await parseBody(c, ClassroomCreateInputSchema);
      const topic = await one<{ id: string }>(c.env.DB, "SELECT id FROM topics WHERE id = $id", {
        id: input.topicId,
      });
      if (!topic) fail(404, "not_found");
      const id = newId("c_");
      const at = nowIso();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = newCode();
        const clash = await one<{ id: string }>(c.env.DB, "SELECT id FROM classrooms WHERE join_code = $code", {
          code,
        });
        if (clash) continue;
        await run(
          c.env.DB,
          "INSERT INTO classrooms (id, name, teacher_id, join_code, current_activity_id, created_at) VALUES ($id, $name, $tid, $code, NULL, $at)",
          { id, name: input.name, tid: user.id, code, at },
        );
        const activityId = await createActivity(c.env.DB, id, input.topicId);
        const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
        void id;
        return c.json({ classroomId: id, code, url: `${base}/join/${code}`, activityId }, 201);
      }
      fail(500, "internal_error");
    })
    .post("/classrooms/:id/activities", async (c) => {
      const user = requireTeacher(c);
      const input = await parseBody(c, ClassroomCreateInputSchema);
      const classroom = await one<ClassroomRow>(c.env.DB, "SELECT * FROM classrooms WHERE id = $id", {
        id: c.req.param("id"),
      });
      if (!classroom) fail(404, "not_found");
      if (classroom.teacher_id !== user.id) fail(403, "forbidden");
      const topic = await one<{ id: string }>(c.env.DB, "SELECT id FROM topics WHERE id = $id", {
        id: input.topicId,
      });
      if (!topic) fail(404, "not_found");
      const activityId = await createActivity(c.env.DB, classroom.id, input.topicId);
      const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
      return c.json(
        {
          classroomId: classroom.id,
          code: classroom.join_code,
          url: `${base}/join/${classroom.join_code}`,
          activityId,
        },
        201,
      );
    });
}

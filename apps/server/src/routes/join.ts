import { Hono } from "hono";
import { JoinInputSchema } from "@socrates/shared";
import { one, run } from "../db/d1";
import { startSession } from "../auth";
import { fail, newId, nowIso, parseBody, type AppEnv } from "../http";
import { topicOf, type ClassroomRow } from "../services/members";

export function joinRoutes() {
  return new Hono<AppEnv>()
    .get("/join/:code", async (c) => {
      const classroom = await one<ClassroomRow>(c.env.DB, "SELECT * FROM classrooms WHERE join_code = $code", {
        code: c.req.param("code"),
      });
      if (!classroom?.current_activity_id) fail(404, "join_code_invalid");
      const activity = await one<{ topic_id: string }>(c.env.DB, "SELECT topic_id FROM activities WHERE id = $id", {
        id: classroom.current_activity_id,
      });
      if (!activity) fail(404, "join_code_invalid");
      const topic = await topicOf(c.env.DB, activity.topic_id);
      return c.json({ code: classroom.join_code, classroomName: classroom.name, topic });
    })
    .post("/join", async (c) => {
      const input = await parseBody(c, JoinInputSchema);
      if (input.tosAccepted !== true) fail(422, "tos_required");
      const classroom = await one<ClassroomRow>(c.env.DB, "SELECT * FROM classrooms WHERE join_code = $code", {
        code: input.code,
      });
      if (!classroom?.current_activity_id) fail(404, "join_code_invalid");
      const user = c.get("user");
      if (user?.role === "teacher") fail(403, "only_student");

      const existing = user
        ? await one<{ user_id: string }>(
            c.env.DB,
            "SELECT user_id FROM members WHERE classroom_id = $cid AND user_id = $uid",
            { cid: classroom.id, uid: user.id },
          )
        : undefined;

      if (existing) {
        return c.json({ user, activityId: classroom.current_activity_id! });
      }

      const at = nowIso();
      let sessionUser = user;
      if (!sessionUser) {
        const name = input.name?.trim();
        if (!name) fail(422, "validation");
        const clash = await one<{ user_id: string }>(
          c.env.DB,
          "SELECT user_id FROM members WHERE classroom_id = $cid AND name = $name",
          { cid: classroom.id, name },
        );
        if (clash) fail(409, "name_taken");
        const id = newId("u_");
        await run(c.env.DB, "INSERT INTO users (id, name, role, created_at) VALUES ($id, $name, 'student', $at)", {
          id,
          name,
          at,
        });
        sessionUser = { id, name, role: "student" as const };
        await startSession(c, sessionUser);
      } else {
        const clash = await one<{ user_id: string }>(
          c.env.DB,
          "SELECT user_id FROM members WHERE classroom_id = $cid AND name = $name",
          { cid: classroom.id, name: sessionUser.name },
        );
        if (clash && clash.user_id !== sessionUser.id) fail(409, "name_taken");
      }

      await run(
        c.env.DB,
        "INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at) VALUES ($cid, $uid, $name, $at, $at)",
        { cid: classroom.id, uid: sessionUser.id, name: sessionUser.name, at },
      );
      return c.json({ user: sessionUser, activityId: classroom.current_activity_id! });
    });
}

import { Hono } from "hono";
import { JoinInputSchema, type User } from "@socrates/shared";
import { batch, one, run } from "../db/d1";
import { startSession } from "../auth";
import { enforceIpLimit, fail, langOf, newId, nowIso, parseBody, uniqueViolationColumns, type AppEnv } from "../http";
import { assertSeats, topicOf, type ClassroomRow } from "../services/members";

const isNameClash = (error: unknown) =>
  uniqueViolationColumns(error).some(([table, column]) => table === "members" && column === "name");

export function joinRoutes() {
  return new Hono<AppEnv>()
    .get("/join/:code", async (c) => {
      await enforceIpLimit(c, "join-code", 60);
      const classroom = await one<ClassroomRow>(c.env.DB, "SELECT * FROM classrooms WHERE join_code = $code", {
        code: c.req.param("code"),
      });
      if (!classroom?.current_activity_id) fail(404, "join_code_invalid");
      const activity = await one<{ topic_id: string }>(c.env.DB, "SELECT topic_id FROM activities WHERE id = $id", {
        id: classroom.current_activity_id,
      });
      if (!activity) fail(404, "join_code_invalid");
      const topic = await topicOf(c.env.DB, activity.topic_id, langOf(c));
      return c.json({ code: classroom.join_code, classroomName: classroom.name, topic });
    })
    .post("/join", async (c) => {
      await enforceIpLimit(c, "join", 30);
      const input = await parseBody(c, JoinInputSchema);
      if (input.tosAccepted !== true) fail(422, "tos_required");
      const classroom = await one<ClassroomRow>(c.env.DB, "SELECT * FROM classrooms WHERE join_code = $code", {
        code: input.code,
      });
      if (!classroom?.current_activity_id) fail(404, "join_code_invalid");
      const activityId = classroom.current_activity_id;
      const current = c.get("user");
      const account = current && !current.guest && !current.preview ? current : null;
      if (account && classroom.teacher_id === account.id) fail(403, "only_student");

      if (account) {
        const existing = await one<{ user_id: string }>(
          c.env.DB,
          "SELECT user_id FROM members WHERE classroom_id = $cid AND user_id = $uid",
          { cid: classroom.id, uid: account.id },
        );
        if (existing) return c.json({ user: account, activityId });
        if (account.kind === "student") fail(403, "student_restricted");
      } else if (current?.guest && !current.preview && current.activityId === activityId) {
        return c.json({ user: current, activityId });
      }

      const activity = await one<{ finished_at: string | null }>(
        c.env.DB,
        "SELECT finished_at FROM activities WHERE id = $id",
        { id: activityId },
      );
      if (activity?.finished_at) fail(409, "activity_finished");
      await assertSeats(c.env.DB, classroom.id, 1);

      const at = nowIso();
      if (!account) {
        const name = input.name?.trim();
        if (!name) fail(422, "validation");
        const clash = await one<{ user_id: string }>(
          c.env.DB,
          "SELECT user_id FROM members WHERE classroom_id = $cid AND name = $name",
          { cid: classroom.id, name },
        );
        if (clash) fail(409, "name_taken");
        const id = newId("u_");
        try {
          await batch(c.env.DB, [
            {
              sql: "INSERT INTO users (id, name, is_guest, guest_activity_id, lang, created_at) VALUES ($id, $name, 1, $aid, $lang, $at)",
              params: { id, name, aid: activityId, at, lang: langOf(c) },
            },
            {
              sql: "INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at) VALUES ($cid, $uid, $name, $at, $at)",
              params: { cid: classroom.id, uid: id, name, at },
            },
          ]);
        } catch (error) {
          if (isNameClash(error)) fail(409, "name_taken");
          throw error;
        }
        const guest: User = { id, name, guest: true, kind: "guest", activityId };
        await startSession(c, guest);
        return c.json({ user: guest, activityId });
      }

      const clash = await one<{ user_id: string }>(
        c.env.DB,
        "SELECT user_id FROM members WHERE classroom_id = $cid AND name = $name",
        { cid: classroom.id, name: account.name },
      );
      if (clash) fail(409, "name_taken");
      try {
        await run(
          c.env.DB,
          "INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at) VALUES ($cid, $uid, $name, $at, $at)",
          { cid: classroom.id, uid: account.id, name: account.name, at },
        );
      } catch (error) {
        if (!isNameClash(error)) throw error;
        const raced = await one<{ user_id: string }>(
          c.env.DB,
          "SELECT user_id FROM members WHERE classroom_id = $cid AND user_id = $uid",
          { cid: classroom.id, uid: account.id },
        );
        if (!raced) fail(409, "name_taken");
      }
      return c.json({ user: account, activityId });
    });
}

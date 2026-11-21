import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { JoinInputSchema, type JoinResult } from "@socrates/shared";
import { one, run } from "../db/d1";
import { PARTICIPANT_COOKIE, lookupParticipant, startParticipantSession } from "../auth";
import { enforceIpLimit, fail, nowIso, parseBody, uniqueViolationColumns, type AppEnv } from "../http";
import {
  createGuestParticipant,
  ensureParticipant,
  participantOf,
  topicOf,
  type ClassroomRow,
  type MemberRow,
} from "../services/members";

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
      const topic = await topicOf(c.env.DB, activity.topic_id);
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
      const activity = await one<{ finished_at: string | null }>(
        c.env.DB,
        "SELECT finished_at FROM activities WHERE id = $id",
        { id: activityId },
      );
      const finished = Boolean(activity?.finished_at);
      const user = c.get("user");

      if (user) {
        const existing = await one<MemberRow>(
          c.env.DB,
          "SELECT * FROM members WHERE classroom_id = $cid AND user_id = $uid",
          { cid: classroom.id, uid: user.id },
        );
        if (!existing) {
          if (finished) fail(409, "activity_finished");
          const clash = await one<{ user_id: string }>(
            c.env.DB,
            "SELECT user_id FROM members WHERE classroom_id = $cid AND name = $name",
            { cid: classroom.id, name: user.name },
          );
          if (clash) fail(409, "name_taken");
          try {
            await run(
              c.env.DB,
              "INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at) VALUES ($cid, $uid, $name, $at, $at)",
              { cid: classroom.id, uid: user.id, name: user.name, at: nowIso() },
            );
          } catch (error) {
            const taken = uniqueViolationColumns(error).some(
              ([table, column]) => table === "members" && column === "name",
            );
            if (taken) fail(409, "name_taken");
            throw error;
          }
        }
        const participant = finished ? null : await ensureParticipant(c.env.DB, activityId, user, nowIso());
        const payload: JoinResult = {
          user,
          activityId,
          participantId: participant?.id ?? null,
          kind: participant ? (participant.kind === "guest" ? "guest" : "member") : null,
        };
        return c.json(payload);
      }

      const held = await lookupParticipant(c.env, getCookie(c, PARTICIPANT_COOKIE));
      if (held?.activityId === activityId) {
        const participant = await participantOf(c.env.DB, activityId, held.participantId);
        if (participant && participant.user_id === null) {
          await startParticipantSession(c, activityId, participant.id);
          const payload: JoinResult = { user: null, activityId, participantId: participant.id, kind: "guest" };
          return c.json(payload);
        }
      }

      if (finished) fail(409, "activity_finished");
      const name = input.name?.trim();
      if (!name) fail(422, "validation");
      const participant = await createGuestParticipant(c.env.DB, activityId, name, nowIso());
      await startParticipantSession(c, activityId, participant.id);
      const payload: JoinResult = { user: null, activityId, participantId: participant.id, kind: "guest" };
      return c.json(payload);
    });
}

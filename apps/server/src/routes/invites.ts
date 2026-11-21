import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import { InviteJoinInputSchema, type InviteJoined } from "@socrates/shared";
import { one } from "../db/d1";
import { PARTICIPANT_COOKIE, lookupParticipant, startParticipantSession } from "../auth";
import {
  activityAccess,
  createGuestParticipant,
  ensureParticipant,
  participantOf,
  resolveInvite,
  topicOf,
  type InviteRow,
  type MemberRow,
} from "../services/members";
import { enforceIpLimit, fail, newId, nowIso, rateLimit, requireUser, validateJson, type AppEnv } from "../http";

async function activeInvite(db: D1Database, activityId: string): Promise<InviteRow | null> {
  return await one<InviteRow>(
    db,
    `SELECT * FROM activity_invites
     WHERE activity_id = $aid AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > $at)
     ORDER BY created_at DESC LIMIT 1`,
    { aid: activityId, at: nowIso() },
  );
}

export function inviteRoutes() {
  return new Hono<AppEnv>()
    .post("/activities/:id/invites", async (c) => {
      const user = requireUser(c);
      const { activity, classroom } = await activityAccess(c.env.DB, c.req.param("id"), {
        user,
        participant: null,
      });
      if (classroom.teacher_id !== user.id) fail(403, "forbidden");
      if (activity.mode === "test") fail(409, "conflict");
      if (activity.finished_at) fail(409, "activity_finished");

      let invite = await activeInvite(c.env.DB, activity.id);
      if (!invite) {
        const token = newId();
        await one(
          c.env.DB,
          `INSERT INTO activity_invites (token, activity_id, created_by, created_at)
           VALUES ($token, $aid, $uid, $at)
           ON CONFLICT DO NOTHING RETURNING token`,
          { token, aid: activity.id, uid: user.id, at: nowIso() },
        );
        invite = await activeInvite(c.env.DB, activity.id);
        if (!invite) fail(500, "internal_error");
      }
      const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
      return c.json({
        token: invite.token,
        activityId: activity.id,
        url: `${base}/join/a/${invite.token}`,
        createdAt: invite.created_at,
        expiresAt: invite.expires_at,
      });
    })
    .get("/invites/:token", async (c) => {
      await enforceIpLimit(c, "invite-preview", 60);
      const { invite, activity, classroom } = await resolveInvite(c.env.DB, c.req.param("token"));
      return c.json({
        token: invite.token,
        activityId: activity.id,
        classroomName: classroom.name,
        topic: await topicOf(c.env.DB, activity.topic_id),
        finishedAt: activity.finished_at,
      });
    })
    .post("/invites/:token/join", rateLimit("invite-join", 30), validateJson(InviteJoinInputSchema), async (c) => {
      const input = c.req.valid("json");
      if (input.tosAccepted !== true) fail(422, "tos_required");
      const { activity } = await resolveInvite(c.env.DB, c.req.param("token"));
      if (activity.finished_at) fail(409, "activity_finished");

      const user = c.get("user");
      const held = await lookupParticipant(c.env, getCookie(c, PARTICIPANT_COOKIE));
      if (held?.activityId === activity.id) {
        const existing = await participantOf(c.env.DB, activity.id, held.participantId);
        if (existing && existing.user_id === (user?.id ?? null)) {
          await startParticipantSession(c, activity.id, existing.id);
          const payload: InviteJoined = {
            activityId: activity.id,
            participantId: existing.id,
            displayName: existing.display_name,
            kind: existing.kind === "member" ? "member" : "guest",
          };
          return c.json(payload);
        }
      }

      const at = nowIso();
      if (user) {
        const member = await one<MemberRow>(
          c.env.DB,
          "SELECT * FROM members WHERE classroom_id = $cid AND user_id = $uid",
          { cid: activity.classroom_id, uid: user.id },
        );
        const participant = await ensureParticipant(c.env.DB, activity.id, user, at, member ? "member" : "guest");
        await startParticipantSession(c, activity.id, participant.id);
        const payload: InviteJoined = {
          activityId: activity.id,
          participantId: participant.id,
          displayName: participant.display_name,
          kind: member ? "member" : "guest",
        };
        return c.json(payload);
      }

      const name = input.name?.trim();
      if (!name) fail(422, "validation");
      const participant = await createGuestParticipant(c.env.DB, activity.id, name, at);
      await startParticipantSession(c, activity.id, participant.id);
      const payload: InviteJoined = {
        activityId: activity.id,
        participantId: participant.id,
        displayName: participant.display_name,
        kind: "guest",
      };
      return c.json(payload);
    });
}

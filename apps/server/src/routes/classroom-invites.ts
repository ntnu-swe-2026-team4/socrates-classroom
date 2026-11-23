import { Hono } from "hono";
import { getCookie } from "hono/cookie";
import {
  ClassroomInviteCreateSchema,
  ClassroomPageQuerySchema,
  InviteJoinInputSchema,
  type ClassroomInviteScope,
  type InviteJoinInput,
} from "@socrates/shared";
import { PARTICIPANT_COOKIE, lookupParticipant, startParticipantSession } from "../auth";
import { sha256Hex } from "../auth-crypto";
import { all, batch, one } from "../db/d1";
import { publishClassroom } from "../do/classroom-events";
import {
  fail,
  guardUser,
  newId,
  nowIso,
  rateLimit,
  requireUser,
  uniqueViolationColumns,
  validateJson,
  validateQuery,
  type AppEnv,
  type Ctx,
} from "../http";
import { classroomAccess, topicOf } from "../services/members";
import { pageBounds, pageOf } from "../services/pagination";

interface InviteRow {
  id: string;
  classroom_id: string;
  activity_id: string | null;
  scope: ClassroomInviteScope;
  created_at: string;
  expires_at: string;
  revoked_at: string | null;
}

interface ResolvedInvite extends InviteRow {
  classroom_name: string;
  topic_id: string | null;
  finished_at: string | null;
}

interface Redemption {
  classroom_id: string;
  activity_id: string | null;
  participant_id: string | null;
  display_name: string | null;
  kind: "guest" | "member" | null;
}

const expiryDuration = 7 * 24 * 60 * 60 * 1000;
const eligible = `WITH eligible AS (
  SELECT i.classroom_id, i.activity_id, i.scope, c.teacher_id
  FROM classroom_invites i
  JOIN classrooms c ON c.id = i.classroom_id
  LEFT JOIN activities a ON a.id = i.activity_id
  WHERE i.id = $invite AND i.revoked_at IS NULL AND i.expires_at > $at
    AND (i.activity_id IS NULL OR (a.mode = 'live' AND a.finished_at IS NULL))
)`;
const participantMatches =
  "((p.user_id = $uid) OR ($uid IS NULL AND p.user_id IS NULL AND p.kind = 'guest' AND p.id = $held))";
const actorIsMember = `EXISTS (
  SELECT 1 FROM members m WHERE m.classroom_id = e.classroom_id AND m.user_id = $uid
)`;

function metadata(row: InviteRow) {
  return {
    id: row.id,
    classroomId: row.classroom_id,
    activityId: row.activity_id,
    scope: row.scope,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
  };
}

async function resolve(db: D1Database, token: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) fail(404, "invite_invalid");
  const invite = await one<ResolvedInvite>(
    db,
    `SELECT i.*, c.name AS classroom_name, a.topic_id, a.finished_at
     FROM classroom_invites i JOIN classrooms c ON c.id = i.classroom_id
     LEFT JOIN activities a ON a.id = i.activity_id WHERE i.token_hash = $hash`,
    { hash: await sha256Hex(token) },
  );
  if (!invite) fail(404, "invite_invalid");
  if (invite.revoked_at) fail(410, "invite_revoked");
  if (invite.expires_at <= nowIso()) fail(410, "invite_expired");
  return invite;
}

async function redeem(c: Ctx, token: string, input: InviteJoinInput) {
  if (!input.tosAccepted) fail(422, "tos_required");
  const db = c.env.DB;
  const invite = await resolve(db, token);
  if (invite.finished_at) fail(409, "activity_finished");
  const guest = invite.scope === "activity_guest";
  const user = guest && !c.get("sessionIssue") ? c.get("user") : requireUser(c);
  const held = user ? null : await lookupParticipant(c.env, getCookie(c, PARTICIPANT_COOKIE));
  const heldId = held?.activityId === invite.activity_id ? held?.participantId : null;
  const name = user?.name ?? input.name;
  if (!name && !heldId) fail(422, "validation");

  const params = { invite: invite.id, uid: user?.id ?? null, name, held: heldId, pid: newId("p_"), at: nowIso() };
  let result: Redemption | undefined;
  let joinedClassroom = false;
  try {
    const [member, , , selected] = await batch(db, [
      {
        sql: `${eligible}
          INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at)
          SELECT e.classroom_id, $uid, $name, $at, $at FROM eligible e
          WHERE e.scope <> 'activity_guest' AND e.teacher_id <> $uid
          ON CONFLICT (classroom_id, user_id) DO NOTHING`,
        params,
      },
      {
        sql: `${eligible}
          INSERT INTO activity_participants (activity_id, id, user_id, kind, display_name, tos_accepted_at, joined_at)
          SELECT e.activity_id, $pid, $uid, CASE WHEN ${actorIsMember} THEN 'member' ELSE 'guest' END,
            CASE WHEN $uid IS NOT NULL AND EXISTS (
              SELECT 1 FROM activity_participants p WHERE p.activity_id = e.activity_id AND p.display_name = $name
            ) THEN $name || ' · ' || substr($pid, 3) ELSE $name END, $at, $at
          FROM eligible e
          WHERE e.activity_id IS NOT NULL AND $name IS NOT NULL AND NOT EXISTS (
            SELECT 1 FROM activity_participants p WHERE p.activity_id = e.activity_id AND ${participantMatches}
          )`,
        params,
      },
      {
        sql: `${eligible}
          UPDATE activity_participants AS p
          SET kind = (SELECT CASE WHEN ${actorIsMember} THEN 'member' ELSE 'guest' END FROM eligible e)
          WHERE p.user_id = $uid AND p.kind IN ('guest', 'member')
            AND p.activity_id IN (SELECT activity_id FROM eligible)`,
        params,
      },
      {
        sql: `${eligible}
          SELECT e.classroom_id, e.activity_id, p.id AS participant_id, p.display_name, p.kind
          FROM eligible e LEFT JOIN activity_participants p ON p.activity_id = e.activity_id AND p.id = (
            SELECT p.id FROM activity_participants p
            WHERE p.activity_id = e.activity_id AND ${participantMatches}
            ORDER BY p.joined_at, p.id LIMIT 1
          )`,
        params,
      },
    ]);
    joinedClassroom = Boolean(member.meta.changes);
    result = (selected.results as Redemption[])[0];
  } catch (error) {
    if (
      uniqueViolationColumns(error).some(
        ([table, column]) =>
          (table === "members" && column === "name") ||
          (table === "activity_participants" && column === "display_name"),
      )
    )
      fail(409, "name_taken");
    throw error;
  }
  if (!result) {
    const latest = await resolve(db, token);
    if (latest.finished_at) fail(409, "activity_finished");
    fail(409, "conflict");
  }
  if (result.activity_id) {
    if (!result.participant_id) fail(422, "validation");
    if (!user) await startParticipantSession(c, result.activity_id, result.participant_id);
  }
  if (joinedClassroom) await publishClassroom(c.env, result.classroom_id, "members");
  return c.json({
    classroomId: result.classroom_id,
    activityId: result.activity_id,
    participantId: result.participant_id,
    displayName: result.display_name,
    kind: result.kind,
  });
}

export function classroomInviteRoutes() {
  return new Hono<AppEnv>()
    .post("/classrooms/:id/invites", guardUser(), validateJson(ClassroomInviteCreateSchema), async (c) => {
      const { classroom, isTeacher } = await classroomAccess(c.env.DB, c.req.param("id"), requireUser(c));
      if (!isTeacher) fail(403, "forbidden");
      const { scope, activityId } = c.req.valid("json");
      if (activityId) {
        const activity = await one<{ mode: string; finished_at: string | null }>(
          c.env.DB,
          "SELECT mode, finished_at FROM activities WHERE classroom_id = $cid AND id = $id",
          { cid: classroom.id, id: activityId },
        );
        if (!activity) fail(404, "not_found");
        if (activity.mode !== "live") fail(409, "conflict");
        if (activity.finished_at) fail(409, "activity_finished");
      }

      const token = newId();
      const created = Date.now();
      const invite = await one<InviteRow>(
        c.env.DB,
        `INSERT INTO classroom_invites (id, classroom_id, activity_id, scope, token_hash, created_at, expires_at)
         VALUES ($id, $cid, $aid, $scope, $hash, $at, $expires) RETURNING *`,
        {
          id: newId("iv_"),
          cid: classroom.id,
          aid: activityId ?? null,
          scope,
          hash: await sha256Hex(token),
          at: new Date(created).toISOString(),
          expires: new Date(created + expiryDuration).toISOString(),
        },
      );
      if (!invite) fail(500, "internal_error");
      const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
      return c.json({ ...metadata(invite), token, url: `${base}/join/i/${token}` }, 201);
    })
    .get("/classrooms/:id/invites", guardUser(), validateQuery(ClassroomPageQuerySchema), async (c) => {
      const { classroom, isTeacher } = await classroomAccess(c.env.DB, c.req.param("id"), requireUser(c));
      if (!isTeacher) fail(403, "forbidden");
      const { limit, at, after } = pageBounds(c.req.valid("query"));
      const rows = await all<InviteRow>(
        c.env.DB,
        `SELECT id, classroom_id, activity_id, scope, created_at, expires_at, revoked_at
         FROM classroom_invites WHERE classroom_id = $cid AND ($at IS NULL OR (created_at, id) < ($at, $after))
         ORDER BY created_at DESC, id DESC LIMIT $limit`,
        { cid: classroom.id, at, after, limit: limit + 1 },
      );
      return c.json(pageOf(rows, limit, (row) => [row.created_at, row.id], metadata));
    })
    .delete("/classrooms/:id/invites/:inviteId", async (c) => {
      const { classroom, isTeacher } = await classroomAccess(c.env.DB, c.req.param("id"), requireUser(c));
      if (!isTeacher) fail(403, "forbidden");
      const updated = await one(
        c.env.DB,
        `UPDATE classroom_invites SET revoked_at = COALESCE(revoked_at, $at)
         WHERE classroom_id = $cid AND id = $id RETURNING id`,
        { cid: classroom.id, id: c.req.param("inviteId"), at: nowIso() },
      );
      if (!updated) fail(404, "not_found");
      return c.body(null, 204);
    })
    .get("/classroom-invites/:token", rateLimit("invite-preview", 60), async (c) => {
      const invitation = await resolve(c.env.DB, c.req.param("token"));
      return c.json({
        classroomId: invitation.classroom_id,
        classroomName: invitation.classroom_name,
        activityId: invitation.activity_id,
        scope: invitation.scope,
        expiresAt: invitation.expires_at,
        finishedAt: invitation.finished_at,
        topic: invitation.topic_id ? await topicOf(c.env.DB, invitation.topic_id) : null,
      });
    })
    .post("/classroom-invites/:token/join", rateLimit("invite-join", 30), validateJson(InviteJoinInputSchema), (c) =>
      redeem(c, c.req.param("token"), c.req.valid("json")),
    );
}

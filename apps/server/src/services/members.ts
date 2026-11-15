import { getCookie } from "hono/cookie";
import { ApiError, type User } from "@socrates/shared";
import type { Db } from "../db/d1";
import { one } from "../db/d1";
import { PARTICIPANT_COOKIE, lookupParticipant, type ParticipantIdentity } from "../auth";
import { fail, newId, nowIso, type Ctx } from "../http";

export interface ClassroomRow {
  id: string;
  name: string;
  teacher_id: string;
  join_code: string;
  current_activity_id: string | null;
}

export interface ActivityRow {
  id: string;
  classroom_id: string;
  topic_id: string;
  created_at: string;
  finished_at: string | null;
}

export interface TopicRow {
  id: string;
  owner_id: string | null;
  title: string;
  statement: string;
  summary: string | null;
  prompts: string;
}

export interface MemberRow {
  classroom_id: string;
  user_id: string;
  name: string;
  tos_accepted_at: string;
  joined_at: string;
}

export interface ParticipantRow {
  activity_id: string;
  id: string;
  user_id: string | null;
  kind: "member" | "guest" | "teacher";
  display_name: string;
  tos_accepted_at: string | null;
  joined_at: string;
}

export function parsePrompts(row: TopicRow) {
  return {
    id: row.id,
    title: row.title,
    statement: row.statement,
    ...(row.summary ? { summary: row.summary } : {}),
    prompts: JSON.parse(row.prompts) as string[],
  };
}

export async function activityOf(
  db: Db,
  activityId: string,
): Promise<{ activity: ActivityRow; classroom: ClassroomRow }> {
  const activity = await one<ActivityRow>(db, "SELECT * FROM activities WHERE id = $id", { id: activityId });
  if (!activity) fail(404, "not_found");
  const classroom = await one<ClassroomRow>(db, "SELECT * FROM classrooms WHERE id = $cid", {
    cid: activity.classroom_id,
  });
  if (!classroom) fail(404, "not_found");
  return { activity, classroom };
}

export async function topicOf(db: Db, topicId: string): Promise<ReturnType<typeof parsePrompts>> {
  const row = await one<TopicRow>(db, "SELECT * FROM topics WHERE id = $id", { id: topicId });
  if (!row) fail(404, "not_found");
  return parsePrompts(row);
}

export async function participantOf(db: Db, activityId: string, participantId: string): Promise<ParticipantRow | null> {
  return await one<ParticipantRow>(db, "SELECT * FROM activity_participants WHERE activity_id = $aid AND id = $pid", {
    aid: activityId,
    pid: participantId,
  });
}

async function participantOfUser(db: Db, activityId: string, userId: string): Promise<ParticipantRow | null> {
  return await one<ParticipantRow>(
    db,
    "SELECT * FROM activity_participants WHERE activity_id = $aid AND user_id = $uid ORDER BY joined_at, id LIMIT 1",
    { aid: activityId, uid: userId },
  );
}

export async function ensureParticipant(
  db: Db,
  activityId: string,
  user: Pick<User, "id" | "name">,
  tosAcceptedAt: string,
  kind: "member" | "guest" = "member",
): Promise<ParticipantRow> {
  const existing = await participantOfUser(db, activityId, user.id);
  if (existing) return existing;
  await one(
    db,
    `INSERT INTO activity_participants (activity_id, id, user_id, kind, display_name, tos_accepted_at, joined_at)
     VALUES ($aid, $pid, $uid, $kind, $name, $tos, $at)
     ON CONFLICT DO NOTHING RETURNING id`,
    { aid: activityId, pid: newId("p_"), uid: user.id, kind, name: user.name, tos: tosAcceptedAt, at: nowIso() },
  );
  const created = await participantOfUser(db, activityId, user.id);
  if (!created) fail(409, "name_taken");
  return created;
}

export async function createGuestParticipant(
  db: Db,
  activityId: string,
  displayName: string,
  tosAcceptedAt: string,
): Promise<ParticipantRow> {
  const created = await one<ParticipantRow>(
    db,
    `INSERT INTO activity_participants (activity_id, id, user_id, kind, display_name, tos_accepted_at, joined_at)
     VALUES ($aid, $pid, NULL, 'guest', $name, $tos, $at)
     ON CONFLICT DO NOTHING RETURNING *`,
    { aid: activityId, pid: newId("p_"), name: displayName, tos: tosAcceptedAt, at: nowIso() },
  );
  if (!created) fail(409, "name_taken");
  return created;
}

export interface ActivityAccess {
  activity: ActivityRow;
  classroom: ClassroomRow;
  participant: ParticipantRow | null;
  member: MemberRow | null;
  isTeacher: boolean;
  user: Pick<User, "id"> | null;
}

export interface ActivityAccessor {
  user: Pick<User, "id"> | null;
  participant: ParticipantIdentity | null;
}

export async function activityAccess(db: Db, activityId: string, accessor: ActivityAccessor): Promise<ActivityAccess> {
  const { activity, classroom } = await activityOf(db, activityId);
  if (accessor.user) {
    if (classroom.teacher_id === accessor.user.id) {
      return { activity, classroom, participant: null, member: null, isTeacher: true, user: accessor.user };
    }
    const member = await one<MemberRow>(db, "SELECT * FROM members WHERE classroom_id = $cid AND user_id = $uid", {
      cid: classroom.id,
      uid: accessor.user.id,
    });
    if (!member) fail(403, "forbidden");
    return {
      activity,
      classroom,
      participant: await participantOfUser(db, activityId, accessor.user.id),
      member,
      isTeacher: false,
      user: accessor.user,
    };
  }
  if (accessor.participant && accessor.participant.activityId === activityId) {
    const participant = await participantOf(db, activityId, accessor.participant.participantId);
    if (participant) return { activity, classroom, participant, member: null, isTeacher: false, user: null };
  }
  fail(401, "unauthorized");
}

export async function activityAccessOf(c: Ctx, activityId: string): Promise<ActivityAccess> {
  const user = c.get("user");
  const participant = await lookupParticipant(c.env, getCookie(c, PARTICIPANT_COOKIE));
  if (user) {
    try {
      return await activityAccess(c.env.DB, activityId, { user, participant: null });
    } catch (error) {
      const cookieOnlyGuest = participant !== null && error instanceof ApiError && error.code === "forbidden";
      if (!cookieOnlyGuest) throw error;
    }
  }
  return await activityAccess(c.env.DB, activityId, { user: null, participant });
}

export interface InviteRow {
  token: string;
  activity_id: string;
  created_by: string;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
}

export async function resolveInvite(
  db: Db,
  token: string,
): Promise<{ invite: InviteRow; activity: ActivityRow; classroom: ClassroomRow }> {
  const invite = await one<InviteRow>(db, "SELECT * FROM activity_invites WHERE token = $token", { token });
  if (!invite) fail(404, "invite_invalid");
  if (invite.revoked_at) fail(410, "invite_revoked");
  if (invite.expires_at && invite.expires_at <= nowIso()) fail(410, "invite_expired");
  const { activity, classroom } = await activityOf(db, invite.activity_id);
  return { invite, activity, classroom };
}

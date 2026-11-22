import { getCookie } from "hono/cookie";
import { ApiError, type ActivityMode, type User } from "@socrates/shared";
import type { Db } from "../db/d1";
import { one, run } from "../db/d1";
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
  mode: ActivityMode;
  created_at: string;
  finished_at: string | null;
}

export interface TopicRow {
  id: string;
  owner_id: string | null;
  classroom_id: string | null;
  copied_from: string | null;
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
    classroomId: row.classroom_id,
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

export interface ClassroomAccess {
  classroom: ClassroomRow;
  isTeacher: boolean;
}

export async function classroomAccess(db: Db, classroomId: string, user: Pick<User, "id">): Promise<ClassroomAccess> {
  const classroom = await one<ClassroomRow>(db, "SELECT * FROM classrooms WHERE id = $id", { id: classroomId });
  if (!classroom) fail(404, "not_found");
  if (classroom.teacher_id === user.id) return { classroom, isTeacher: true };
  const member = await one<MemberRow>(db, "SELECT * FROM members WHERE classroom_id = $cid AND user_id = $uid", {
    cid: classroom.id,
    uid: user.id,
  });
  if (!member) fail(403, "forbidden");
  return { classroom, isTeacher: false };
}

export async function topicForActivity(
  db: Db,
  topicId: string,
  classroomId: string,
  userId: string,
): Promise<TopicRow> {
  const topic = await one<TopicRow>(db, "SELECT * FROM topics WHERE id = $id", { id: topicId });
  if (!topic) fail(404, "not_found");
  const systemOrOwn = topic.classroom_id === null && (topic.owner_id === null || topic.owner_id === userId);
  if (topic.classroom_id !== classroomId && !systemOrOwn) fail(404, "not_found");
  return topic;
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
  const effectiveKind = `CASE WHEN $kind = 'member' OR EXISTS (
    SELECT 1 FROM activities a JOIN members m ON m.classroom_id = a.classroom_id
    WHERE a.id = $aid AND m.user_id = $uid
  ) THEN 'member' ELSE 'guest' END`;
  let candidate = user.name;
  for (let attempt = 1; attempt <= 8; attempt++) {
    const existing = await participantOfUser(db, activityId, user.id);
    if (existing) {
      if (existing.kind !== kind && existing.kind !== "teacher") {
        const updated = await one<ParticipantRow>(
          db,
          `UPDATE activity_participants SET kind = ${effectiveKind}
           WHERE activity_id = $aid AND id = $pid AND user_id = $uid RETURNING *`,
          { kind, aid: activityId, pid: existing.id, uid: user.id },
        );
        if (updated) return updated;
      }
      return existing;
    }
    const created = await one<ParticipantRow>(
      db,
      `INSERT INTO activity_participants (activity_id, id, user_id, kind, display_name, tos_accepted_at, joined_at)
       SELECT $aid, $pid, $uid, ${effectiveKind}, $name, $tos, $at
       WHERE NOT EXISTS (SELECT 1 FROM activity_participants WHERE activity_id = $aid AND user_id = $uid)
       ON CONFLICT DO NOTHING RETURNING *`,
      { aid: activityId, pid: newId("p_"), uid: user.id, kind, name: candidate, tos: tosAcceptedAt, at: nowIso() },
    );
    if (created) return created;
    const holder = await one<ParticipantRow>(
      db,
      "SELECT * FROM activity_participants WHERE activity_id = $aid AND display_name = $name",
      { aid: activityId, name: candidate },
    );
    if (holder?.user_id === null && holder.kind === "guest" && (await yieldGuestName(db, activityId, candidate))) {
      continue;
    }
    candidate = `${user.name} ${attempt + 1}`;
  }
  fail(409, "name_taken");
}

async function yieldGuestName(db: Db, activityId: string, name: string): Promise<boolean> {
  for (let n = 1; n <= 9; n++) {
    const renamed = n === 1 ? `${name}（訪客）` : `${name}（訪客 ${n}）`;
    const result = await run(
      db,
      `UPDATE activity_participants SET display_name = $new
       WHERE activity_id = $aid AND display_name = $old AND user_id IS NULL AND kind = 'guest'`,
      { aid: activityId, old: name, new: renamed },
    );
    if ((result.meta?.changes ?? 0) > 0) return true;
  }
  return false;
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
  if (activity.mode === "test" && classroom.teacher_id !== accessor.user?.id) fail(403, "forbidden");
  if (accessor.user) {
    if (classroom.teacher_id === accessor.user.id) {
      return { activity, classroom, participant: null, member: null, isTeacher: true, user: accessor.user };
    }
    const member = await one<MemberRow>(db, "SELECT * FROM members WHERE classroom_id = $cid AND user_id = $uid", {
      cid: classroom.id,
      uid: accessor.user.id,
    });
    const participant = await participantOfUser(db, activityId, accessor.user.id);
    if (!member && participant?.kind !== "guest") fail(403, "forbidden");
    return {
      activity,
      classroom,
      participant,
      member,
      isTeacher: false,
      user: accessor.user,
    };
  }
  if (accessor.participant && accessor.participant.activityId === activityId) {
    const participant = await participantOf(db, activityId, accessor.participant.participantId);
    if (participant?.kind === "guest" && participant.user_id === null) {
      return { activity, classroom, participant, member: null, isTeacher: false, user: null };
    }
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

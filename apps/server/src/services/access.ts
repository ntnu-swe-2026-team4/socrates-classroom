import type { Db } from "../db/d1";
import { all, one } from "../db/d1";
import type { UserRow } from "../http";
import { fail } from "../http";

export interface ClassroomRow {
  id: string;
  name: string;
  description: string;
  teacher_id: string;
  created_at: string;
  updated_at: string;
}

export interface MembershipRow {
  classroom_id: string;
  user_id: string;
  role: "student" | "assistant";
  status: "active" | "invited";
  created_at: string;
}

export interface ActivityRow {
  id: string;
  classroom_id: string;
  title: string;
  statement: string;
  answer_mode: string;
  axes: string;
  group_size: number;
  stage: "individual" | "team" | "debate" | "done";
  stage_deadline: string | null;
  topic_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface TopicRow {
  id: string;
  classroom_id: string;
  title: string;
  description: string;
  due_at: string | null;
  accepts_reports: number;
  activity_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface DiscussionRow {
  id: string;
  classroom_id: string;
  title: string;
  prompt: string;
  conclusion_hint: string;
  due_at: string | null;
  max_rounds: number;
  status: "open" | "closed";
  created_at: string;
  updated_at: string;
}

export type ClassroomRole = "teacher" | "assistant" | "student";

export async function classroomById(db: Db, id: string): Promise<ClassroomRow | null> {
  return await one<ClassroomRow>(db, "SELECT * FROM classrooms WHERE id = $id", { id });
}

export async function membershipOf(db: Db, classroomId: string, userId: string): Promise<MembershipRow | null> {
  return await one<MembershipRow>(db,
    "SELECT * FROM classroom_members WHERE classroom_id = $cid AND user_id = $uid",
    { cid: classroomId, uid: userId },
  );
}

export async function roleIn(db: Db, classroom: ClassroomRow, user: UserRow): Promise<ClassroomRole | null> {
  if (classroom.teacher_id === user.id) return "teacher";
  const m = await membershipOf(db, classroom.id, user.id);
  if (!m || m.status !== "active") return null;
  return m.role;
}

export async function accessClassroom(db: Db, classroomId: string, user: UserRow): Promise<{ classroom: ClassroomRow; role: ClassroomRole }> {
  const classroom = await classroomById(db, classroomId);
  if (!classroom) fail(404, "classroom_not_found");
  const role = await roleIn(db, classroom, user);
  if (!role) fail(403, "not_classroom_member");
  return { classroom, role };
}

export async function accessClassroomStaff(db: Db, classroomId: string, user: UserRow): Promise<{ classroom: ClassroomRow; role: "teacher" | "assistant" }> {
  const out = await accessClassroom(db, classroomId, user);
  if (out.role !== "teacher" && out.role !== "assistant") fail(403, "only_staff");
  return { classroom: out.classroom, role: out.role };
}

export async function accessClassroomTeacher(db: Db, classroomId: string, user: UserRow): Promise<ClassroomRow> {
  const out = await accessClassroom(db, classroomId, user);
  if (out.role !== "teacher") fail(403, "only_teacher");
  return out.classroom;
}

export async function activityById(db: Db, id: string): Promise<ActivityRow | null> {
  return await one<ActivityRow>(db, "SELECT * FROM activities WHERE id = $id", { id });
}

export async function accessActivity(db: Db, id: string, user: UserRow): Promise<{ activity: ActivityRow; classroom: ClassroomRow; role: ClassroomRole }> {
  const activity = await activityById(db, id);
  if (!activity) fail(404, "activity_not_found");
  const { classroom, role } = await accessClassroom(db, activity.classroom_id, user);
  return { activity, classroom, role };
}

export async function topicById(db: Db, id: string): Promise<TopicRow | null> {
  return await one<TopicRow>(db, "SELECT * FROM topics WHERE id = $id", { id });
}

export async function accessTopic(db: Db, id: string, user: UserRow): Promise<{ topic: TopicRow; classroom: ClassroomRow; role: ClassroomRole }> {
  const topic = await topicById(db, id);
  if (!topic) fail(404, "topic_not_found");
  const { classroom, role } = await accessClassroom(db, topic.classroom_id, user);
  return { topic, classroom, role };
}

export async function discussionById(db: Db, id: string): Promise<DiscussionRow | null> {
  return await one<DiscussionRow>(db, "SELECT * FROM discussions WHERE id = $id", { id });
}

export async function accessDiscussion(db: Db, id: string, user: UserRow): Promise<{ discussion: DiscussionRow; classroom: ClassroomRow; role: ClassroomRole }> {
  const discussion = await discussionById(db, id);
  if (!discussion) fail(404, "discussion_not_found");
  const { classroom, role } = await accessClassroom(db, discussion.classroom_id, user);
  return { discussion, classroom, role };
}

export async function groupRow(db: Db, id: string): Promise<any | null> {
  return await one(db, "SELECT * FROM groups WHERE id = $id", { id });
}

export async function accessGroup(db: Db, id: string, user: UserRow): Promise<{ group: any; activity: ActivityRow; classroom: ClassroomRow; role: ClassroomRole }> {
  const group = await groupRow(db, id);
  if (!group) fail(404, "group_not_found");
  const { activity, classroom, role } = await accessActivity(db, group.activity_id, user);
  return { group, activity, classroom, role };
}

export async function roomRow(db: Db, id: string): Promise<any | null> {
  return await one(db, "SELECT * FROM rooms WHERE id = $id", { id });
}

export async function accessRoom(db: Db, id: string, user: UserRow): Promise<{ room: any; activity: ActivityRow; classroom: ClassroomRow; role: ClassroomRole }> {
  const room = await roomRow(db, id);
  if (!room) fail(404, "room_not_found");
  const { activity, classroom, role } = await accessActivity(db, room.activity_id, user);
  return { room, activity, classroom, role };
}

export async function studentIdsOf(db: Db, classroomId: string): Promise<string[]> {
  const rows = await all<{ user_id: string }>(
    db,
    "SELECT user_id FROM classroom_members WHERE classroom_id = $cid AND role = 'student' AND status = 'active' ORDER BY created_at, user_id",
    { cid: classroomId },
  );
  return rows.map((r) => r.user_id);
}

export async function memberIdsOf(db: Db, classroomId: string): Promise<string[]> {
  const rows = await all<{ user_id: string }>(
    db,
    "SELECT user_id FROM classroom_members WHERE classroom_id = $cid AND status = 'active' ORDER BY created_at, user_id",
    { cid: classroomId },
  );
  return rows.map((r) => r.user_id);
}

export async function usersByIds(db: Db, ids: string[]): Promise<Map<string, UserRow>> {
  const map = new Map<string, UserRow>();
  if (!ids.length) return map;
  const placeholders = ids.map((_, i) => `$id${i}`).join(",");
  const params: Record<string, string> = {};
  ids.forEach((id, i) => (params[`id${i}`] = id));
  const rows = (await all<UserRow>(
    db,
    `SELECT id, name, role, avatar_url, created_at FROM users WHERE id IN (${placeholders})`,
    params,
  )) as UserRow[];
  for (const row of rows) map.set(row.id, row);
  return map;
}

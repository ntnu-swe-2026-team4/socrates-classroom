import type { DB } from "../db";
import { bind, one } from "../db";
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

export function classroomById(db: DB, id: string): ClassroomRow | null {
  return one<ClassroomRow>(db, "SELECT * FROM classrooms WHERE id = $id", { id });
}

export function membershipOf(db: DB, classroomId: string, userId: string): MembershipRow | null {
  return one<MembershipRow>(
    db,
    "SELECT * FROM classroom_members WHERE classroom_id = $cid AND user_id = $uid",
    { cid: classroomId, uid: userId },
  );
}

export function roleIn(db: DB, classroom: ClassroomRow, user: UserRow): ClassroomRole | null {
  if (classroom.teacher_id === user.id) return "teacher";
  const m = membershipOf(db, classroom.id, user.id);
  if (!m || m.status !== "active") return null;
  return m.role;
}

export function accessClassroom(db: DB, classroomId: string, user: UserRow): { classroom: ClassroomRow; role: ClassroomRole } {
  const classroom = classroomById(db, classroomId);
  if (!classroom) fail(404, "classroom_not_found");
  const role = roleIn(db, classroom, user);
  if (!role) fail(403, "not_classroom_member");
  return { classroom, role };
}

export function accessClassroomStaff(db: DB, classroomId: string, user: UserRow): { classroom: ClassroomRow; role: "teacher" | "assistant" } {
  const out = accessClassroom(db, classroomId, user);
  if (out.role !== "teacher" && out.role !== "assistant") fail(403, "only_staff");
  return { classroom: out.classroom, role: out.role };
}

export function accessClassroomTeacher(db: DB, classroomId: string, user: UserRow): ClassroomRow {
  const out = accessClassroom(db, classroomId, user);
  if (out.role !== "teacher") fail(403, "only_teacher");
  return out.classroom;
}

export function activityById(db: DB, id: string): ActivityRow | null {
  return one<ActivityRow>(db, "SELECT * FROM activities WHERE id = $id", { id });
}

export function accessActivity(db: DB, id: string, user: UserRow): { activity: ActivityRow; classroom: ClassroomRow; role: ClassroomRole } {
  const activity = activityById(db, id);
  if (!activity) fail(404, "activity_not_found");
  const { classroom, role } = accessClassroom(db, activity.classroom_id, user);
  return { activity, classroom, role };
}

export function topicById(db: DB, id: string): TopicRow | null {
  return one<TopicRow>(db, "SELECT * FROM topics WHERE id = $id", { id });
}

export function accessTopic(db: DB, id: string, user: UserRow): { topic: TopicRow; classroom: ClassroomRow; role: ClassroomRole } {
  const topic = topicById(db, id);
  if (!topic) fail(404, "topic_not_found");
  const { classroom, role } = accessClassroom(db, topic.classroom_id, user);
  return { topic, classroom, role };
}

export function discussionById(db: DB, id: string): DiscussionRow | null {
  return one<DiscussionRow>(db, "SELECT * FROM discussions WHERE id = $id", { id });
}

export function accessDiscussion(db: DB, id: string, user: UserRow): { discussion: DiscussionRow; classroom: ClassroomRow; role: ClassroomRole } {
  const discussion = discussionById(db, id);
  if (!discussion) fail(404, "discussion_not_found");
  const { classroom, role } = accessClassroom(db, discussion.classroom_id, user);
  return { discussion, classroom, role };
}

export function groupRow(db: DB, id: string): any | null {
  return one(db, "SELECT * FROM groups WHERE id = $id", { id });
}

export function accessGroup(db: DB, id: string, user: UserRow): { group: any; activity: ActivityRow; classroom: ClassroomRow; role: ClassroomRole } {
  const group = groupRow(db, id);
  if (!group) fail(404, "group_not_found");
  const { activity, classroom, role } = accessActivity(db, group.activity_id, user);
  return { group, activity, classroom, role };
}

export function roomRow(db: DB, id: string): any | null {
  return one(db, "SELECT * FROM rooms WHERE id = $id", { id });
}

export function accessRoom(db: DB, id: string, user: UserRow): { room: any; activity: ActivityRow; classroom: ClassroomRow; role: ClassroomRole } {
  const room = roomRow(db, id);
  if (!room) fail(404, "room_not_found");
  const { activity, classroom, role } = accessActivity(db, room.activity_id, user);
  return { room, activity, classroom, role };
}

export function studentIdsOf(db: DB, classroomId: string): string[] {
  return (db.query(
    "SELECT user_id FROM classroom_members WHERE classroom_id = $cid AND role = 'student' AND status = 'active' ORDER BY created_at, user_id",
  ).all(bind({ cid: classroomId })) as { user_id: string }[]).map((r) => r.user_id);
}

export function memberIdsOf(db: DB, classroomId: string): string[] {
  return (db.query(
    "SELECT user_id FROM classroom_members WHERE classroom_id = $cid AND status = 'active' ORDER BY created_at, user_id",
  ).all(bind({ cid: classroomId })) as { user_id: string }[]).map((r) => r.user_id);
}

export function usersByIds(db: DB, ids: string[]): Map<string, UserRow> {
  const map = new Map<string, UserRow>();
  if (!ids.length) return map;
  const placeholders = ids.map((_, i) => `$id${i}`).join(",");
  const params: Record<string, string> = {};
  ids.forEach((id, i) => (params[`id${i}`] = id));
  const rows = db.query(
    `SELECT id, name, role, avatar_url, created_at FROM users WHERE id IN (${placeholders})`,
  ).all(bind(params)) as UserRow[];
  for (const row of rows) map.set(row.id, row);
  return map;
}

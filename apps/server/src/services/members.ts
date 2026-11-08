import type { User } from "@socrates/shared";
import type { Db } from "../db/d1";
import { one } from "../db/d1";
import { fail } from "../http";

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

export async function requireMembership(
  db: Db,
  activityId: string,
  user: User,
): Promise<{ activity: ActivityRow; classroom: ClassroomRow; member: MemberRow | null; isTeacher: boolean }> {
  const { activity, classroom } = await activityOf(db, activityId);
  if (classroom.teacher_id === user.id) return { activity, classroom, member: null, isTeacher: true };
  const member = await one<MemberRow>(db, "SELECT * FROM members WHERE classroom_id = $cid AND user_id = $uid", {
    cid: classroom.id,
    uid: user.id,
  });
  if (!member) fail(403, "forbidden");
  return { activity, classroom, member, isTeacher: false };
}

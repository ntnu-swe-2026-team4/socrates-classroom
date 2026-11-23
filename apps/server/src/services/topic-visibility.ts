import type { Db, SqlEntry } from "../db/d1";
import { one } from "../db/d1";
import { fail } from "../http";

export type TopicScope = "system" | "personal" | "classroom";

export interface TopicIdentity {
  owner_id: string | null;
  classroom_id: string | null;
  deleted_at: string | null;
}

export interface TopicSubject {
  userId: string;
  classroomId?: string | null;
}

export function topicScope(topic: TopicIdentity): TopicScope {
  if (topic.classroom_id !== null) return "classroom";
  return topic.owner_id === null ? "system" : "personal";
}

const scopeSql: Record<TopicScope, (subject: TopicSubject) => SqlEntry> = {
  system: () => ({ sql: "classroom_id IS NULL AND owner_id IS NULL AND deleted_at IS NULL" }),
  personal: (subject) => ({
    sql: "classroom_id IS NULL AND owner_id = $uid AND deleted_at IS NULL",
    params: { uid: subject.userId },
  }),
  classroom: (subject) => ({
    sql: "classroom_id = $cid AND deleted_at IS NULL",
    params: { cid: subject.classroomId ?? null },
  }),
};

export function topicPoolSql(scopes: readonly TopicScope[], subject: TopicSubject): SqlEntry {
  const entries = scopes.map((scope) => scopeSql[scope](subject));
  const params: Record<string, unknown> = {};
  for (const entry of entries) Object.assign(params, entry.params);
  return { sql: `(${entries.map((entry) => entry.sql).join(" OR ")})`, params };
}

export function topicVisibleTo(topic: TopicIdentity, subject: TopicSubject): boolean {
  if (topic.deleted_at !== null) return false;
  const scope = topicScope(topic);
  if (scope === "system") return true;
  if (scope === "personal") return topic.owner_id === subject.userId;
  return subject.classroomId != null && topic.classroom_id === subject.classroomId;
}

export async function copyableTopic<T extends TopicIdentity>(db: Db, topicId: string, userId: string): Promise<T> {
  const topic = await one<T>(db, "SELECT * FROM topics WHERE id = $id", { id: topicId });
  if (!topic || topic.deleted_at !== null) fail(404, "not_found");
  if (topicScope(topic) === "classroom") {
    const classroom = await one<{ teacher_id: string }>(db, "SELECT teacher_id FROM classrooms WHERE id = $cid", {
      cid: topic.classroom_id,
    });
    if (classroom?.teacher_id !== userId) fail(404, "not_found");
    return topic;
  }
  if (!topicVisibleTo(topic, { userId })) fail(404, "not_found");
  return topic;
}

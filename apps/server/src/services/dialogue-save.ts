import type { Db } from "../db/d1";
import { newId, nowIso } from "../http";
import type { Emotion } from "@socrates/shared";

/**
 * 對話成功的 D1 寫回——三個 scope 各自的 SQL，自原本 routes 的 save callback 移植。
 * 由 PiAgent DO 在串流完成時呼叫（DO 自己有 DB binding）。
 */
export interface SaveTurnInput {
  scope: "archive" | "activity" | "discussion";
  scopeId: string;
  userId: string;
  userText: string;
  assistantText: string;
  emotion: Emotion;
}

export async function saveTurn(db: Db, input: SaveTurnInput): Promise<{ id: string; at: string }> {
  const at = nowIso();
  const userId = newId(scopePrefix(input.scope));
  const assistantId = newId(scopePrefix(input.scope));

  if (input.scope === "archive") {
    const rounds = await db.one<{ n: number }>(
      "SELECT COUNT(*) AS n FROM archive_messages WHERE archive_id = $id AND role = 'user'",
      { id: input.scopeId },
    );
    await db.batch([
      { sql: "INSERT INTO archive_messages (id, archive_id, role, text, emotion, created_at) VALUES ($id, $aid, 'user', $text, NULL, $at)", params: { id: userId, aid: input.scopeId, text: input.userText, at } },
      { sql: "INSERT INTO archive_messages (id, archive_id, role, text, emotion, created_at) VALUES ($id, $aid, 'assistant', $text, $emotion, $at)", params: { id: assistantId, aid: input.scopeId, text: input.assistantText, emotion: input.emotion, at } },
      { sql: "UPDATE archives SET rounds = $rounds, snippet = $snippet, date = $at, updated_at = $at WHERE id = $id", params: { rounds: rounds?.n ?? 0, snippet: input.assistantText.slice(0, 60), at, id: input.scopeId } },
    ]);
  } else if (input.scope === "activity") {
    await db.batch([
      { sql: "INSERT INTO activity_dialogue (id, activity_id, student_id, role, text, emotion, created_at) VALUES ($id, $aid, $sid, 'user', $text, NULL, $at)", params: { id: userId, aid: input.scopeId, sid: input.userId, text: input.userText, at } },
      { sql: "INSERT INTO activity_dialogue (id, activity_id, student_id, role, text, emotion, created_at) VALUES ($id, $aid, $sid, 'assistant', $text, $emotion, $at)", params: { id: assistantId, aid: input.scopeId, sid: input.userId, text: input.assistantText, emotion: input.emotion, at } },
    ]);
  } else {
    await db.batch([
      { sql: "INSERT INTO discussion_messages (id, discussion_id, student_id, role, text, emotion, created_at) VALUES ($id, $did, $sid, 'user', $text, NULL, $at)", params: { id: userId, did: input.scopeId, sid: input.userId, text: input.userText, at } },
      { sql: "INSERT INTO discussion_messages (id, discussion_id, student_id, role, text, emotion, created_at) VALUES ($id, $did, $sid, 'assistant', $text, $emotion, $at)", params: { id: assistantId, did: input.scopeId, sid: input.userId, text: input.assistantText, emotion: input.emotion, at } },
      { sql: "UPDATE discussion_sessions SET last_active_at = $at WHERE discussion_id = $did AND student_id = $sid", params: { at, did: input.scopeId, sid: input.userId } },
    ]);
  }
  return { id: assistantId, at };
}

function scopePrefix(scope: SaveTurnInput["scope"]): string {
  return scope === "archive" ? "u_" : "m_";
}

/** 對話歷史的讀取（移植自三個路由的前置查詢；供首次建立 pi session 時注入上下文）。 */
export async function loadHistory(db: Db, scope: SaveTurnInput["scope"], scopeId: string, userId: string): Promise<Array<{ role: "user" | "assistant"; text: string }>> {
  if (scope === "archive") {
    const rows = await db.all<{ role: string; text: string }>(
      "SELECT role, text FROM archive_messages WHERE archive_id = $id ORDER BY created_at DESC, rowid DESC LIMIT 40",
      { id: scopeId },
    );
    return rows.reverse().map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
  }
  const limit = scope === "activity" ? 40 : 80;
  const table = scope === "activity" ? "activity_dialogue" : "discussion_messages";
  const key = scope === "activity" ? "activity_id" : "discussion_id";
  const rows = await db.all<{ role: string; text: string }>(
    `SELECT role, text FROM ${table} WHERE ${key} = $did AND student_id = $sid ORDER BY created_at DESC, rowid DESC LIMIT ${limit}`,
    { did: scopeId, sid: userId },
  );
  return rows.reverse().map((m) => ({ role: m.role as "user" | "assistant", text: m.text }));
}

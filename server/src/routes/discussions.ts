import { Hono } from "hono";
import type { Config, Lang } from "../config";
import type { DB } from "../db";
import { all, one, run, tx } from "../db";
import { requireUser } from "../auth";
import { bodyOf, fail, newId, nowIso, str, type AppEnv } from "../http";
import { accessClassroom, accessClassroomStaff, accessDiscussion, studentIdsOf } from "../services/access";
import { acquireLock, checkRate, dialogueSse, messageJson, releaseLock } from "../services/dialogue";
import {
  discussionSessionDetailJson, discussionSessionJson, discussionTaskJson, discussionSessionsExist,
} from "../services/serialize";
import type { UserRow } from "../http";

// 這個路由同時服務老師與學生；accessClassroom 已經處理權限，這裡只是取角色。
function accessClassroomStaffOrMember(db: DB, id: string, user: UserRow) {
  return accessClassroom(db, id, user);
}

function mySession(db: DB, discussionId: string, studentId: string) {
  let row = one<any>(db, "SELECT * FROM discussion_sessions WHERE discussion_id = $did AND student_id = $sid", { did: discussionId, sid: studentId });
  if (!row) {
    const id = newId("ds_");
    run(db, "INSERT INTO discussion_sessions (id, discussion_id, student_id, conclusion, submitted_at, last_active_at) VALUES ($id, $did, $sid, NULL, NULL, NULL)", {
      id, did: discussionId, sid: studentId,
    });
    row = one<any>(db, "SELECT * FROM discussion_sessions WHERE id = $id", { id });
  }
  return row;
}

function statusOf(db: DB, discussionId: string, studentId: string): "todo" | "talking" | "submitted" {
  const session = one<any>(db, "SELECT * FROM discussion_sessions WHERE discussion_id = $did AND student_id = $sid", { did: discussionId, sid: studentId });
  if (!session) return "todo";
  if (session.conclusion !== null) return "submitted";
  const rounds = one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM discussion_messages WHERE discussion_id = $did AND student_id = $sid AND role = 'user'", { did: discussionId, sid: studentId });
  return (rounds?.n ?? 0) > 0 ? "talking" : "todo";
}

function cleanInput(body: Record<string, unknown>, partial: boolean) {
  const out: Record<string, unknown> = {};
  if (!partial || body.title !== undefined) {
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (!title) fail(422, "discussion_title_required");
    out.title = title.slice(0, 200);
  }
  if (!partial || body.prompt !== undefined) out.prompt = typeof body.prompt === "string" ? body.prompt.trim().slice(0, 10000) : "";
  if (!partial || body.conclusionHint !== undefined) out.conclusionHint = typeof body.conclusionHint === "string" ? body.conclusionHint.trim().slice(0, 4000) : "";
  if (!partial || body.dueAt !== undefined) {
    if (body.dueAt === null || body.dueAt === undefined || body.dueAt === "") out.dueAt = null;
    else {
      const d = new Date(String(body.dueAt));
      if (Number.isNaN(d.getTime())) fail(422, "invalid_datetime");
      out.dueAt = d.toISOString();
    }
  }
  if (!partial || body.maxRounds !== undefined) {
    const n = Number(body.maxRounds);
    if (!Number.isInteger(n) || n < 2 || n > 40) fail(422, "max_rounds");
    out.maxRounds = n;
  }
  return out;
}

export function discussionRoutes(db: DB, config: Config, getLang: (c: any) => Lang) {
  const r = new Hono<AppEnv>();

  r.get("/classrooms/:id/discussions", (c) => {
    const user = requireUser(c);
    const { classroom, role } = accessClassroomStaffOrMember(db, c.req.param("id"), user);
    const rows = all<any>(db, "SELECT * FROM discussions WHERE classroom_id = $cid ORDER BY created_at DESC", { cid: classroom.id });
    return c.json(rows.map((d) => {
      discussionSessionsExist(db, d.id);
      return discussionTaskJson(db, d, role === "student" ? statusOf(db, d.id, user.id) : undefined);
    }));
  });

  r.get("/discussions/:id", (c) => {
    const user = requireUser(c);
    const { discussion, role } = accessDiscussion(db, c.req.param("id"), user);
    discussionSessionsExist(db, discussion.id);
    return c.json(discussionTaskJson(db, discussion, role === "student" ? statusOf(db, discussion.id, user.id) : undefined));
  });

  r.post("/classrooms/:id/discussions", async (c) => {
    const user = requireUser(c);
    const { classroom } = accessClassroomStaff(db, c.req.param("id"), user);
    const body = await bodyOf(c);
    const input = cleanInput(body, false);
    const at = nowIso();
    const id = newId("dq_");
    tx(db, () => {
      run(
        db,
        `INSERT INTO discussions (id, classroom_id, title, prompt, conclusion_hint, due_at, max_rounds, status, created_at, updated_at)
         VALUES ($id, $cid, $title, $prompt, $hint, $dueAt, $maxRounds, 'open', $at, $at)`,
        { id, cid: classroom.id, title: input.title, prompt: input.prompt, hint: input.conclusionHint, dueAt: input.dueAt, maxRounds: input.maxRounds, at },
      );
      for (const sid of studentIdsOf(db, classroom.id)) {
        run(db, "INSERT INTO discussion_sessions (id, discussion_id, student_id, conclusion, submitted_at, last_active_at) VALUES ($id, $did, $sid, NULL, NULL, NULL)", {
          id: newId("ds_"), did: id, sid,
        });
      }
    });
    const row = one<any>(db, "SELECT * FROM discussions WHERE id = $id", { id })!;
    return c.json(discussionTaskJson(db, row));
  });

  r.patch("/discussions/:id", async (c) => {
    const user = requireUser(c);
    const { discussion, role } = accessDiscussion(db, c.req.param("id"), user);
    if (role !== "teacher" && role !== "assistant") fail(403, "only_staff");
    const body = await bodyOf(c);
    const input = cleanInput(body, true);
    for (const [key, value] of Object.entries(input)) {
      const column = key === "conclusionHint" ? "conclusion_hint" : key === "dueAt" ? "due_at" : key === "maxRounds" ? "max_rounds" : key;
      run(db, `UPDATE discussions SET ${column} = $v WHERE id = $id`, { v: value, id: discussion.id });
    }
    run(db, "UPDATE discussions SET updated_at = $at WHERE id = $id", { at: nowIso(), id: discussion.id });
    const row = one<any>(db, "SELECT * FROM discussions WHERE id = $id", { id: discussion.id })!;
    return c.json(discussionTaskJson(db, row));
  });

  r.put("/discussions/:id/status", async (c) => {
    const user = requireUser(c);
    const { discussion, role } = accessDiscussion(db, c.req.param("id"), user);
    if (role !== "teacher" && role !== "assistant") fail(403, "only_staff");
    const body = await bodyOf(c);
    if (body.status !== "open" && body.status !== "closed") fail(422, "validation");
    run(db, "UPDATE discussions SET status = $status, updated_at = $at WHERE id = $id", { status: body.status, at: nowIso(), id: discussion.id });
    const row = one<any>(db, "SELECT * FROM discussions WHERE id = $id", { id: discussion.id })!;
    return c.json(discussionTaskJson(db, row));
  });

  r.delete("/discussions/:id", (c) => {
    const user = requireUser(c);
    const { discussion, role } = accessDiscussion(db, c.req.param("id"), user);
    if (role !== "teacher" && role !== "assistant") fail(403, "only_staff");
    run(db, "DELETE FROM discussions WHERE id = $id", { id: discussion.id });
    return c.body(null, 204);
  });

  r.get("/discussions/:id/sessions", (c) => {
    const user = requireUser(c);
    const { discussion, role } = accessDiscussion(db, c.req.param("id"), user);
    if (role !== "teacher" && role !== "assistant") fail(403, "only_staff");
    discussionSessionsExist(db, discussion.id);
    const rows = all<any>(
      db,
      `SELECT s.* FROM discussion_sessions s
       JOIN classroom_members m ON m.classroom_id = $cid AND m.user_id = s.student_id
         AND m.status = 'active' AND m.role = 'student'
       WHERE s.discussion_id = $did`,
      { did: discussion.id, cid: discussion.classroom_id },
    );
    return c.json(rows
      .map((s) => discussionSessionJson(db, discussion, s, user.id))
      .sort((a, b) => a.studentName.localeCompare(b.studentName)));
  });

  r.get("/discussions/:id/sessions/:studentId", (c) => {
    const user = requireUser(c);
    const { discussion, role } = accessDiscussion(db, c.req.param("id"), user);
    const target = c.req.param("studentId");
    const self = target === "me" || target === user.id;
    if (!self && role !== "teacher" && role !== "assistant") fail(403, "only_staff");
    const studentId = self ? user.id : target;
    const membership = one(db, "SELECT 1 AS x FROM classroom_members WHERE classroom_id = $cid AND user_id = $sid AND status = 'active'", {
      cid: discussion.classroom_id, sid: studentId,
    });
    if (!membership) fail(404, "session_not_found");
    const session = mySession(db, discussion.id, studentId);
    return c.json(discussionSessionDetailJson(db, discussion, session, user.id));
  });

  r.post("/discussions/:id/sessions/me/messages", async (c) => {
    const user = requireUser(c);
    const { discussion, role } = accessDiscussion(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    if (discussion.status === "closed") fail(409, "discussion_closed");
    const session = mySession(db, discussion.id, user.id);
    const rounds = one<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM discussion_messages WHERE discussion_id = $did AND student_id = $sid AND role = 'user'",
      { did: discussion.id, sid: user.id },
    )?.n ?? 0;
    if (rounds >= discussion.max_rounds) fail(409, "max_rounds_reached", { n: discussion.max_rounds });
    const body = await bodyOf(c);
    const text = str(body.text, "text_required", { min: 1, max: 2000 });
    checkRate(user.id);
    const lockKey = `discussion:${discussion.id}:${user.id}`;
    acquireLock(lockKey);
    const history = all<any>(
      db,
      "SELECT role, text FROM discussion_messages WHERE discussion_id = $did AND student_id = $sid ORDER BY created_at DESC, rowid DESC LIMIT 80",
      { did: discussion.id, sid: user.id },
    ).reverse().map((m) => ({ role: m.role as "user" | "assistant", text: m.text as string }));
    try {
      return await dialogueSse(c, config, {
        lang: getLang(c),
        title: discussion.title,
        statement: discussion.prompt,
        extra: discussion.conclusion_hint ? `希望同學在結論裡回答：${discussion.conclusion_hint}` : undefined,
        history,
        lockKey,
        save: (userText, assistantText, emotion) => {
          const userId = newId("m_");
          const assistantId = newId("m_");
          const at = nowIso();
          tx(db, () => {
            run(db, "INSERT INTO discussion_messages (id, discussion_id, student_id, role, text, emotion, created_at) VALUES ($id, $did, $sid, 'user', $text, NULL, $at)", {
              id: userId, did: discussion.id, sid: user.id, text: userText, at,
            });
            run(db, "INSERT INTO discussion_messages (id, discussion_id, student_id, role, text, emotion, created_at) VALUES ($id, $did, $sid, 'assistant', $text, $emotion, $at)", {
              id: assistantId, did: discussion.id, sid: user.id, text: assistantText, emotion, at,
            });
            run(db, "UPDATE discussion_sessions SET last_active_at = $at WHERE discussion_id = $did AND student_id = $sid", {
              at, did: discussion.id, sid: user.id,
            });
          });
          void session;
          return { message: messageJson(assistantId, "assistant", assistantText, at, emotion) };
        },
      }, text);
    } catch (error) {
      releaseLock(lockKey);
      throw error;
    }
  });

  r.put("/discussions/:id/sessions/me/conclusion", async (c) => {
    const user = requireUser(c);
    const { discussion, role } = accessDiscussion(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    if (discussion.status === "closed") fail(409, "discussion_closed");
    const session = mySession(db, discussion.id, user.id);
    const body = await bodyOf(c);
    if (!("conclusion" in body)) fail(422, "validation");
    if (body.conclusion === null) {
      run(db, "UPDATE discussion_sessions SET conclusion = NULL, submitted_at = NULL, last_active_at = $at WHERE id = $id", { at: nowIso(), id: session.id });
    } else {
      if (typeof body.conclusion !== "string" || !body.conclusion.trim()) fail(422, "conclusion_empty");
      const rounds = one<{ n: number }>(
        db,
        "SELECT COUNT(*) AS n FROM discussion_messages WHERE discussion_id = $did AND student_id = $sid",
        { did: discussion.id, sid: user.id },
      )?.n ?? 0;
      if (!rounds) fail(422, "need_dialogue");
      const at = nowIso();
      run(db, "UPDATE discussion_sessions SET conclusion = $conclusion, submitted_at = $at, last_active_at = $at WHERE id = $id", {
        conclusion: body.conclusion.trim().slice(0, 10000), at, id: session.id,
      });
    }
    const updated = one<any>(db, "SELECT * FROM discussion_sessions WHERE id = $id", { id: session.id })!;
    return c.json(discussionSessionDetailJson(db, discussion, updated, user.id));
  });

  return r;
}

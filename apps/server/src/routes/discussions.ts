import { Hono } from "hono";
import type { Lang } from "@socrates/shared";
import type { Db } from "../db/d1";
import { all, one, run } from "../db/d1";
import { requireUser } from "../auth";
import { bodyOf, fail, newId, nowIso, str, type AppEnv } from "../http";
import { accessClassroom, accessClassroomStaff, accessDiscussion, studentIdsOf } from "../services/access";
import { checkRate, releaseLock } from "../services/rate-limit";
import {
  discussionSessionDetailJson, discussionSessionJson, discussionTaskJson, discussionSessionsExist,
} from "../services/serialize";
import type { UserRow } from "../http";

// 這個路由同時服務老師與學生；accessClassroom 已經處理權限，這裡只是取角色。
async function accessClassroomStaffOrMember(db: Db, id: string, user: UserRow) {
  return accessClassroom(db, id, user);
}

async function mySession(db: Db, discussionId: string, studentId: string) {
  let row = await one<any>(db, "SELECT * FROM discussion_sessions WHERE discussion_id = $did AND student_id = $sid", { did: discussionId, sid: studentId });
  if (!row) {
    const id = newId("ds_");
    await run(db, "INSERT INTO discussion_sessions (id, discussion_id, student_id, conclusion, submitted_at, last_active_at) VALUES ($id, $did, $sid, NULL, NULL, NULL)", {
      id, did: discussionId, sid: studentId,
    });
    row = (await one<any>(db, "SELECT * FROM discussion_sessions WHERE id = $id", { id }))!;
  }
  return row;
}

async function statusOf(db: Db, discussionId: string, studentId: string): Promise<"todo" | "talking" | "submitted"> {
  const session = await one<any>(db, "SELECT * FROM discussion_sessions WHERE discussion_id = $did AND student_id = $sid", { did: discussionId, sid: studentId });
  if (!session) return "todo";
  if (session.conclusion !== null) return "submitted";
  const rounds = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM discussion_messages WHERE discussion_id = $did AND student_id = $sid AND role = 'user'", { did: discussionId, sid: studentId });
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

export function discussionRoutes(db: Db, getLang: (c: any) => Lang) {
  const r = new Hono<AppEnv>();

  r.get("/classrooms/:id/discussions", async (c) => {
    const user = requireUser(c);
    const { classroom, role } = await accessClassroomStaffOrMember(db, c.req.param("id"), user);
    const rows = await all<any>(db, "SELECT * FROM discussions WHERE classroom_id = $cid ORDER BY created_at DESC", { cid: classroom.id });
    return c.json(await Promise.all(rows.map(async (d) => {
      await discussionSessionsExist(db, d.id);
      return discussionTaskJson(db, d, role === "student" ? await statusOf(db, d.id, user.id) : undefined);
    })));
  });

  r.get("/discussions/:id", async (c) => {
    const user = requireUser(c);
    const { discussion, role } = await accessDiscussion(db, c.req.param("id"), user);
    await discussionSessionsExist(db, discussion.id);
    return c.json(await discussionTaskJson(db, discussion, role === "student" ? await statusOf(db, discussion.id, user.id) : undefined));
  });

  r.post("/classrooms/:id/discussions", async (c) => {
    const user = requireUser(c);
    const { classroom } = await accessClassroomStaff(db, c.req.param("id"), user);
    const body = await bodyOf(c);
    const input = cleanInput(body, false);
    const at = nowIso();
    const id = newId("dq_");
    await run(db,
      `INSERT INTO discussions (id, classroom_id, title, prompt, conclusion_hint, due_at, max_rounds, status, created_at, updated_at)
       VALUES ($id, $cid, $title, $prompt, $hint, $dueAt, $maxRounds, 'open', $at, $at)`,
      { id, cid: classroom.id, title: input.title, prompt: input.prompt, hint: input.conclusionHint, dueAt: input.dueAt, maxRounds: input.maxRounds, at },
    );
    const sids = await studentIdsOf(db, classroom.id);
    await db.batch(sids.map((sid) => ({
      sql: "INSERT INTO discussion_sessions (id, discussion_id, student_id, conclusion, submitted_at, last_active_at) VALUES ($id, $did, $sid, NULL, NULL, NULL)",
      params: { id: newId("ds_"), did: id, sid },
    })));
    const row = await one<any>(db, "SELECT * FROM discussions WHERE id = $id", { id })!;
    return c.json(await discussionTaskJson(db, row));
  });

  r.patch("/discussions/:id", async (c) => {
    const user = requireUser(c);
    const { discussion, role } = await accessDiscussion(db, c.req.param("id"), user);
    if (role !== "teacher" && role !== "assistant") fail(403, "only_staff");
    const body = await bodyOf(c);
    const input = cleanInput(body, true);
    for (const [key, value] of Object.entries(input)) {
      const column = key === "conclusionHint" ? "conclusion_hint" : key === "dueAt" ? "due_at" : key === "maxRounds" ? "max_rounds" : key;
      await run(db, `UPDATE discussions SET ${column} = $v WHERE id = $id`, { v: value, id: discussion.id });
    }
    await run(db, "UPDATE discussions SET updated_at = $at WHERE id = $id", { at: nowIso(), id: discussion.id });
    const row = await one<any>(db, "SELECT * FROM discussions WHERE id = $id", { id: discussion.id })!;
    return c.json(await discussionTaskJson(db, row));
  });

  r.put("/discussions/:id/status", async (c) => {
    const user = requireUser(c);
    const { discussion, role } = await accessDiscussion(db, c.req.param("id"), user);
    if (role !== "teacher" && role !== "assistant") fail(403, "only_staff");
    const body = await bodyOf(c);
    if (body.status !== "open" && body.status !== "closed") fail(422, "validation");
    await run(db, "UPDATE discussions SET status = $status, updated_at = $at WHERE id = $id", { status: body.status, at: nowIso(), id: discussion.id });
    const row = await one<any>(db, "SELECT * FROM discussions WHERE id = $id", { id: discussion.id })!;
    return c.json(await discussionTaskJson(db, row));
  });

  r.delete("/discussions/:id", async (c) => {
    const user = requireUser(c);
    const { discussion, role } = await accessDiscussion(db, c.req.param("id"), user);
    if (role !== "teacher" && role !== "assistant") fail(403, "only_staff");
    await run(db, "DELETE FROM discussions WHERE id = $id", { id: discussion.id });
    return c.body(null, 204);
  });

  r.get("/discussions/:id/sessions", async (c) => {
    const user = requireUser(c);
    const { discussion, role } = await accessDiscussion(db, c.req.param("id"), user);
    if (role !== "teacher" && role !== "assistant") fail(403, "only_staff");
    await discussionSessionsExist(db, discussion.id);
    const rows = await all<any>(db,
      `SELECT s.* FROM discussion_sessions s
       JOIN classroom_members m ON m.classroom_id = $cid AND m.user_id = s.student_id
         AND m.status = 'active' AND m.role = 'student'
       WHERE s.discussion_id = $did`,
      { did: discussion.id, cid: discussion.classroom_id },
    );
    const sessions = await Promise.all(rows.map((s) => discussionSessionJson(db, discussion, s, user.id)));
    return c.json(sessions.sort((a, b) => a.studentName.localeCompare(b.studentName)));
  });

  r.get("/discussions/:id/sessions/:studentId", async (c) => {
    const user = requireUser(c);
    const { discussion, role } = await accessDiscussion(db, c.req.param("id"), user);
    const target = c.req.param("studentId");
    const self = target === "me" || target === user.id;
    if (!self && role !== "teacher" && role !== "assistant") fail(403, "only_staff");
    const studentId = self ? user.id : target;
    const membership = await one(db, "SELECT 1 AS x FROM classroom_members WHERE classroom_id = $cid AND user_id = $sid AND status = 'active'", {
      cid: discussion.classroom_id, sid: studentId,
    });
    if (!membership) fail(404, "session_not_found");
    const session = (await mySession(db, discussion.id, studentId))!;
    return c.json(await discussionSessionDetailJson(db, discussion, session, user.id));
  });

  r.post("/discussions/:id/sessions/me/messages", async (c) => {
    const user = requireUser(c);
    const { discussion, role } = await accessDiscussion(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    if (discussion.status === "closed") fail(409, "discussion_closed");
    const session = (await mySession(db, discussion.id, user.id))!;
    const rounds = (await one<{ n: number }>(db,
      "SELECT COUNT(*) AS n FROM discussion_messages WHERE discussion_id = $did AND student_id = $sid AND role = 'user'",
      { did: discussion.id, sid: user.id },
    ))?.n ?? 0;
    if (rounds >= discussion.max_rounds) fail(409, "max_rounds_reached", { n: discussion.max_rounds });
    const body = await bodyOf(c);
    const text = str(body.text, "text_required", { min: 1, max: 2000 });
    checkRate(user.id);
    const lockKey = `discussion:${discussion.id}:${user.id}`;
    const stub = c.env.PiAgent.getByName(`discussion:${discussion.id}:${user.id}`);
    let response: Response;
    try {
      response = await stub.dialogue({
        scope: "discussion",
        scopeId: discussion.id,
        userId: user.id,
        userText: text,
        lang: getLang(c),
        title: discussion.title,
        statement: discussion.prompt,
        extra: discussion.conclusion_hint ? `希望同學在結論裡回答：${discussion.conclusion_hint}` : undefined,
      });
    } catch (error) {
      releaseLock(lockKey);
      throw error;
    }
    void session;
    return new Response(response.body, response);
  });

  r.put("/discussions/:id/sessions/me/conclusion", async (c) => {
    const user = requireUser(c);
    const { discussion, role } = await accessDiscussion(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    if (discussion.status === "closed") fail(409, "discussion_closed");
    const session = (await mySession(db, discussion.id, user.id))!;
    const body = await bodyOf(c);
    if (!("conclusion" in body)) fail(422, "validation");
    if (body.conclusion === null) {
      await run(db, "UPDATE discussion_sessions SET conclusion = NULL, submitted_at = NULL, last_active_at = $at WHERE id = $id", { at: nowIso(), id: session.id });
    } else {
      if (typeof body.conclusion !== "string" || !body.conclusion.trim()) fail(422, "conclusion_empty");
      const rounds = (await one<{ n: number }>(db,
        "SELECT COUNT(*) AS n FROM discussion_messages WHERE discussion_id = $did AND student_id = $sid",
        { did: discussion.id, sid: user.id },
      ))?.n ?? 0;
      if (!rounds) fail(422, "need_dialogue");
      const at = nowIso();
      await run(db, "UPDATE discussion_sessions SET conclusion = $conclusion, submitted_at = $at, last_active_at = $at WHERE id = $id", {
        conclusion: body.conclusion.trim().slice(0, 10000), at, id: session.id,
      });
    }
    const updated = await one<any>(db, "SELECT * FROM discussion_sessions WHERE id = $id", { id: session.id })!;
    return c.json(await discussionSessionDetailJson(db, discussion, updated, user.id));
  });

  return r;
}

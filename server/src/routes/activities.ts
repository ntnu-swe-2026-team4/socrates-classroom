import { Hono } from "hono";
import type { Config, Lang } from "../config";
import type { DB } from "../db";
import { all, one, parseJson, run, tx } from "../db";
import { requireUser } from "../auth";
import { bodyOf, fail, newId, nowIso, str, type AppEnv } from "../http";
import { accessActivity, accessClassroom, activityById, studentIdsOf, usersByIds } from "../services/access";
import {
  autoFillPositions, buildGroups, computeScores, enterStage, prepareDebate,
} from "../services/activities";
import { acquireLock, checkRate, dialogueSse, messageJson, releaseLock } from "../services/dialogue";
import { completeJson } from "../services/llm";
import { draftSummary, estimateCoords, type Axis } from "../services/debate";
import { publish, subscribe } from "../services/events";
import { activityJson, coverageOf, dialogueJson, memberJson, noteJson, positionJson } from "../services/serialize";

function activityProgress(db: DB, activityId: string, studentId: string) {
  const texts = all<any>(
    db,
    "SELECT text FROM activity_dialogue WHERE activity_id = $aid AND student_id = $sid AND role = 'user' ORDER BY created_at",
    { aid: activityId, sid: studentId },
  ).map((r) => r.text as string);
  return {
    rounds: texts.length,
    maxRounds: 20,
    coverage: coverageOf(texts),
    readyToSummarize: texts.length >= 2,
  };
}

export function activityRoutes(db: DB, config: Config, getLang: (c: any) => Lang) {
  const r = new Hono<AppEnv>();

  r.get("/classrooms/:id/activities", (c) => {
    const user = requireUser(c);
    const { classroom } = accessClassroom(db, c.req.param("id"), user);
    const rows = all<any>(db, "SELECT * FROM activities WHERE classroom_id = $cid ORDER BY created_at DESC", { cid: classroom.id });
    return c.json(rows.map((row) => activityJson(db, row)));
  });

  r.get("/activities/:id", (c) => {
    const user = requireUser(c);
    const { activity } = accessActivity(db, c.req.param("id"), user);
    return c.json(activityJson(db, activity));
  });

  r.post("/activities/:id/advance", (c) => {
    const user = requireUser(c);
    const { activity, role } = accessActivity(db, c.req.param("id"), user);
    if (role !== "teacher") fail(403, "only_teacher");
    if (activity.stage === "done") fail(409, "stage_done");
    if (activity.stage === "individual") {
      autoFillPositions(db, activity);
      buildGroups(db, activity, activity.group_size, 42, getLang(c));
      enterStage(db, activity.id, "team");
    } else if (activity.stage === "team") {
      const groups = all<any>(db, "SELECT * FROM groups WHERE activity_id = $aid", { aid: activity.id });
      if (groups.length < 2) fail(409, "need_two_groups");
      prepareDebate(db, activity, getLang(c));
      enterStage(db, activity.id, "debate");
    } else if (activity.stage === "debate") {
      computeScores(db, activity);
      enterStage(db, activity.id, "done");
    } else {
      fail(409, "cannot_advance");
    }
    return c.json(activityJson(db, activityById(db, activity.id)!));
  });

  r.post("/activities/:id/finish", (c) => {
    const user = requireUser(c);
    const { activity, role } = accessActivity(db, c.req.param("id"), user);
    if (role !== "teacher") fail(403, "only_teacher");
    if (activity.stage === "done") fail(409, "stage_done");
    if (activity.stage === "individual") {
      autoFillPositions(db, activity);
      buildGroups(db, activity, activity.group_size, 42, getLang(c));
    } else {
      autoFillPositions(db, activity);
    }
    const groups = all<any>(db, "SELECT * FROM groups WHERE activity_id = $aid", { aid: activity.id });
    const rooms = one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM rooms WHERE activity_id = $aid", { aid: activity.id })?.n ?? 0;
    if (!rooms && groups.length >= 2) prepareDebate(db, activity, getLang(c));
    computeScores(db, activity);
    enterStage(db, activity.id, "done");
    return c.json(activityJson(db, activityById(db, activity.id)!));
  });

  r.put("/activities/:id/deadline", async (c) => {
    const user = requireUser(c);
    const { activity, role } = accessActivity(db, c.req.param("id"), user);
    if (role !== "teacher") fail(403, "only_teacher");
    if (activity.stage === "done") fail(409, "stage_done");
    const body = await bodyOf(c);
    let deadline: string | null = null;
    if (body.deadline !== null && body.deadline !== undefined && body.deadline !== "") {
      const d = new Date(String(body.deadline));
      if (Number.isNaN(d.getTime())) fail(422, "invalid_datetime");
      if (d.getTime() <= Date.now()) fail(422, "deadline_in_past");
      deadline = d.toISOString();
    }
    run(db, "UPDATE activities SET stage_deadline = $deadline, updated_at = $at WHERE id = $id", { deadline, at: nowIso(), id: activity.id });
    publishDeadline(activity.id, deadline);
    return c.json(activityJson(db, activityById(db, activity.id)!));
  });

  r.get("/activities/:id/events", (c) => {
    const user = requireUser(c);
    const { activity } = accessActivity(db, c.req.param("id"), user);
    const encoder = new TextEncoder();
    let cleanup = () => {};
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        const write = (text: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(text));
          } catch {
            closed = true;
          }
        };
        write(": connected\n\n");
        const unsubscribe = subscribe(activity.id, (payload) => write(payload));
        const ping = setInterval(() => write(": ping\n\n"), 15_000);
        cleanup = () => {
          if (closed) return;
          closed = true;
          clearInterval(ping);
          unsubscribe();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        };
      },
      cancel() {
        cleanup();
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  });

  r.get("/activities/:id/members", (c) => {
    const user = requireUser(c);
    const { activity, role } = accessActivity(db, c.req.param("id"), user);
    const ids = studentIdsOf(db, activity.classroom_id);
    const users = usersByIds(db, ids);
    const readyRows = new Map(
      all<any>(db, "SELECT student_id, ready FROM activity_ready WHERE activity_id = $aid", { aid: activity.id })
        .map((row) => [row.student_id as string, !!row.ready]),
    );
    return c.json(ids.map((id) => {
      const u = users.get(id);
      if (!u) return null;
      return memberJson(db, u, user.id, {
        ready: readyRows.get(id) ?? false,
        showIndividual: role !== "student" || id === user.id,
        activityId: activity.id,
      });
    }).filter(Boolean));
  });

  r.put("/activities/:id/ready", async (c) => {
    const user = requireUser(c);
    const { activity, role } = accessActivity(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    if (activity.stage === "done" || activity.stage === "debate") fail(409, "not_ready_stage");
    const body = await bodyOf(c);
    if (typeof body.ready !== "boolean") fail(422, "validation");
    run(
      db,
      `INSERT INTO activity_ready (activity_id, student_id, ready, updated_at) VALUES ($aid, $sid, $ready, $at)
       ON CONFLICT(activity_id, student_id) DO UPDATE SET ready = excluded.ready, updated_at = excluded.updated_at`,
      { aid: activity.id, sid: user.id, ready: body.ready ? 1 : 0, at: nowIso() },
    );
    publishReady(activity.id, user.id, body.ready);
    return c.body(null, 204);
  });

  /* ---------------- 階段 1 ---------------- */
  r.get("/activities/:id/dialogue", (c) => {
    const user = requireUser(c);
    const { activity } = accessActivity(db, c.req.param("id"), user);
    const rows = all<any>(
      db,
      "SELECT * FROM activity_dialogue WHERE activity_id = $aid AND student_id = $sid ORDER BY created_at, rowid",
      { aid: activity.id, sid: user.id },
    );
    return c.json(rows.map(dialogueJson));
  });

  r.post("/activities/:id/dialogue", async (c) => {
    const user = requireUser(c);
    const { activity, role } = accessActivity(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    if (activity.stage !== "individual") fail(403, "stage_not_individual");
    const rounds = one<{ n: number }>(
      db,
      "SELECT COUNT(*) AS n FROM activity_dialogue WHERE activity_id = $aid AND student_id = $sid AND role = 'user'",
      { aid: activity.id, sid: user.id },
    )?.n ?? 0;
    if (rounds >= 20) fail(422, "max_rounds_reached", { n: 20 });
    const body = await bodyOf(c);
    const text = str(body.text, "text_required", { min: 1, max: 2000 });
    checkRate(user.id);
    const lockKey = `activity:${activity.id}:${user.id}`;
    acquireLock(lockKey);
    const history = all<any>(
      db,
      "SELECT role, text FROM activity_dialogue WHERE activity_id = $aid AND student_id = $sid ORDER BY created_at DESC, rowid DESC LIMIT 40",
      { aid: activity.id, sid: user.id },
    ).reverse().map((m) => ({ role: m.role as "user" | "assistant", text: m.text as string }));
    try {
      return await dialogueSse(c, config, {
        lang: getLang(c),
        title: activity.title,
        statement: activity.statement,
        history,
        lockKey,
        save: (userText, assistantText, emotion) => {
          const userId = newId("m_");
          const assistantId = newId("m_");
          const at = nowIso();
          tx(db, () => {
            run(db, "INSERT INTO activity_dialogue (id, activity_id, student_id, role, text, emotion, created_at) VALUES ($id, $aid, $sid, 'user', $text, NULL, $at)", {
              id: userId, aid: activity.id, sid: user.id, text: userText, at,
            });
            run(db, "INSERT INTO activity_dialogue (id, activity_id, student_id, role, text, emotion, created_at) VALUES ($id, $aid, $sid, 'assistant', $text, $emotion, $at)", {
              id: assistantId, aid: activity.id, sid: user.id, text: assistantText, emotion, at,
            });
          });
          return { message: messageJson(assistantId, "assistant", assistantText, at, emotion) };
        },
      }, text);
    } catch (error) {
      releaseLock(lockKey);
      throw error;
    }
  });

  r.get("/activities/:id/progress", (c) => {
    const user = requireUser(c);
    const { activity } = accessActivity(db, c.req.param("id"), user);
    return c.json(activityProgress(db, activity.id, user.id));
  });

  r.post("/activities/:id/position/draft", async (c) => {
    const user = requireUser(c);
    const { activity, role } = accessActivity(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    // 草稿會打真實 LLM：與串流對話共用同一把鎖和速率額度，避免連點或腳本灌爆 LLM 額度
    checkRate(user.id);
    const lockKey = `activity:${activity.id}:${user.id}`;
    acquireLock(lockKey);
    const texts = all<any>(
      db,
      "SELECT text FROM activity_dialogue WHERE activity_id = $aid AND student_id = $sid AND role = 'user' ORDER BY created_at",
      { aid: activity.id, sid: user.id },
    ).map((row) => row.text as string);
    const axes = parseJson<Axis[]>(activity.axes, []);
    let summary = draftSummary(axes, texts);
    const langName = getLang(c) === "en" ? "English" : getLang(c) === "es" ? "Español" : "繁體中文";
    try {
      const generated = await completeJson<{ claim?: string; reason?: string; evidence?: string }>(
        config,
        `你是哲學課的助教。請從學生與蘇格拉底的對話，整理出學生的主張、理由與證據。只輸出 JSON：{"claim":"...","reason":"...","evidence":"..."}。不要加入學生沒說過的想法。請用${langName}輸出。`,
        texts.join("\n") || "（學生還沒有說話）",
      );
      if (generated && typeof generated.claim === "string") {
        summary = {
          claim: generated.claim.slice(0, 500),
          reason: typeof generated.reason === "string" ? generated.reason.slice(0, 1000) : "",
          evidence: typeof generated.evidence === "string" ? generated.evidence.slice(0, 1000) : "",
        };
      }
    } finally {
      releaseLock(lockKey);
    }
    return c.json({ summary });
  });

  r.put("/activities/:id/position", async (c) => {
    const user = requireUser(c);
    const { activity, role } = accessActivity(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    if (activity.stage !== "individual") fail(409, "position_locked");
    const body = await bodyOf(c);
    const summary = body.summary as any;
    if (!summary || typeof summary !== "object") fail(422, "validation");
    const claim = typeof summary.claim === "string" ? summary.claim.trim() : "";
    if (!claim) fail(422, "validation");
    const reason = typeof summary.reason === "string" ? summary.reason.trim().slice(0, 1000) : "";
    const evidence = typeof summary.evidence === "string" ? summary.evidence.trim().slice(0, 1000) : "";
    const texts = all<any>(
      db,
      "SELECT text FROM activity_dialogue WHERE activity_id = $aid AND student_id = $sid AND role = 'user' ORDER BY created_at",
      { aid: activity.id, sid: user.id },
    ).map((row) => row.text as string);
    const coords = estimateCoords(parseJson<Axis[]>(activity.axes, []), texts);
    run(
      db,
      `INSERT INTO positions (activity_id, student_id, claim, reason, evidence, coords, confirmed, ai_suggested, updated_at)
       VALUES ($aid, $sid, $claim, $reason, $evidence, $coords, 1, 0, $at)
       ON CONFLICT(activity_id, student_id) DO UPDATE SET
         claim = excluded.claim, reason = excluded.reason, evidence = excluded.evidence,
         coords = excluded.coords, confirmed = 1, ai_suggested = 0, updated_at = excluded.updated_at`,
      { aid: activity.id, sid: user.id, claim: claim.slice(0, 500), reason, evidence, coords: JSON.stringify(coords), at: nowIso() },
    );
    const row = one<any>(db, "SELECT * FROM positions WHERE activity_id = $aid AND student_id = $sid", { aid: activity.id, sid: user.id })!;
    return c.json(positionJson(row, false));
  });

  r.get("/activities/:id/positions", (c) => {
    const user = requireUser(c);
    const { activity, role } = accessActivity(db, c.req.param("id"), user);
    const showCoords = role !== "student" || activity.stage === "done";
    const rows = role !== "student"
      ? all<any>(db, "SELECT * FROM positions WHERE activity_id = $aid", { aid: activity.id })
      : all<any>(db, "SELECT * FROM positions WHERE activity_id = $aid AND student_id = $sid", { aid: activity.id, sid: user.id });
    return c.json(rows.map((row) => positionJson(row, showCoords)));
  });

  /* ---------------- 思路筆記 ---------------- */
  r.get("/activities/:id/notes", (c) => {
    const user = requireUser(c);
    const { activity, role } = accessActivity(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    const rows = all<any>(db, "SELECT * FROM notes WHERE activity_id = $aid AND student_id = $sid ORDER BY created_at", { aid: activity.id, sid: user.id });
    return c.json(rows.map(noteJson));
  });

  r.post("/activities/:id/notes", async (c) => {
    const user = requireUser(c);
    const { activity, role } = accessActivity(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    const body = await bodyOf(c);
    if (body.kind !== "highlight" && body.kind !== "thought") fail(422, "validation");
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) fail(422, "note_empty");
    let sourceMessageId: string | null = null;
    if (body.sourceMessageId !== undefined && body.sourceMessageId !== null) {
      if (typeof body.sourceMessageId !== "string") fail(422, "validation");
      const source = one<any>(db, "SELECT * FROM activity_dialogue WHERE id = $id AND activity_id = $aid AND student_id = $sid", {
        id: body.sourceMessageId, aid: activity.id, sid: user.id,
      });
      if (!source) fail(404, "not_found");
      sourceMessageId = source.id;
    }
    const id = newId("nt_");
    const at = nowIso();
    run(
      db,
      `INSERT INTO notes (id, activity_id, student_id, stage, kind, source_message_id, text, created_at, updated_at)
       VALUES ($id, $aid, $sid, $stage, $kind, $source, $text, $at, $at)`,
      { id, aid: activity.id, sid: user.id, stage: activity.stage, kind: body.kind, source: sourceMessageId, text: text.slice(0, 5000), at },
    );
    return c.json(noteJson(one<any>(db, "SELECT * FROM notes WHERE id = $id", { id })!));
  });

  r.patch("/notes/:id", async (c) => {
    const user = requireUser(c);
    const row = one<any>(db, "SELECT * FROM notes WHERE id = $id", { id: c.req.param("id") });
    if (!row) fail(404, "note_not_found");
    if (row.student_id !== user.id) fail(403, "forbidden");
    const body = await bodyOf(c);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) fail(422, "note_empty");
    run(db, "UPDATE notes SET text = $text, updated_at = $at WHERE id = $id", { text: text.slice(0, 5000), at: nowIso(), id: row.id });
    return c.json(noteJson(one<any>(db, "SELECT * FROM notes WHERE id = $id", { id: row.id })!));
  });

  r.delete("/notes/:id", (c) => {
    const user = requireUser(c);
    const row = one<any>(db, "SELECT * FROM notes WHERE id = $id", { id: c.req.param("id") });
    if (!row) fail(404, "note_not_found");
    if (row.student_id !== user.id) fail(403, "forbidden");
    run(db, "DELETE FROM notes WHERE id = $id", { id: row.id });
    return c.body(null, 204);
  });

  return r;
}

function publishDeadline(activityId: string, deadline: string | null) {
  publish(activityId, { type: "deadline_changed", deadline });
}
function publishReady(activityId: string, memberId: string, ready: boolean) {
  publish(activityId, { type: "member_ready", memberId, ready });
}

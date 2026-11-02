import { Hono } from "hono";
import type { Lang } from "@socrates/shared";
import type { Db } from "../db/d1";
import { all, one, parseJson, run } from "../db/d1";
import { requireUser } from "../auth";
import { bodyOf, fail, newId, nowIso, str, type AppEnv } from "../http";
import { accessActivity, accessClassroom, activityById, studentIdsOf, usersByIds } from "../services/access";
import { autoFillPositions, buildGroups, computeScores, enterStage, prepareDebate } from "../services/activities";
import { acquireLock, checkRate, releaseLock } from "../services/rate-limit";
import { completeJson } from "../providers/pool";
import { draftSummary, estimateCoords, type Axis } from "../services/debate";
import { publish } from "../do/events";
import { activityJson, coverageOf, dialogueJson, memberJson, noteJson, positionJson } from "../services/serialize";

async function activityProgress(db: Db, activityId: string, studentId: string) {
  const rows = await all<{ text: string }>(
    db,
    "SELECT text FROM activity_dialogue WHERE activity_id = $aid AND student_id = $sid AND role = 'user' ORDER BY created_at",
    { aid: activityId, sid: studentId },
  );
  const texts = rows.map((r) => r.text);
  return {
    rounds: texts.length,
    maxRounds: 20,
    coverage: coverageOf(texts),
    readyToSummarize: texts.length >= 2,
  };
}

export function activityRoutes(db: Db, getLang: (c: any) => Lang) {
  const r = new Hono<AppEnv>();

  r.get("/classrooms/:id/activities", async (c) => {
    const user = requireUser(c);
    const { classroom } = await accessClassroom(db, c.req.param("id"), user);
    const rows = await all<any>(db, "SELECT * FROM activities WHERE classroom_id = $cid ORDER BY created_at DESC", {
      cid: classroom.id,
    });
    return c.json(await Promise.all(rows.map((row) => activityJson(db, row))));
  });

  r.get("/activities/:id", async (c) => {
    const user = requireUser(c);
    const { activity } = await accessActivity(db, c.req.param("id"), user);
    return c.json(await activityJson(db, activity));
  });

  r.post("/activities/:id/advance", async (c) => {
    const user = requireUser(c);
    const { activity, role } = await accessActivity(db, c.req.param("id"), user);
    if (role !== "teacher") fail(403, "only_teacher");
    if (activity.stage === "done") fail(409, "stage_done");
    if (activity.stage === "individual") {
      await autoFillPositions(db, activity);
      await buildGroups(db, activity, activity.group_size, 42, getLang(c));
      await enterStage(db, activity.id, "team");
    } else if (activity.stage === "team") {
      const groups = await all<any>(db, "SELECT * FROM groups WHERE activity_id = $aid", { aid: activity.id });
      if (groups.length < 2) fail(409, "need_two_groups");
      await prepareDebate(db, activity, getLang(c));
      await enterStage(db, activity.id, "debate");
    } else if (activity.stage === "debate") {
      await computeScores(db, activity);
      await enterStage(db, activity.id, "done");
    } else {
      fail(409, "cannot_advance");
    }
    return c.json(await activityJson(db, (await activityById(db, activity.id))!));
  });

  r.post("/activities/:id/finish", async (c) => {
    const user = requireUser(c);
    const { activity, role } = await accessActivity(db, c.req.param("id"), user);
    if (role !== "teacher") fail(403, "only_teacher");
    if (activity.stage === "done") fail(409, "stage_done");
    if (activity.stage === "individual") {
      await autoFillPositions(db, activity);
      await buildGroups(db, activity, activity.group_size, 42, getLang(c));
    } else {
      await autoFillPositions(db, activity);
    }
    const groups = await all<any>(db, "SELECT * FROM groups WHERE activity_id = $aid", { aid: activity.id });
    const rooms =
      (await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM rooms WHERE activity_id = $aid", { aid: activity.id }))
        ?.n ?? 0;
    if (!rooms && groups.length >= 2) await prepareDebate(db, activity, getLang(c));
    await computeScores(db, activity);
    await enterStage(db, activity.id, "done");
    return c.json(await activityJson(db, (await activityById(db, activity.id))!));
  });

  r.put("/activities/:id/deadline", async (c) => {
    const user = requireUser(c);
    const { activity, role } = await accessActivity(db, c.req.param("id"), user);
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
    await run(db, "UPDATE activities SET stage_deadline = $deadline, updated_at = $at WHERE id = $id", {
      deadline,
      at: nowIso(),
      id: activity.id,
    });
    publishDeadline(activity.id, deadline);
    return c.json(await activityJson(db, (await activityById(db, activity.id))!));
  });

  r.get("/activities/:id/events", async (c) => {
    const user = requireUser(c);
    const { activity } = await accessActivity(db, c.req.param("id"), user);
    const stub = c.env.ActivityEvents.getByName(activity.id);
    return stub.stream();
  });

  r.get("/activities/:id/members", async (c) => {
    const user = requireUser(c);
    const { activity, role } = await accessActivity(db, c.req.param("id"), user);
    const ids = await studentIdsOf(db, activity.classroom_id);
    const users = await usersByIds(db, ids);
    const readyRows = new Map(
      (
        await all<any>(db, "SELECT student_id, ready FROM activity_ready WHERE activity_id = $aid", {
          aid: activity.id,
        })
      ).map((row) => [row.student_id as string, !!row.ready]),
    );
    return c.json(
      (
        await Promise.all(
          ids.map(async (id) => {
            const u = users.get(id);
            if (!u) return null;
            return memberJson(db, u, user.id, {
              ready: readyRows.get(id) ?? false,
              showIndividual: role !== "student" || id === user.id,
              activityId: activity.id,
            });
          }),
        )
      ).filter(Boolean),
    );
  });

  r.put("/activities/:id/ready", async (c) => {
    const user = requireUser(c);
    const { activity, role } = await accessActivity(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    if (activity.stage === "done" || activity.stage === "debate") fail(409, "not_ready_stage");
    const body = await bodyOf(c);
    if (typeof body.ready !== "boolean") fail(422, "validation");
    await run(
      db,
      `INSERT INTO activity_ready (activity_id, student_id, ready, updated_at) VALUES ($aid, $sid, $ready, $at)
       ON CONFLICT(activity_id, student_id) DO UPDATE SET ready = excluded.ready, updated_at = excluded.updated_at`,
      { aid: activity.id, sid: user.id, ready: body.ready ? 1 : 0, at: nowIso() },
    );
    publishReady(activity.id, user.id, body.ready);
    return c.body(null, 204);
  });

  r.get("/activities/:id/dialogue", async (c) => {
    const user = requireUser(c);
    const { activity } = await accessActivity(db, c.req.param("id"), user);
    const rows = await all<any>(
      db,
      "SELECT * FROM activity_dialogue WHERE activity_id = $aid AND student_id = $sid ORDER BY created_at, rowid",
      { aid: activity.id, sid: user.id },
    );
    return c.json(rows.map(dialogueJson));
  });

  r.post("/activities/:id/dialogue", async (c) => {
    const user = requireUser(c);
    const { activity, role } = await accessActivity(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    if (activity.stage !== "individual") fail(403, "stage_not_individual");
    const rounds =
      (
        await one<{ n: number }>(
          db,
          "SELECT COUNT(*) AS n FROM activity_dialogue WHERE activity_id = $aid AND student_id = $sid AND role = 'user'",
          { aid: activity.id, sid: user.id },
        )
      )?.n ?? 0;
    if (rounds >= 20) fail(422, "max_rounds_reached", { n: 20 });
    const body = await bodyOf(c);
    const text = str(body.text, "text_required", { min: 1, max: 2000 });
    checkRate(user.id);
    const lockKey = `activity:${activity.id}:${user.id}`;
    const stub = c.env.PiAgent.getByName(`activity:${activity.id}:${user.id}`);
    let response: Response;
    try {
      response = await stub.dialogue({
        scope: "activity",
        scopeId: activity.id,
        userId: user.id,
        userText: text,
        lang: getLang(c),
        title: activity.title,
        statement: activity.statement,
      });
    } catch (error) {
      releaseLock(lockKey);
      throw error;
    }
    return new Response(response.body, response);
  });

  r.get("/activities/:id/progress", async (c) => {
    const user = requireUser(c);
    const { activity } = await accessActivity(db, c.req.param("id"), user);
    return c.json(await activityProgress(db, activity.id, user.id));
  });

  r.post("/activities/:id/position/draft", async (c) => {
    const user = requireUser(c);
    const { activity, role } = await accessActivity(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    checkRate(user.id);
    const lockKey = `activity:${activity.id}:${user.id}`;
    acquireLock(lockKey);
    const texts = (
      await all<{ text: string }>(
        db,
        "SELECT text FROM activity_dialogue WHERE activity_id = $aid AND student_id = $sid AND role = 'user' ORDER BY created_at",
        { aid: activity.id, sid: user.id },
      )
    ).map((row) => row.text as string);
    const axes = parseJson<Axis[]>(activity.axes, []);
    let summary = draftSummary(axes, texts);
    const langName = getLang(c) === "en" ? "English" : getLang(c) === "es" ? "Español" : "繁體中文";
    try {
      const generated = await completeJson<{ claim?: string; reason?: string; evidence?: string }>(
        c.env,
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
    const { activity, role } = await accessActivity(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    if (activity.stage !== "individual") fail(409, "position_locked");
    const body = await bodyOf(c);
    const summary = body.summary as any;
    if (!summary || typeof summary !== "object") fail(422, "validation");
    const claim = typeof summary.claim === "string" ? summary.claim.trim() : "";
    if (!claim) fail(422, "validation");
    const reason = typeof summary.reason === "string" ? summary.reason.trim().slice(0, 1000) : "";
    const evidence = typeof summary.evidence === "string" ? summary.evidence.trim().slice(0, 1000) : "";
    const textRows = await all<{ text: string }>(
      db,
      "SELECT text FROM activity_dialogue WHERE activity_id = $aid AND student_id = $sid AND role = 'user' ORDER BY created_at",
      { aid: activity.id, sid: user.id },
    );
    const texts = textRows.map((row) => row.text as string);
    const coords = estimateCoords(parseJson<Axis[]>(activity.axes, []), texts);
    await run(
      db,
      `INSERT INTO positions (activity_id, student_id, claim, reason, evidence, coords, confirmed, ai_suggested, updated_at)
       VALUES ($aid, $sid, $claim, $reason, $evidence, $coords, 1, 0, $at)
       ON CONFLICT(activity_id, student_id) DO UPDATE SET
         claim = excluded.claim, reason = excluded.reason, evidence = excluded.evidence,
         coords = excluded.coords, confirmed = 1, ai_suggested = 0, updated_at = excluded.updated_at`,
      {
        aid: activity.id,
        sid: user.id,
        claim: claim.slice(0, 500),
        reason,
        evidence,
        coords: JSON.stringify(coords),
        at: nowIso(),
      },
    );
    const row = await one<any>(db, "SELECT * FROM positions WHERE activity_id = $aid AND student_id = $sid", {
      aid: activity.id,
      sid: user.id,
    })!;
    return c.json(positionJson(row, false));
  });

  r.get("/activities/:id/positions", async (c) => {
    const user = requireUser(c);
    const { activity, role } = await accessActivity(db, c.req.param("id"), user);
    const showCoords = role !== "student" || activity.stage === "done";
    const rows =
      role !== "student"
        ? await all<any>(db, "SELECT * FROM positions WHERE activity_id = $aid", { aid: activity.id })
        : await all<any>(db, "SELECT * FROM positions WHERE activity_id = $aid AND student_id = $sid", {
            aid: activity.id,
            sid: user.id,
          });
    return c.json(rows.map((row) => positionJson(row, showCoords)));
  });

  r.get("/activities/:id/notes", async (c) => {
    const user = requireUser(c);
    const { activity, role } = await accessActivity(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    const rows = await all<any>(
      db,
      "SELECT * FROM notes WHERE activity_id = $aid AND student_id = $sid ORDER BY created_at",
      { aid: activity.id, sid: user.id },
    );
    return c.json(rows.map(noteJson));
  });

  r.post("/activities/:id/notes", async (c) => {
    const user = requireUser(c);
    const { activity, role } = await accessActivity(db, c.req.param("id"), user);
    if (role !== "student") fail(403, "only_student");
    const body = await bodyOf(c);
    if (body.kind !== "highlight" && body.kind !== "thought") fail(422, "validation");
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) fail(422, "note_empty");
    let sourceMessageId: string | null = null;
    if (body.sourceMessageId !== undefined && body.sourceMessageId !== null) {
      if (typeof body.sourceMessageId !== "string") fail(422, "validation");
      const source = await one<any>(
        db,
        "SELECT * FROM activity_dialogue WHERE id = $id AND activity_id = $aid AND student_id = $sid",
        {
          id: body.sourceMessageId,
          aid: activity.id,
          sid: user.id,
        },
      );
      if (!source) fail(404, "not_found");
      sourceMessageId = source.id;
    }
    const id = newId("nt_");
    const at = nowIso();
    await run(
      db,
      `INSERT INTO notes (id, activity_id, student_id, stage, kind, source_message_id, text, created_at, updated_at)
       VALUES ($id, $aid, $sid, $stage, $kind, $source, $text, $at, $at)`,
      {
        id,
        aid: activity.id,
        sid: user.id,
        stage: activity.stage,
        kind: body.kind,
        source: sourceMessageId,
        text: text.slice(0, 5000),
        at,
      },
    );
    return c.json(noteJson(await one<any>(db, "SELECT * FROM notes WHERE id = $id", { id })!));
  });

  r.patch("/notes/:id", async (c) => {
    const user = requireUser(c);
    const row = await one<any>(db, "SELECT * FROM notes WHERE id = $id", { id: c.req.param("id") });
    if (!row) fail(404, "note_not_found");
    if (row.student_id !== user.id) fail(403, "forbidden");
    const body = await bodyOf(c);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) fail(422, "note_empty");
    await run(db, "UPDATE notes SET text = $text, updated_at = $at WHERE id = $id", {
      text: text.slice(0, 5000),
      at: nowIso(),
      id: row.id,
    });
    return c.json(noteJson(await one<any>(db, "SELECT * FROM notes WHERE id = $id", { id: row.id })!));
  });

  r.delete("/notes/:id", async (c) => {
    const user = requireUser(c);
    const row = await one<any>(db, "SELECT * FROM notes WHERE id = $id", { id: c.req.param("id") });
    if (!row) fail(404, "note_not_found");
    if (row.student_id !== user.id) fail(403, "forbidden");
    await run(db, "DELETE FROM notes WHERE id = $id", { id: row.id });
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

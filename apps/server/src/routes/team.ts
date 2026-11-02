import { Hono } from "hono";
import type { Db } from "../db/d1";
import type { Lang } from "@socrates/shared";
import { all, one, parseJson, run } from "../db/d1";
import { requireUser } from "../auth";
import { bodyOf, fail, newId, nowIso, type AppEnv } from "../http";
import { accessActivity, accessGroup, accessRoom } from "../services/access";
import {
  buildGroups, commitTurn, computeScores, recalcArgumentStatuses, roomJson, roomSpec, scoreRows,
  starData, startRoom, tickExpired,
} from "../services/activities";
import { counterexampleFor, ensureGroupArguments as ensureArgs, groupLabel, tally } from "../services/debate";
import { publish } from "../do/events";
import {
  argumentJson, groupJson, groupMessageJson, judgmentJson, turnJson,
} from "../services/serialize";

function membershipOfGroup(group: any, userId: string): boolean {
  return parseJson<string[]>(group.member_ids, []).includes(userId);
}

export function teamRoutes(db: Db, getLang: (c: any) => Lang) {
  const r = new Hono<AppEnv>();

  r.get("/activities/:id/groups", async (c) => {
    const user = requireUser(c);
    const { activity, role } = await accessActivity(db, c.req.param("id"), user);
    const rows = await all<any>(db, "SELECT * FROM groups WHERE activity_id = $aid ORDER BY seq", { aid: activity.id });
    return c.json(rows.map((row) => groupJson(row, role, user.id)));
  });

  r.post("/activities/:id/groups/regroup", async (c) => {
    const user = requireUser(c);
    const { activity, role } = await accessActivity(db, c.req.param("id"), user);
    if (role !== "teacher") fail(403, "only_teacher");
    if (activity.stage === "debate" || activity.stage === "done") fail(409, "stage_not_team");
    const body = await bodyOf(c);
    const size = Number(body.groupSize);
    if (!Number.isInteger(size) || size < 2 || size > 8) fail(422, "invalid_group_size");
    await buildGroups(db, activity, size, 42 + Math.floor(Math.random() * 1000), getLang(c));
    await run(db, "UPDATE activities SET group_size = $size, updated_at = $at WHERE id = $id", { size, at: nowIso(), id: activity.id });
    publish(activity.id, { type: "stage_changed", stage: activity.stage });
    const rows = await all<any>(db, "SELECT * FROM groups WHERE activity_id = $aid ORDER BY seq", { aid: activity.id });
    return c.json(rows.map((row) => groupJson(row, role, user.id)));
  });

  r.get("/groups/:gid/messages", async (c) => {
    const user = requireUser(c);
    const { group, role } = await accessGroup(db, c.req.param("gid"), user);
    if (role === "student" && !membershipOfGroup(group, user.id)) fail(403, "not_your_group");
    const rows = await all<any>(db, "SELECT * FROM group_messages WHERE group_id = $gid ORDER BY created_at, rowid", { gid: group.id });
    return c.json(rows.map(groupMessageJson));
  });

  r.post("/groups/:gid/messages", async (c) => {
    const user = requireUser(c);
    const { group, activity, role } = await accessGroup(db, c.req.param("gid"), user);
    if (activity.stage !== "team") fail(409, "stage_not_team");
    if (role !== "student" || !membershipOfGroup(group, user.id)) fail(403, "not_your_group");
    const body = await bodyOf(c);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) fail(422, "text_required");
    if (text.length > 2000) fail(422, "text_too_long", { n: 2000 });
    const id = newId("gm_");
    await run(db,
      "INSERT INTO group_messages (id, group_id, kind, author_id, text, created_at) VALUES ($id, $gid, 'chat', $author, $text, $at)",
      { id, gid: group.id, author: user.id, text, at: nowIso() },
    );
    const row = await one<any>(db, "SELECT * FROM group_messages WHERE id = $id", { id });
    publish(activity.id, { type: "group_message", message: groupMessageJson(row) });
    return c.json(groupMessageJson(row));
  });

  r.post("/groups/:gid/ai/summarize", async (c) => {
    const user = requireUser(c);
    const { group, activity, role } = await accessGroup(db, c.req.param("gid"), user);
    if (role === "student" && !membershipOfGroup(group, user.id)) fail(403, "not_your_group");
    if (activity.stage !== "team") fail(409, "stage_not_team");
    const args = await ensureArgs(db, activity, group, getLang(c));
    const claims = args.filter((a) => a.kind === "claim");
    const lang = getLang(c);
    const head = lang === "en"
      ? `I merged your discussion and summaries into ${claims.length} claims:`
      : lang === "es"
        ? `He combinado la discusión en ${claims.length} afirmaciones:`
        : `我把你們的討論與每個人的論點總結合併，整理出 ${claims.length} 條主張：`;
    const tail = lang === "en" ? "Please vote on each: endorse, revise, or oppose." : lang === "es" ? "Vota cada una: a favor, revisar o en contra." : "請針對每一條投票：贊成、需要修改，或反對。";
    const text = head + "\n" + claims.map((cl, i) => `${i + 1}. ${cl.text}`).join("\n") + "\n" + tail;
    const id = newId("gm_");
    await run(db, "INSERT INTO group_messages (id, group_id, kind, author_id, text, created_at) VALUES ($id, $gid, 'ai_summary', NULL, $text, $at)", {
      id, gid: group.id, text, at: nowIso(),
    });
    const row = await one<any>(db, "SELECT * FROM group_messages WHERE id = $id", { id });
    publish(activity.id, { type: "group_message", message: groupMessageJson(row) });
    for (const arg of args) publish(activity.id, { type: "argument_updated", argument: argumentJson(arg) });
    return c.json(args.map(argumentJson));
  });

  r.post("/groups/:gid/ai/counterexample", async (c) => {
    const user = requireUser(c);
    const { group, activity, role } = await accessGroup(db, c.req.param("gid"), user);
    if (role === "student" && !membershipOfGroup(group, user.id)) fail(403, "not_your_group");
    if (activity.stage !== "team") fail(409, "stage_not_team");
    const args = await ensureArgs(db, activity, group, getLang(c));
    const memberIds = parseJson<string[]>(group.member_ids, []);
    const candidates = args
      .filter((a) => a.kind === "claim" && a.status !== "dropped" && !a.countered)
      .sort((a, b) => tally(parseJson(b.votes, {}), memberIds).endorse - tally(parseJson(a.votes, {}), memberIds).endorse);
    if (!candidates.length) fail(409, args.length ? "all_countered" : "no_arguments");
    const target = candidates[0];
    await run(db, "UPDATE group_arguments SET countered = 1 WHERE id = $id", { id: target.id });
    const lang = getLang(c);
    const prefix = lang === "en" ? `On "${target.text}":` : lang === "es" ? `Sobre "${target.text}":` : `針對「${target.text}」：`;
    const tail = lang === "en" ? "Think it over, then vote again." : lang === "es" ? "Piénsalo y vuelve a votar." : "想過之後，請重新投票。";
    const text = `${prefix}\n${counterexampleFor(activity, target, getLang(c))}\n${tail}`;
    const id = newId("gm_");
    await run(db, "INSERT INTO group_messages (id, group_id, kind, author_id, text, created_at) VALUES ($id, $gid, 'ai_counterexample', NULL, $text, $at)", {
      id, gid: group.id, text, at: nowIso(),
    });
    const row = await one<any>(db, "SELECT * FROM group_messages WHERE id = $id", { id });
    publish(activity.id, { type: "group_message", message: groupMessageJson(row) });
    const updated = await one<any>(db, "SELECT * FROM group_arguments WHERE id = $id", { id: target.id });
    publish(activity.id, { type: "argument_updated", argument: argumentJson(updated) });
    return c.json(groupMessageJson(row));
  });

  r.get("/groups/:gid/arguments", async (c) => {
    const user = requireUser(c);
    const { group, role } = await accessGroup(db, c.req.param("gid"), user);
    if (role === "student" && !membershipOfGroup(group, user.id)) fail(403, "not_your_group");
    const rows = await all<any>(db, "SELECT * FROM group_arguments WHERE group_id = $gid ORDER BY seq", { gid: group.id });
    return c.json(rows.map(argumentJson));
  });

  r.post("/arguments/:id/vote", async (c) => {
    const user = requireUser(c);
    const arg = await one<any>(db, "SELECT * FROM group_arguments WHERE id = $id", { id: c.req.param("id") });
    if (!arg) fail(404, "argument_not_found");
    const { group, activity, role } = await accessGroup(db, arg.group_id, user);
    if (activity.stage !== "team") fail(409, "stage_not_team");
    if (role !== "student" || !membershipOfGroup(group, user.id)) fail(403, "not_your_group");
    const body = await bodyOf(c);
    if (body.vote !== "endorse" && body.vote !== "revise" && body.vote !== "oppose") fail(422, "validation");
    const votes = parseJson<Record<string, string>>(arg.votes, {});
    votes[user.id] = body.vote;
    await run(db, "UPDATE group_arguments SET votes = $votes WHERE id = $id", { votes: JSON.stringify(votes), id: arg.id });
    await recalcArgumentStatuses(db, group);
    const updated = await one<any>(db, "SELECT * FROM group_arguments WHERE id = $id", { id: arg.id });
    publish(activity.id, { type: "argument_updated", argument: argumentJson(updated) });
    return c.json(argumentJson(updated));
  });

  r.post("/groups/:gid/split", async (c) => {
    const user = requireUser(c);
    const { group, activity, role } = await accessGroup(db, c.req.param("gid"), user);
    if (activity.stage !== "team") fail(409, "stage_not_team");
    if (role !== "student" && role !== "teacher" && role !== "assistant") fail(403, "forbidden");
    const memberIds = parseJson<string[]>(group.member_ids, []);
    if (role === "student" && !memberIds.includes(user.id)) fail(403, "not_your_group");
    const args = await all<any>(db, "SELECT * FROM group_arguments WHERE group_id = $gid ORDER BY seq", { gid: group.id });
    const contested = args.find((a) => a.kind === "claim" && a.status === "contested");
    if (!contested) fail(409, "no_split");
    const votes = parseJson<Record<string, string>>(contested.votes, {});
    const dissent = memberIds.filter((id) => votes[id] && votes[id] !== "endorse");
    const remain = memberIds.filter((id) => !dissent.includes(id));
    if (dissent.length < 2 || remain.length < 2) fail(409, "no_split");

    const groups = await all<any>(db, "SELECT * FROM groups WHERE activity_id = $aid ORDER BY seq", { aid: activity.id });
    const coords: Record<string, number[]> = {};
    for (const p of await all<any>(db, "SELECT student_id, coords FROM positions WHERE activity_id = $aid", { aid: activity.id })) {
      coords[p.student_id] = parseJson<number[]>(p.coords, []);
    }
    const centroid = (ids: string[]) => {
      const pts = ids.map((id) => coords[id] ?? []);
      const dim = Math.max(1, ...pts.map((p) => p.length));
      return Array.from({ length: dim }, (_, d) => pts.reduce((s, p) => s + (p[d] ?? 0), 0) / Math.max(1, pts.length));
    };
    const newIdGroup = newId("g_");
    const lang = getLang(c);
    const label = groupLabel(lang, groups.length + 1);
    const splitNewText = lang === "en"
      ? `You split off from "${group.label}" because you disagree about "${contested.text}".`
      : lang === "es"
        ? `Se separaron de "${group.label}" porque discrepan sobre "${contested.text}".`
        : `你們從「${group.label}」分裂出來，因為對「${contested.text}」有不同的看法。`;
    const splitOldText = lang === "en"
      ? `${dissent.length} member(s) split off as "${label}" because of a disagreement.`
      : lang === "es"
        ? `${dissent.length} miembro(s) se separaron como "${label}" por un desacuerdo.`
        : `有 ${dissent.length} 位組員因為分歧，分出去成為「${label}」。`;
    const voteEntries: Array<{ sql: string; params: Record<string, unknown> }> = [];
    for (const id of dissent) {
      for (const arg of args) {
        const v = parseJson<Record<string, string>>(arg.votes, {});
        if (v[id]) {
          delete v[id];
          voteEntries.push({ sql: "UPDATE group_arguments SET votes = $votes WHERE id = $id", params: { votes: JSON.stringify(v), id: arg.id } });
        }
      }
    }
    await db.batch([
      { sql: "UPDATE groups SET member_ids = $ids, centroid = $centroid WHERE id = $id", params: { ids: JSON.stringify(remain), centroid: JSON.stringify(centroid(remain)), id: group.id } },
      { sql: "INSERT INTO groups (id, activity_id, label, member_ids, centroid, formed_by, seq) VALUES ($id, $aid, $label, $ids, $centroid, 'split', $seq)",
        params: { id: newIdGroup, aid: activity.id, label, ids: JSON.stringify(dissent), centroid: JSON.stringify(centroid(dissent)), seq: groups.length } },
      { sql: "INSERT INTO group_messages (id, group_id, kind, author_id, text, created_at) VALUES ($id, $gid, 'system', NULL, $text, $at)",
        params: { id: newId("gm_"), gid: newIdGroup, text: splitNewText, at: nowIso() } },
      { sql: "INSERT INTO group_messages (id, group_id, kind, author_id, text, created_at) VALUES ($id, $gid, 'system', NULL, $text, $at)",
        params: { id: newId("gm_"), gid: group.id, text: splitOldText, at: nowIso() } },
      ...voteEntries,
    ]);
    await recalcArgumentStatuses(db, await one<any>(db, "SELECT * FROM groups WHERE id = $id", { id: group.id })!);
    const newGroup = await one<any>(db, "SELECT * FROM groups WHERE id = $id", { id: newIdGroup })!;
    await ensureArgs(db, activity, newGroup, getLang(c));
    publish(activity.id, { type: "stage_changed", stage: activity.stage });
    const rows = await all<any>(db, "SELECT * FROM groups WHERE activity_id = $aid ORDER BY seq", { aid: activity.id });
    return c.json(rows.map((row) => groupJson(row, role, user.id)));
  });

  /* ---------------- 階段 3 ---------------- */
  r.get("/activities/:id/rooms", async (c) => {
    const user = requireUser(c);
    const { activity } = await accessActivity(db, c.req.param("id"), user);
    const lang = getLang(c);
    let rows = await all<any>(db, "SELECT * FROM rooms WHERE activity_id = $aid ORDER BY seq", { aid: activity.id });
    if (activity.stage === "debate") {
      for (let i = 0; i < rows.length; i++) rows[i] = await tickExpired(db, rows[i], lang);
    }
    return c.json(await Promise.all(rows.map((room) => roomJson(db, room))));
  });

  r.post("/rooms/:id/start", async (c) => {
    const user = requireUser(c);
    const { room, activity, role } = await accessRoom(db, c.req.param("id"), user);
    if (activity.stage !== "debate") fail(409, "stage_not_debate");
    const memberIds = (await roomMemberIds(db, room))!;
    if (role === "student" && !memberIds.includes(user.id)) fail(403, "not_your_group");
    const updated = await startRoom(db, room, getLang(c));
    return c.json(await roomJson(db, updated));
  });

  r.get("/rooms/:id/turns", async (c) => {
    const user = requireUser(c);
    const { room, activity, role } = await accessRoom(db, c.req.param("id"), user);
    if (role === "student" && !(await roomMemberIds(db, room)).includes(user.id)) fail(403, "not_your_group");
    const fresh = activity.stage === "debate" ? await tickExpired(db, room, getLang(c)) : room;
    const turns = await all<any>(db, "SELECT * FROM turns WHERE room_id = $rid ORDER BY seq", { rid: fresh.id });
    const judgments = await all<any>(db, "SELECT * FROM judgments WHERE room_id = $rid", { rid: fresh.id });
    return c.json({ turns: turns.map(turnJson), judgments: judgments.map(judgmentJson) });
  });

  r.post("/rooms/:id/turns", async (c) => {
    const user = requireUser(c);
    const { room, activity, role } = await accessRoom(db, c.req.param("id"), user);
    if (activity.stage !== "debate") fail(409, "stage_not_debate");
    if (role !== "student") fail(403, "only_student");
    if (!(await roomMemberIds(db, room)).includes(user.id)) fail(403, "not_your_group");
    // 先讀完 body 再做輪序檢查與寫入：檢查到寫入之間沒有 await，同一學生連點也不會重複寫入同一輪
    const body = await bodyOf(c);
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (!text) fail(422, "text_required");
    if (text.length > 2000) fail(422, "text_too_long", { n: 2000 });
    const fresh = await tickExpired(db, room, getLang(c));
    if (fresh.status !== "live") fail(409, "room_not_live");
    const spec = await roomSpec(db, fresh);
    if (!spec) fail(409, "room_not_live");
    if (spec.memberId !== user.id) fail(409, "not_your_turn");
    const { turn } = await commitTurn(db, fresh, text, getLang(c));
    return c.json(turnJson(turn));
  });

  r.patch("/judgments/:id", async (c) => {
    const user = requireUser(c);
    const judgment = await one<any>(db, "SELECT * FROM judgments WHERE id = $id", { id: c.req.param("id") });
    if (!judgment) fail(404, "judgment_not_found");
    const room = await one<any>(db, "SELECT activity_id FROM rooms WHERE id = $id", { id: judgment.room_id });
    if (!room) fail(404, "room_not_found");
    const { activity, role } = await accessActivity(db, room.activity_id, user);
    if (role !== "teacher") fail(403, "only_teacher");
    const body = await bodyOf(c);
    let score: number | null = null;
    if (body.teacherScore !== null && body.teacherScore !== undefined) {
      const n = Number(body.teacherScore);
      if (!Number.isFinite(n) || n < 0 || n > 5) fail(422, "validation");
      score = n;
    }
    await run(db, "UPDATE judgments SET teacher_score = $score WHERE id = $id", { score, id: judgment.id });
    if (activity.stage === "done") await computeScores(db, activity);
    const updated = await one<any>(db, "SELECT * FROM judgments WHERE id = $id", { id: judgment.id })!;
    return c.json(judgmentJson(updated));
  });

  /* ---------------- 結果與星圖 ---------------- */
  r.get("/activities/:id/scores", async (c) => {
    const user = requireUser(c);
    const { activity, role } = await accessActivity(db, c.req.param("id"), user);
    let rows = await scoreRows(db, activity);
    if (role === "student") rows = rows.filter((r: any) => r.memberId === user.id);
    return c.json(rows);
  });

  r.patch("/activities/:id/scores/:memberId", async (c) => {
    const user = requireUser(c);
    const { activity, role } = await accessActivity(db, c.req.param("id"), user);
    if (role !== "teacher") fail(403, "only_teacher");
    const memberId = c.req.param("memberId");
    const existing = await one<any>(db, "SELECT * FROM scores WHERE activity_id = $aid AND member_id = $mid", { aid: activity.id, mid: memberId });
    if (!existing) fail(409, "score_not_found");
    const body = await bodyOf(c);
    const adjust = Number(body.adjust);
    if (!Number.isFinite(adjust) || adjust < -100 || adjust > 100) fail(422, "validation");
    await run(db, "UPDATE scores SET adjust = $adjust WHERE activity_id = $aid AND member_id = $mid", { adjust, aid: activity.id, mid: memberId });
    return c.json((await scoreRows(db, activity, memberId))[0] ?? null);
  });

  r.get("/activities/:id/star", async (c) => {
    const user = requireUser(c);
    const { activity, role } = await accessActivity(db, c.req.param("id"), user);
    if (activity.stage !== "done" && role === "student") fail(403, "star_after_done");
    return c.json(await starData(db, activity, getLang(c), user.id));
  });

  return r;
}

async function roomMemberIds(db: Db, room: any): Promise<string[]> {
  const ids = new Set<string>();
  for (const gid of [room.group_a, room.group_b]) {
    const group = await one<any>(db, "SELECT member_ids FROM groups WHERE id = $id", { id: gid });
    for (const id of parseJson<string[]>(group?.member_ids, [])) ids.add(id);
  }
  return [...ids];
}

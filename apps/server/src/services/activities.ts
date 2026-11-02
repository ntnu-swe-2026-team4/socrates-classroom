import type { Db } from "../db/d1";
import { all, one, parseJson } from "../db/d1";
import type { Lang } from "@socrates/shared";
import { newId, nowIso } from "../http";
import type { ActivityRow } from "./access";
import { studentIdsOf } from "./access";
import {
  averageScores, clamp, computeScore, DEFAULT_SECONDS, draftSummary, ensureGroupArguments,
  estimateCoords, formGroups, judgeTurn, pairGroups, PHASES, phaseOf, refreshStatuses, SPEAKING_ORDER,
  weightedTotal, type Axis, type Phase,
} from "./debate";
import { publish } from "../do/events";
import { judgmentJson, turnJson } from "./serialize";

export async function hasStarted(db: Db, activityId: string): Promise<boolean> {
  const a = await one<any>(db, "SELECT stage FROM activities WHERE id = $id", { id: activityId });
  if (!a) return true;
  if (a.stage !== "individual") return true;
  const dialogue = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM activity_dialogue WHERE activity_id = $id", { id: activityId });
  const positions = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM positions WHERE activity_id = $id", { id: activityId });
  return (dialogue?.n ?? 0) > 0 || (positions?.n ?? 0) > 0;
}

export async function enterStage(db: Db, activityId: string, stage: ActivityRow["stage"]): Promise<ActivityRow> {
  const at = nowIso();
  const entries: Array<{ sql: string; params?: Record<string, unknown> }> = [
    { sql: "UPDATE activities SET stage = $stage, stage_deadline = NULL, updated_at = $at WHERE id = $id", params: { stage, at, id: activityId } },
    { sql: "UPDATE activity_ready SET ready = 0, updated_at = $at WHERE activity_id = $id", params: { at, id: activityId } },
  ];
  if (stage === "done") {
    entries.push({ sql: "UPDATE rooms SET status = 'finished', deadline = NULL WHERE activity_id = $id", params: { id: activityId } });
  }
  await db.batch(entries);
  publish(activityId, { type: "stage_changed", stage });
  return (await one<ActivityRow>(db, "SELECT * FROM activities WHERE id = $id", { id: activityId }))!;
}

/** 依目前對話幫沒有確認論點的學生補上 AI 建議（confirmed = 0、aiSuggested = 1）。 */
export async function autoFillPositions(db: Db, activity: ActivityRow): Promise<void> {
  const axes = parseJson<Axis[]>(activity.axes, []);
  const ids = await studentIdsOf(db, activity.classroom_id);
  const entries: Array<{ sql: string; params: Record<string, unknown> }> = [];
  for (const studentId of ids) {
    const existing = await one<any>(db, "SELECT * FROM positions WHERE activity_id = $aid AND student_id = $sid", { aid: activity.id, sid: studentId });
    if (existing?.confirmed) continue;
    const rows = await all<{ text: string }>(
      db,
      "SELECT text FROM activity_dialogue WHERE activity_id = $aid AND student_id = $sid AND role = 'user' ORDER BY created_at",
      { aid: activity.id, sid: studentId },
    );
    const texts = rows.map((r) => r.text);
    const summary = draftSummary(axes, texts);
    const coords = estimateCoords(axes, texts);
    entries.push({
      sql: `INSERT INTO positions (activity_id, student_id, claim, reason, evidence, coords, confirmed, ai_suggested, updated_at)
       VALUES ($aid, $sid, $claim, $reason, $evidence, $coords, 0, 1, $at)
       ON CONFLICT(activity_id, student_id) DO UPDATE SET
         claim = excluded.claim, reason = excluded.reason, evidence = excluded.evidence,
         coords = excluded.coords, ai_suggested = 1, updated_at = excluded.updated_at`,
      params: {
        aid: activity.id, sid: studentId, claim: summary.claim, reason: summary.reason,
        evidence: summary.evidence, coords: JSON.stringify(coords), at: nowIso(),
      },
    });
  }
  if (entries.length) await db.batch(entries);
}

const SYSTEM_GROUP_READY: Record<Lang, string> = {
  zh: "組別已依座標分好。可以先聊聊彼此的想法，再請 AI 整理論點、丟反例。",
  en: "Groups have been formed by position. Talk through your ideas, then ask the AI to summarize arguments or offer a counterexample.",
  es: "Los grupos se formaron por posición. Comenten sus ideas y luego pidan a la IA que resuma argumentos o propongan un contraejemplo.",
};

export async function buildGroups(db: Db, activity: ActivityRow, groupSize: number, seed = 42, lang: Lang = "zh"): Promise<any[]> {
  const ids = await studentIdsOf(db, activity.classroom_id);
  const coords: Record<string, number[]> = {};
  const axes = parseJson<Axis[]>(activity.axes, []);
  for (const id of ids) {
    const p = await one<any>(db, "SELECT coords FROM positions WHERE activity_id = $aid AND student_id = $sid", { aid: activity.id, sid: id });
    coords[id] = p ? parseJson<number[]>(p.coords, []) : new Array(axes.length).fill(0);
  }
  const { formGroups } = await import("./debate");
  const formed = formGroups(ids.map((id) => ({ id })), coords, clamp(Math.round(groupSize), 2, 8), seed, lang);
  const entries: Array<{ sql: string; params: Record<string, unknown> }> = [
    { sql: "DELETE FROM groups WHERE activity_id = $aid", params: { aid: activity.id } },
  ];
  formed.forEach((g, i) => {
    const id = newId("g_");
    entries.push({
      sql: `INSERT INTO groups (id, activity_id, label, member_ids, centroid, formed_by, seq)
         VALUES ($id, $aid, $label, $members, $centroid, 'auto', $seq)`,
      params: { id, aid: activity.id, label: g.label, members: JSON.stringify(g.memberIds), centroid: JSON.stringify(g.centroid), seq: i },
    });
    const msg = newId("gm_");
    entries.push({
      sql: "INSERT INTO group_messages (id, group_id, kind, author_id, text, created_at) VALUES ($id, $gid, 'system', NULL, $text, $at)",
      params: { id: msg, gid: id, text: SYSTEM_GROUP_READY[lang] ?? SYSTEM_GROUP_READY.zh, at: nowIso() },
    });
  });
  await db.batch(entries);
  return await all(db, "SELECT * FROM groups WHERE activity_id = $aid ORDER BY seq", { aid: activity.id });
}

export async function prepareDebate(db: Db, activity: ActivityRow, lang: Lang = "zh"): Promise<any[]> {
  const groups = await all<any>(db, "SELECT * FROM groups WHERE activity_id = $aid ORDER BY seq", { aid: activity.id });
  if (groups.length < 2) throw new Error("need_two_groups");
  for (const group of groups) await ensureGroupArguments(db, activity, group, lang);
  const { pairs } = pairGroups(groups.map((g) => ({ id: g.id, centroid: parseJson<number[]>(g.centroid, []) })));
  const entries: Array<{ sql: string; params: Record<string, unknown> }> = [
    { sql: "DELETE FROM rooms WHERE activity_id = $aid", params: { aid: activity.id } },
  ];
  pairs.forEach(([a, b], i) => {
    entries.push({
      sql: `INSERT INTO rooms (id, activity_id, group_a, group_b, status, phase_idx, turn_idx, side_count, asked, deadline, seq)
         VALUES ($id, $aid, $a, $b, 'scheduled', 0, 0, '{"a":0,"b":0}', '{}', NULL, $seq)`,
      params: { id: newId("r_"), aid: activity.id, a, b, seq: i },
    });
  });
  await db.batch(entries);
  return await all(db, "SELECT * FROM rooms WHERE activity_id = $aid ORDER BY seq", { aid: activity.id });
}

/* ---------------- 場次（後端是時間與輪次的唯一裁定者） ---------------- */
export interface RoomSpec {
  phase: Phase;
  side: "a" | "b";
  role: "ask" | "answer" | "speak";
  group: any;
  memberId: string;
}

export async function roomSpec(db: Db, room: any): Promise<RoomSpec | null> {
  const phase = PHASES[room.phase_idx];
  if (!phase) return null;
  const order = SPEAKING_ORDER[phase];
  const side = order[room.turn_idx];
  if (!side) return null;
  const groupId = side === "a" ? room.group_a : room.group_b;
  const group = await one<any>(db, "SELECT * FROM groups WHERE id = $id", { id: groupId });
  if (!group) return null;
  const memberIds = parseJson<string[]>(group.member_ids, []);
  if (!memberIds.length) return null;
  const counts = parseJson<Record<string, number>>(room.side_count, { a: 0, b: 0 });
  const memberId = memberIds[(counts[side] ?? 0) % memberIds.length];
  const role = phase === "cross" ? (room.turn_idx % 2 === 0 ? "ask" : "answer") : "speak";
  return { phase, side, role, group, memberId };
}

const MOD: Record<Lang, Record<string, string>> = {
  zh: {
    intro: "各位好，我是這場辯論的主持人。{a}（A 方）對上{b}（B 方），共四個回合：開場、質詢、反駁、結辯。我只管流程與時間，也只看論證的證據與推理，不評判誰的立場才對。",
    opening: "第一回合：開場。請 A 方先說明核心主張與證據，接著換 B 方。",
    cross: "第二回合：質詢。A 方先提問、B 方回答，接著交換。提問請針對對方論點，回答請正面回應。",
    rebuttal: "第三回合：反駁。請回應對方最強的論點，而不是重述自己的立場。",
    closing: "最後一回合：結辯。請整理你們最有力的論點與證據。",
    recap: "小結：A 方提到「{a}」；B 方提到「{b}」。兩邊的說法我都記下來了。",
    askSource: "這個說法的出處或具體例子是什麼？可以補充一下嗎？",
    end: "辯論結束。我會依證據、推理、回應、表達四項給分，只看論證品質，不評判立場。",
  },
  en: {
    intro: "Welcome. I am the moderator. {a} (side A) faces {b} (side B) over four rounds: opening, cross-examination, rebuttal, closing. I keep time and judge only the quality of reasoning and evidence, not which side is right.",
    opening: "Round one: opening. Side A starts with its core claim and evidence, then side B.",
    cross: "Round two: cross-examination. A asks, B answers, then they switch. Questions should target the other side's argument and answers should respond directly.",
    rebuttal: "Round three: rebuttal. Respond to the strongest opposing argument rather than restating your own.",
    closing: "Final round: closing. Summarize your strongest arguments and evidence.",
    recap: "Recap: side A mentioned \"{a}\"; side B mentioned \"{b}\". Both are on record.",
    askSource: "What is the source or a concrete example for that claim? Could you add one?",
    end: "The debate is over. I score evidence, reasoning, rebuttal, and clarity, judging only argument quality, not positions.",
  },
  es: {
    intro: "Bienvenidos. Soy el moderador. {a} (lado A) se enfrenta a {b} (lado B) en cuatro rondas: apertura, interrogatorio, refutación y cierre. Solo cuido el tiempo y juzgo la calidad del razonamiento y la evidencia, no qué lado tiene razón.",
    opening: "Primera ronda: apertura. El lado A empieza con su tesis y evidencia, luego el lado B.",
    cross: "Segunda ronda: interrogatorio. A pregunta, B responde y luego cambian. Las preguntas deben apuntar al argumento contrario.",
    rebuttal: "Tercera ronda: refutación. Responde al argumento más fuerte del otro lado en lugar de repetir el tuyo.",
    closing: "Ronda final: cierre. Resume tus argumentos y evidencia más fuertes.",
    recap: "Resumen: el lado A mencionó \"{a}\"; el lado B mencionó \"{b}\". Ambos quedan registrados.",
    askSource: "¿Cuál es la fuente o un ejemplo concreto de esa afirmación?",
    end: "El debate terminó. Puntúo evidencia, razonamiento, refutación y claridad; solo la calidad del argumento.",
  },
};

function mod(lang: Lang, key: string, vars: Record<string, string> = {}): string {
  return (MOD[lang] ?? MOD.zh)[key].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");
}

function snippet(text: string, n = 22): string {
  return text.length > n ? text.slice(0, n) + "…" : text;
}

export async function addModeratorTurn(db: Db, room: any, text: string): Promise<any> {
  const id = newId("t_");
  const seq = (await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM turns WHERE room_id = $rid", { rid: room.id }))?.n ?? 0;
  const at = nowIso();
  await db.batch([
    {
      sql: "INSERT INTO turns (id, room_id, seq, side, member_id, phase, role, text, created_at) VALUES ($id, $rid, $seq, 'moderator', NULL, NULL, NULL, $text, $at)",
      params: { id, rid: room.id, seq, text, at },
    },
  ]);
  return await one<any>(db, "SELECT * FROM turns WHERE id = $id", { id });
}

export async function roomJson(db: Db, room: any) {
  const spec = room.status === "live" ? await roomSpec(db, room) : null;
  return {
    id: room.id,
    activityId: room.activity_id,
    groupA: room.group_a,
    groupB: room.group_b,
    status: room.status,
    phase: room.status === "finished" ? "ended" : phaseOf(room.phase_idx),
    turn: spec
      ? {
        side: spec.side,
        memberId: spec.memberId,
        role: spec.role,
        deadline: room.deadline ?? new Date(Date.now() + 1000).toISOString(),
      }
      : null,
  };
}

async function setNextDeadline(db: Db, room: any): Promise<void> {
  const spec = await roomSpec(db, room);
  if (!spec) {
    await db.run("UPDATE rooms SET status = 'finished', deadline = NULL WHERE id = $id", { id: room.id });
    return;
  }
  const deadline = new Date(Date.now() + DEFAULT_SECONDS[spec.phase] * 1000).toISOString();
  await db.run("UPDATE rooms SET deadline = $deadline WHERE id = $id", { deadline, id: room.id });
}

async function advancePhase(db: Db, room: any, lang: Lang, phase: Phase, judgedText: string): Promise<void> {
  const order = SPEAKING_ORDER[phase];
  if (room.turn_idx < order.length) return;
  const inPhase = await all<any>(db, "SELECT * FROM turns WHERE room_id = $rid AND phase = $phase ORDER BY seq", { rid: room.id, phase });
  const aText = [...inPhase].reverse().find((t) => t.side === "a")?.text ?? "";
  const bText = [...inPhase].reverse().find((t) => t.side === "b")?.text ?? "";
  await addModeratorTurn(db, room, mod(lang, "recap", { a: snippet(aText || judgedText), b: snippet(bText) }));
  room.phase_idx += 1;
  room.turn_idx = 0;
  if (room.phase_idx >= PHASES.length) {
    room.status = "finished";
    room.phase_idx = PHASES.length - 1;
    await addModeratorTurn(db, room, mod(lang, "end"));
    await db.run("UPDATE rooms SET status = 'finished', phase_idx = $p, turn_idx = 0, deadline = NULL WHERE id = $id", { p: room.phase_idx, id: room.id });
  } else {
    await addModeratorTurn(db, room, mod(lang, PHASES[room.phase_idx]));
    await db.run("UPDATE rooms SET phase_idx = $p, turn_idx = 0 WHERE id = $id", { p: room.phase_idx, id: room.id });
  }
}

/** 送出目前輪次的發言（或逾時空白），寫入裁判分數並推進。 */
export async function commitTurn(db: Db, room: any, text: string, lang: Lang): Promise<{ turn: any; judgment: any }> {
  const spec = await roomSpec(db, room);
  if (!spec) throw new Error("room_not_live");
  const at = nowIso();
  const turnId = newId("t_");
  const seq = (await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM turns WHERE room_id = $rid", { rid: room.id }))?.n ?? 0;
  await db.run(
    `INSERT INTO turns (id, room_id, seq, side, member_id, phase, role, text, created_at)
     VALUES ($id, $rid, $seq, $side, $memberId, $phase, $role, $text, $at)`,
    { id: turnId, rid: room.id, seq, side: spec.side, memberId: spec.memberId, phase: spec.phase, role: spec.role, text, at },
  );

  const opponentSide = spec.side === "a" ? "b" : "a";
  const opponentRows = await all<any>(
    db,
    "SELECT text FROM turns WHERE room_id = $rid AND side = $side ORDER BY seq DESC LIMIT 1",
    { rid: room.id, side: opponentSide },
  );
  const opponentLast = opponentRows[0]?.text ?? "";
  const judged = judgeTurn(text, spec.phase, opponentLast, lang);
  const judgmentId = newId("j_");
  await db.run(
    `INSERT INTO judgments (id, turn_id, room_id, side, member_id, phase, scores, notes, verifiability, teacher_score)
     VALUES ($id, $turnId, $rid, $side, $memberId, $phase, $scores, $notes, $verifiability, NULL)`,
    {
      id: judgmentId, turnId, rid: room.id, side: spec.side, memberId: spec.memberId, phase: spec.phase,
      scores: JSON.stringify(judged.scores), notes: JSON.stringify(judged.notes), verifiability: judged.verifiability,
    },
  );

  const counts = parseJson<Record<string, number>>(room.side_count, { a: 0, b: 0 });
  counts[spec.side] = (counts[spec.side] ?? 0) + 1;
  const asked = parseJson<Record<string, boolean>>(room.asked, {});
  let askedLine: string | null = null;
  if ((judged.scores.evidence ?? 5) <= 2 && (spec.phase === "opening" || spec.phase === "rebuttal") && !asked[spec.side]) {
    asked[spec.side] = true;
    askedLine = (lang === "en" ? (spec.side === "a" ? "Side A, " : "Side B, ") : lang === "es" ? (spec.side === "a" ? "Lado A, " : "Lado B, ") : (spec.side === "a" ? "A 方，" : "B 方，")) + mod(lang, "askSource");
  }
  room.turn_idx += 1;
  room.side_count = JSON.stringify(counts);
  room.asked = JSON.stringify(asked);
  await db.run("UPDATE rooms SET side_count = $counts, asked = $asked, turn_idx = $turnIdx WHERE id = $id", {
    counts: room.side_count, asked: room.asked, turnIdx: room.turn_idx, id: room.id,
  });

  if (askedLine) await addModeratorTurn(db, room, askedLine);
  await advancePhase(db, room, lang, spec.phase, text);
  if (room.status === "live") await setNextDeadline(db, room);
  room = (await one<any>(db, "SELECT * FROM rooms WHERE id = $id", { id: room.id }))!;
  const turn = await one<any>(db, "SELECT * FROM turns WHERE id = $id", { id: turnId });
  const judgment = await one<any>(db, "SELECT * FROM judgments WHERE id = $id", { id: judgmentId });
  publish(room.activity_id, { type: "turn_created", turn: turnJson(turn), judgment: judgmentJson(judgment) });
  publish(room.activity_id, { type: "room_updated", room: await roomJson(db, room) });
  return { turn, judgment };
}

export async function startRoom(db: Db, room: any, lang: Lang): Promise<any> {
  if (room.status !== "scheduled") return room;
  const groupA = await one<any>(db, "SELECT * FROM groups WHERE id = $id", { id: room.group_a });
  const groupB = await one<any>(db, "SELECT * FROM groups WHERE id = $id", { id: room.group_b });
  room.status = "live";
  room.phase_idx = 0;
  room.turn_idx = 0;
  await addModeratorTurn(db, room, mod(lang, "intro", { a: groupA?.label ?? "A", b: groupB?.label ?? "B" }));
  await addModeratorTurn(db, room, mod(lang, "opening"));
  await db.run("UPDATE rooms SET status = 'live', phase_idx = 0, turn_idx = 0 WHERE id = $id", { id: room.id });
  await setNextDeadline(db, room);
  room = (await one<any>(db, "SELECT * FROM rooms WHERE id = $id", { id: room.id }))!;
  publish(room.activity_id, { type: "room_updated", room: await roomJson(db, room) });
  const turns = await all<any>(db, "SELECT * FROM turns WHERE room_id = $rid ORDER BY seq", { rid: room.id });
  for (const t of turns.filter((x) => x.side === "moderator").slice(-2)) {
    publish(room.activity_id, { type: "turn_created", turn: turnJson(t) });
  }
  return room;
}

/** 逾時自動送出（伺服器時間為準）。每次讀取場次前呼叫。 */
export async function tickExpired(db: Db, room: any, lang: Lang): Promise<any> {
  let guard = 0;
  while (room.status === "live" && room.deadline && room.deadline <= nowIso() && guard++ < 30) {
    const spec = await roomSpec(db, room);
    if (!spec) {
      await db.run("UPDATE rooms SET status = 'finished', deadline = NULL WHERE id = $id", { id: room.id });
      break;
    }
    const timeoutText = lang === "en" ? "(Time is up; no statement was made.)" : lang === "es" ? "(Se acabó el tiempo; no hubo intervención.)" : "（逾時，這一則沒有發言）";
    await commitTurn(db, room, timeoutText, lang);
    room = (await one<any>(db, "SELECT * FROM rooms WHERE id = $id", { id: room.id }))!;
  }
  return room;
}

/* ---------------- 計分 ---------------- */
export async function computeScores(db: Db, activity: ActivityRow): Promise<void> {
  const ids = await studentIdsOf(db, activity.classroom_id);
  const groups = await all<any>(db, "SELECT * FROM groups WHERE activity_id = $aid", { aid: activity.id });
  const rooms = await all<any>(db, "SELECT * FROM rooms WHERE activity_id = $aid", { aid: activity.id });
  const adjustRows = await all<any>(db, "SELECT member_id, adjust FROM scores WHERE activity_id = $aid", { aid: activity.id });
  const previous = new Map(adjustRows.map((r) => [r.member_id as string, r.adjust as number]));
  const entries: Array<{ sql: string; params: Record<string, unknown> }> = [
    { sql: "DELETE FROM scores WHERE activity_id = $aid", params: { aid: activity.id } },
  ];
  for (const memberId of ids) {
    const position = await one<any>(db, "SELECT * FROM positions WHERE activity_id = $aid AND student_id = $sid", { aid: activity.id, sid: memberId });
    const group = groups.find((g) => parseJson<string[]>(g.member_ids, []).includes(memberId));
    const args = group ? await all<any>(db, "SELECT * FROM group_arguments WHERE group_id = $gid", { gid: group.id }) : [];
    const chatCount = group
      ? (await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM group_messages WHERE group_id = $gid AND kind = 'chat' AND author_id = $sid", { gid: group.id, sid: memberId }))?.n ?? 0
      : 0;
    const votesCast = args.filter((a) => parseJson<Record<string, string>>(a.votes, {})[memberId]).length;
    const groupHasActive = args.some((a) => a.status === "active" || a.status === "revised");
    const room = group ? rooms.find((r) => r.group_a === group.id || r.group_b === group.id) : null;
    const side = room ? (room.group_a === group!.id ? "a" : "b") : null;
    const effective = (j: any) => {
      const scores = parseJson<Record<string, number | null>>(j.scores, {});
      if (j.teacher_score === null || j.teacher_score === undefined) return { ...j, scores };
      const out: Record<string, number | null> = {};
      for (const k of Object.keys(scores)) out[k] = scores[k] === null ? null : j.teacher_score;
      return { ...j, scores: out };
    };
    const mine = room ? (await all<any>(db, "SELECT * FROM judgments WHERE room_id = $rid AND member_id = $sid", { rid: room.id, sid: memberId })).map(effective) : [];
    const sideJ = room && side ? (await all<any>(db, "SELECT * FROM judgments WHERE room_id = $rid AND side = $side", { rid: room.id, side })).map(effective) : [];
    const s = computeScore({
      position,
      chatCount,
      votesCast,
      groupHasActive,
      turnJudgments: mine,
      sideAvg: averageScores(sideJ).overall,
    });
    entries.push({
      sql: "INSERT INTO scores (activity_id, member_id, individual, team, debate, adjust) VALUES ($aid, $mid, $i, $t, $d, $adj)",
      params: { aid: activity.id, mid: memberId, i: s.individual, t: s.team, d: s.debate, adj: previous.get(memberId) ?? 0 },
    });
  }
  await db.batch(entries);
}

export async function scoreRows(db: Db, activity: ActivityRow, onlyMemberId?: string) {
  const rows = await all<any>(
    db,
    `SELECT s.*, u.name FROM scores s JOIN users u ON u.id = s.member_id
     WHERE s.activity_id = $aid ${onlyMemberId ? "AND s.member_id = $mid" : ""}
     ORDER BY u.name`,
    onlyMemberId ? { aid: activity.id, mid: onlyMemberId } : { aid: activity.id },
  );
  return rows.map((r) => {
    const s = { individual: r.individual, team: r.team, debate: r.debate, adjust: r.adjust };
    return {
      memberId: r.member_id,
      memberName: r.name,
      individual: r.individual,
      team: r.team,
      debate: r.debate,
      adjust: r.adjust,
      total: weightedTotal(s),
    };
  });
}

/* ---------------- 立場星圖 ---------------- */
const STEP_TEXT: Record<Lang, { individual: string; team: string; onlyIndividual: string; onlyTeam: string; teamAligned: string }> = {
  zh: { individual: "個人調查後", team: "團隊提純後", onlyIndividual: "個人調查", onlyTeam: "每個人自己確認的座標", teamAligned: "向組內共識靠近的座標" },
  en: { individual: "After individual inquiry", team: "After team refinement", onlyIndividual: "Individual inquiry", onlyTeam: "Coordinates each student confirmed", teamAligned: "Positions aligned with the group consensus" },
  es: { individual: "Tras la investigación individual", team: "Tras el refinamiento en equipo", onlyIndividual: "Investigación individual", onlyTeam: "Coordenadas confirmadas por cada estudiante", teamAligned: "Coordenadas alineadas con el consenso del grupo" },
};

export async function starData(db: Db, activity: ActivityRow, lang: Lang, meId?: string) {
  const axes = parseJson<Axis[]>(activity.axes, []);
  const groups = await all<any>(db, "SELECT * FROM groups WHERE activity_id = $aid ORDER BY seq", { aid: activity.id });
  const ids = await studentIdsOf(db, activity.classroom_id);
  const positionRows = await all<any>(db, "SELECT * FROM positions WHERE activity_id = $aid", { aid: activity.id });
  const positions = new Map(positionRows.map((p) => [p.student_id as string, p]));
  const stepText = STEP_TEXT[lang] ?? STEP_TEXT.zh;

  if (!groups.length) {
    const confirmed = ids.filter((id) => positions.get(id)?.confirmed);
    return {
      axes,
      hasTimeline: false,
      initialStep: 0,
      stepLabels: [stepText.onlyIndividual],
      stepNotes: [stepText.onlyTeam],
      groups: null,
      agents: confirmed.map((id, i) => {
        const coords = parseJson<number[]>(positions.get(id)!.coords, []);
        return { id: i, me: id === meId, history: [coords, coords] };
      }),
    };
  }

  const assignments: number[] = [];
  const agents: Array<{ id: number; me: boolean; history: number[][] }> = [];
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    const p = positions.get(id);
    const c0 = p ? parseJson<number[]>(p.coords, []) : new Array(axes.length).fill(0);
    const gIndex = groups.findIndex((g) => parseJson<string[]>(g.member_ids, []).includes(id));
    const group = groups[gIndex];
    let lam = 0.15;
    if (group) {
      const args = await all<any>(db, "SELECT * FROM group_arguments WHERE group_id = $gid AND kind = 'claim'", { gid: group.id });
      const votes = args.map((a) => parseJson<Record<string, string>>(a.votes, {})[id]).filter(Boolean);
      lam = 0.15 + 0.35 * (votes.length ? votes.filter((v) => v === "endorse").length / votes.length : 0.5);
    }
    const centroid = group ? parseJson<number[]>(group.centroid, []) : c0;
    const c1 = c0.map((v, k) => clamp(v + lam * ((centroid[k] ?? 0) - v), -1, 1));
    assignments.push(Math.max(0, gIndex));
    agents.push({ id: i, me: id === meId, history: [c0, c1] });
  }
  return {
    axes,
    agents,
    hasTimeline: true,
    initialStep: activity.stage === "done" ? 1 : 0,
    groups: { labels: groups.map((g) => g.label), assignments },
    stepLabels: [stepText.individual, stepText.team],
    stepNotes: [stepText.onlyTeam, stepText.teamAligned],
  };
}

export async function recalcArgumentStatuses(db: Db, group: any): Promise<void> {
  const members = parseJson<string[]>(group.member_ids, []);
  const args = await all<any>(db, "SELECT * FROM group_arguments WHERE group_id = $gid ORDER BY seq", { gid: group.id });
  refreshStatuses(args, members);
  await db.batch(
    args.map((arg) => ({
      sql: "UPDATE group_arguments SET status = $status WHERE id = $id",
      params: { status: arg.status, id: arg.id },
    })),
  );
}

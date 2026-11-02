// @ts-nocheck
/**
 * 示範用的辯論「假後端」：把原型（純 JS 版）的流程引擎搬到這裡，讓前端沒有後端也能完整跑一遍。
 * 這一整個資料夾（src/mock）只在 VITE_API_MODE=mock 時才會被打包進來；
 * 真後端上線後整個刪掉即可，頁面程式完全不依賴它。
 * 所有「AI」都是規則式範本（見 debate-ai.ts 開頭說明），不是真正的 LLM。
 */
import * as D from "./debate-ai";
import { tr } from "@/i18n";

const uid = (p: string) => p + Math.random().toString(36).slice(2, 8);
const now = () => new Date().toISOString();
const listeners = new Map<string, Set<(e: any) => void>>();
export const emit = (id: string, e: any) => listeners.get(id)?.forEach((cb) => cb(e));
export function subscribe(id: string, cb: (e: any) => void) {
  if (!listeners.has(id)) listeners.set(id, new Set());
  listeners.get(id)!.add(cb);
  return () => listeners.get(id)?.delete(cb);
}

export const acts: any[] = [];
export const findAct = (id: string) => {
  const a = acts.find((x) => x.id === id);
  if (!a) throw new Error(tr("找不到活動"));
  return a;
};

/* ---------------- 活動 ---------------- */
export function createActivity(classroom: { id: string; students: string[] }, input: any, id?: string) {
  const a: any = {
    id: id ?? uid("d"), classroomId: classroom.id, title: input.title, statement: input.statement,
    answerMode: input.answerMode, axes: D.makeAxes(input.axes), groupSize: input.groupSize,
    stage: "individual", createdAt: now(), weights: { ...D.DEFAULT_WEIGHTS },
    members: [], positions: {}, dialogue: [], groups: [], groupState: {}, rooms: [], bye: null, scores: {}, ready: new Set(), stageDeadline: null,
  };
  a.members = D.makeCohort({ students: classroom.students }, { activityId: a.id });
  acts.push(a);
  return a;
}

export function removeActivity(id: string) {
  const i = acts.findIndex((x) => x.id === id);
  if (i >= 0) acts.splice(i, 1);
}

/** 有人開始對話（或已過階段 1）後，辯論設定就不能再改 */
export const hasStarted = (a: any) => a.stage !== "individual" || a.dialogue.length > 0 || Object.keys(a.positions).length > 0;

export function updateSettings(a: any, s: { answerMode?: string; axes?: any[]; groupSize?: number }) {
  if (hasStarted(a)) throw new Error(tr("已經有學生開始對話，辯論設定不能再修改"));
  if (s.answerMode) a.answerMode = s.answerMode;
  if (s.groupSize) a.groupSize = s.groupSize;
  if (s.axes) a.axes = D.makeAxes(s.axes);
}

export const toActivity = (a: any) => ({
  id: a.id, classroomId: a.classroomId, title: a.title, statement: a.statement, answerMode: a.answerMode,
  axes: a.axes.map((x: any) => ({ key: x.key, name: x.name, left: x.left, right: x.right })),
  groupSize: a.groupSize, stage: a.stage, memberCount: a.members.length, createdAt: a.createdAt,
  stageDeadline: a.stageDeadline ?? null, topicId: a.topicId,
});

/* ---------------- 階段 1 ---------------- */
const replies = () => [
  tr("有意思。但你剛才那句話裡，有沒有哪個詞，其實你自己也還沒完全想清楚是什麼意思？"),
  tr("換個角度想：如果反過來看，你剛剛的說法還會成立嗎？"),
  tr("你會怎麼跟一個完全不同意你的人，解釋你為什麼這樣想？"),
  tr("假設有一個例外情況，你的說法在那個情況下還站得住腳嗎？"),
  tr("你說的這件事，是你自己觀察到的，還是別人告訴你的？這兩者對你來說有差別嗎？"),
];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const userTexts = (a: any) => a.dialogue.filter((m: any) => m.role === "user").map((m: any) => m.text);

export async function sendDialogue(a: any, text: string, onDelta?: (c: string) => void): Promise<any> {
  if (a.stage !== "individual") throw new Error(tr("個人調查已經結束"));
  if (userTexts(a).length >= 20) throw new Error(tr("已達最多 20 輪"));
  a.dialogue.push({ id: uid("m"), role: "user", text, at: now() });
  const rs = replies();
  const reply = rs[a.dialogue.filter((m: any) => m.role === "assistant").length % rs.length];
  for (let i = 0; i < reply.length; i += 4) { await wait(25); onDelta?.(reply.slice(i, i + 4)); }
  const msg = { id: uid("m"), role: "assistant", text: reply, at: now() };
  a.dialogue.push(msg);
  return msg;
}

export function progress(a: any) {
  const texts = userTexts(a);
  return { rounds: texts.length, maxRounds: 20, coverage: D.coverage(texts), readyToSummarize: texts.length >= 2 };
}

/** 學生只拿到 AI 整理的論點；座標在確認時由「後端」估算，不給學生 */
export function draftPosition(a: any) {
  const d = D.draftPosition(a, userTexts(a));
  return { summary: { claim: d.claim, reason: d.reason, evidence: d.evidence } };
}

export function confirmPosition(a: any, summary: any) {
  if (a.stage !== "individual") throw new Error(tr("個人調查已經結束"));
  const d = D.draftPosition(a, userTexts(a));
  a.positions.you = { coords: d.coords, summary, confirmed: true, rounds: userTexts(a).length };
  return toPosition(a, "you", false);
}

export function simulateIndividual(a: any) {
  let n = 0;
  for (const m of a.members) {
    if (!m.sim || a.positions[m.id]?.confirmed) continue;
    const coords = D.simPosition(a, m);
    a.positions[m.id] = { coords, summary: D.simSummary(a, m, coords), confirmed: true, rounds: 3 + (n % 5), sim: true };
    a.ready.add(m.id); // 模擬同學完成調查就算準備好了
    n++;
  }
  return n;
}

/** 活動結束前，學生拿到的座標是 null（老師一律看得到） */
export const coordsVisible = (a: any, teacher: boolean) => teacher || a.stage === "done";

export const toPosition = (a: any, id: string, teacher: boolean) => {
  const p = a.positions[id];
  return { memberId: id, coords: coordsVisible(a, teacher) ? p.coords : null, summary: { claim: p.summary.claim, reason: p.summary.reason, evidence: p.summary.evidence }, confirmed: !!p.confirmed, aiSuggested: !!p.auto };
};

export function listPositions(a: any, teacher: boolean) {
  const ids = teacher ? a.members.map((m: any) => m.id) : ["you"];
  return ids.filter((id: string) => a.positions[id]).map((id: string) => toPosition(a, id, teacher));
}

export function listMembers(a: any, teacher: boolean, isStudent: boolean) {
  const rounds = userTexts(a).length;
  return a.members.map((m: any) => {
    const p = a.positions[m.id];
    const r = m.isYou ? rounds : p?.rounds || 0;
    const status = p?.confirmed ? "confirmed" : r ? "talking" : "todo";
    const visible = teacher || m.isYou;
    return {
      id: m.id, name: m.name, isMe: !!m.isYou && isStudent, simulated: !!m.sim, ready: a.ready.has(m.id),
      individual: visible ? { status, rounds: r, claim: p?.confirmed ? p.summary.claim : undefined } : undefined,
    };
  });
}

/* ---------------- 推進階段 ---------------- */
export function advance(a: any) {
  const i = D.STAGES.indexOf(a.stage);
  const next = D.STAGES[i + 1];
  if (!next) throw new Error(tr("活動已經結束"));
  if (a.stage === "individual") {
    simulateIndividual(a);
    if (!a.positions.you?.confirmed) {
      const d = D.draftPosition(a, userTexts(a));
      a.positions.you = { coords: d.coords, summary: { claim: d.claim, reason: d.reason, evidence: d.evidence }, confirmed: false, auto: true };
    }
    formTeams(a);
  } else if (a.stage === "team") {
    if (a.groups.length < 2) throw new Error(tr("至少需要兩個組別才能辯論"));
    enterDebate(a);
  } else if (a.stage === "debate") {
    for (const r of a.rooms) if (r.status !== "finished") simulateRoom(a, r);
    finalizeScores(a);
  }
  enterStage(a, next);
  return a;
}

/** 換階段：截止時間與「準備好了」都重設 */
function enterStage(a: any, stage: string) {
  a.stage = stage;
  a.stageDeadline = null;
  a.ready = new Set();
  emit(a.id, { type: "stage_changed", stage });
}

/** 老師直接結束活動：依序推進到結果；組別不足兩組時跳過辯論，直接結算 */
export function finish(a: any) {
  if (a.stage === "done") throw new Error(tr("活動已經結束"));
  while (a.stage !== "done") {
    if (a.stage === "team" && a.groups.length < 2) {
      finalizeScores(a);
      enterStage(a, "done");
    } else advance(a);
  }
  return a;
}

export function setDeadline(a: any, deadline: string | null) {
  if (a.stage === "done") throw new Error(tr("活動已經結束"));
  if (deadline && new Date(deadline).getTime() <= Date.now()) throw new Error(tr("截止時間要晚於現在"));
  a.stageDeadline = deadline;
  emit(a.id, { type: "deadline_changed", deadline });
  return a;
}

export function setReady(a: any, ready: boolean) {
  if (a.stage === "done" || a.stage === "debate") throw new Error(tr("這個階段不需要回報"));
  if (ready) a.ready.add("you"); else a.ready.delete("you");
  emit(a.id, { type: "member_ready", memberId: "you", ready });
}

/* ---------------- 階段 2 ---------------- */
const cmap = (a: any) => Object.fromEntries(Object.entries(a.positions).map(([id, p]: any) => [id, p.coords]));
const memberById = (a: any, id: string) => a.members.find((m: any) => m.id === id);
const groupOf = (a: any, id: string) => a.groups.find((g: any) => g.memberIds.includes(id));
const gById = (a: any, gid: string) => a.groups.find((g: any) => g.id === gid);

export function formTeams(a: any, seed = 42) {
  a.groups = D.formGroups(a.members, cmap(a), a.groupSize, seed);
  a.groupState = {};
  const sums = Object.fromEntries(a.members.map((m: any) => [m.id, a.positions[m.id].summary]));
  for (const g of a.groups) initGroupState(a, g, sums);
}

function initGroupState(a: any, g: any, sums: any) {
  const cm = cmap(a);
  const sims = g.memberIds.map((id: string) => memberById(a, id)).filter((m: any) => !m.isYou);
  const messages: any[] = [];
  sims.slice(0, 2).forEach((m: any, i: number) => {
    messages.push({ id: uid("gm"), kind: "chat", authorId: m.id, text: D.simChatLine(a, m, cm[m.id], sums[m.id] || a.positions[m.id].summary, i), at: now() });
  });
  messages.push({ id: uid("gm"), kind: "system", text: tr("組別已依座標分好。可以先聊聊彼此的想法，再請 AI 整理論點、丟反例。"), at: now() });
  a.groupState[g.id] = { messages, args: [], countered: {}, splitDone: false, chatCount: 0, votesCast: 0 };
}

function castSimVotes(a: any, g: any, opts: any = {}) {
  const st = a.groupState[g.id];
  const cm = cmap(a);
  for (const arg of st.args) {
    if (arg.kind !== "claim" || (opts.only && arg.id !== opts.only)) continue;
    for (const id of g.memberIds) {
      if (id === "you") continue;
      arg.votes[id] = D.simVote(a, memberById(a, id), cm[id], arg, { afterCounter: !!opts.afterCounter });
    }
  }
  D.refreshStatuses(st.args, g.memberIds);
}

export function ensureArgs(a: any, g: any) {
  const st = a.groupState[g.id];
  if (st.args.length) return false;
  const sums = Object.fromEntries(a.members.map((m: any) => [m.id, a.positions[m.id].summary]));
  st.args = D.summarizeGroup(a, g, sums, cmap(a));
  castSimVotes(a, g);
  return true;
}

export const toGroup = (a: any, g: any, teacher: boolean) => ({
  id: g.id, label: g.label, centroid: g.centroid, formedBy: g.formedBy,
  memberIds: teacher || g.memberIds.includes("you") ? g.memberIds : [],
});
export const toMessage = (gid: string, m: any) => ({ id: m.id, groupId: gid, kind: m.kind, authorId: m.authorId, text: m.text, at: m.at });
export const toArg = (gid: string, x: any, st: any) => ({
  id: x.id, groupId: gid, kind: x.kind, text: x.text, parentId: x.parent, axisIndex: x.axis, status: x.status,
  votes: { ...x.votes }, countered: !!st.countered[x.id],
});
const groupOfArg = (a: any, argId: string) => a.groups.find((g: any) => a.groupState[g.id].args.some((x: any) => x.id === argId));

export function postGroupMessage(a: any, gid: string, text: string) {
  const g = gById(a, gid), st = a.groupState[gid];
  if (!g.memberIds.includes("you")) throw new Error(tr("只能在自己的組別發言"));
  const msg = { id: uid("gm"), kind: "chat", authorId: "you", text, at: now() };
  st.messages.push(msg);
  st.chatCount++;
  const sims = g.memberIds.filter((id: string) => id !== "you");
  if (sims.length) {
    const m = memberById(a, sims[st.chatCount % sims.length]);
    setTimeout(() => {
      const reply = { id: uid("gm"), kind: "chat", authorId: m.id, text: D.simChatLine(a, m, a.positions[m.id].coords, a.positions[m.id].summary, st.chatCount + 1), at: now() };
      st.messages.push(reply);
      emit(a.id, { type: "group_message", message: toMessage(gid, reply) });
    }, 1100);
  }
  return toMessage(gid, msg);
}

export function summarize(a: any, gid: string) {
  const g = gById(a, gid), st = a.groupState[gid];
  if (ensureArgs(a, g)) a.aiCalls = (a.aiCalls ?? 0) + 1;
  const claims = st.args.filter((x: any) => x.kind === "claim");
  const msg = { id: uid("gm"), kind: "ai_summary", text: tr("我把你們的討論與每個人的論點總結合併，整理出 {n} 條主張：", { n: claims.length }) + "\n" + claims.map((c: any, i: number) => `${i + 1}. ${c.text}`).join("\n") + "\n" + tr("請針對每一條投票：贊成、需要修改，或反對。"), at: now() };
  st.messages.push(msg);
  emit(a.id, { type: "group_message", message: toMessage(gid, msg) });
  return st.args.map((x: any) => toArg(gid, x, st));
}

export function counterexample(a: any, gid: string) {
  const g = gById(a, gid), st = a.groupState[gid];
  if (!st.args.length) throw new Error(tr("先請 AI 整理論點，才有東西可以丟反例"));
  const cands = st.args.filter((x: any) => x.kind === "claim" && x.status !== "dropped" && !st.countered[x.id]);
  if (!cands.length) throw new Error(tr("每一條主張都丟過反例了"));
  cands.sort((x: any, y: any) => D.tally(y, g.memberIds).endorse - D.tally(x, g.memberIds).endorse);
  const target = cands[0];
  st.countered[target.id] = true;
  const msg = { id: uid("gm"), kind: "ai_counterexample", text: tr("針對「{claim}」：", { claim: target.text }) + "\n" + D.counterexampleFor(a, target) + "\n" + tr("想過之後，請重新投票。"), at: now() };
  st.messages.push(msg);
  castSimVotes(a, g, { only: target.id, afterCounter: true });
  emit(a.id, { type: "group_message", message: toMessage(gid, msg) });
  return toMessage(gid, msg);
}

export function vote(a: any, argId: string, v: string) {
  const g = groupOfArg(a, argId);
  if (!g) throw new Error(tr("找不到論點"));
  const st = a.groupState[g.id];
  const arg = st.args.find((x: any) => x.id === argId);
  if (!arg.votes.you) st.votesCast++;
  arg.votes.you = v;
  D.refreshStatuses(st.args, g.memberIds);
  const out = toArg(g.id, arg, st);
  emit(a.id, { type: "argument_updated", argument: out });
  return out;
}

export function splitCandidate(a: any, g: any) {
  const st = a.groupState[g.id];
  if (st.splitDone) return null;
  const c = st.args.find((x: any) => x.kind === "claim" && x.status === "contested");
  if (!c) return null;
  const dissent = g.memberIds.filter((id: string) => c.votes[id] && c.votes[id] !== "endorse");
  if (dissent.length < 2 || g.memberIds.length - dissent.length < 2) return null;
  return { claim: c, dissent };
}

export function splitGroup(a: any, gid: string) {
  const g = gById(a, gid);
  const s = splitCandidate(a, g);
  if (!s) throw new Error(tr("目前沒有需要分裂的分歧"));
  const st = a.groupState[gid];
  const cm = cmap(a);
  const sums = Object.fromEntries(a.members.map((m: any) => [m.id, a.positions[m.id].summary]));
  g.memberIds = g.memberIds.filter((id: string) => !s.dissent.includes(id));
  const n = a.groups.length + 1;
  const ng = { id: "g" + n, label: tr("第 {n} 組", { n }), memberIds: s.dissent, centroid: [], formedBy: "split", parent: g.id, color: D.GROUP_COLORS[(n - 1) % D.GROUP_COLORS.length] };
  D.recomputeCentroid(g, cm); D.recomputeCentroid(ng, cm);
  a.groups.push(ng);
  initGroupState(a, ng, sums);
  ensureArgs(a, ng);
  const rest = new Set(g.memberIds);
  for (const k of Object.keys(s.claim.votes)) if (!rest.has(k)) delete s.claim.votes[k];
  st.splitDone = true;
  D.refreshStatuses(st.args, g.memberIds);
  st.messages.push({ id: uid("gm"), kind: "system", text: tr("有 {count} 位組員因為分歧，分出去成為「{label}」。", { count: s.dissent.length, label: ng.label }), at: now() });
  a.groupState[ng.id].messages.unshift({ id: uid("gm"), kind: "system", text: tr("你們從「{label}」分裂出來，因為對「{claim}」有不同的看法。", { label: g.label, claim: s.claim.text }), at: now() });
  return a.groups;
}

export const finalArgs = (a: any, g: any) => (a.groupState[g.id]?.args || []).filter((x: any) => x.status !== "dropped");

/* ---------------- 階段 3 ---------------- */
export function enterDebate(a: any) {
  for (const g of a.groups) ensureArgs(a, g);
  const { pairs, bye } = D.pairGroups(a.groups);
  const mine = groupOf(a, "you");
  if (mine && bye === mine.id && pairs.length) { const sw = pairs[0][0]; pairs[0][0] = mine.id; a.bye = sw; } else a.bye = bye;
  a.rooms = pairs.map(([ga, gb]: any, i: number) => ({
    id: a.id + "-r" + (i + 1), a: ga, b: gb, status: "scheduled", phaseIdx: 0, turnIdx: 0,
    turns: [], judgments: [], sideCount: { a: 0, b: 0 }, asked: {}, deadline: null,
  }));
  for (const r of a.rooms) if (![r.a, r.b].includes(mine?.id)) simulateRoom(a, r);
}

export const findRoom = (id: string) => {
  for (const a of acts) { const r = a.rooms.find((x: any) => x.id === id); if (r) return { a, r }; }
  throw new Error(tr("找不到場次"));
};
const sideGroup = (a: any, r: any, side: string) => gById(a, side === "a" ? r.a : r.b);

function roomSpec(a: any, r: any) {
  const phase = D.PHASES[r.phaseIdx];
  const order = D.SPEAKING_ORDER[phase];
  const side = order[r.turnIdx];
  const g = sideGroup(a, r, side);
  const speakerId = g.memberIds[r.sideCount[side] % g.memberIds.length];
  const role = phase === "cross" ? (r.turnIdx % 2 === 0 ? "ask" : "answer") : "speak";
  return { phase, side, role, group: g, speaker: memberById(a, speakerId), isYou: speakerId === "you" };
}

const modLine = (a: any, r: any, text: string) => r.turns.push({ id: uid("t"), seq: r.turns.length, side: "moderator", text, at: now() });

function startRoomInner(a: any, r: any) {
  r.status = "live";
  modLine(a, r, D.MODERATOR.intro(sideGroup(a, r, "a"), sideGroup(a, r, "b")));
  modLine(a, r, D.MODERATOR.phase("opening"));
}
const lastTextOf = (r: any, side: string) => [...r.turns].reverse().find((x: any) => x.side === side)?.text ?? "";

function commitTurn(a: any, r: any, spec: any, text: string) {
  const opp = spec.side === "a" ? "b" : "a";
  const turn = { id: uid("t"), seq: r.turns.length, side: spec.side, speakerId: spec.speaker.id, phase: spec.phase, role: spec.role, text, at: now() };
  r.turns.push(turn);
  const j = D.judgeTurn({ text, phase: spec.phase, opponentText: lastTextOf(r, opp) });
  const judgment = { id: uid("j"), turnId: turn.id, side: spec.side, speakerId: spec.speaker.id, phase: spec.phase, ...j, teacher: null };
  r.judgments.push(judgment);
  r.sideCount[spec.side]++;
  if (j.scores.evidence <= 2 && (spec.phase === "opening" || spec.phase === "rebuttal") && !r.asked[spec.side]) {
    r.asked[spec.side] = true;
    modLine(a, r, (spec.side === "a" ? tr("A 方，") : tr("B 方，")) + D.MODERATOR.askSource());
  }
  r.turnIdx++;
  const order = D.SPEAKING_ORDER[spec.phase];
  if (r.turnIdx >= order.length) {
    const inPhase = r.turns.filter((t: any) => t.phase === spec.phase);
    modLine(a, r, D.MODERATOR.recap(inPhase.find((t: any) => t.side === "a")?.text || "", inPhase.find((t: any) => t.side === "b")?.text || ""));
    r.phaseIdx++; r.turnIdx = 0;
    if (r.phaseIdx >= D.PHASES.length) {
      r.status = "finished"; r.phaseIdx = D.PHASES.length - 1; r.ended = true;
      modLine(a, r, D.MODERATOR.end());
    } else modLine(a, r, D.MODERATOR.phase(D.PHASES[r.phaseIdx]));
  }
  return { turn, judgment };
}

function simText(a: any, r: any, spec: any) {
  const other = spec.side === "a" ? "b" : "a";
  return D.simTurnText({
    phase: spec.phase, role: spec.role, group: spec.group, args: finalArgs(a, spec.group),
    opponentArgs: finalArgs(a, sideGroup(a, r, other)), opponentLast: lastTextOf(r, other), seed: r.id + ":" + r.turns.length,
  });
}

export function simulateRoom(a: any, r: any) {
  clearTimeout(r._timer);
  if (r.status === "scheduled") startRoomInner(a, r);
  let guard = 0;
  while (r.status === "live" && guard++ < 40) { const spec = roomSpec(a, r); commitTurn(a, r, spec, simText(a, r, spec)); }
  r.deadline = null;
  emit(a.id, { type: "room_updated", room: toRoom(a, r) });
}

export function startRoom(a: any, r: any) {
  if (r.status !== "scheduled") return r;
  startRoomInner(a, r);
  emit(a.id, { type: "room_updated", room: toRoom(a, r) });
  drive(a, r);
  return r;
}

function pushTurnEvents(a: any, r: any, before: number) {
  for (const t of r.turns.slice(before)) {
    const j = r.judgments.find((x: any) => x.turnId === t.id);
    emit(a.id, { type: "turn_created", turn: toTurn(r, t), judgment: j ? toJudgment(r, j) : undefined });
  }
  emit(a.id, { type: "room_updated", room: toRoom(a, r) });
}

/** 輪到模擬同學就 1.5 秒後自動發言；輪到學生就開始倒數，逾時自動送出 */
function drive(a: any, r: any) {
  clearTimeout(r._timer);
  if (r.status !== "live" || a.stage !== "debate") return;
  const spec = roomSpec(a, r);
  if (spec.isYou) {
    r.deadline = r.deadline ?? Date.now() + D.DEFAULT_SECONDS[spec.phase] * 1000;
    r._timer = setTimeout(() => {
      const before = r.turns.length;
      commitTurn(a, r, roomSpec(a, r), tr("（逾時，這一則沒有發言）"));
      r.deadline = null;
      pushTurnEvents(a, r, before);
      drive(a, r);
    }, Math.max(0, r.deadline - Date.now()));
    emit(a.id, { type: "room_updated", room: toRoom(a, r) });
    return;
  }
  r._timer = setTimeout(() => {
    const before = r.turns.length;
    commitTurn(a, r, spec, simText(a, r, spec));
    pushTurnEvents(a, r, before);
    drive(a, r);
  }, 1500);
}

export function postTurn(a: any, r: any, text: string) {
  if (r.status !== "live") throw new Error(tr("這場比賽不在進行中"));
  const spec = roomSpec(a, r);
  if (!spec.isYou) throw new Error(tr("還沒輪到你"));
  clearTimeout(r._timer);
  const before = r.turns.length;
  const { turn } = commitTurn(a, r, spec, text);
  r.deadline = null;
  pushTurnEvents(a, r, before);
  drive(a, r);
  return toTurn(r, turn);
}

export const toRoom = (a: any, r: any): any => {
  let turn = null;
  if (r.status === "live") {
    const s = roomSpec(a, r);
    turn = { side: s.side, memberId: s.speaker.id, role: s.role, deadline: new Date(r.deadline ?? Date.now() + 1500).toISOString() };
  }
  return {
    id: r.id, activityId: a.id, groupA: r.a, groupB: r.b, status: r.status,
    phase: r.status === "finished" ? "ended" : D.PHASES[r.phaseIdx], turn,
  };
};
export const toTurn = (r: any, t: any) => ({ id: t.id, roomId: r.id, seq: t.seq, side: t.side, memberId: t.speakerId, phase: t.phase, text: t.text, at: t.at });
export const toJudgment = (r: any, j: any) => ({
  id: j.id, turnId: j.turnId, roomId: r.id, side: j.side, memberId: j.speakerId, phase: j.phase,
  scores: j.scores, notes: j.notes, verifiability: j.verifiability, teacherScore: j.teacher,
});

export function overrideJudgment(jid: string, teacherScore: number | null) {
  for (const a of acts) for (const r of a.rooms) {
    const j = r.judgments.find((x: any) => x.id === jid);
    if (j) { j.teacher = teacherScore; if (a.stage === "done") finalizeScores(a); return toJudgment(r, j); }
  }
  throw new Error(tr("找不到評分"));
}

/* ---------------- 計分 ---------------- */
export const effectiveJ = (j: any) => {
  if (j.teacher === null || j.teacher === undefined) return j;
  const sc: any = {};
  for (const k of Object.keys(j.scores)) sc[k] = j.scores[k] === null ? null : j.teacher;
  return { ...j, scores: sc };
};

export function finalizeScores(a: any) {
  const prev = a.scores;
  a.scores = {};
  for (const m of a.members) {
    const g = groupOf(a, m.id);
    const st = g ? a.groupState[g.id] : null;
    const room = g ? a.rooms.find((r: any) => r.a === g.id || r.b === g.id) : null;
    const side = room ? (room.a === g.id ? "a" : "b") : null;
    const mine = room ? room.judgments.filter((j: any) => j.speakerId === m.id).map(effectiveJ) : [];
    const sideJ = room ? room.judgments.filter((j: any) => j.side === side).map(effectiveJ) : [];
    const s = D.computeScore({
      member: m, position: a.positions[m.id],
      chatCount: st ? (m.isYou ? st.chatCount : 2 + (m.id.length % 3)) : 0,
      votesCast: st ? (m.isYou ? st.votesCast : 3) : 0,
      groupHasActive: st ? st.args.some((x: any) => x.status === "active" || x.status === "revised") : false,
      turnJudgments: mine, sideAvg: D.avgScores(sideJ).overall,
    });
    a.scores[m.id] = { ...s, adjust: prev[m.id]?.adjust || 0 };
  }
}

export function listScores(a: any, teacher: boolean) {
  if (!Object.keys(a.scores).length) return [];
  const rows = (teacher ? a.members : a.members.filter((m: any) => m.isYou)).map((m: any) => {
    const s = a.scores[m.id];
    return { memberId: m.id, memberName: m.name, individual: s.individual, team: s.team, debate: s.debate, adjust: s.adjust, total: D.weightedTotal(s, a.weights, s.adjust) };
  });
  return rows;
}
export function adjustScore(a: any, memberId: string, adjust: number) {
  if (!a.scores[memberId]) throw new Error(tr("還沒有成績"));
  a.scores[memberId].adjust = adjust;
  return listScores(a, true).find((r: any) => r.memberId === memberId);
}

/* ---------------- 立場星圖 ---------------- */
export function starData(a: any) {
  const axes = a.axes.map((x: any) => ({ key: x.key, name: x.name, left: x.left, right: x.right }));
  if (!a.groups.length) {
    const order = a.members.filter((m: any) => a.positions[m.id]?.confirmed).sort((x: any, y: any) => (y.isYou ? 1 : 0) - (x.isYou ? 1 : 0));
    return {
      axes, hasTimeline: false, initialStep: 0, stepLabels: [tr("個人調查")], stepNotes: [tr("每個人自己確認的座標")], groups: null,
      agents: order.map((m: any, i: number) => ({ id: i, me: !!m.isYou, history: [a.positions[m.id].coords, a.positions[m.id].coords] })),
    };
  }
  const cm = cmap(a);
  const order = [...a.members].sort((x: any, y: any) => (y.isYou ? 1 : 0) - (x.isYou ? 1 : 0));
  const assignments: number[] = [];
  const agents = order.map((m: any, i: number) => {
    const g = groupOf(a, m.id);
    const c0 = cm[m.id];
    let lam = 0.15;
    if (g) {
      const votes = a.groupState[g.id].args.filter((x: any) => x.kind === "claim").map((c: any) => c.votes[m.id]).filter(Boolean);
      lam = 0.15 + 0.35 * (votes.length ? votes.filter((v: string) => v === "endorse").length / votes.length : 0.5);
    }
    const cen = g ? g.centroid : c0;
    const c1 = c0.map((v: number, k: number) => D.clamp(v + lam * (cen[k] - v), -1, 1));
    assignments.push(Math.max(0, a.groups.indexOf(g)));
    return { id: i, me: !!m.isYou, history: [c0, c1] };
  });
  return {
    axes, agents, hasTimeline: true, initialStep: a.stage === "done" ? 1 : 0,
    groups: { labels: a.groups.map((g: any) => g.label), assignments },
    stepLabels: [tr("個人調查後"), tr("團隊提純後")], stepNotes: [tr("每個人自己確認的座標"), tr("依組內投票推估（示範）")],
  };
}

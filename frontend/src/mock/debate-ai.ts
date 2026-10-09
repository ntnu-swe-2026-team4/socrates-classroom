// @ts-nocheck
/* =========================================================
   辯論系統 — 純邏輯層（沒有 DOM，可以直接在 Node 測試）

   流程（對應設計圖）：
     老師設定題目 → 階段 1 個人調查 → 階段 2 團隊提純 → 階段 3 辯論比賽 → 活動結束

   ⚠ 這裡的「AI」全部是**離線示範用的規則式範本**，不是真正的 LLM：
     - 模擬同學的立場、發言、投票：由議題與成員 id 決定的種子產生
     - 整理論點 / 反例 / 主持人：句型範本
     - 裁判：只看文字裡有沒有證據、推理、回應、表達的線索（規則式），
       **完全不判斷立場對錯**
   之後接後端時，把 AI.* 這幾個函式換成呼叫 API 即可，其餘流程不用動。
   ========================================================= */
import { kmeans, mulberry32, hashSeed } from "@/lib/star/data";

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const AXIS_COLORS = ["#c9a15a", "#6f95c9", "#7ea56a"];
export const GROUP_COLORS = ["#d9855a", "#5fae8e", "#7a8fd6", "#c9a15a", "#b27ac0", "#5ab1c2", "#c96f8f", "#9aa66a"];

export const STAGES = ["individual", "team", "debate", "done"];
export const STAGE_NAME = { individual: "階段 1 · 個人調查", team: "階段 2 · 團隊提純", debate: "階段 3 · 辯論比賽", done: "活動結束" };
export const STAGE_SHORT = { individual: "個人調查", team: "團隊提純", debate: "辯論比賽", done: "已結束" };
export const ANSWER_MODE_NAME = { text: "文字", voice: "語音", both: "文字或語音" };
export const PHASES = ["opening", "cross", "rebuttal", "closing"];
export const PHASE_NAME = { opening: "開場", cross: "質詢", rebuttal: "反駁", closing: "結辯", ended: "結束" };
export const CRITERIA = [
  { key: "evidence", name: "證據品質", hint: "有沒有具體例子、來源或可查核的資料" },
  { key: "reasoning", name: "推理", hint: "從證據到結論的推導是否清楚" },
  { key: "rebuttal", name: "回應", hint: "有沒有正面回應對方的論點" },
  { key: "clarity", name: "表達", hint: "論點是否清楚、長度適中" },
];

/* 每回合的發言順序（質詢：A 問 B 答，再 B 問 A 答） */
export const SPEAKING_ORDER = {
  opening: ["a", "b"],
  cross: ["a", "b", "b", "a"],
  rebuttal: ["b", "a"],
  closing: ["b", "a"],
};
export const DEFAULT_SECONDS = { opening: 60, cross: 45, rebuttal: 60, closing: 45 }; // 每則發言

/* ---------------- 活動 / 價值軸 ---------------- */

export function makeAxes(list) {
  return list.slice(0, 3).map((a, i) => ({ key: "ax" + i, color: AXIS_COLORS[i], ...a }));
}

/** 建議價值軸（老師輸入議題後的起手式，可修改） */
export const SUGGESTED_AXES = [
  { name: "判準", left: "結果", right: "動機" },
  { name: "權威", left: "個人", right: "共同體" },
  { name: "變革", left: "守成", right: "革新" },
];

/* ---------------- 模擬同學 ---------------- */

export function makeCohort(classroom, { activityId, minSims = 8 } = {}) {
  const names = classroom.students.filter((n) => n !== "你");
  const members = names.map((name, i) => ({ id: "m" + i, name, sim: true }));
  for (let i = members.length; i < minSims; i++) {
    members.push({ id: "m" + i, name: "模擬同學 " + (i + 1 - names.length), sim: true, padded: true });
  }
  members.push({ id: "you", name: "你", isYou: true });
  return members;
}

const PATTERNS = [
  [0.72, 0.6, -0.5],
  [-0.7, -0.52, 0.62],
  [0.6, -0.62, 0.5],
  [-0.6, 0.58, -0.55],
];

function gaussFrom(rng) {
  let u = 0, v = 0;
  while (u === 0) u = rng();
  while (v === 0) v = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** 模擬同學藏在心裡的立場（階段 1 「確認」時才公開） */
export function simPosition(activity, member) {
  const rng = mulberry32(hashSeed(activity.id + ":" + member.id));
  const k = activity.axes.length;
  const base = PATTERNS[(rng() * PATTERNS.length) | 0];
  const wild = rng() < 0.2;
  return Array.from({ length: k }, (_, i) =>
    wild ? rng() * 2 - 1 : clamp(base[i % base.length] + gaussFrom(rng) * 0.24, -1, 1),
  );
}

const REASONS = [
  "因為大多數情況下，這樣做比較能讓人們願意長期遵守",
  "因為只看單一面向，常常會忽略真正受影響的人",
  "因為規則如果沒有理由支撐，很難說服立場不同的人",
  "因為不少歷史例子都顯示，過度偏向另一邊會帶來問題",
];
const EVIDENCES = [
  "例如學校的班規，如果大家沒有參與制定，就比較容易被忽視",
  "例如新聞上常見的公共政策爭議，兩邊各有一部分道理",
  "例如課堂上討論過的例子：同一件事在不同情境下，評價會不同",
  "例如生活中的排隊插隊，大家在意的不只是結果，還有公平",
];

const pole = (ax, v) => (v >= 0 ? ax.right : ax.left);

/** 一位同學的論點總結（主張 / 理由 / 證據） */
export function simSummary(activity, member, coords) {
  const rng = mulberry32(hashSeed("sum:" + activity.id + member.id));
  let best = 0;
  coords.forEach((v, i) => { if (Math.abs(v) > Math.abs(coords[best])) best = i; });
  const ax = activity.axes[best];
  const claim = `在「${ax.name}」上，我認為${pole(ax, coords[best])}比較重要`;
  const reason = REASONS[(rng() * REASONS.length) | 0];
  const evidence = EVIDENCES[(rng() * EVIDENCES.length) | 0];
  return { claim, reason, evidence, axis: best, sign: coords[best] >= 0 ? 1 : -1 };
}

/* ---------------- 階段 1：對話 → 座標與論點草稿 ---------------- */

const CUE = {
  claim: /我(覺得|認為|想|主張|相信)|應該|不應該|才是|就是|不是/,
  reason: /因為|由於|原因|所以|因此|畢竟/,
  evidence: /例如|比如|像是|舉例|例子|研究|新聞|經驗|報導|統計|資料/,
  counter: /但是|不過|然而|除非|可是|也許|可能|另一方面|反過來/,
};

/** 「AI 追問到哪了」：以使用者的發言粗略判斷四個面向有沒有出現 */
export function coverage(userTexts) {
  const all = userTexts.join("\n");
  return {
    claim: CUE.claim.test(all),
    reason: CUE.reason.test(all),
    evidence: CUE.evidence.test(all),
    counter: CUE.counter.test(all),
  };
}

const trim = (s, n = 90) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** 從使用者的發言整理出座標建議與論點草稿（離線示範：關鍵字估計，請學生自己調整） */
export function draftPosition(activity, userTexts) {
  const pick = (re) => userTexts.find((t) => re.test(t)) || "";
  const claim = trim(pick(CUE.claim) || userTexts[0] || "");
  const reason = trim(pick(CUE.reason));
  const evidence = trim(pick(CUE.evidence));
  const all = userTexts.join("\n");
  const count = (w) => (all.match(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  const coords = activity.axes.map((ax) => clamp((count(ax.right) - count(ax.left)) * 0.4, -1, 1));
  const hinted = activity.axes.some((ax) => count(ax.left) + count(ax.right) > 0);
  return { coords, claim, reason, evidence, hinted };
}

/* ---------------- 階段 2：分組 ---------------- */

/** k-means 分組 + 人數上限平衡 + 併掉單人組。points 是每位成員的座標。 */
export function formGroups(members, coordsById, targetSize = 3, seed = 42) {
  const pts = members.map((m) => coordsById[m.id]);
  const n = pts.length;
  const k = Math.max(1, Math.round(n / targetSize));
  const res = kmeans(pts, k, { seed });
  const assign = res.assignments.slice();
  const dist2 = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  const centroidOf = (c) => {
    const idx = assign.map((a, i) => (a === c ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return null;
    return pts[0].map((_, d) => idx.reduce((s, i) => s + pts[i][d], 0) / idx.length);
  };
  const size = (c) => assign.filter((a) => a === c).length;
  const kk = res.centroids.length;
  const maxSize = targetSize + 1;

  // 人數上限：把離中心最遠的人移到最近、還有空位的組
  for (let guard = 0; guard < n * kk; guard++) {
    const over = [...Array(kk).keys()].find((c) => size(c) > maxSize);
    if (over === undefined) break;
    const cen = centroidOf(over);
    const members_ = assign.map((a, i) => (a === over ? i : -1)).filter((i) => i >= 0);
    const mover = members_.sort((x, y) => dist2(pts[y], cen) - dist2(pts[x], cen))[0];
    const targets = [...Array(kk).keys()].filter((c) => c !== over && size(c) < maxSize && centroidOf(c));
    if (!targets.length) break;
    targets.sort((a, b) => dist2(pts[mover], centroidOf(a)) - dist2(pts[mover], centroidOf(b)));
    assign[mover] = targets[0];
  }
  // 單人組併入最近的組
  for (let c = 0; c < kk; c++) {
    if (size(c) === 1 && kk > 1) {
      const i = assign.indexOf(c);
      const others = [...Array(kk).keys()].filter((o) => o !== c && size(o) > 0);
      others.sort((a, b) => dist2(pts[i], centroidOf(a)) - dist2(pts[i], centroidOf(b)));
      if (others.length) assign[i] = others[0];
    }
  }

  const groups = [];
  for (let c = 0; c < kk; c++) {
    const idx = assign.map((a, i) => (a === c ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    groups.push({ memberIds: idx.map((i) => members[i].id), centroid: centroidOf(c), formedBy: "auto" });
  }
  groups.sort((a, b) => a.centroid[0] - b.centroid[0]);
  return groups.map((g, i) => ({ ...g, id: "g" + (i + 1), label: "第 " + (i + 1) + " 組", color: GROUP_COLORS[i % GROUP_COLORS.length] }));
}

export function recomputeCentroid(group, coordsById) {
  const pts = group.memberIds.map((id) => coordsById[id]);
  group.centroid = pts[0].map((_, d) => pts.reduce((s, p) => s + p[d], 0) / pts.length);
}

/** 辯論配對：中心相距最遠的兩組先對上；奇數組時剩一組輪空 */
export function pairGroups(groups) {
  const d2 = (a, b) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  const edges = [];
  for (let i = 0; i < groups.length; i++)
    for (let j = i + 1; j < groups.length; j++) edges.push([d2(groups[i].centroid, groups[j].centroid), i, j]);
  edges.sort((x, y) => y[0] - x[0]);
  const used = new Set();
  const pairs = [];
  for (const [, i, j] of edges) {
    if (!used.has(i) && !used.has(j)) { used.add(i); used.add(j); pairs.push([groups[i].id, groups[j].id]); }
  }
  const bye = groups.find((_, i) => !used.has(i));
  return { pairs, bye: bye ? bye.id : null };
}

/* ---------------- 階段 2：組內論點 / 反例 / 投票 ---------------- */

let argSeq = 1;
export const newArgId = () => "arg" + argSeq++;

/** AI「整理組內論點」：把組員的論點總結，依價值軸合併成去重的論點樹 */
export function summarizeGroup(activity, group, summaries, coordsById) {
  const out = [];
  const k = activity.axes.length;
  for (let i = 0; i < k; i++) {
    const vals = group.memberIds.map((id) => coordsById[id][i]);
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    if (Math.abs(mean) < 0.2) continue;
    const ax = activity.axes[i];
    const sign = mean >= 0 ? 1 : -1;
    // 找最支持這個方向的成員，借他的理由與證據
    const lead = group.memberIds
      .map((id) => ({ id, v: coordsById[id][i] * sign }))
      .sort((a, b) => b.v - a.v)[0];
    const s = summaries[lead.id];
    const claim = { id: newArgId(), kind: "claim", text: `我們傾向「${pole(ax, mean)}」，而不是「${pole(ax, -mean)}」（${ax.name}）`, axis: i, sign, parent: null, status: "active", votes: {} };
    out.push(claim);
    if (s?.reason) out.push({ id: newArgId(), kind: "reason", text: s.reason, axis: i, sign, parent: claim.id, status: "active", votes: {} });
    if (s?.evidence) out.push({ id: newArgId(), kind: "evidence", text: s.evidence, axis: i, sign, parent: claim.id, status: "active", votes: {} });
  }
  if (!out.length) {
    out.push({ id: newArgId(), kind: "claim", text: "我們的立場比較居中，還在找出彼此的共同點", axis: 0, sign: 1, parent: null, status: "active", votes: {} });
  }
  return out;
}

/** AI「丟反例」：針對一條主張，產生一個具體的反向情境 */
export function counterexampleFor(activity, arg) {
  const ax = activity.axes[arg.axis] || activity.axes[0];
  const opp = pole(ax, -arg.sign);
  const mine = pole(ax, arg.sign);
  const cases = [
    `假設有一個情境，「${opp}」才是大家都接受、結果也比較好的做法。你們主張「${mine}」，這個情境會不會讓主張失效？請說明它在什麼條件下仍然成立。`,
    `想像一位跟你們立場完全相反的同學，他舉了一個生活中的例子，說明「${opp}」比「${mine}」更合理。你們會怎麼回應他，又有哪一步是你們自己也還沒有把握的？`,
  ];
  return cases[hashSeed(arg.id) % cases.length];
}

/** 模擬同學對某條論點的投票（依他自己的座標，反例之後會更保守） */
export function simVote(activity, member, coords, arg, { afterCounter = false } = {}) {
  const v = (coords[arg.axis] ?? 0) * arg.sign;
  const rng = mulberry32(hashSeed("vote:" + member.id + arg.id + (afterCounter ? "c" : "")));
  const t = afterCounter ? 0.45 : 0.15;
  const noise = (rng() - 0.5) * (afterCounter ? 0.7 : 0.2);
  const s = v + noise;
  if (s > t) return "endorse";
  if (s < -t) return "oppose";
  return "revise";
}

export function tally(arg, memberIds) {
  const t = { endorse: 0, revise: 0, oppose: 0 };
  for (const id of memberIds) { const v = arg.votes[id]; if (v) t[v]++; }
  t.total = memberIds.length;
  t.cast = t.endorse + t.revise + t.oppose;
  return t;
}

/** 依票數更新論點狀態；回傳有沒有出現「內部分裂」的核心分歧 */
export function refreshStatuses(args, memberIds) {
  let split = null;
  for (const a of args) {
    if (a.kind !== "claim") continue;
    const t = tally(a, memberIds);
    if (t.cast < Math.ceil(t.total * 0.6)) { a.status = "active"; continue; }
    const dis = t.oppose + t.revise;
    if (t.oppose / t.total >= 0.6) a.status = "dropped";
    else if (t.revise / t.total >= 0.5) a.status = "revised";
    else if (dis / t.total >= 0.4 && dis >= 2) { a.status = "contested"; if (!split) split = a; }
    else a.status = "active";
  }
  return split;
}

/** 模擬同學在組內聊天室說的話 */
export function simChatLine(activity, member, coords, summary, i = 0) {
  const s = summary;
  const lines = [
    `${s.claim}。${s.reason}。`,
    `補充一下我的例子：${s.evidence.replace(/^例如/, "")}。`,
    `我比較在意的是「${activity.axes[s.axis].name}」這條，你們覺得呢？`,
  ];
  return lines[i % lines.length];
}

/* ---------------- 階段 3：辯論賽 ---------------- */

const snippet = (t, n = 18) => (t.length > n ? t.slice(0, n) + "…" : t);

export const MODERATOR = {
  intro: (a, b) => `各位好，我是這場辯論的主持人。${a.label}（A 方）對上${b.label}（B 方），共四個回合：開場、質詢、反駁、結辯。我只管流程與時間，也只看論證的證據與推理，不評判誰的立場才對。`,
  phase: (phase, ctx = {}) =>
    ({
      opening: "第一回合：開場。請 A 方先說明核心主張與證據，接著換 B 方。",
      cross: "第二回合：質詢。A 方先提問、B 方回答，接著交換。提問請針對對方論點，回答請正面回應。",
      rebuttal: "第三回合：反駁。請回應對方最強的論點，而不是重述自己的立場。",
      closing: "最後一回合：結辯。請整理你們最有力的論點與證據。",
    })[phase],
  recap: (aText, bText) => `小結：A 方提到「${snippet(aText, 22)}」；B 方提到「${snippet(bText, 22)}」。兩邊的說法我都記下來了。`,
  askSource: () => "這個說法的出處或具體例子是什麼？可以補充一下嗎？",
  end: () => "辯論結束。我會依證據、推理、回應、表達四項給分，只看論證品質，不評判立場。",
};

/** 模擬選手的發言 */
export function simTurnText({ phase, role, group, args, opponentArgs, opponentLast, seed }) {
  const rng = mulberry32(hashSeed(seed));
  const claims = args.filter((a) => a.kind === "claim" && a.status !== "dropped");
  const mine = claims[0]?.text || "我們還在整理自己的主張";
  const reason = args.find((a) => a.kind === "reason")?.text || REASONS[(rng() * REASONS.length) | 0];
  const evidence = args.find((a) => a.kind === "evidence")?.text || EVIDENCES[(rng() * EVIDENCES.length) | 0];
  const theirs = opponentArgs.find((a) => a.kind === "claim")?.text || "對方的主張";
  const quiet = rng() < 0.25; // 有時候只講立場、沒有證據，讓評分有高有低
  if (phase === "opening")
    return quiet
      ? `我方的主張是：${mine}。我們認為這樣比較合理。`
      : `我方的核心主張是：${mine}。${reason}。${evidence}。`;
  if (phase === "cross")
    return role === "ask"
      ? `請問對方：你們主張「${snippet(theirs, 26)}」，如果情境反過來，這個主張還成立嗎？你們的根據是什麼？`
      : `我方回答：${reason}，而且${evidence.replace(/^例如/, "例如")}。所以即使情境改變，我方的主張仍然有它的道理。`;
  if (phase === "rebuttal")
    return `對方剛才提到「${snippet(opponentLast || theirs, 20)}」。但是我方認為這忽略了：${mine}。因為${reason.replace(/^因為/, "")}，因此我方仍然堅持原本的看法。`;
  return quiet
    ? `總結：我們認為我方的立場比較值得支持。`
    : `總結我方：${mine}。我們的證據是：${evidence}。所以我們認為這個立場更值得支持。`;
}

const RE = {
  example: /例如|比如|舉例|例子|像是|假設/,
  source: /根據|研究|報導|報告|統計|資料|實驗|調查|來源|新聞/,
  number: /\d|[一二三四五六七八九十百千萬]+(成|倍|個|次|人|年)/,
  because: /因為|由於|所以|因此|因而|代表|意味/,
  cond: /如果|若|假如|要是|除非/,
  contrast: /但是|然而|不過|可是|反而/,
};

/**
 * 規則式裁判（示範）：只看文字裡有沒有證據、推理、回應、表達的線索。
 * 不判斷立場對錯；不宣稱事實真假，只標記「有沒有給出處/可查核」。
 * 回應項在開場與結辯不計分（null）。
 */
export function judgeTurn({ text, phase, opponentText }) {
  const notes = {};
  // 證據
  let ev = 1;
  const evHits = [];
  if (text.length > 40) ev += 1;
  if (RE.example.test(text)) { ev += 1; evHits.push("具體例子"); }
  if (RE.number.test(text)) { ev += 1; evHits.push("數字"); }
  if (RE.source.test(text)) { ev += 1; evHits.push("出處用語"); }
  notes.evidence = evHits.length ? `提到了${evHits.join("、")}` : "沒有提出具體例子或出處";
  // 推理
  let rs = 1;
  const rsHits = [];
  if (RE.because.test(text)) { rs += 1; rsHits.push("因果連結"); }
  if (RE.cond.test(text)) { rs += 1; rsHits.push("條件推論"); }
  if ((text.match(/[。！？]/g) || []).length >= 2) rs += 1;
  if (RE.contrast.test(text)) { rs += 1; rsHits.push("考慮了另一面"); }
  notes.reasoning = rsHits.length ? `使用了${rsHits.join("、")}` : "只有斷言，缺少理由";
  // 回應
  let rb = null;
  if ((phase === "cross" || phase === "rebuttal") && opponentText) {
    const grams = new Set();
    for (let i = 0; i < opponentText.length - 1; i++) grams.add(opponentText.slice(i, i + 2));
    let hit = 0;
    for (let i = 0; i < text.length - 1; i++) if (grams.has(text.slice(i, i + 2))) hit++;
    const ratio = hit / Math.max(8, text.length);
    rb = 1 + (ratio > 0.12 ? 1 : 0) + (ratio > 0.22 ? 1 : 0) + (/對方|你們|剛才|提到/.test(text) ? 1 : 0) + (RE.contrast.test(text) ? 1 : 0);
    notes.rebuttal = rb >= 3 ? "有引用並回應對方的說法" : "和對方的論點連結不多";
  }
  // 表達
  let cl = 3;
  if (text.length >= 20 && text.length <= 220) cl += 1;
  if (/[，。]/.test(text)) cl += 1;
  if (text.length < 12) cl -= 2;
  if (text.length > 320) cl -= 1;
  notes.clarity = text.length < 12 ? "太短，看不出完整的想法" : text.length > 320 ? "偏長，重點可以再收斂" : "長度適中、句子完整";

  const verifiability = RE.source.test(text) ? "sourced" : RE.example.test(text) || RE.number.test(text) ? "checkable" : "unverified";
  const s = (v) => (v === null ? null : clamp(v, 0, 5));
  return { scores: { evidence: s(ev), reasoning: s(rs), rebuttal: s(rb), clarity: s(cl) }, notes, verifiability };
}

export const VERIFY_NAME = { sourced: "有出處用語", checkable: "有例子可查", unverified: "尚未提供" };

export function avgScores(judgments) {
  const out = {};
  for (const c of CRITERIA) {
    const v = judgments.map((j) => j.scores[c.key]).filter((x) => x !== null && x !== undefined);
    out[c.key] = v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
  }
  const vals = Object.values(out).filter((x) => x !== null);
  out.overall = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
  return out;
}

/* ---------------- 計分（看過程與論證品質，不看立場） ---------------- */

export const DEFAULT_WEIGHTS = { individual: 30, team: 30, debate: 40 };

export function computeScore({ member, position, chatCount, votesCast, groupHasActive, turnJudgments, sideAvg }) {
  // 個人：完成調查、論點完整度
  let ind = 0;
  if (position?.confirmed) {
    ind += 60;
    const filled = ["claim", "reason", "evidence"].filter((k) => position.summary?.[k]).length;
    ind += filled * (40 / 3);
  }
  // 團隊：參與（發言、投票）與組內論點被保留
  const team = clamp(Math.min(chatCount, 4) * 10 + Math.min(votesCast, 4) * 10 + (groupHasActive ? 20 : 0), 0, 100);
  // 辯論：自己的發言平均；沒上場就用該方平均打八折
  let deb = 0;
  const mine = avgScores(turnJudgments).overall;
  if (mine !== null) deb = (mine / 5) * 100;
  else if (sideAvg !== null && sideAvg !== undefined) deb = (sideAvg / 5) * 100 * 0.8;
  return { individual: Math.round(ind), team: Math.round(team), debate: Math.round(deb) };
}

export function weightedTotal(s, w = DEFAULT_WEIGHTS, adjust = 0) {
  const sum = w.individual + w.team + w.debate || 1;
  return Math.round((s.individual * w.individual + s.team * w.team + s.debate * w.debate) / sum + adjust);
}

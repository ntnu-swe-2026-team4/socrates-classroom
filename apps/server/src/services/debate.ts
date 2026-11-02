import type { Db } from "../db/d1";
import type { Lang } from "@socrates/shared";
import { all, one, parseJson } from "../db/d1";
import { newId, nowIso } from "../http";
import type { ActivityRow } from "./access";

export const STAGES = ["individual", "team", "debate", "done"] as const;
export const PHASES = ["opening", "cross", "rebuttal", "closing"] as const;
export type Phase = (typeof PHASES)[number];
export type Side = "a" | "b";
export const SPEAKING_ORDER: Record<Phase, Side[]> = {
  opening: ["a", "b"],
  cross: ["a", "b", "b", "a"],
  rebuttal: ["b", "a"],
  closing: ["b", "a"],
};
export const DEFAULT_SECONDS: Record<Phase, number> = { opening: 60, cross: 45, rebuttal: 60, closing: 45 };

export interface Axis {
  key: string;
  name: string;
  left: string;
  right: string;
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export function makeAxes(input: unknown): Axis[] {
  if (!Array.isArray(input) || !input.length) throw new Error("invalid_axis");
  return input.slice(0, 3).map((raw, i) => {
    if (typeof raw !== "object" || raw === null) throw new Error("invalid_axis");
    const a = raw as Record<string, unknown>;
    const name = typeof a.name === "string" ? a.name.trim() : "";
    const left = typeof a.left === "string" ? a.left.trim() : "";
    const right = typeof a.right === "string" ? a.right.trim() : "";
    if (!name || !left || !right) throw new Error("invalid_axis");
    return { key: `ax${i}`, name, left, right };
  });
}

const trimTo = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

const CUE = {
  claim:
    /我(覺得|認為|想|主張|相信)|應該|不應該|才是|就是|不是|\bI (think|believe|feel)\b|\bwe (think|believe)\b|\bshould(n't| not)?\b|\b(creo|pienso|opino|considero)\b|me parece|\bdeber[ií]a/i,
  reason:
    /因為|由於|原因|所以|因此|畢竟|\b(because|since|therefore|after all)\b|\b(porque|ya que|puesto que|por lo tanto|por eso)\b/i,
  evidence:
    /例如|比如|像是|舉例|例子|研究|新聞|經驗|報導|統計|資料|for example|for instance|such as|\b(study|studies|research|news|experience|data|statistics)\b|por ejemplo|\b(estudio|estudios|investigaci[oó]n|noticias?|experiencia|datos|estad[ií]sticas?)\b/i,
};

export function draftSummary(_axes: Axis[], texts: string[]) {
  const pick = (re: RegExp) => texts.find((t) => re.test(t)) || "";
  const claim = trimTo(pick(CUE.claim) || texts[0] || "");
  const reason = trimTo(pick(CUE.reason));
  const evidence = trimTo(pick(CUE.evidence));
  return { claim, reason, evidence };
}

export function estimateCoords(axes: Axis[], texts: string[]): number[] {
  const text = texts.join("\n");
  const count = (w: string) => (text.match(new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
  return axes.map((ax) => clamp((count(ax.right) - count(ax.left)) * 0.4, -1, 1));
}

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function kmeans(points: number[][], k: number, seed = 42) {
  const n = points.length;
  if (!n) return { assignments: [] as number[], centroids: [] as number[][] };
  k = Math.max(1, Math.min(k, n));
  const dim = points[0].length;
  const rng = mulberry32(seed);
  let best: { assignments: number[]; centroids: number[][]; inertia: number } | null = null;
  for (let restart = 0; restart < 8; restart++) {
    const centroids = [points[(rng() * n) | 0].slice()];
    while (centroids.length < k) centroids.push(points[(rng() * n) | 0].slice());
    const assignments = new Array(n).fill(0);
    for (let iter = 0; iter < 50; iter++) {
      let moved = false;
      for (let i = 0; i < n; i++) {
        let bestC = 0;
        let bestD = Infinity;
        for (let c = 0; c < k; c++) {
          let s = 0;
          for (let d = 0; d < dim; d++) s += (points[i][d] - centroids[c][d]) ** 2;
          if (s < bestD) {
            bestD = s;
            bestC = c;
          }
        }
        if (assignments[i] !== bestC) {
          assignments[i] = bestC;
          moved = true;
        }
      }
      const sums = Array.from({ length: k }, () => new Array(dim).fill(0));
      const counts = new Array(k).fill(0);
      for (let i = 0; i < n; i++) {
        counts[assignments[i]]++;
        for (let d = 0; d < dim; d++) sums[assignments[i]][d] += points[i][d];
      }
      for (let c = 0; c < k; c++) {
        if (counts[c]) centroids[c] = sums[c].map((v) => v / counts[c]);
        else centroids[c] = points[(rng() * n) | 0].slice();
      }
      if (!moved && iter > 0) break;
    }
    let inertia = 0;
    for (let i = 0; i < n; i++)
      for (let d = 0; d < dim; d++) inertia += (points[i][d] - centroids[assignments[i]][d]) ** 2;
    if (!best || inertia < best.inertia) best = { assignments, centroids, inertia };
  }
  return best!;
}

export interface FormedGroup {
  memberIds: string[];
  centroid: number[];
  formedBy: "auto";
  label: string;
}

const GROUP_WORD: Record<Lang, (n: number) => string> = {
  zh: (n) => `第 ${n} 組`,
  en: (n) => `Group ${n}`,
  es: (n) => `Grupo ${n}`,
};

export function groupLabel(lang: Lang, n: number): string {
  return (GROUP_WORD[lang] ?? GROUP_WORD.zh)(n);
}

export function formGroups(
  members: { id: string }[],
  coordsById: Record<string, number[]>,
  targetSize = 3,
  seed = 42,
  lang: Lang = "zh",
): FormedGroup[] {
  const pts = members.map((m) => coordsById[m.id] ?? []);
  if (!pts.length) return [];
  const dim = pts[0].length || 1;
  const normalized = pts.map((p) => (p.length === dim ? p : new Array(dim).fill(0)));
  const n = normalized.length;
  const k = Math.max(1, Math.round(n / Math.max(2, targetSize)));
  const res = kmeans(normalized, k, seed);
  const assign = res.assignments.slice();
  const d2 = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  const centroidOf = (c: number) => {
    const idx = assign.map((a, i) => (a === c ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) return null;
    return normalized[0].map((_, d) => idx.reduce((s, i) => s + normalized[i][d], 0) / idx.length);
  };
  const size = (c: number) => assign.filter((a) => a === c).length;
  const maxSize = targetSize + 1;
  const kk = Math.max(...assign) + 1;
  for (let guard = 0; guard < n * kk; guard++) {
    const over = [...Array(kk).keys()].find((c) => size(c) > maxSize);
    if (over === undefined) break;
    const cen = centroidOf(over)!;
    const idx = assign.map((a, i) => (a === over ? i : -1)).filter((i) => i >= 0);
    const mover = idx.sort((x, y) => d2(normalized[y], cen) - d2(normalized[x], cen))[0];
    const targets = [...Array(kk).keys()].filter((c) => c !== over && size(c) < maxSize && centroidOf(c));
    if (!targets.length) break;
    targets.sort((a, b) => d2(normalized[mover], centroidOf(a)!) - d2(normalized[mover], centroidOf(b)!));
    assign[mover] = targets[0];
  }
  for (let c = 0; c < kk; c++) {
    if (size(c) === 1 && kk > 1) {
      const i = assign.indexOf(c);
      const others = [...Array(kk).keys()].filter((o) => o !== c && size(o) > 0);
      others.sort((a, b) => d2(normalized[i], centroidOf(a)!) - d2(normalized[i], centroidOf(b)!));
      if (others.length) assign[i] = others[0];
    }
  }
  const groups: FormedGroup[] = [];
  for (let c = 0; c < kk; c++) {
    const idx = assign.map((a, i) => (a === c ? i : -1)).filter((i) => i >= 0);
    if (!idx.length) continue;
    groups.push({
      memberIds: idx.map((i) => members[i].id),
      centroid: centroidOf(c) ?? new Array(dim).fill(0),
      formedBy: "auto",
      label: "",
    });
  }
  groups.sort((a, b) => a.centroid[0] - b.centroid[0]);
  if (groups.length < 2 && members.length >= 2) {
    const order = members.map((m, i) => ({ id: m.id, v: normalized[i][0] ?? 0 })).sort((a, b) => a.v - b.v);
    const cut = Math.ceil(order.length / 2);
    const halves = [order.slice(0, cut), order.slice(cut)];
    groups.length = 0;
    for (const half of halves) {
      if (!half.length) continue;
      const ids = half.map((x) => x.id);
      const pts2 = ids.map((id) => coordsById[id] ?? new Array(dim).fill(0));
      groups.push({
        memberIds: ids,
        centroid: Array.from({ length: dim }, (_, d) => pts2.reduce((s, p) => s + (p[d] ?? 0), 0) / pts2.length),
        formedBy: "auto",
        label: "",
      });
    }
  }
  return groups.map((g, i) => ({ ...g, label: groupLabel(lang, i + 1) }));
}

export function recomputeCentroid(
  group: { memberIds: string[]; centroid: number[] },
  coords: Record<string, number[]>,
) {
  const pts = group.memberIds.map((id) => coords[id] ?? []);
  const dim = pts[0]?.length ?? group.centroid.length;
  group.centroid = Array.from(
    { length: dim },
    (_, d) => pts.reduce((s, p) => s + (p[d] ?? 0), 0) / Math.max(1, pts.length),
  );
}

export function pairGroups(groups: { id: string; centroid: number[] }[]) {
  const d2 = (a: number[], b: number[]) => a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0);
  const edges: [number, number, number][] = [];
  for (let i = 0; i < groups.length; i++) {
    for (let j = i + 1; j < groups.length; j++) edges.push([d2(groups[i].centroid, groups[j].centroid), i, j]);
  }
  edges.sort((x, y) => y[0] - x[0]);
  const used = new Set<number>();
  const pairs: [string, string][] = [];
  for (const [, i, j] of edges) {
    if (!used.has(i) && !used.has(j)) {
      used.add(i);
      used.add(j);
      pairs.push([groups[i].id, groups[j].id]);
    }
  }
  const bye = groups.find((_, i) => !used.has(i))?.id ?? null;
  return { pairs, bye };
}

export function tally(votes: Record<string, string>, memberIds: string[]) {
  const t = { endorse: 0, revise: 0, oppose: 0, total: memberIds.length, cast: 0 };
  for (const id of memberIds) {
    const v = votes[id];
    if (v === "endorse" || v === "revise" || v === "oppose") t[v]++;
  }
  t.cast = t.endorse + t.revise + t.oppose;
  return t;
}

export function refreshStatuses(args: any[], memberIds: string[]) {
  for (const a of args) {
    if (a.kind !== "claim") continue;
    const votes = parseJson<Record<string, string>>(a.votes, {});
    const t = tally(votes, memberIds);
    if (t.cast < Math.ceil(t.total * 0.6)) a.status = "active";
    else {
      const dis = t.oppose + t.revise;
      if (t.oppose / t.total >= 0.6) a.status = "dropped";
      else if (t.revise / t.total >= 0.5) a.status = "revised";
      else if (dis / t.total >= 0.4 && dis >= 2) a.status = "contested";
      else a.status = "active";
    }
  }
}

export async function ensureGroupArguments(
  db: Db,
  activity: ActivityRow,
  group: any,
  lang: Lang = "zh",
): Promise<any[]> {
  const existing = await all(db, "SELECT * FROM group_arguments WHERE group_id = $gid ORDER BY seq", { gid: group.id });
  if (existing.length) return existing;
  const axes = parseJson<Axis[]>(activity.axes, []);
  const memberIds = parseJson<string[]>(group.member_ids, []);
  const positions = (
    await Promise.all(
      memberIds.map((id) =>
        one<any>(db, "SELECT * FROM positions WHERE activity_id = $aid AND student_id = $sid", {
          aid: activity.id,
          sid: id,
        }),
      ),
    )
  ).filter(Boolean);
  const out: any[] = [];
  let seq = 0;
  for (let i = 0; i < axes.length; i++) {
    const values = positions.map((p) => parseJson<number[]>(p.coords, [])[i] ?? 0);
    if (!values.length) continue;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    if (Math.abs(mean) < 0.2) continue;
    const sign = mean >= 0 ? 1 : -1;
    const lead = positions
      .map((p) => ({ p, v: (parseJson<number[]>(p.coords, [])[i] ?? 0) * sign }))
      .sort((x, y) => y.v - x.v)[0]?.p;
    const ax = axes[i];
    const claimId = newId("arg_");
    const toward = mean >= 0 ? ax.right : ax.left;
    const away = mean >= 0 ? ax.left : ax.right;
    const claimText =
      lang === "en"
        ? `We lean toward "${toward}" rather than "${away}" (${ax.name}).`
        : lang === "es"
          ? `Nos inclinamos por "${toward}" más que por "${away}" (${ax.name}).`
          : `我們傾向「${toward}」，而不是「${away}」（${ax.name}）`;
    out.push({
      id: claimId,
      group_id: group.id,
      kind: "claim",
      text: claimText,
      parent_id: null,
      axis_index: i,
      sign,
      status: "active",
      votes: "{}",
      countered: 0,
      seq: seq++,
    });
    if (lead?.reason) {
      out.push({
        id: newId("arg_"),
        group_id: group.id,
        kind: "reason",
        text: lead.reason,
        parent_id: claimId,
        axis_index: i,
        sign,
        status: "active",
        votes: "{}",
        countered: 0,
        seq: seq++,
      });
    }
    if (lead?.evidence) {
      out.push({
        id: newId("arg_"),
        group_id: group.id,
        kind: "evidence",
        text: lead.evidence,
        parent_id: claimId,
        axis_index: i,
        sign,
        status: "active",
        votes: "{}",
        countered: 0,
        seq: seq++,
      });
    }
  }
  if (!out.length) {
    out.push({
      id: newId("arg_"),
      group_id: group.id,
      kind: "claim",
      text:
        lang === "en"
          ? "Our position is fairly central; we are still finding common ground."
          : lang === "es"
            ? "Nuestra posición es bastante central; aún buscamos puntos en común."
            : "我們的立場比較居中，還在找出彼此的共同點",
      parent_id: null,
      axis_index: 0,
      sign: 1,
      status: "active",
      votes: "{}",
      countered: 0,
      seq: 0,
    });
  }
  await db.batch(
    out.map((row) => ({
      sql: `INSERT INTO group_arguments (id, group_id, kind, text, parent_id, axis_index, sign, status, votes, countered, seq)
       VALUES ($id, $gid, $kind, $text, $parentId, $axisIndex, $sign, $status, $votes, $countered, $seq)`,
      params: {
        id: row.id,
        gid: row.group_id,
        kind: row.kind,
        text: row.text,
        parentId: row.parent_id,
        axisIndex: row.axis_index,
        sign: row.sign,
        status: row.status,
        votes: row.votes,
        countered: row.countered,
        seq: row.seq,
      },
    })),
  );
  return await all(db, "SELECT * FROM group_arguments WHERE group_id = $gid ORDER BY seq", { gid: group.id });
}

export function counterexampleFor(activity: ActivityRow, arg: any, lang: Lang = "zh"): string {
  const axes = parseJson<Axis[]>(activity.axes, []);
  const ax = axes[arg.axis_index] ?? axes[0] ?? { left: "另一邊", right: "這一邊" };
  const opp = arg.sign >= 0 ? ax.left : ax.right;
  const mine = arg.sign >= 0 ? ax.right : ax.left;
  const cases =
    lang === "en"
      ? [
          `Suppose there were a situation in which "${opp}" were the accepted and better outcome. Would that make your claim "${mine}" fail? Explain the conditions under which it still holds.`,
          `Imagine a classmate with the opposite view who gives a real-life example showing that "${opp}" is more reasonable than "${mine}". How would you respond, and which step are you least sure about?`,
        ]
      : lang === "es"
        ? [
            `Supón una situación en la que "${opp}" fuera la opción aceptada y con mejores resultados. ¿Eso haría fallar su afirmación "${mine}"? Expliquen bajo qué condiciones sigue siendo válida.`,
            `Imaginen a un compañero con la postura opuesta que da un ejemplo cotidiano de que "${opp}" es más razonable que "${mine}". ¿Cómo responderían y qué paso les genera más dudas?`,
          ]
        : [
            `假設有一個情境，「${opp}」才是大家都接受、結果也比較好的做法。你們主張「${mine}」，這個情境會不會讓主張失效？請說明它在什麼條件下仍然成立。`,
            `想像一位跟你們立場完全相反的同學，他舉了一個生活中的例子，說明「${opp}」比「${mine}」更合理。你們會怎麼回應他，又有哪一步是你們自己也還沒有把握的？`,
          ];
  return cases[arg.id.length % cases.length];
}

const RE = {
  example:
    /例如|比如|舉例|例子|像是|假設|for example|for instance|such as|\b(suppose|imagine)\b|por ejemplo|\b(ejemplo|supongamos|imagina)\b/i,
  source:
    /根據|研究|報導|報告|統計|資料|實驗|調查|來源|新聞|according to|\b(study|studies|research|report|statistics|experiment|survey|source|news)\b|seg[uú]n|\b(estudio|estudios|investigaci[oó]n|informe|estad[ií]sticas?|experimento|encuesta|fuente|noticias?)\b/i,
  number: /\d|[一二三四五六七八九十百千萬]+(成|倍|個|次|人|年)/,
  because:
    /因為|由於|所以|因此|因而|代表|意味|\b(because|since|therefore|thus|means)\b|\b(porque|puesto que|significa)\b|ya que|por lo tanto|por eso/i,
  cond: /如果|若|假如|要是|除非|\b(if|unless|provided)\b|\bsi\b|a menos que|en caso de que/i,
  contrast: /但是|然而|不過|可是|反而|\b(but|however|yet|although)\b|\b(pero|aunque)\b|sin embargo|no obstante/i,
};

export function judgeTurn(text: string, phase: Phase, opponentText: string, lang: Lang = "zh") {
  const notes: Record<string, string> = {};
  const pick = (zh: string, en: string, es: string) => (lang === "en" ? en : lang === "es" ? es : zh);
  let evidence = 1;
  const evHits: string[] = [];
  if (text.length > 40) evidence += 1;
  if (RE.example.test(text)) {
    evidence += 1;
    evHits.push("具體例子");
  }
  if (RE.number.test(text)) {
    evidence += 1;
    evHits.push("數字");
  }
  if (RE.source.test(text)) {
    evidence += 1;
    evHits.push("出處用語");
  }
  notes.evidence = evHits.length
    ? pick(`提到了${evHits.join("、")}`, `Mentioned ${evHits.join(", ")}`, `Mencionó ${evHits.join(", ")}`)
    : pick("沒有提出具體例子或出處", "No concrete example or source", "Sin ejemplo concreto ni fuente");
  let reasoning = 1;
  const rsHits: string[] = [];
  if (RE.because.test(text)) {
    reasoning += 1;
    rsHits.push("因果連結");
  }
  if (RE.cond.test(text)) {
    reasoning += 1;
    rsHits.push("條件推論");
  }
  if ((text.match(/[。！？.!?]/g) || []).length >= 2) reasoning += 1;
  if (RE.contrast.test(text)) {
    reasoning += 1;
    rsHits.push("考慮了另一面");
  }
  notes.reasoning = rsHits.length
    ? pick(`使用了${rsHits.join("、")}`, `Used ${rsHits.join(", ")}`, `Usó ${rsHits.join(", ")}`)
    : pick("只有斷言，缺少理由", "Assertion only, no reasons", "Solo afirmación, sin razones");
  let rebuttal: number | null = null;
  if ((phase === "cross" || phase === "rebuttal") && opponentText) {
    const grams = new Set<string>();
    for (let i = 0; i < opponentText.length - 1; i++) grams.add(opponentText.slice(i, i + 2));
    let hit = 0;
    for (let i = 0; i < text.length - 1; i++) if (grams.has(text.slice(i, i + 2))) hit++;
    const ratio = hit / Math.max(8, text.length);
    rebuttal =
      1 +
      (ratio > 0.12 ? 1 : 0) +
      (ratio > 0.22 ? 1 : 0) +
      (/對方|你們|剛才|提到|\b(you|your|they|their|mentioned|earlier)\b|ustedes|mencion|dijeron|antes/i.test(text)
        ? 1
        : 0) +
      (RE.contrast.test(text) ? 1 : 0);
    notes.rebuttal =
      rebuttal >= 3
        ? pick("有引用並回應對方的說法", "Engaged with the opposing argument", "Respondió al argumento contrario")
        : pick(
            "和對方的論點連結不多",
            "Weak connection to the opposing argument",
            "Poca conexión con el argumento contrario",
          );
  }
  let clarity = 3;
  if (text.length >= 20 && text.length <= 220) clarity += 1;
  if (/[，。,.]/.test(text)) clarity += 1;
  if (text.length < 12) clarity -= 2;
  if (text.length > 320) clarity -= 1;
  notes.clarity =
    text.length < 12
      ? pick(
          "太短，看不出完整的想法",
          "Too short to show a complete idea",
          "Demasiado corto para mostrar una idea completa",
        )
      : text.length > 320
        ? pick("偏長，重點可以再收斂", "A bit long; tighten the focus", "Algo largo; conviene enfocar mejor")
        : pick("長度適中、句子完整", "Good length, complete sentences", "Longitud adecuada y frases completas");
  const s = (v: number | null) => (v === null ? null : clamp(v, 0, 5));
  return {
    scores: { evidence: s(evidence), reasoning: s(reasoning), rebuttal: s(rebuttal), clarity: s(clarity) },
    notes,
    verifiability: RE.source.test(text)
      ? "sourced"
      : RE.example.test(text) || RE.number.test(text)
        ? "checkable"
        : "unverified",
  };
}

export function averageScores(judgments: any[]) {
  const keys = ["evidence", "reasoning", "rebuttal", "clarity"] as const;
  const out: Record<string, number | null> = {};
  for (const key of keys) {
    const values = judgments
      .map((j) => parseJson<Record<string, number | null>>(j.scores, {})[key])
      .filter((v): v is number => typeof v === "number");
    out[key] = values.length ? values.reduce((s, v) => s + v, 0) / values.length : null;
  }
  const vals = Object.values(out).filter((v): v is number => typeof v === "number");
  out.overall = vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : null;
  return out;
}

export function computeScore(input: {
  position: any | null;
  chatCount: number;
  votesCast: number;
  groupHasActive: boolean;
  turnJudgments: any[];
  sideAvg: number | null;
}) {
  let individual = 0;
  if (input.position?.confirmed) {
    individual += 60;
    const filled = ["claim", "reason", "evidence"].filter((k) => input.position[k]).length;
    individual += filled * (40 / 3);
  }
  const team = clamp(
    Math.min(input.chatCount, 4) * 10 + Math.min(input.votesCast, 4) * 10 + (input.groupHasActive ? 20 : 0),
    0,
    100,
  );
  let debate = 0;
  const mine = averageScores(input.turnJudgments).overall;
  if (mine !== null) debate = (mine / 5) * 100;
  else if (input.sideAvg !== null) debate = (input.sideAvg / 5) * 100 * 0.8;
  return { individual: Math.round(individual), team: Math.round(team), debate: Math.round(debate) };
}

export function weightedTotal(s: { individual: number; team: number; debate: number; adjust: number }) {
  const weights = { individual: 30, team: 30, debate: 40 };
  return Math.round(
    (s.individual * weights.individual + s.team * weights.team + s.debate * weights.debate) / 100 + s.adjust,
  );
}

export function phaseOf(idx: number): Phase | "ended" {
  return idx >= PHASES.length ? "ended" : PHASES[idx];
}

export function now(): string {
  return nowIso();
}

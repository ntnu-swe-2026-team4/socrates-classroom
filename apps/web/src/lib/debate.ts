import type { ArgumentStatus, CriterionKey, GroupArgument, Phase, Vote } from "@/api";

/** 組別顏色（星圖與各處共用，順序 = 組別順序） */
export const GROUP_COLORS = ["#d9855a", "#5fae8e", "#7a8fd6", "#c9a15a", "#b27ac0", "#5ab1c2", "#c96f8f", "#9aa66a"];
export const groupColor = (i: number) => GROUP_COLORS[i % GROUP_COLORS.length];

export const PHASES: Phase[] = ["opening", "cross", "rebuttal", "closing"];
export const PHASE_NAME: Record<Phase | "ended", string> = { opening: "開場", cross: "質詢", rebuttal: "反駁", closing: "結辯", ended: "結束" };
export const ROLE_NAME = { ask: "提問", answer: "回答", speak: "" } as const;
export const SIDE_NAME = { a: "A 方", b: "B 方" } as const;
export const STATUS_NAME: Record<ArgumentStatus, string> = { active: "保留", revised: "修改中", dropped: "已放棄", contested: "有分歧" };
export const VERIFY_NAME = { sourced: "有出處用語", checkable: "有例子可查", unverified: "尚未提供" } as const;
export const CRITERIA: { key: CriterionKey; name: string; hint: string }[] = [
  { key: "evidence", name: "證據品質", hint: "有沒有具體例子、來源或可查核的資料" },
  { key: "reasoning", name: "推理", hint: "從證據到結論的推導是否清楚" },
  { key: "rebuttal", name: "回應", hint: "有沒有正面回應對方的論點" },
  { key: "clarity", name: "表達", hint: "論點是否清楚、長度適中" },
];

export function tally(arg: GroupArgument, memberIds: string[]) {
  const t: Record<Vote, number> = { endorse: 0, revise: 0, oppose: 0 };
  for (const id of memberIds) { const v = arg.votes[id]; if (v) t[v]++; }
  return { ...t, total: memberIds.length };
}

export const fmt = (v: number | null | undefined, d = 1) => (v === null || v === undefined ? "—" : v.toFixed(d));

/** 一組評分的各項平均（null 的不計）；老師覆寫的整體分會取代原本的分數 */
export function avgScores(js: { scores: Record<CriterionKey, number | null>; teacherScore: number | null }[]) {
  const out: Record<string, number | null> = {};
  const vals: number[] = [];
  for (const c of CRITERIA) {
    const v = js.map((j) => (j.scores[c.key] === null ? null : j.teacherScore ?? j.scores[c.key])).filter((x): x is number => x !== null);
    out[c.key] = v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
    if (out[c.key] !== null) vals.push(out[c.key]!);
  }
  out.overall = vals.length ? vals.reduce((s, x) => s + x, 0) / vals.length : null;
  return out as Record<CriterionKey | "overall", number | null>;
}

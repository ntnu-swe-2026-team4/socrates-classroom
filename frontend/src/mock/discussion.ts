/**
 * 多人討論的「假後端」：老師出一題，每位同學各自跟 AI 蘇格拉底對話，老師看全班的討論成果。
 *
 * 全部存在記憶體（重整就消失）。模擬同學的對話是由「題目 id + 同學名字」決定的種子產生的
 * 範本句子，不是真正的 LLM；真正登入的那位學生如果有設 OpenRouter 的 key，會問真的 AI
 * （見 mock.ts 的 llmReply 與 frontend/dev/llm-bridge.ts）。
 *
 * 真後端上線後整個 src/mock 都可以刪掉。
 */
import { mulberry32, hashSeed } from "@/lib/star/data";
import { coverage } from "./debate-ai";
import { tr } from "@/i18n";
import type {
  Coverage, DialogueMessage, DiscussionSession, DiscussionSessionDetail, DiscussionSessionStatus,
  DiscussionStats, DiscussionStatus, DiscussionTask, DiscussionTaskInput,
} from "@/api/types";

export interface StoredSession {
  studentId: string;
  studentName: string;
  messages: DialogueMessage[];
  conclusion: string | null;
  submittedAt: string | null;
  lastActiveAt: string | null;
  simulated: boolean;
}

export interface StoredDiscussion {
  id: string;
  classroomId: string;
  title: string;
  prompt: string;
  conclusionHint: string;
  dueAt: string | null;
  maxRounds: number;
  status: DiscussionStatus;
  createdAt: string;
  updatedAt: string;
  /** studentId → 那位同學的對話 */
  sessions: Map<string, StoredSession>;
}

export const discussions: StoredDiscussion[] = [];
const now = () => new Date().toISOString();
let seq = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${seq++}`;

/* ---------------- 模擬同學的對話 ---------------- */
/** 同學可能說的話：由種子挑選、串成一段看起來合理的對話 */
const OPENERS = [
  "我第一個想法是：這要看我們在意的是結果，還是在意有沒有守住原則。",
  "直覺上我會說是，但我說不太出來為什麼，好像只是因為大家都這樣講。",
  "我覺得這題的關鍵在於「誰來決定」，而不是答案本身。",
  "我想先把題目裡的詞定義清楚，不然很容易各說各話。",
  "我的立場偏向反對，因為我想到幾個反例。",
];
const MIDDLES = [
  "因為如果每個人都可以自己決定例外，那規則就等於沒有用了。",
  "我舉一個例子：班上訂班規的時候，沒有參與討論的人最容易破壞規則。",
  "可是我剛剛那樣講，好像會推導出一個我自己也不接受的結論。",
  "我想補充一點：短期看起來有效的做法，長期可能反而讓人不信任制度。",
  "也許我應該把「公平」跟「平等」分開講，這兩個我剛剛混在一起了。",
  "新聞上那種爭議案件，兩邊其實各有一部分道理，所以我沒辦法只選一邊。",
  "我同意你的追問——我原本的說法沒有處理到「如果對方不同意」的情況。",
];
const CLOSERS = [
  "所以我現在的結論是：原則要先講清楚，但要留下說明理由的空間。",
  "聊完之後我把立場往中間修了一點，因為我發現我的理由不夠支撐原本的說法。",
  "我還是維持原本的立場，不過理由換了一個我自己更站得住腳的。",
  "我發現我真正在意的是「決定過程有沒有讓人參與」，而不是最後選哪一邊。",
];
/** AI 蘇格拉底的追問（跟其他階段用的是同一套範本） */
const SOCRATIC = [
  "有意思。但你剛才那句話裡，有沒有哪個詞，其實你自己也還沒完全想清楚是什麼意思？",
  "換個角度想：如果反過來看，你剛剛的說法還會成立嗎？",
  "你會怎麼跟一個完全不同意你的人，解釋你為什麼這樣想？",
  "假設有一個例外情況，你的說法在那個情況下還站得住腳嗎？",
  "你說的這件事，是你自己觀察到的，還是別人告訴你的？這兩者對你來說有差別嗎？",
  "如果把你剛剛的理由推到底，會得到什麼結論？你接受那個結論嗎？",
];
const CONCLUSIONS = [
  "我的結論是：這題沒有單一答案，但判斷時要先問「這個決定是誰做的、理由能不能攤開來講」。原本我只看結果，聊完之後我認為過程同樣重要。",
  "我主張原則上應該成立，但必須允許例外，而且例外要能用同一套理由解釋得通，不能是個案開後門。",
  "聊完我改變了立場。一開始我覺得答案很明顯，後來發現我的理由只適用在我熟悉的情境，換個情境就不成立了。",
  "我的結論是反對。最主要的理由是：這個做法把成本轉給最沒有辦法拒絕的人，而他們沒有參與決定。",
];

const pick = <T,>(rng: () => number, xs: T[]) => xs[(rng() * xs.length) | 0];

/** 依「題目 + 同學」產生一段固定的對話；rounds = 0 代表這位同學還沒開始 */
function simulate(taskId: string, studentId: string, studentName: string, maxRounds: number): StoredSession {
  const rng = mulberry32(hashSeed(`${taskId}:${studentId}`));
  const roll = rng();
  // 約 2 成還沒開始、3 成在對話中、5 成已經送出結論
  const rounds = roll < 0.2 ? 0 : Math.max(1, Math.min(maxRounds, 2 + ((rng() * 6) | 0)));
  const submitted = rounds > 0 && roll >= 0.5;
  const messages: DialogueMessage[] = [];
  const base = Date.now() - (1 + rng() * 3) * 864e5;
  const at = (i: number) => new Date(base + i * 7 * 60_000).toISOString();
  for (let i = 0; i < rounds; i++) {
    const text = i === 0 ? pick(rng, OPENERS) : i === rounds - 1 && rounds > 2 ? pick(rng, CLOSERS) : pick(rng, MIDDLES);
    messages.push({ id: `${studentId}-u${i}`, role: "user", text: tr(text), at: at(i * 2) });
    messages.push({ id: `${studentId}-a${i}`, role: "assistant", text: tr(SOCRATIC[(i + ((rng() * 3) | 0)) % SOCRATIC.length]), at: at(i * 2 + 1) });
  }
  return {
    studentId, studentName, messages, simulated: true,
    conclusion: submitted ? tr(pick(rng, CONCLUSIONS)) : null,
    submittedAt: submitted ? at(rounds * 2) : null,
    lastActiveAt: rounds ? at(rounds * 2) : null,
  };
}

/* ---------------- 讀取與統計 ---------------- */
const statusOf = (s: StoredSession): DiscussionSessionStatus =>
  s.conclusion !== null ? "submitted" : s.messages.length ? "talking" : "todo";

const coverageOf = (s: StoredSession): Coverage =>
  coverage(s.messages.filter((m) => m.role === "user").map((m) => m.text)) as Coverage;

export const roundsOf = (s: StoredSession) => s.messages.filter((m) => m.role === "user").length;

const toSession = (d: StoredDiscussion, s: StoredSession, meId: string): DiscussionSession => ({
  id: `${d.id}:${s.studentId}`, taskId: d.id, studentId: s.studentId, studentName: s.studentName,
  status: statusOf(s), rounds: roundsOf(s), conclusion: s.conclusion, submittedAt: s.submittedAt,
  lastActiveAt: s.lastActiveAt, coverage: coverageOf(s), simulated: s.simulated, isMe: s.studentId === meId,
});

export const toSessionDetail = (d: StoredDiscussion, s: StoredSession, meId: string): DiscussionSessionDetail =>
  ({ ...toSession(d, s, meId), messages: s.messages.map((m) => ({ ...m })) });

function stats(d: StoredDiscussion): DiscussionStats {
  const all = [...d.sessions.values()];
  const started = all.filter((s) => s.messages.length);
  const rounds = started.reduce((n, s) => n + roundsOf(s), 0);
  return {
    total: all.length,
    started: started.length,
    submitted: all.filter((s) => s.conclusion !== null).length,
    avgRounds: started.length ? Math.round((rounds / started.length) * 10) / 10 : 0,
  };
}

/** 傳給前端的題目；myId 有值（學生）時附上自己的進度 */
export function toTask(d: StoredDiscussion, myId: string | null): DiscussionTask {
  const mine = myId ? d.sessions.get(myId) : undefined;
  return {
    id: d.id, classroomId: d.classroomId, title: d.title, prompt: d.prompt, conclusionHint: d.conclusionHint,
    dueAt: d.dueAt, maxRounds: d.maxRounds, status: d.status, createdAt: d.createdAt, updatedAt: d.updatedAt,
    stats: stats(d), ...(myId ? { myStatus: mine ? statusOf(mine) : ("todo" as const) } : {}),
  };
}

export const listSessions = (d: StoredDiscussion, meId: string) =>
  [...d.sessions.values()]
    .sort((a, b) => Number(b.studentId === meId) - Number(a.studentId === meId) || a.studentName.localeCompare(b.studentName))
    .map((s) => toSession(d, s, meId));

/* ---------------- 建立與修改 ---------------- */
export function createDiscussion(classroomId: string, input: DiscussionTaskInput, students: string[], meName: string, meId: string, id?: string): StoredDiscussion {
  const at = now();
  const d: StoredDiscussion = {
    id: id ?? newId("dq"), classroomId, title: input.title, prompt: input.prompt, conclusionHint: input.conclusionHint,
    dueAt: input.dueAt, maxRounds: input.maxRounds, status: "open", createdAt: at, updatedAt: at, sessions: new Map(),
  };
  // 教室裡的每位同學各有一段對話：登入的那位從空的開始，其他人用模擬的
  for (const name of students) {
    if (name === meName) continue;
    const sid = `sim-${hashSeed(name).toString(36)}`;
    d.sessions.set(sid, simulate(d.id, sid, name, d.maxRounds));
  }
  d.sessions.set(meId, { studentId: meId, studentName: meName, messages: [], conclusion: null, submittedAt: null, lastActiveAt: null, simulated: false });
  discussions.push(d);
  return d;
}

export function findDiscussion(id: string): StoredDiscussion {
  const d = discussions.find((x) => x.id === id);
  if (!d) throw new Error(tr("找不到討論"));
  return d;
}

/** 自己的那段對話（還沒有就開一段新的） */
export function mySession(d: StoredDiscussion, meId: string, meName: string): StoredSession {
  let s = d.sessions.get(meId);
  if (!s) d.sessions.set(meId, (s = { studentId: meId, studentName: meName, messages: [], conclusion: null, submittedAt: null, lastActiveAt: null, simulated: false }));
  return s;
}

export function removeDiscussion(id: string) {
  const i = discussions.findIndex((x) => x.id === id);
  if (i >= 0) discussions.splice(i, 1);
}

export { now as discussionNow };

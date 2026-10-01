import type { Api } from "./api";
import type {
  Announcement, Archive, Classroom, ClassroomMember, ClassroomPreview, ClassroomTopic, CreateActivityInput, JoinApplication,
  JoinPolicy, TopicResource, User,
} from "./types";
import * as E from "@/mock/engine";

/**
 * 示範用的假後端（全部在記憶體，重整就消失）。
 * 認證、議題、教室在這裡；辯論的整套流程（對話、分組、比賽、計分、星圖）在 src/mock/engine.ts。
 * 真後端上線後，整個 src/mock 與這個檔案都可以刪掉。
 */
const delay = (ms = 120) => new Promise((r) => setTimeout(r, ms));

let user: User | null = null;

const archives: Archive[] = [
  { id: "a1", title: "正義是否只是強者的利益？", date: "今天 14:20", rounds: 12, bank: "public", inSummary: false,
    snippet: "我一開始認為強者說了算，但後來發現「強者也可能誤判自己的利益」這件事把我的論點推翻了一半。" },
  { id: "a2", title: "我們該不該永遠說實話？", date: "9 月 10 日", rounds: 8, bank: null, inSummary: false,
    snippet: "蘇格拉底一直追問「救人一命」跟「誠實」哪個才是更根本的原則，我後來也說不清楚了。" },
  { id: "a3", title: "忒修斯之船：改變了多少才不是原來的你？", date: "9 月 3 日", rounds: 15, bank: null, inSummary: false,
    snippet: "從一片木板到整艘船，我發現「同一性」比我想的更依賴我們怎麼定義它。" },
];

/**
 * 假後端只有一位學生（名字固定為「你」）：joined = 已加入；invited = 老師邀請了、還沒回應；
 * 兩者都不是的教室，學生只能從「探索教室」或邀請碼找到。老師只看得到自己（同名）開的教室。
 */
type StoredClassroom = Classroom & { students: string[]; invited?: boolean };
const ME = "你";
const classrooms: StoredClassroom[] = [
  { id: "c1", name: "高二哲學選修 A", description: "從柏拉圖《理想國》出發，練習用提問把自己的想法說清楚。", teacherName: "林老師",
    studentCount: 5, debateCount: 1, joined: true, students: ["王○安", "李○恩", "陳○宇", "林○彤", "吳○哲"] },
  { id: "c2", name: "高二哲學選修 B", description: "", teacherName: "陳老師", studentCount: 0, debateCount: 0, joined: false, invited: true, students: [] },
  { id: "c3", name: "大學先修：邏輯與論證", description: "認識常見的謬誤，練習把一段論證拆成前提與結論。開放所有高中生加入。", teacherName: "張老師",
    studentCount: 3, debateCount: 0, joined: false, students: ["周○妤", "鄭○翰", "許○晴"] },
  { id: "c4", name: "倫理學讀書會", description: "每週讀一篇倫理學經典，名額有限，請簡單說明你想參加的原因。", teacherName: "林老師",
    studentCount: 2, debateCount: 0, joined: false, students: ["蔡○彥", "郭○廷"] },
];

/* 加入設定與申請 */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉容易看錯的 0 / O / 1 / I
const newCode = () => Array.from({ length: 6 }, () => CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]).join("");
const defaultPolicy = (): JoinPolicy => ({ code: newCode(), codeEnabled: true, discoverable: false, requireApproval: false, questionnaire: [] });
const READING_QUESTIONS: JoinPolicy["questionnaire"] = [
  { id: "q1", prompt: "你為什麼想參加這個讀書會？", kind: "paragraph", required: true },
  { id: "q2", prompt: "你讀過哪些哲學或倫理學的書？", kind: "text", required: false },
  { id: "q3", prompt: "每週能固定參加嗎？", kind: "choice", options: ["可以", "大部分可以", "不一定"], required: true },
];
const policies = new Map<string, JoinPolicy>([
  ["c1", { code: "PLATO7", codeEnabled: true, discoverable: false, requireApproval: false, questionnaire: [] }],
  ["c2", defaultPolicy()],
  ["c3", { code: "LOGIC3", codeEnabled: true, discoverable: true, requireApproval: false, questionnaire: [] }],
  ["c4", { code: "ETHIC5", codeEnabled: true, discoverable: true, requireApproval: true, questionnaire: READING_QUESTIONS }],
]);
const policyOf = (cid: string) => {
  let p = policies.get(cid);
  if (!p) policies.set(cid, (p = defaultPolicy()));
  return p;
};
const applications: JoinApplication[] = [
  { id: "ap1", classroomId: "c4", classroomName: "倫理學讀書會", studentId: "s7", studentName: "黃○婷", status: "pending", createdAt: new Date(Date.now() - 2 * 864e5).toISOString(),
    reviewedAt: null, note: null, answers: [
      { questionId: "q1", prompt: READING_QUESTIONS[0].prompt, answer: "上學期讀了《正義：一場思辨之旅》，想找人一起討論。" },
      { questionId: "q2", prompt: READING_QUESTIONS[1].prompt, answer: "桑德爾《正義》、《蘇菲的世界》" },
      { questionId: "q3", prompt: READING_QUESTIONS[2].prompt, answer: "可以" },
    ] },
  { id: "ap2", classroomId: "c4", classroomName: "倫理學讀書會", studentId: "s8", studentName: "劉○安", status: "pending", createdAt: new Date(Date.now() - 864e5).toISOString(),
    reviewedAt: null, note: null, answers: [
      { questionId: "q1", prompt: READING_QUESTIONS[0].prompt, answer: "想準備哲學系的申請。" },
      { questionId: "q2", prompt: READING_QUESTIONS[1].prompt, answer: "" },
      { questionId: "q3", prompt: READING_QUESTIONS[2].prompt, answer: "大部分可以" },
    ] },
];
const MY_ID = "s1";
const findApplication = (id: string) => {
  const a = applications.find((x) => x.id === id);
  if (!a) throw new Error("找不到申請");
  return a;
};
const myLatestApplication = (cid: string) => applications.filter((a) => a.classroomId === cid && a.studentId === MY_ID).at(-1) ?? null;
const preview = (c: StoredClassroom): ClassroomPreview => {
  const p = policyOf(c.id);
  return { id: c.id, name: c.name, description: c.description, teacherName: c.teacherName, studentCount: c.students.length,
    requireApproval: p.requireApproval, questionnaire: p.requireApproval ? structuredClone(p.questionnaire) : [],
    joined: !!c.joined, myApplication: myLatestApplication(c.id)?.status ?? null };
};

const STATUS = [
  { on: true, last: "今天 14:32", pct: 82 }, { on: false, last: "昨天 09:10", pct: 56 }, { on: true, last: "今天 13:47", pct: 95 },
  { on: false, last: "9 月 8 日", pct: 31 }, { on: true, last: "今天 10:02", pct: 67 },
];
const memberRows = (c: { id: string; students: string[] }): ClassroomMember[] =>
  c.students.map((name, i) => ({ id: c.id + "-" + i + "-" + name, name, online: STATUS[i % 5].on, lastActive: STATUS[i % 5].last, progress: STATUS[i % 5].pct }));
const findClassroom = (id: string) => {
  const c = classrooms.find((x) => x.id === id);
  if (!c) throw new Error("找不到教室");
  return c;
};
const pub = ({ students: _s, invited: _i, ...c }: StoredClassroom): Classroom => ({ ...c, studentCount: _s.length, debateCount: E.acts.filter((a) => a.classroomId === c.id).length });

const DEMO_AXES = [
  { name: "正義來源", left: "約定", right: "本性" },
  { name: "判準", left: "結果", right: "動機" },
  { name: "權力", left: "警惕", right: "信任" },
];
E.createActivity(classrooms[0], { title: "第 1 場辯論", statement: "正義是否只是強者的利益？", answerMode: "both", groupSize: 3, axes: DEMO_AXES }, "d1");

/* 教室議題：團體議題對應 engine 裡的辯論活動；個人議題的對話存在 archives（topicId 指回議題） */
const iso = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 864e5).toISOString();
const topics: ClassroomTopic[] = [
  { id: "t1", classroomId: "c1", type: "group", title: "正義是否只是強者的利益？", activityId: "d1", acceptsReports: false, postCount: 0,
    description: "《理想國》第一卷，色拉敘馬霍斯主張「正義就是強者的利益」。先各自和蘇格拉底對話釐清立場，再分組辯論。",
    dueAt: iso(7), resources: [{ id: "r1", kind: "link", name: "《理想國》第一卷導讀", url: "https://zh.wikipedia.org/wiki/理想國", addedAt: iso(-3) }],
    createdAt: iso(-3), updatedAt: iso(-3) },
  { id: "t2", classroomId: "c1", type: "individual", title: "我們該不該永遠說實話？", activityId: null, acceptsReports: true, postCount: 0,
    description: "康德認為說謊在任何情況下都是錯的，即使門口的殺人犯問你朋友躲在哪裡。你同意嗎？和蘇格拉底聊聊你的理由。",
    dueAt: iso(14), resources: [], createdAt: iso(-1), updatedAt: iso(-1) },
];
E.findAct("d1").topicId = "t1";
const topicArchive = new Map<string, string>(); // topicId → archiveId（假後端只有一位學生）
const findTopic = (id: string) => {
  const t = topics.find((x) => x.id === id);
  if (!t) throw new Error("找不到議題");
  return t;
};
const touch = (t: ClassroomTopic) => { t.updatedAt = new Date().toISOString(); };
let seq = 0;
const newId = (p: string) => `${p}${Date.now().toString(36)}${seq++}`;

/* 公告：published 由讀取當下的時間計算，學生只拿得到已發布的 */
type StoredAnnouncement = Omit<Announcement, "published">;
const announcements: StoredAnnouncement[] = [
  { id: "an1", classroomId: "c1", title: "期中辯論的評分方式", pinned: true, authorName: "林老師", publishAt: iso(-5), createdAt: iso(-5), updatedAt: iso(-5),
    body: "期中辯論占學期成績 30%：\n・個人調查 30%\n・團隊提純 30%\n・辯論比賽 40%\n\nAI 裁判的分數僅供參考，最後由老師確認。" },
  { id: "an2", classroomId: "c1", title: "下週請先讀完《理想國》第一卷", pinned: false, authorName: "林老師", publishAt: iso(-1), createdAt: iso(-1), updatedAt: iso(-1),
    body: "議題「正義是否只是強者的利益？」的閱讀材料已放在議題頁，上課前請先讀完。" },
  { id: "an3", classroomId: "c1", title: "第二場辯論開放報名", pinned: false, authorName: "林老師", publishAt: iso(3), createdAt: iso(0), updatedAt: iso(0),
    body: "（排程中的公告：學生要到發布時間才看得到）" },
];
const toAnnouncement = (a: StoredAnnouncement): Announcement => ({ ...a, published: new Date(a.publishAt).getTime() <= Date.now() });
const findAnnouncement = (id: string) => {
  const a = announcements.find((x) => x.id === id);
  if (!a) throw new Error("找不到公告");
  return a;
};

const topicDialogues = new Map<string, import("./types").DialogueMessage[]>();
const TOPIC_REPLIES = [
  "有意思。但你剛才那句話裡，有沒有哪個詞，其實你自己也還沒完全想清楚是什麼意思？",
  "換個角度想：如果反過來看，你剛剛的說法還會成立嗎？",
  "你會怎麼跟一個完全不同意你的人，解釋你為什麼這樣想？",
  "假設有一個例外情況，你的說法在那個情況下還站得住腳嗎？",
  "你說的這件事，是你自己觀察到的，還是別人告訴你的？這兩者對你來說有差別嗎？",
];

const isTeacher = () => user?.role === "teacher";
const needStudent = () => { if (isTeacher()) throw new Error("只有學生可以這樣做"); };
const join = (c: StoredClassroom) => {
  c.joined = true;
  c.invited = false;
  if (!c.students.includes(ME)) c.students.push(ME);
};
const MAX_UPLOAD = 50 * 1024 * 1024;
const needTeacher = () => { if (!isTeacher()) throw new Error("只有老師可以這樣做"); };
const roomAct = (id: string) => E.findRoom(id);

export const mockApi: Api = {
  async login({ role, name }) {
    await delay();
    user = { id: role === "teacher" ? "t1" : "s1", name: name || (role === "teacher" ? "林老師" : "訪客"), role };
    return user;
  },
  async me() { await delay(30); return user; },
  async logout() { user = null; },

  async listArchives() { await delay(); return archives.map((a) => ({ ...a })); },
  async updateArchive(id, patch) {
    await delay(60);
    const a = archives.find((x) => x.id === id);
    if (!a) throw new Error("找不到議題");
    if (patch.bank !== undefined) a.bank = patch.bank;
    if (patch.inSummary !== undefined) a.inSummary = patch.inSummary;
    return { ...a };
  },

  async createArchive(title) {
    await delay(60);
    const a: Archive = { id: "n" + (archives.length + 1), title, date: "剛剛", rounds: 0, bank: null, inSummary: false, snippet: "（剛開始的對話）" };
    archives.unshift(a);
    return { ...a };
  },
  async listTopicDialogue(id) { await delay(30); return [...(topicDialogues.get(id) ?? [])]; },
  async sendTopicDialogue(id, text, onDelta) {
    const list = topicDialogues.get(id) ?? [];
    topicDialogues.set(id, list);
    list.push({ id: "u" + list.length, role: "user", text, at: new Date().toISOString() });
    const reply = TOPIC_REPLIES[list.filter((m) => m.role === "assistant").length % TOPIC_REPLIES.length];
    for (let i = 0; i < reply.length; i += 4) { await delay(25); onDelta?.(reply.slice(i, i + 4)); }
    const msg = { id: "a" + list.length, role: "assistant" as const, text: reply, at: new Date().toISOString() };
    list.push(msg);
    const a = archives.find((x) => x.id === id);
    if (a) a.rounds = list.filter((m) => m.role === "user").length;
    return msg;
  },

  async listClassrooms() {
    await delay();
    return classrooms.filter((c) => (isTeacher() ? c.teacherName === user?.name : c.joined || c.invited)).map(pub);
  },
  async getClassroom(id) {
    await delay(60);
    return pub(findClassroom(id));
  },
  async createClassroom({ name, description }) {
    await delay(); needTeacher();
    const c: StoredClassroom = { id: newId("c"), name, description, teacherName: user?.name ?? "老師", studentCount: 0, debateCount: 0, joined: true, students: [] };
    classrooms.push(c);
    return pub(c);
  },
  async updateClassroom(id, patch) {
    await delay(); needTeacher();
    const c = findClassroom(id);
    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new Error("教室名稱不能是空的");
      c.name = patch.name.trim();
    }
    if (patch.description !== undefined) c.description = patch.description.trim();
    return pub(c);
  },
  async acceptInvite(id) { await delay(); const c = findClassroom(id); join(c); return pub(c); },
  async declineInvite(id) { await delay(); findClassroom(id).invited = false; },
  async listClassroomMembers(id) { await delay(40); return memberRows(findClassroom(id)); },
  async addClassroomMember(id, name) {
    await delay(); needTeacher();
    const c = findClassroom(id);
    c.students.push(name);
    return memberRows(c)[c.students.length - 1];
  },
  async removeClassroomMember(id, mid) {
    await delay(); needTeacher();
    const c = findClassroom(id);
    const rows = memberRows(c);
    const i = rows.findIndex((r) => r.id === mid);
    if (i >= 0) c.students.splice(i, 1);
  },
  async listActivities(cid) { await delay(); return E.acts.filter((a) => a.classroomId === cid).map(E.toActivity); },
  async getActivity(id) { await delay(40); return E.toActivity(E.findAct(id)); },
  async createActivity(cid, input: CreateActivityInput) {
    await delay();
    needTeacher();
    const c = classrooms.find((x) => x.id === cid);
    if (!c) throw new Error("找不到教室");
    return E.toActivity(E.createActivity(c, input));
  },
  async advanceActivity(id) { await delay(); return E.toActivity(E.advance(E.findAct(id))); },

  async listDialogue(id) { await delay(30); return [...E.findAct(id).dialogue]; },
  sendDialogue: (id, text, onDelta) => E.sendDialogue(E.findAct(id), text, onDelta),
  async getProgress(id) { await delay(30); return E.progress(E.findAct(id)); },
  async draftPosition(id) { await delay(); return E.draftPosition(E.findAct(id)); },
  async confirmPosition(id, p) { await delay(); return E.confirmPosition(E.findAct(id), p); },
  async listPositions(id) { await delay(); return E.listPositions(E.findAct(id), isTeacher()); },

  async listMembers(id) { await delay(40); return E.listMembers(E.findAct(id), isTeacher(), !isTeacher()); },
  async listGroups(id) { await delay(40); const a = E.findAct(id); return a.groups.map((g: any) => E.toGroup(a, g, isTeacher())); },
  async regroup(id, size) {
    await delay(); needTeacher();
    const a = E.findAct(id);
    a.groupSize = size;
    E.formTeams(a, 42 + Math.floor(Math.random() * 1000));
    return a.groups.map((g: any) => E.toGroup(a, g, true));
  },
  async listGroupMessages(gid) {
    await delay(30);
    const a = E.acts.find((x) => x.groups.some((g: any) => g.id === gid));
    if (!a) throw new Error("找不到組別");
    return a.groupState[gid].messages.map((m: any) => E.toMessage(gid, m));
  },
  async postGroupMessage(gid, text) { const a = groupAct(gid); return E.postGroupMessage(a, gid, text); },
  async summarizeGroup(gid) { await delay(400); return E.summarize(groupAct(gid), gid); },
  async counterexample(gid) { await delay(400); return E.counterexample(groupAct(gid), gid); },
  async listArguments(gid) {
    await delay(30);
    const a = groupAct(gid);
    const st = a.groupState[gid];
    return st.args.map((x: any) => E.toArg(gid, x, st));
  },
  async vote(aid, v) {
    await delay(40);
    const a = E.acts.find((x) => x.groups.some((g: any) => x.groupState[g.id].args.some((y: any) => y.id === aid)));
    if (!a) throw new Error("找不到論點");
    return E.vote(a, aid, v);
  },
  async splitGroup(gid) { await delay(200); const a = groupAct(gid); E.splitGroup(a, gid); return a.groups.map((g: any) => E.toGroup(a, g, isTeacher())); },

  async listRooms(id) { await delay(40); const a = E.findAct(id); return a.rooms.map((r: any) => E.toRoom(a, r)); },
  async startRoom(rid) { const { a, r } = roomAct(rid); E.startRoom(a, r); return E.toRoom(a, r); },
  async listTurns(rid) {
    await delay(30);
    const { r } = roomAct(rid);
    return { turns: r.turns.map((t: any) => E.toTurn(r, t)), judgments: r.judgments.map((j: any) => E.toJudgment(r, j)) };
  },
  async postTurn(rid, text) { const { a, r } = roomAct(rid); return E.postTurn(a, r, text); },
  async overrideJudgment(jid, score) { needTeacher(); return E.overrideJudgment(jid, score); },

  async listScores(id) { await delay(40); return E.listScores(E.findAct(id), isTeacher()); },
  async adjustScore(id, memberId, adjust) { needTeacher(); return E.adjustScore(E.findAct(id), memberId, adjust); },
  async getStarData(id) { await delay(60); return E.starData(E.findAct(id)); },

  dev: {
    async simulateIndividual(id) { return E.simulateIndividual(E.findAct(id)); },
    async simulateRoom(rid) { const { a, r } = roomAct(rid); E.simulateRoom(a, r); return E.toRoom(a, r); },
    async simulateAllRooms(id) { const a = E.findAct(id); for (const r of a.rooms) if (r.status !== "finished") E.simulateRoom(a, r); },
  },

  subscribe: (id, cb) => E.subscribe(id, cb),

  /* 以下為教室功能擴充（見 docs/api-contract.md），各階段實作時再換成真正的假資料 */
  finishActivity: notYet("P8"),
  setStageDeadline: notYet("P8"),
  /* 教室議題（P4） */
  async listTopics(cid) {
    await delay();
    return topics.filter((t) => t.classroomId === cid).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((t) => structuredClone(t));
  },
  async getTopic(id) { await delay(40); return structuredClone(findTopic(id)); },
  async createTopic(cid, input) {
    await delay(); needTeacher();
    const c = findClassroom(cid);
    if (!input.title.trim()) throw new Error("請填寫議題標題");
    if (input.type === "group" && !input.activity) throw new Error("團體議題需要辯論設定");
    const at = new Date().toISOString();
    const t: ClassroomTopic = {
      id: newId("t"), classroomId: cid, type: input.type, title: input.title.trim(), description: input.description.trim(),
      dueAt: input.dueAt, acceptsReports: input.acceptsReports, activityId: null, resources: [], postCount: 0, createdAt: at, updatedAt: at,
    };
    if (input.type === "group" && input.activity) {
      const a = E.createActivity(c, { ...input.activity, title: t.title, statement: t.title });
      a.topicId = t.id;
      t.activityId = a.id;
    }
    topics.push(t);
    return structuredClone(t);
  },
  async updateTopic(id, patch) {
    await delay(); needTeacher();
    const t = findTopic(id);
    if (patch.title !== undefined && !patch.title.trim()) throw new Error("請填寫議題標題");
    if (patch.activity && t.activityId) E.updateSettings(E.findAct(t.activityId), patch.activity);
    if (patch.title !== undefined) {
      t.title = patch.title.trim();
      if (t.activityId) Object.assign(E.findAct(t.activityId), { title: t.title, statement: t.title });
    }
    if (patch.description !== undefined) t.description = patch.description.trim();
    if (patch.dueAt !== undefined) t.dueAt = patch.dueAt;
    if (patch.acceptsReports !== undefined) t.acceptsReports = patch.acceptsReports;
    touch(t);
    return structuredClone(t);
  },
  async deleteTopic(id) {
    await delay(); needTeacher();
    const t = findTopic(id);
    if (t.activityId) E.removeActivity(t.activityId);
    for (const r of t.resources) if (r.kind === "file") URL.revokeObjectURL(r.file.url);
    topics.splice(topics.indexOf(t), 1);
  },
  async addTopicLink(tid, { name, url }) {
    await delay(); needTeacher();
    if (!/^https?:\/\//.test(url.trim())) throw new Error("連結要以 http:// 或 https:// 開頭");
    const t = findTopic(tid);
    const r: TopicResource = { id: newId("r"), kind: "link", name: name.trim() || url.trim(), url: url.trim(), addedAt: new Date().toISOString() };
    t.resources.push(r); touch(t);
    return { ...r };
  },
  async uploadTopicFile(tid, file) {
    await delay(300); needTeacher();
    if (file.size > MAX_UPLOAD) throw new Error("檔案太大（上限 50 MB）");
    const t = findTopic(tid);
    // 假後端：檔案只存在這個分頁的記憶體裡，重新整理就消失
    const r: TopicResource = { id: newId("r"), kind: "file", addedAt: new Date().toISOString(),
      file: { name: file.name, url: URL.createObjectURL(file), size: file.size, mimeType: file.type || "application/octet-stream" } };
    t.resources.push(r); touch(t);
    return structuredClone(r);
  },
  async deleteTopicResource(tid, rid) {
    await delay(); needTeacher();
    const t = findTopic(tid);
    const r = t.resources.find((x) => x.id === rid);
    if (r?.kind === "file") URL.revokeObjectURL(r.file.url);
    t.resources = t.resources.filter((x) => x.id !== rid); touch(t);
  },
  async startTopicDialogue(tid) {
    await delay();
    if (isTeacher()) throw new Error("老師不能開始個人議題的對話");
    const t = findTopic(tid);
    if (t.type !== "individual") throw new Error("團體議題請從辯論活動進入");
    const existing = archives.find((a) => a.id === topicArchive.get(tid));
    if (existing) return { ...existing };
    const a: Archive = { id: newId("n"), title: t.title, date: "剛剛", rounds: 0, bank: null, inSummary: false, snippet: "（剛開始的對話）", topicId: t.id };
    archives.unshift(a);
    topicArchive.set(tid, a.id);
    return { ...a };
  },
  /* 公告（P2） */
  async listAnnouncements(cid) {
    await delay();
    return announcements.filter((a) => a.classroomId === cid).map(toAnnouncement)
      .filter((a) => isTeacher() || a.published)
      .sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.publishAt.localeCompare(a.publishAt));
  },
  async createAnnouncement(cid, input) {
    await delay(); needTeacher();
    findClassroom(cid);
    if (!input.title.trim()) throw new Error("請填寫公告標題");
    const at = new Date().toISOString();
    const a: StoredAnnouncement = { id: newId("an"), classroomId: cid, title: input.title.trim(), body: input.body.trim(), pinned: input.pinned,
      publishAt: input.publishAt ?? at, authorName: user?.name ?? "老師", createdAt: at, updatedAt: at };
    announcements.push(a);
    return toAnnouncement(a);
  },
  async updateAnnouncement(id, patch) {
    await delay(); needTeacher();
    const a = findAnnouncement(id);
    if (patch.title !== undefined) {
      if (!patch.title.trim()) throw new Error("請填寫公告標題");
      a.title = patch.title.trim();
    }
    if (patch.body !== undefined) a.body = patch.body.trim();
    if (patch.pinned !== undefined) a.pinned = patch.pinned;
    if (patch.publishAt !== undefined) a.publishAt = patch.publishAt ?? new Date().toISOString();
    a.updatedAt = new Date().toISOString();
    return toAnnouncement(a);
  },
  async deleteAnnouncement(id) {
    await delay(); needTeacher();
    announcements.splice(announcements.indexOf(findAnnouncement(id)), 1);
  },
  /* 加入教室與成員管理（P3） */
  async importClassroomMembers(cid, names) {
    await delay(); needTeacher();
    const c = findClassroom(cid);
    const result: Awaited<ReturnType<Api["importClassroomMembers"]>> = { added: [], skipped: [] };
    const seen = new Set<string>();
    for (const raw of names) {
      const name = raw.trim();
      if (!name) continue;
      if (seen.has(name)) { result.skipped.push({ name, reason: "名單裡重複" }); continue; }
      seen.add(name);
      if (c.students.includes(name)) { result.skipped.push({ name, reason: "已經在教室裡" }); continue; }
      c.students.push(name);
      result.added.push(memberRows(c)[c.students.length - 1]);
    }
    return result;
  },
  async getJoinPolicy(cid) { await delay(40); needTeacher(); findClassroom(cid); return structuredClone(policyOf(cid)); },
  async updateJoinPolicy(cid, patch) {
    await delay(); needTeacher(); findClassroom(cid);
    const p = policyOf(cid);
    if (patch.questionnaire) {
      for (const q of patch.questionnaire) {
        if (!q.prompt.trim()) throw new Error("每一題都要有題目");
        if (q.kind === "choice" && (q.options?.filter((o) => o.trim()).length ?? 0) < 2) throw new Error(`「${q.prompt}」至少要有兩個選項`);
      }
      p.questionnaire = patch.questionnaire.map((q) => ({ ...q, prompt: q.prompt.trim(), options: q.kind === "choice" ? q.options?.map((o) => o.trim()).filter(Boolean) : undefined }));
    }
    if (patch.codeEnabled !== undefined) p.codeEnabled = patch.codeEnabled;
    if (patch.discoverable !== undefined) p.discoverable = patch.discoverable;
    if (patch.requireApproval !== undefined) p.requireApproval = patch.requireApproval;
    return structuredClone(p);
  },
  async regenerateJoinCode(cid) { await delay(); needTeacher(); findClassroom(cid); const p = policyOf(cid); p.code = newCode(); return structuredClone(p); },
  async discoverClassrooms(q) {
    await delay(); needStudent();
    const k = q?.trim().toLowerCase() ?? "";
    return classrooms.filter((c) => policyOf(c.id).discoverable && (!k || [c.name, c.description, c.teacherName].some((t) => t.toLowerCase().includes(k)))).map(preview);
  },
  async lookupJoinCode(code) {
    await delay(); needStudent();
    const c = classrooms.find((x) => { const p = policyOf(x.id); return p.codeEnabled && p.code === code.trim().toUpperCase(); });
    if (!c) throw new Error("邀請碼無效或已停用，請向老師確認");
    return preview(c);
  },
  async joinClassroom(cid, input) {
    await delay(); needStudent();
    const c = findClassroom(cid);
    const p = policyOf(cid);
    if (c.joined) throw new Error("你已經是這個教室的成員");
    const codeOk = !!input.code && p.codeEnabled && p.code === input.code.trim().toUpperCase();
    if (!p.discoverable && !codeOk && !c.invited) throw new Error("需要有效的邀請碼才能加入這個教室");
    if (!p.requireApproval) { join(c); return { status: "joined", classroom: pub(c) }; }
    if (myLatestApplication(cid)?.status === "pending") throw new Error("你已經送出申請，請等老師審核");
    const answers = p.questionnaire.map((q) => ({ questionId: q.id, prompt: q.prompt, answer: (input.answers?.[q.id] ?? "").trim() }));
    const missing = p.questionnaire.find((q, i) => q.required && !answers[i].answer);
    if (missing) throw new Error(`請回答「${missing.prompt}」`);
    const bad = p.questionnaire.find((q, i) => q.kind === "choice" && answers[i].answer && !q.options?.includes(answers[i].answer));
    if (bad) throw new Error(`「${bad.prompt}」的選項不正確`);
    const app: JoinApplication = { id: newId("ap"), classroomId: cid, classroomName: c.name, studentId: MY_ID, studentName: ME, answers,
      status: "pending", createdAt: new Date().toISOString(), reviewedAt: null, note: null };
    applications.push(app);
    return { status: "pending", application: structuredClone(app) };
  },
  async listMyApplications() {
    await delay(); needStudent();
    return applications.filter((a) => a.studentId === MY_ID).map((a) => structuredClone(a)).reverse();
  },
  async cancelApplication(id) {
    await delay(); needStudent();
    const a = findApplication(id);
    if (a.studentId !== MY_ID || a.status !== "pending") throw new Error("只能取消自己還在審核中的申請");
    applications.splice(applications.indexOf(a), 1);
  },
  async listApplications(cid, status) {
    await delay(); needTeacher();
    return applications.filter((a) => a.classroomId === cid && (!status || a.status === status)).map((a) => structuredClone(a));
  },
  async reviewApplication(id, decision, note) {
    await delay(); needTeacher();
    const a = findApplication(id);
    if (a.status !== "pending") throw new Error("這筆申請已經審核過了");
    a.status = decision === "approve" ? "approved" : "rejected";
    a.reviewedAt = new Date().toISOString();
    a.note = note?.trim() || null;
    if (decision === "approve") {
      const c = findClassroom(a.classroomId);
      if (a.studentId === MY_ID) join(c);
      else if (!c.students.includes(a.studentName)) c.students.push(a.studentName);
    }
    return structuredClone(a);
  },
  listReports: notYet("P7"),
  submitReport: notYet("P7"),
  deleteReport: notYet("P7"),
  listPosts: notYet("P5"),
  createPost: notYet("P5"),
  deletePost: notYet("P5"),
  listCalendar: notYet("P6"),
  setReady: notYet("P8"),
  listNotes: notYet("P8"),
  createNote: notYet("P8"),
  updateNote: notYet("P8"),
  deleteNote: notYet("P8"),
};

/** 已在契約裡、但假後端還沒做的功能：呼叫時直接報錯，方便發現漏接 */
function notYet(phase: string) {
  return async (): Promise<never> => {
    await delay(30);
    throw new Error(`這個功能預計在 ${phase} 完成，假後端尚未實作`);
  };
}

function groupAct(gid: string) {
  const a = E.acts.find((x) => x.groups.some((g: any) => g.id === gid));
  if (!a) throw new Error("找不到組別");
  return a;
}

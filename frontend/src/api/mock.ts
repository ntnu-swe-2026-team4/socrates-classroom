import type { Api } from "./api";
import type { Announcement, Archive, Classroom, ClassroomMember, ClassroomTopic, CreateActivityInput, TopicResource, User } from "./types";
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

const classrooms: (Classroom & { students: string[] })[] = [
  { id: "c1", name: "高二哲學選修 A", description: "從柏拉圖《理想國》出發，練習用提問把自己的想法說清楚。", teacherName: "林老師",
    studentCount: 5, debateCount: 1, joined: true, students: ["王○安", "李○恩", "陳○宇", "林○彤", "吳○哲"] },
  { id: "c2", name: "高二哲學選修 B", description: "", teacherName: "陳老師", studentCount: 1, debateCount: 0, joined: false, students: ["你"] },
];

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
const pub = ({ students: _s, ...c }: Classroom & { students: string[] }): Classroom => ({ ...c, studentCount: _s.length, debateCount: E.acts.filter((a) => a.classroomId === c.id).length });

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
    return classrooms.map(pub);
  },
  async getClassroom(id) {
    await delay(60);
    return pub(findClassroom(id));
  },
  async createClassroom({ name, description }) {
    await delay(); needTeacher();
    const c = { id: "c" + (classrooms.length + 1), name, description, teacherName: user?.name ?? "老師", studentCount: 0, debateCount: 0, joined: true, students: [] as string[] };
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
  async acceptInvite(id) { await delay(); const c = findClassroom(id); c.joined = true; if (!c.students.includes("你")) c.students.push("你"); return pub(c); },
  async declineInvite(id) { await delay(); const i = classrooms.findIndex((x) => x.id === id); if (i >= 0 && !classrooms[i].joined) classrooms.splice(i, 1); },
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
  importClassroomMembers: notYet("P3"),
  finishActivity: notYet("P8"),
  setStageDeadline: notYet("P8"),
  getJoinPolicy: notYet("P3"),
  updateJoinPolicy: notYet("P3"),
  regenerateJoinCode: notYet("P3"),
  discoverClassrooms: notYet("P3"),
  lookupJoinCode: notYet("P3"),
  joinClassroom: notYet("P3"),
  listMyApplications: notYet("P3"),
  cancelApplication: notYet("P3"),
  listApplications: notYet("P3"),
  reviewApplication: notYet("P3"),
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

import type { Api } from "./api";
import { currentLang, tr } from "@/i18n";
import type { ActivityEvent, DialogueMessage, Emotion } from "./types";

const BASE = (import.meta.env.VITE_API_BASE as string | undefined) ?? "";

export class ApiError extends Error {
  /** code：後端錯誤的代碼（例如對話的 llm_not_configured），沒有就是 undefined */
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

/** 後端的錯誤格式是 `{ message }`；不是 JSON 就用 fallback（預設 statusText） */
async function errorOf(res: Response, fallback = res.statusText): Promise<ApiError> {
  let detail = fallback;
  let code: string | undefined;
  try {
    const j = (await res.json()) as { message?: string; detail?: string; code?: string };
    detail = j.message ?? j.detail ?? detail;
    code = j.code;
  } catch {
    /* 不是 JSON 就用預設說明 */
  }
  return new ApiError(res.status, detail, code);
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method,
    credentials: "include",
    headers: { "Accept-Language": currentLang(), ...(body === undefined ? {} : { "Content-Type": "application/json" }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw await errorOf(res);
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

const get = <T>(p: string) => req<T>("GET", p);
const post = <T>(p: string, b?: unknown) => req<T>("POST", p, b ?? {});
const put = <T>(p: string, b: unknown) => req<T>("PUT", p, b);
const patch = <T>(p: string, b: unknown) => req<T>("PATCH", p, b);
const del = (p: string) => req<void>("DELETE", p);
const qs = (o: Record<string, string | undefined>) => {
  const s = new URLSearchParams(Object.entries(o).filter((e): e is [string, string] => e[1] !== undefined)).toString();
  return s ? `?${s}` : "";
};

/** 上傳檔案：multipart/form-data，檔案欄位名為 file，其餘欄位為字串 */
async function upload<T>(path: string, file: File, fields: Record<string, string> = {}): Promise<T> {
  const form = new FormData();
  form.append("file", file);
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const res = await fetch(`${BASE}${path}`, { method: "POST", credentials: "include", headers: { "Accept-Language": currentLang() }, body: form });
  if (!res.ok) throw await errorOf(res, res.status === 413 ? tr("檔案太大") : res.statusText);
  return (await res.json()) as T;
}

/** 把一個 SSE 區塊拆成事件名稱與資料；`:` 開頭的是心跳註解，多行 data 用換行接起來 */
function parseSseBlock(block: string): { event: string; data: string } | null {
  let event = "message";
  const data: string[] = [];
  for (const line of block.split("\n")) {
    if (line.startsWith(":")) continue;
    const colon = line.indexOf(":");
    const field = colon < 0 ? line : line.slice(0, colon);
    const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
    if (field === "event") event = value;
    else if (field === "data") data.push(value);
  }
  return data.length ? { event, data: data.join("\n") } : null;
}

/**
 * 送出對話並讀取 SSE（格式見 docs/api-contract.md「對話 API」）：
 * event: emotion {emotion}（AI 的當下反應，最先送）→ event: delta {text} 多次 → event: done {message}；
 * 途中 AI 出錯時改送 event: error {message}。
 * 開始串流之前的錯誤（未登入、超過輪數、AI 服務沒設定…）是一般的 HTTP 錯誤 + { message }。
 */
export async function streamDialogue(path: string, body: unknown, onDelta?: (c: string) => void, onEmotion?: (e: Emotion) => void): Promise<DialogueMessage> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", "Accept-Language": currentLang() },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await errorOf(res);
  if (!res.body) throw new ApiError(502, tr("串流結束但沒有收到完整訊息"));
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  const handle = (block: string): DialogueMessage | null => {
    const ev = parseSseBlock(block);
    if (!ev) return null;
    const payload = JSON.parse(ev.data) as { text?: string; message?: DialogueMessage | string; emotion?: Emotion };
    if (ev.event === "emotion" && payload.emotion) onEmotion?.(payload.emotion);
    if (ev.event === "delta" && payload.text) onDelta?.(payload.text);
    if (ev.event === "done" && typeof payload.message === "object") return payload.message;
    if (ev.event === "error") throw new ApiError(502, typeof payload.message === "string" ? payload.message : tr("串流結束但沒有收到完整訊息"));
    return null;
  };
  try {
    for (;;) {
      const { value, done } = await reader.read();
      buf += dec.decode(value, { stream: !done });
      // 事件之間以空行分隔；換行可能是 \n 或 \r\n
      let m: RegExpExecArray | null;
      while ((m = /\r?\n\r?\n/.exec(buf))) {
        const block = buf.slice(0, m.index).replace(/\r/g, "");
        buf = buf.slice(m.index + m[0].length);
        const final = handle(block);
        if (final) return final;
      }
      if (done) break;
    }
    // 最後一個事件後面沒有空行也接受
    const final = handle(buf.replace(/\r/g, ""));
    if (final) return final;
  } finally {
    reader.cancel().catch(() => { /* 已經關閉 */ });
  }
  throw new ApiError(502, tr("串流結束但沒有收到完整訊息"));
}

export const httpApi: Api = {
  login: (i) => post("/api/auth/login", i),
  me: async () => {
    try {
      return await get("/api/me");
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return null;
      throw e;
    }
  },
  updateMe: (p) => patch("/api/me", p),
  logout: () => post("/api/auth/logout"),

  listArchives: () => get("/api/archives"),
  updateArchive: (id, p) => patch(`/api/archives/${id}`, p),
  listShareTargets: () => get("/api/me/share-targets"),

  createArchive: (title) => post("/api/archives", { title }),
  listTopicDialogue: (id) => get(`/api/archives/${id}/dialogue`),
  sendTopicDialogue: (id, text, onDelta, onEmotion) => streamDialogue(`/api/archives/${id}/dialogue`, { text }, onDelta, onEmotion),

  listClassrooms: () => get("/api/classrooms"),
  getClassroom: (id) => get(`/api/classrooms/${id}`),
  createClassroom: (i) => post("/api/classrooms", i),
  updateClassroom: (id, p) => patch(`/api/classrooms/${id}`, p),
  acceptInvite: (id) => post(`/api/classrooms/${id}/invite/accept`),
  declineInvite: (id) => post(`/api/classrooms/${id}/invite/decline`),
  listClassroomMembers: (id) => get(`/api/classrooms/${id}/members`),
  addClassroomMember: (id, name) => post(`/api/classrooms/${id}/members`, { name }),
  importClassroomMembers: (id, names) => post(`/api/classrooms/${id}/members/import`, { names }),
  removeClassroomMember: (id, mid) => del(`/api/classrooms/${id}/members/${mid}`),
  setMemberRole: (id, mid, role) => patch(`/api/classrooms/${id}/members/${mid}`, { role }),
  listActivities: (cid) => get(`/api/classrooms/${cid}/activities`),
  getActivity: (id) => get(`/api/activities/${id}`),
  advanceActivity: (id) => post(`/api/activities/${id}/advance`),
  finishActivity: (id) => post(`/api/activities/${id}/finish`),
  setStageDeadline: (id, deadline) => put(`/api/activities/${id}/deadline`, { deadline }),

  getJoinPolicy: (cid) => get(`/api/classrooms/${cid}/join-policy`),
  updateJoinPolicy: (cid, p) => patch(`/api/classrooms/${cid}/join-policy`, p),
  regenerateJoinCode: (cid) => post(`/api/classrooms/${cid}/join-policy/code`),
  discoverClassrooms: (q) => get(`/api/classrooms/discover${qs({ q })}`),
  lookupJoinCode: (code) => get(`/api/join-codes/${encodeURIComponent(code)}`),
  joinClassroom: (cid, i) => post(`/api/classrooms/${cid}/join`, i),
  listMyApplications: () => get("/api/me/applications"),
  cancelApplication: (aid) => del(`/api/applications/${aid}`),
  listApplications: (cid, status) => get(`/api/classrooms/${cid}/applications${qs({ status })}`),
  reviewApplication: (aid, decision, note) => post(`/api/applications/${aid}/review`, { decision, note: note ?? null }),

  listAnnouncements: (cid) => get(`/api/classrooms/${cid}/announcements`),
  createAnnouncement: (cid, i) => post(`/api/classrooms/${cid}/announcements`, i),
  updateAnnouncement: (id, p) => patch(`/api/announcements/${id}`, p),
  deleteAnnouncement: (id) => del(`/api/announcements/${id}`),

  listTopics: (cid) => get(`/api/classrooms/${cid}/topics`),
  getTopic: (id) => get(`/api/topics/${id}`),
  createTopic: (cid, i) => post(`/api/classrooms/${cid}/topics`, i),
  updateTopic: (id, p) => patch(`/api/topics/${id}`, p),
  deleteTopic: (id) => del(`/api/topics/${id}`),
  addTopicLink: (tid, link) => post(`/api/topics/${tid}/resources`, link),
  uploadTopicFile: (tid, file) => upload(`/api/topics/${tid}/resources/files`, file),
  deleteTopicResource: (tid, rid) => del(`/api/topics/${tid}/resources/${rid}`),
  listReports: (tid) => get(`/api/topics/${tid}/reports`),
  submitReport: (tid, file, comment) => upload(`/api/topics/${tid}/reports`, file, { comment: comment ?? "" }),
  deleteReport: (rid) => del(`/api/reports/${rid}`),

  listDiscussions: (cid) => get(`/api/classrooms/${cid}/discussions`),
  getDiscussion: (id) => get(`/api/discussions/${id}`),
  createDiscussion: (cid, i) => post(`/api/classrooms/${cid}/discussions`, i),
  updateDiscussion: (id, p) => patch(`/api/discussions/${id}`, p),
  setDiscussionStatus: (id, status) => put(`/api/discussions/${id}/status`, { status }),
  deleteDiscussion: (id) => del(`/api/discussions/${id}`),
  listDiscussionSessions: (id) => get(`/api/discussions/${id}/sessions`),
  getDiscussionSession: (id, studentId) => get(`/api/discussions/${id}/sessions/${studentId ?? "me"}`),
  sendDiscussionMessage: (id, text, onDelta, onEmotion) => streamDialogue(`/api/discussions/${id}/sessions/me/messages`, { text }, onDelta, onEmotion),
  submitDiscussionConclusion: (id, conclusion) => put(`/api/discussions/${id}/sessions/me/conclusion`, { conclusion }),

  listPosts: (cid, topicId) => get(`/api/classrooms/${cid}/posts${qs({ topicId: topicId ?? undefined })}`),
  createPost: (cid, i) => post(`/api/classrooms/${cid}/posts`, i),
  deletePost: (pid) => del(`/api/posts/${pid}`),

  createCalendarEvent: (cid, i) => post(`/api/classrooms/${cid}/calendar-events`, i),
  updateCalendarEvent: (id, p) => patch(`/api/calendar-events/${id}`, p),
  deleteCalendarEvent: (id) => del(`/api/calendar-events/${id}`),
  listCalendar: ({ from, to, classroomId }) =>
    get(`/api/classrooms/${classroomId}/calendar${qs({ from, to })}`),

  listDialogue: (id) => get(`/api/activities/${id}/dialogue`),
  sendDialogue: (id, text, onDelta) => streamDialogue(`/api/activities/${id}/dialogue`, { text }, onDelta),
  getProgress: (id) => get(`/api/activities/${id}/progress`),
  draftPosition: (id) => post(`/api/activities/${id}/position/draft`),
  confirmPosition: (id, summary) => put(`/api/activities/${id}/position`, { summary }),
  listPositions: (id) => get(`/api/activities/${id}/positions`),
  setReady: (id, ready) => put(`/api/activities/${id}/ready`, { ready }),
  listNotes: (id) => get(`/api/activities/${id}/notes`),
  createNote: (id, i) => post(`/api/activities/${id}/notes`, i),
  updateNote: (nid, text) => patch(`/api/notes/${nid}`, { text }),
  deleteNote: (nid) => del(`/api/notes/${nid}`),

  listMembers: (id) => get(`/api/activities/${id}/members`),
  listGroups: (id) => get(`/api/activities/${id}/groups`),
  regroup: (id, groupSize) => post(`/api/activities/${id}/groups/regroup`, { groupSize }),
  listGroupMessages: (gid) => get(`/api/groups/${gid}/messages`),
  postGroupMessage: (gid, text) => post(`/api/groups/${gid}/messages`, { text }),
  summarizeGroup: (gid) => post(`/api/groups/${gid}/ai/summarize`),
  counterexample: (gid) => post(`/api/groups/${gid}/ai/counterexample`),
  listArguments: (gid) => get(`/api/groups/${gid}/arguments`),
  vote: (aid, vote) => post(`/api/arguments/${aid}/vote`, { vote }),
  splitGroup: (gid) => post(`/api/groups/${gid}/split`),

  listRooms: (id) => get(`/api/activities/${id}/rooms`),
  startRoom: (rid) => post(`/api/rooms/${rid}/start`),
  listTurns: (rid) => get(`/api/rooms/${rid}/turns`),
  postTurn: (rid, text) => post(`/api/rooms/${rid}/turns`, { text }),
  overrideJudgment: (jid, teacherScore) => patch(`/api/judgments/${jid}`, { teacherScore }),

  listScores: (id) => get(`/api/activities/${id}/scores`),
  adjustScore: (id, memberId, adjust) => patch(`/api/activities/${id}/scores/${memberId}`, { adjust }),

  getStarData: (id) => get(`/api/activities/${id}/star`),

  subscribe(id, onEvent) {
    const es = new EventSource(`${BASE}/api/activities/${id}/events`, { withCredentials: true });
    es.onmessage = (m) => onEvent(JSON.parse(m.data) as ActivityEvent);
    return () => es.close();
  },
};

import type { Db } from "../db/d1";
import { all, one, parseJson } from "../db/d1";
import type { UserRow } from "../http";
import type { ActivityRow, ClassroomRow, ClassroomRole, DiscussionRow, TopicRow } from "./access";
import { studentIdsOf } from "./access";

/** PUBLIC_BASE_URL 由 app 初始化時注入（Workers 沒有 process.env bindings）。 */
let PUBLIC_BASE = "";
export function setPublicBase(url: string | undefined): void {
  PUBLIC_BASE = (url ?? "").replace(/\/$/, "");
}

export function publicUser(user: UserRow) {
  return { id: user.id, name: user.name, role: user.role, avatarUrl: user.avatar_url };
}

export async function classroomJson(db: Db, c: ClassroomRow, _user: UserRow, role: ClassroomRole, joined = true) {
  const teacher = await one<{ name: string }>(db, "SELECT name FROM users WHERE id = $id", { id: c.teacher_id });
  const students = await one<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM classroom_members WHERE classroom_id = $cid AND role = 'student' AND status = 'active'",
    { cid: c.id },
  );
  const debates = await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM topics WHERE classroom_id = $cid", { cid: c.id });
  return {
    id: c.id,
    name: c.name,
    description: c.description,
    teacherName: teacher?.name ?? "",
    studentCount: students?.n ?? 0,
    debateCount: debates?.n ?? 0,
    myRole: role,
    joined,
  };
}

export async function announcementJson(db: Db, row: any) {
  const author = await one<{ name: string }>(db, "SELECT name FROM users WHERE id = $id", { id: row.author_id });
  return {
    id: row.id,
    classroomId: row.classroom_id,
    title: row.title,
    body: row.body,
    pinned: !!row.pinned,
    publishAt: row.publish_at,
    published: row.publish_at <= new Date().toISOString(),
    authorName: author?.name ?? "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function fileRef(row: any) {
  return {
    name: row.name,
    url: `${PUBLIC_BASE}/api/files/${row.id}`,
    size: row.size,
    mimeType: row.mime_type,
  };
}

export async function resourceJsonWithDb(db: Db, row: any) {
  if (row.kind === "link") {
    return { id: row.id, kind: "link", name: row.name, url: row.url, addedAt: row.added_at };
  }
  const file = row.file_id ? await one<any>(db, "SELECT * FROM files WHERE id = $id", { id: row.file_id }) : null;
  return {
    id: row.id,
    kind: "file",
    name: row.name,
    file: file ? fileRef(file) : { name: row.name, url: "", size: 0, mimeType: "application/octet-stream" },
    addedAt: row.added_at,
  };
}

export async function topicJson(db: Db, t: TopicRow) {
  const resourceRows = await all(db, "SELECT * FROM topic_resources WHERE topic_id = $id ORDER BY seq, added_at", { id: t.id });
  const resources = await Promise.all(resourceRows.map((r: any) => resourceJsonWithDb(db, r)));
  const posts = await one<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM posts WHERE topic_id = $id AND deleted = 0",
    { id: t.id },
  );
  return {
    id: t.id,
    classroomId: t.classroom_id,
    title: t.title,
    description: t.description,
    dueAt: t.due_at,
    resources,
    acceptsReports: !!t.accepts_reports,
    activityId: t.activity_id,
    postCount: posts?.n ?? 0,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

export async function activityJson(db: Db, a: ActivityRow) {
  const studentCount = await one<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM classroom_members WHERE classroom_id = $cid AND role = 'student' AND status = 'active'",
    { cid: a.classroom_id },
  );
  return {
    id: a.id,
    classroomId: a.classroom_id,
    title: a.title,
    statement: a.statement,
    answerMode: a.answer_mode,
    axes: parseJson(a.axes, []),
    groupSize: a.group_size,
    stage: a.stage,
    memberCount: studentCount?.n ?? 0,
    createdAt: a.created_at,
    topicId: a.topic_id ?? undefined,
    stageDeadline: a.stage_deadline,
  };
}

export function dialogueJson(row: any) {
  return {
    id: row.id,
    role: row.role,
    text: row.text,
    at: row.created_at,
    ...(row.emotion ? { emotion: row.emotion } : {}),
  };
}

export async function archiveJson(db: Db, row: any, user: UserRow) {
  const sharedRows = (await all(db, "SELECT user_id FROM archive_shares WHERE archive_id = $id ORDER BY user_id", { id: row.id })) as { user_id: string }[];
  const sharedWithIds = sharedRows.map((r) => r.user_id);
  const owner = await one<{ name: string }>(db, "SELECT name FROM users WHERE id = $id", { id: row.owner_id });
  const sharedWithMe = await one(db, "SELECT 1 AS x FROM archive_shares WHERE archive_id = $aid AND user_id = $uid", { aid: row.id, uid: user.id });
  const sharedBy = row.owner_id === user.id || !sharedWithMe ? null : owner?.name ?? null;
  return {
    id: row.id,
    title: row.title,
    date: row.date,
    rounds: row.rounds,
    snippet: row.snippet,
    bank: row.bank,
    inSummary: !!row.in_summary,
    ...(row.activity_id ? { activityId: row.activity_id } : {}),
    sharedWithIds: row.owner_id === user.id ? sharedWithIds : [],
    sharedBy,
  };
}

export async function memberJson(db: Db, user: UserRow, meId: string, opts: { ready: boolean; showIndividual: boolean; activityId: string }) {
  const position = await one<any>(
    db,
    "SELECT * FROM positions WHERE activity_id = $aid AND student_id = $sid",
    { aid: opts.activityId, sid: user.id },
  );
  const rounds = await one<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM activity_dialogue WHERE activity_id = $aid AND student_id = $sid AND role = 'user'",
    { aid: opts.activityId, sid: user.id },
  );
  const r = rounds?.n ?? 0;
  const status = position?.confirmed ? "confirmed" : r > 0 ? "talking" : "todo";
  return {
    id: user.id,
    name: user.name,
    isMe: user.id === meId,
    simulated: false,
    ready: opts.ready,
    ...(opts.showIndividual
      ? { individual: { status, rounds: r, ...(position?.confirmed ? { claim: position.claim } : {}) } }
      : {}),
  };
}

export function groupJson(row: any, role: ClassroomRole, userId: string) {
  const memberIds = parseJson<string[]>(row.member_ids, []);
  const visible = role === "teacher" || role === "assistant" || memberIds.includes(userId);
  return {
    id: row.id,
    label: row.label,
    memberIds: visible ? memberIds : [],
    centroid: parseJson<number[]>(row.centroid, []),
    formedBy: row.formed_by,
  };
}

export function groupMessageJson(row: any) {
  return {
    id: row.id,
    groupId: row.group_id,
    kind: row.kind,
    ...(row.author_id ? { authorId: row.author_id } : {}),
    text: row.text,
    at: row.created_at,
  };
}

export function argumentJson(row: any) {
  return {
    id: row.id,
    groupId: row.group_id,
    kind: row.kind,
    text: row.text,
    parentId: row.parent_id,
    axisIndex: row.axis_index,
    status: row.status,
    votes: parseJson<Record<string, string>>(row.votes, {}),
    countered: !!row.countered,
  };
}

export function turnJson(row: any) {
  return {
    id: row.id,
    roomId: row.room_id,
    seq: row.seq,
    side: row.side,
    ...(row.member_id ? { memberId: row.member_id } : {}),
    ...(row.phase ? { phase: row.phase } : {}),
    text: row.text,
    at: row.created_at,
  };
}

export function judgmentJson(row: any) {
  return {
    id: row.id,
    turnId: row.turn_id,
    roomId: row.room_id,
    side: row.side,
    memberId: row.member_id,
    phase: row.phase,
    scores: parseJson(row.scores, {}),
    notes: parseJson(row.notes, {}),
    verifiability: row.verifiability,
    teacherScore: row.teacher_score,
  };
}

export async function discussionSessionsExist(db: Db, discussionId: string): Promise<void> {
  const row = await one<{ classroom_id: string }>(db, "SELECT classroom_id FROM discussions WHERE id = $id", { id: discussionId });
  const ids = await studentIdsOf(db, row?.classroom_id ?? "");
  // 只補缺的 session
  const missing: Array<{ sql: string; params: Record<string, unknown> }> = [];
  for (const sid of ids) {
    const exists = await one(db, "SELECT 1 AS x FROM discussion_sessions WHERE discussion_id = $did AND student_id = $sid", {
      did: discussionId, sid,
    });
    if (!exists) {
      missing.push({
        sql: "INSERT INTO discussion_sessions (id, discussion_id, student_id, conclusion, submitted_at, last_active_at) VALUES ($id, $did, $sid, NULL, NULL, NULL)",
        params: { id: crypto.randomUUID().replaceAll("-", ""), did: discussionId, sid },
      });
    }
  }
  if (missing.length) await db.batch(missing);
}

export async function discussionCounts(db: Db, d: DiscussionRow) {
  await discussionSessionsExist(db, d.id);
  const total = (await one<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM classroom_members WHERE classroom_id = $cid AND role = 'student' AND status = 'active'",
    { cid: d.classroom_id },
  ))?.n ?? 0;
  const started = (await one<{ n: number }>(
    db,
    `SELECT COUNT(DISTINCT m.student_id) AS n FROM discussion_messages m
     JOIN discussion_sessions s ON s.discussion_id = m.discussion_id AND s.student_id = m.student_id
     JOIN classroom_members cm ON cm.classroom_id = $cid AND cm.user_id = m.student_id
       AND cm.status = 'active' AND cm.role = 'student'
     WHERE m.discussion_id = $did`,
    { did: d.id, cid: d.classroom_id },
  ))?.n ?? 0;
  const submitted = (await one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM discussion_sessions s
     JOIN classroom_members cm ON cm.classroom_id = $cid AND cm.user_id = s.student_id
       AND cm.status = 'active' AND cm.role = 'student'
     WHERE s.discussion_id = $did AND s.conclusion IS NOT NULL`,
    { did: d.id, cid: d.classroom_id },
  ))?.n ?? 0;
  const rounds = (await one<{ n: number }>(
    db,
    `SELECT COUNT(*) AS n FROM discussion_messages m
     JOIN classroom_members cm ON cm.classroom_id = $cid AND cm.user_id = m.student_id
       AND cm.status = 'active' AND cm.role = 'student'
     WHERE m.discussion_id = $did AND m.role = 'user'`,
    { did: d.id, cid: d.classroom_id },
  ))?.n ?? 0;
  return { total, started, submitted, avgRounds: started ? Math.round((rounds / started) * 10) / 10 : 0 };
}

export async function discussionTaskJson(db: Db, d: DiscussionRow, myStatus?: string) {
  return {
    id: d.id,
    classroomId: d.classroom_id,
    title: d.title,
    prompt: d.prompt,
    conclusionHint: d.conclusion_hint,
    dueAt: d.due_at,
    maxRounds: d.max_rounds,
    status: d.status,
    createdAt: d.created_at,
    updatedAt: d.updated_at,
    stats: await discussionCounts(db, d),
    ...(myStatus ? { myStatus } : {}),
  };
}

export async function discussionSessionJson(db: Db, d: DiscussionRow, session: any, meId: string) {
  const user = await one<UserRow>(db, "SELECT id, name, role, avatar_url, created_at FROM users WHERE id = $id", { id: session.student_id });
  const rounds = (await one<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM discussion_messages WHERE discussion_id = $did AND student_id = $sid AND role = 'user'",
    { did: d.id, sid: session.student_id },
  ))?.n ?? 0;
  const textRows = await all<{ text: string }>(
    db,
    "SELECT text FROM discussion_messages WHERE discussion_id = $did AND student_id = $sid AND role = 'user' ORDER BY created_at",
    { did: d.id, sid: session.student_id },
  );
  const status = session.conclusion !== null ? "submitted" : rounds > 0 ? "talking" : "todo";
  return {
    id: `${d.id}:${session.student_id}`,
    taskId: d.id,
    studentId: session.student_id,
    studentName: user?.name ?? "",
    status,
    rounds,
    conclusion: session.conclusion,
    submittedAt: session.submitted_at,
    lastActiveAt: session.last_active_at,
    coverage: coverageOf(textRows.map((r) => r.text)),
    simulated: false,
    isMe: session.student_id === meId,
  };
}

export async function discussionSessionDetailJson(db: Db, d: DiscussionRow, session: any, meId: string) {
  const messages = await all(db, "SELECT * FROM discussion_messages WHERE discussion_id = $did AND student_id = $sid ORDER BY created_at", {
    did: d.id, sid: session.student_id,
  });
  return { ...(await discussionSessionJson(db, d, session, meId)), messages: messages.map(dialogueJson) };
}

const CUE = {
  claim: /我(覺得|認為|想|主張|相信)|應該|不應該|才是|就是|不是|\bI (think|believe|feel)\b|\bwe (think|believe)\b|\bshould(n't| not)?\b|\b(creo|pienso|opino|considero)\b|me parece|\bdeber[ií]a/i,
  reason: /因為|由於|原因|所以|因此|畢竟|\b(because|since|therefore|after all)\b|\b(porque|ya que|puesto que|por lo tanto|por eso)\b/i,
  evidence: /例如|比如|像是|舉例|例子|研究|新聞|經驗|報導|統計|資料|for example|for instance|such as|\b(study|studies|research|news|experience|data|statistics)\b|por ejemplo|\b(estudio|estudios|investigaci[oó]n|noticias?|experiencia|datos|estad[ií]sticas?)\b/i,
  counter: /但是|不過|然而|除非|可是|也許|可能|另一方面|反過來|\b(but|however|unless|although|maybe|perhaps|possibly)\b|on the other hand|\b(pero|aunque|quiz[aá]s?|tal vez|posiblemente)\b|sin embargo|a menos que|por otro lado/i,
};

export function coverageOf(texts: string[]) {
  const text = texts.join("\n");
  return {
    claim: CUE.claim.test(text),
    reason: CUE.reason.test(text),
    evidence: CUE.evidence.test(text),
    counter: CUE.counter.test(text),
  };
}

export function positionJson(row: any, showCoords: boolean) {
  return {
    memberId: row.student_id,
    summary: { claim: row.claim, reason: row.reason, evidence: row.evidence },
    coords: showCoords ? parseJson<number[]>(row.coords, []) : null,
    confirmed: !!row.confirmed,
    aiSuggested: !!row.ai_suggested,
  };
}

export function noteJson(row: any) {
  return {
    id: row.id,
    activityId: row.activity_id,
    stage: row.stage,
    kind: row.kind,
    sourceMessageId: row.source_message_id,
    text: row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function customEventJson(row: any, classroomName: string) {
  return {
    classroomId: row.classroom_id,
    classroomName,
    id: row.id,
    kind: "custom",
    title: row.title,
    at: row.at,
    ...(row.note ? { note: row.note } : {}),
  };
}

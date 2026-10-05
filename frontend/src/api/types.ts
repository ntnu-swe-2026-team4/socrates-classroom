/**
 * 前後端的資料契約。後端（Rust / Axum）依這份型別回傳 JSON；
 * 之後可改成由 OpenAPI 自動產生，欄位名稱與意義維持一致即可。
 * 所有 id 都是字串，時間都是 ISO 8601。
 */
export type Role = "student" | "teacher";

export interface User {
  id: string;
  name: string;
  role: Role;
  avatarUrl?: string;
}

/* ---------- 議題（對話存檔）與題庫 ---------- */
export type BankKind = "private" | "public";

export interface Archive {
  id: string;
  title: string;
  date: string;
  rounds: number;
  snippet: string;
  bank: BankKind | null;
  inSummary: boolean;
  /** 由辯論活動產生的議題，繼續對話時要回到該活動 */
  activityId?: string;
}

/* ---------- 教室 ---------- */
export interface Classroom {
  id: string;
  name: string;
  /** 教室簡介（可為空字串） */
  description: string;
  teacherName: string;
  studentCount: number;
  debateCount: number;
  /** false = 老師邀請了你，還沒接受（學生看到「待處理邀請」） */
  joined: boolean;
}

/** 建立 / 編輯教室（僅老師） */
export interface ClassroomInput {
  name: string;
  description: string;
}

/* ---------- 加入教室：邀請碼、公開探索、審核問卷 ---------- */
export interface JoinQuestion {
  id: string;
  prompt: string;
  /** text = 單行；paragraph = 多行；choice = 單選（options 必填） */
  kind: "text" | "paragraph" | "choice";
  options?: string[];
  required: boolean;
}

/** 教室的加入設定（只有老師讀得到完整內容） */
export interface JoinPolicy {
  /** 6 碼英數邀請碼；codeEnabled = false 時輸入此碼無效 */
  code: string;
  codeEnabled: boolean;
  /** 出現在學生的「探索教室」 */
  discoverable: boolean;
  /** true = 學生加入要老師審核，並填寫 questionnaire */
  requireApproval: boolean;
  questionnaire: JoinQuestion[];
}

export type ApplicationStatus = "pending" | "approved" | "rejected";

/** 學生在加入前看到的教室資訊（探索列表、輸入邀請碼後） */
export interface ClassroomPreview {
  id: string;
  name: string;
  description: string;
  teacherName: string;
  studentCount: number;
  requireApproval: boolean;
  /** requireApproval = false 時為空陣列 */
  questionnaire: JoinQuestion[];
  joined: boolean;
  /** 自己最近一次申請的狀態；沒申請過為 null */
  myApplication: ApplicationStatus | null;
}

export interface JoinInput {
  /** 用邀請碼加入時帶上；從探索列表加入則省略 */
  code?: string;
  /** questionId → 回答；需要審核時才需要 */
  answers?: Record<string, string>;
}

export interface JoinApplication {
  id: string;
  classroomId: string;
  classroomName: string;
  studentId: string;
  studentName: string;
  /** 送出當下的題目與回答（老師之後改問卷也不影響舊申請） */
  answers: { questionId: string; prompt: string; answer: string }[];
  status: ApplicationStatus;
  createdAt: string;
  reviewedAt: string | null;
  /** 老師審核時的附註（拒絕理由等），學生看得到 */
  note: string | null;
}

export type JoinResult =
  | { status: "joined"; classroom: Classroom }
  | { status: "pending"; application: JoinApplication };

/** 批次匯入成員的結果 */
export interface ImportMembersResult {
  added: ClassroomMember[];
  /** 找不到帳號、已在教室裡…… */
  skipped: { name: string; reason: string }[];
}

/* ---------- 公告 ---------- */
export interface Announcement {
  id: string;
  classroomId: string;
  title: string;
  body: string;
  pinned: boolean;
  /** 發布時間；在這之前學生看不到 */
  publishAt: string;
  /** publishAt 已到（由後端依伺服器時間計算） */
  published: boolean;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnnouncementInput {
  title: string;
  body: string;
  pinned: boolean;
  /** null = 立即發布 */
  publishAt: string | null;
}

/* ---------- 教室議題 ---------- */
export type TopicType = "individual" | "group";

/** 上傳檔案的共用描述（教學資源、學生報告） */
export interface FileRef {
  name: string;
  /** 下載網址，由後端提供（需登入才能下載） */
  url: string;
  size: number;
  mimeType: string;
}

export type TopicResource =
  | { id: string; kind: "link"; name: string; url: string; addedAt: string }
  | { id: string; kind: "file"; file: FileRef; addedAt: string };

export interface ClassroomTopic {
  id: string;
  classroomId: string;
  type: TopicType;
  title: string;
  /** 議題詳細說明 */
  description: string;
  dueAt: string | null;
  resources: TopicResource[];
  /** 是否讓學生上傳結論報告 */
  acceptsReports: boolean;
  /** 議題對應的活動：團體議題是辯論活動，個人議題是個人思辨活動 */
  activityId: string | null;
  postCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TopicInput {
  type: TopicType;
  title: string;
  description: string;
  dueAt: string | null;
  acceptsReports: boolean;
  /** 團體議題必填：辯論活動的設定（活動的 title / statement 由後端用議題標題填入） */
  activity?: Pick<CreateActivityInput, "answerMode" | "axes" | "groupSize">;
}

export interface TopicReport {
  id: string;
  topicId: string;
  studentId: string;
  studentName: string;
  file: FileRef;
  comment: string;
  submittedAt: string;
}

/* ---------- 討論區 ---------- */
export interface DiscussionPost {
  id: string;
  classroomId: string;
  /** null = 教室討論區；否則為該議題的討論區 */
  topicId: string | null;
  /** 回覆的對象；null = 主貼文 */
  parentId: string | null;
  body: string;
  anonymous: boolean;
  /** 顯示名稱：實名為本名；匿名時學生看到「匿名同學」，老師看到本名 */
  authorLabel: string;
  /** 只有老師（或作者本人）拿得到；匿名貼文給其他學生時為 null */
  authorId: string | null;
  authorRole: Role;
  isMine: boolean;
  createdAt: string;
  /** 被刪除的貼文保留位置（底下可能還有回覆），body 為空 */
  deleted: boolean;
}

export interface PostInput {
  topicId: string | null;
  parentId?: string | null;
  body: string;
  /** 老師的貼文一律實名，後端忽略此欄位 */
  anonymous: boolean;
}

/* ---------- 行事曆 ---------- */
export interface CalendarEvent {
  id: string;
  classroomId: string;
  classroomName: string;
  kind: "topic_due" | "announcement" | "stage_deadline";
  title: string;
  at: string;
  topicId?: string;
  announcementId?: string;
  activityId?: string;
}

/** 教室成員表的一列（成員分頁） */
export interface ClassroomMember {
  id: string;
  name: string;
  online: boolean;
  lastActive: string;
  /** 完成度 0–100 */
  progress: number;
}

/* ---------- 辯論活動 ---------- */
export type Stage = "individual" | "team" | "debate" | "done";
export type AnswerMode = "text" | "voice" | "both";

export interface Axis {
  key: string;
  name: string;
  /** 座標 -1 那一端 */
  left: string;
  /** 座標 +1 那一端 */
  right: string;
}

/** debate = 團體議題的四階段辯論；individual = 個人議題的個人思辨（每位學生各自完成，只有「思辨 → 結算」） */
export type ActivityKind = "debate" | "individual";

export interface Activity {
  id: string;
  classroomId: string;
  kind: ActivityKind;
  title: string;
  statement: string;
  answerMode: AnswerMode;
  axes: Axis[];
  groupSize: number;
  stage: Stage;
  memberCount: number;
  createdAt: string;
  /** 所屬的教室議題（P4 之後由議題建立的活動才有） */
  topicId?: string;
  /** 老師為目前階段設的截止時間；null = 不限時。到時間只提醒，不會自動推進 */
  stageDeadline: string | null;
}

export interface CreateActivityInput {
  title: string;
  statement: string;
  answerMode: AnswerMode;
  axes: Omit<Axis, "key">[];
  groupSize: number;
}

/* ---------- 階段 1：個人調查 ---------- */
export interface DialogueMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
}

/** 對話進度：四個面向有沒有出現（由後端的 LLM 流程判斷） */
export interface Coverage {
  claim: boolean;
  reason: boolean;
  evidence: boolean;
  counter: boolean;
}

export interface Progress {
  rounds: number;
  maxRounds: number;
  coverage: Coverage;
  readyToSummarize: boolean;
}

/** 學生的論點總結（AI 依對話整理，學生確認或修改） */
export interface ArgumentSummary {
  claim: string;
  reason: string;
  evidence: string;
}

/** AI 依對話整理的草稿：學生只看得到論點，座標由後端估算、不給學生 */
export interface PositionDraft {
  summary: ArgumentSummary;
}

export interface Position {
  memberId: string;
  summary: ArgumentSummary;
  /**
   * 每條價值軸一個 -1..+1 的座標，順序同 Activity.axes；由後端依對話估算。
   * 活動結束（stage = done）前，學生拿到的是 null；老師一律拿得到。
   */
  coords: number[] | null;
  confirmed: boolean;
  /** 本人沒有確認、由 AI 自動補上的 */
  aiSuggested: boolean;
}

/* ---------- 階段 2：團隊提純 ---------- */
export interface Member {
  id: string;
  name: string;
  isMe: boolean;
  /** 示範資料裡由系統補齊的模擬同學（真後端沒有這個概念） */
  simulated: boolean;
  /** 在目前階段按了「我準備好了」；換階段時由後端重設為 false */
  ready?: boolean;
  /**
   * 階段 1 的進度（老師看得到全班；學生只看得到自己）。
   * done 只出現在個人思辨活動：學生按了「完成」，進入結算畫面（可以再重新開啟）
   */
  individual?: { status: "todo" | "talking" | "confirmed" | "done"; rounds: number; claim?: string };
}

export interface Group {
  id: string;
  label: string;
  memberIds: string[];
  centroid: number[];
  formedBy: "auto" | "split";
}

export type ArgumentKind = "claim" | "reason" | "evidence";
export type ArgumentStatus = "active" | "revised" | "dropped" | "contested";
export type Vote = "endorse" | "revise" | "oppose";

export interface GroupArgument {
  id: string;
  groupId: string;
  kind: ArgumentKind;
  text: string;
  parentId: string | null;
  axisIndex: number;
  status: ArgumentStatus;
  votes: Record<string, Vote>;
  countered: boolean;
}

export interface GroupMessage {
  id: string;
  groupId: string;
  kind: "chat" | "system" | "ai_summary" | "ai_counterexample";
  authorId?: string;
  text: string;
  at: string;
}

/* ---------- 階段 3：辯論比賽 ---------- */
export type Phase = "opening" | "cross" | "rebuttal" | "closing";
export type Side = "a" | "b";

export interface Room {
  id: string;
  activityId: string;
  groupA: string;
  groupB: string;
  status: "scheduled" | "live" | "finished";
  phase: Phase | "ended";
  /** 目前輪到誰；null = 沒人（尚未開始或已結束） */
  turn: { side: Side; memberId: string; role: "ask" | "answer" | "speak"; deadline: string } | null;
}

export interface Turn {
  id: string;
  roomId: string;
  seq: number;
  side: Side | "moderator";
  memberId?: string;
  phase?: Phase;
  text: string;
  at: string;
}

export type CriterionKey = "evidence" | "reasoning" | "rebuttal" | "clarity";

export interface Judgment {
  id: string;
  turnId: string;
  roomId: string;
  side: Side;
  memberId: string;
  phase: Phase;
  /** 0–5；該回合不適用時為 null（例如開場沒有「回應」） */
  scores: Record<CriterionKey, number | null>;
  notes: Partial<Record<CriterionKey, string>>;
  verifiability: "sourced" | "checkable" | "unverified";
  /** 老師覆寫的整體分；null = 沿用 AI */
  teacherScore: number | null;
}

/* ---------- 結果 ---------- */
export interface ScoreRow {
  memberId: string;
  memberName: string;
  individual: number;
  team: number;
  debate: number;
  adjust: number;
  total: number;
}

/* ---------- 學生的思路筆記（只有本人看得到） ---------- */
export interface ThinkingNote {
  id: string;
  activityId: string;
  /** 寫下時所在的階段 */
  stage: Stage;
  /** highlight = 從對話中標註的重點（sourceMessageId 指向那則訊息）；thought = 自己寫的想法 */
  kind: "highlight" | "thought";
  sourceMessageId: string | null;
  text: string;
  createdAt: string;
  updatedAt: string;
}

export interface NoteInput {
  kind: ThinkingNote["kind"];
  sourceMessageId?: string | null;
  text: string;
}

/* ---------- 即時事件（SSE：GET /api/activities/:id/events） ---------- */
export type ActivityEvent =
  | { type: "stage_changed"; stage: Stage }
  | { type: "deadline_changed"; deadline: string | null }
  | { type: "member_ready"; memberId: string; ready: boolean }
  | { type: "group_message"; message: GroupMessage }
  | { type: "argument_updated"; argument: GroupArgument }
  | { type: "turn_created"; turn: Turn; judgment?: Judgment }
  | { type: "room_updated"; room: Room };

/* ---------- 立場星圖 ---------- */
export interface StarData {
  axes: Axis[];
  /** 每位成員在每一步的座標：history[step][axisIndex]，範圍 -1..+1 */
  agents: { id: number; me: boolean; history: number[][] }[];
  /** 已分組時才有：assignments[i] 是第 i 位成員所屬組別的索引 */
  groups: { labels: string[]; assignments: number[] } | null;
  stepLabels: string[];
  stepNotes: string[];
  initialStep: number;
  /** 只有一個時間點時為 false（例如階段 1），畫面就不顯示時間軸 */
  hasTimeline: boolean;
}

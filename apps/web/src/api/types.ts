export type Role = "student" | "teacher";

export interface User {
  id: string;
  name: string;
  role: Role;
  avatarUrl?: string | null;
}

export type BankKind = "private" | "public";

export interface Archive {
  id: string;
  title: string;
  date: string;
  rounds: number;
  snippet: string;
  bank: BankKind | null;
  inSummary: boolean;
  activityId?: string;
  sharedWithIds: string[];
  sharedBy: string | null;
}

export interface ShareTarget {
  id: string;
  name: string;
  role: string;
}

export type ClassroomRole = "teacher" | "assistant" | "student";

export interface Classroom {
  id: string;
  name: string;
  description: string;
  teacherName: string;
  studentCount: number;
  debateCount: number;
  myRole: ClassroomRole;
  joined: boolean;
}

export interface ClassroomInput {
  name: string;
  description: string;
}

export interface JoinQuestion {
  id: string;
  prompt: string;
  kind: "text" | "paragraph" | "choice";
  options?: string[];
  required: boolean;
}

export interface JoinPolicy {
  code: string;
  codeEnabled: boolean;
  discoverable: boolean;
  requireApproval: boolean;
  questionnaire: JoinQuestion[];
}

export type ApplicationStatus = "pending" | "approved" | "rejected";

export interface ClassroomPreview {
  id: string;
  name: string;
  description: string;
  teacherName: string;
  studentCount: number;
  requireApproval: boolean;
  questionnaire: JoinQuestion[];
  joined: boolean;
  myApplication: ApplicationStatus | null;
}

export interface JoinInput {
  code?: string;
  answers?: Record<string, string>;
}

export interface JoinApplication {
  id: string;
  classroomId: string;
  classroomName: string;
  studentId: string;
  studentName: string;
  answers: { questionId: string; prompt: string; answer: string }[];
  status: ApplicationStatus;
  createdAt: string;
  reviewedAt: string | null;
  note: string | null;
}

export type JoinResult =
  | { status: "joined"; classroom: Classroom }
  | { status: "pending"; application: JoinApplication };

export interface ImportMembersResult {
  added: ClassroomMember[];
  skipped: { name: string; reason: string }[];
}

export interface Announcement {
  id: string;
  classroomId: string;
  title: string;
  body: string;
  pinned: boolean;
  publishAt: string;
  published: boolean;
  authorName: string;
  createdAt: string;
  updatedAt: string;
}

export interface AnnouncementInput {
  title: string;
  body: string;
  pinned: boolean;
  publishAt: string | null;
}

export interface FileRef {
  name: string;
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
  title: string;
  description: string;
  dueAt: string | null;
  resources: TopicResource[];
  acceptsReports: boolean;
  activityId?: string;
  postCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface TopicInput {
  title: string;
  description: string;
  dueAt: string | null;
  acceptsReports: boolean;
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

export interface DiscussionPost {
  id: string;
  classroomId: string;
  topicId: string | null;
  parentId: string | null;
  body: string;
  anonymous: boolean;
  authorLabel: string;
  authorId: string | null;
  authorRole: Role;
  isMine: boolean;
  createdAt: string;
  deleted: boolean;
}

export interface PostInput {
  topicId: string | null;
  parentId?: string | null;
  body: string;
  anonymous: boolean;
}

export type DiscussionStatus = "open" | "closed";

export type DiscussionSessionStatus = "todo" | "talking" | "submitted";

export interface DiscussionStats {
  total: number;
  started: number;
  submitted: number;
  avgRounds: number;
}

export interface DiscussionTask {
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
  stats: DiscussionStats;
  myStatus?: DiscussionSessionStatus;
}

export interface DiscussionTaskInput {
  title: string;
  prompt: string;
  conclusionHint: string;
  dueAt: string | null;
  maxRounds: number;
}

export interface DiscussionSession {
  id: string;
  taskId: string;
  studentId: string;
  studentName: string;
  status: DiscussionSessionStatus;
  rounds: number;
  conclusion: string | null;
  submittedAt: string | null;
  lastActiveAt: string | null;
  coverage: Coverage;
  simulated: boolean;
  isMe: boolean;
}

export interface DiscussionSessionDetail extends DiscussionSession {
  messages: DialogueMessage[];
}

export interface CalendarEvent {
  id: string;
  classroomId: string;
  classroomName: string;
  kind: "topic_due" | "announcement" | "stage_deadline" | "discussion_due" | "custom";
  title: string;
  at: string;
  note?: string;
  topicId?: string;
  announcementId?: string;
  activityId?: string;
  discussionId?: string;
}

export interface CalendarEventInput {
  title: string;
  at: string;
  note?: string;
}

export interface ClassroomMember {
  id: string;
  name: string;
  role: Exclude<ClassroomRole, "teacher">;
  online: boolean;
  lastActive: string;
  progress: number;
}

export type Stage = "individual" | "team" | "debate" | "done";
export type AnswerMode = "text" | "voice" | "both";

export interface Axis {
  key: string;
  name: string;
  left: string;
  right: string;
}

export interface Activity {
  id: string;
  classroomId: string;
  title: string;
  statement: string;
  answerMode: AnswerMode;
  axes: Axis[];
  groupSize: number;
  stage: Stage;
  memberCount: number;
  createdAt: string;
  topicId?: string;
  stageDeadline: string | null;
}

export interface CreateActivityInput {
  title: string;
  statement: string;
  answerMode: AnswerMode;
  axes: Omit<Axis, "key">[];
  groupSize: number;
}

export type Emotion = "neutral" | "happy" | "confused" | "angry";

export interface DialogueMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
  emotion?: Emotion;
}

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

export interface ArgumentSummary {
  claim: string;
  reason: string;
  evidence: string;
}

export interface PositionDraft {
  summary: ArgumentSummary;
}

export interface Position {
  memberId: string;
  summary: ArgumentSummary;
  coords: number[] | null;
  confirmed: boolean;
  aiSuggested: boolean;
}

export interface Member {
  id: string;
  name: string;
  isMe: boolean;
  simulated: boolean;
  ready?: boolean;
  individual?: { status: "todo" | "talking" | "confirmed"; rounds: number; claim?: string };
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

export type Phase = "opening" | "cross" | "rebuttal" | "closing";
export type Side = "a" | "b";

export interface Room {
  id: string;
  activityId: string;
  groupA: string;
  groupB: string;
  status: "scheduled" | "live" | "finished";
  phase: Phase | "ended";
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
  scores: Record<CriterionKey, number | null>;
  notes: Partial<Record<CriterionKey, string>>;
  verifiability: "sourced" | "checkable" | "unverified";
  teacherScore: number | null;
}

export interface ScoreRow {
  memberId: string;
  memberName: string;
  individual: number;
  team: number;
  debate: number;
  adjust: number;
  total: number;
}

export interface ThinkingNote {
  id: string;
  activityId: string;
  stage: Stage;
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

export type ActivityEvent =
  | { type: "stage_changed"; stage: Stage }
  | { type: "deadline_changed"; deadline: string | null }
  | { type: "member_ready"; memberId: string; ready: boolean }
  | { type: "group_message"; message: GroupMessage }
  | { type: "argument_updated"; argument: GroupArgument }
  | { type: "turn_created"; turn: Turn; judgment?: Judgment }
  | { type: "room_updated"; room: Room };

export interface StarData {
  axes: Axis[];
  agents: { id: number; me: boolean; history: number[][] }[];
  groups: { labels: string[]; assignments: number[] } | null;
  stepLabels: string[];
  stepNotes: string[];
  initialStep: number;
  hasTimeline: boolean;
}

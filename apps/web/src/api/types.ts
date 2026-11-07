import type { ErrorCode } from "@socrates/shared";

export type Role = "student" | "teacher";

export interface User {
  id: string;
  name: string;
  role: Role;
}

export interface Topic {
  id: string;
  title: string;
  statement: string;
  summary?: string;
  prompts: string[];
}

export interface JoinInfo {
  code: string;
  classroomName: string;
  topic: Topic;
}

export interface SoloChat {
  id: string;
  title: string;
  rounds: number;
  lastText: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ClassroomSummary {
  id: string;
  name: string;
  role: Role;
  teacherName: string;
  memberCount: number;
  code: string | null;
  url: string | null;
  current: {
    activityId: string;
    topicId: string;
    topicTitle: string;
    topicStatement: string;
    finished: boolean;
  } | null;
  createdAt: string;
}

export interface ClassroomCreated {
  classroomId: string;
  code: string;
  url: string;
  activityId: string;
}

export type LiveStatus = "active" | "speaking" | "idle";

export interface StudentLive {
  id: string;
  name: string;
  status: LiveStatus;
  rounds: number;
  flagged: boolean;
  flagReason?: string;
  lastUtterance: string;
}

export interface DialogueMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  at: string;
}

export interface ActivityInfo {
  id: string;
  classroomId: string;
  classroomName: string;
  topic: Topic;
  finishedAt: string | null;
}

export interface HexagonAxis {
  label: string;
  value: number;
}

export interface ArgumentPoint {
  claim: string;
  reason: string;
  tension: string;
}

export interface ViolationSlice {
  turn: number;
  type: string;
  excerpt: string;
}

export interface IndividualReport {
  pseudonym: string;
  hexagon: HexagonAxis[];
  arguments: ArgumentPoint[];
  violations: ViolationSlice[];
}

export interface ReportAxis {
  name: string;
  left: string;
  right: string;
  color: string;
}

export interface StancePoint {
  pseudonym: string;
  values: number[];
  cluster: number;
}

export interface GroupReport {
  axes: ReportAxis[];
  points: StancePoint[];
  clusters: { id: number; label: string }[];
}

export interface TeacherReport {
  topicTitle: string;
  group: GroupReport;
  individuals: IndividualReport[];
}

export interface StudentReport {
  topicTitle: string;
  group: GroupReport;
  individual: IndividualReport;
}

export type Report = TeacherReport | StudentReport;

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

export type ByokStatus = { provider: string; last4: string } | null;

export interface TermExplanation {
  term: string;
  markdown: string;
}

export interface TermQuery {
  term: string;
  at: string;
}

export interface Api {
  me(): Promise<User | null>;
  login(email: string, password: string): Promise<User>;
  guest(name?: string): Promise<User>;
  updateMe(name: string): Promise<User>;
  register(input: { name: string; email: string; password: string }): Promise<User>;
  listSoloChats(): Promise<SoloChat[]>;
  createSoloChat(title: string): Promise<SoloChat>;
  soloChat(chatId: string): Promise<SoloChat>;
  deleteSoloChat(chatId: string): Promise<void>;
  soloHistory(chatId: string): Promise<DialogueMessage[]>;
  sendSoloDialogue(
    chatId: string,
    text: string,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<DialogueMessage>;
  listClassrooms(): Promise<ClassroomSummary[]>;
  classroom(classroomId: string): Promise<ClassroomSummary>;
  startActivity(classroomId: string, topicId: string): Promise<ClassroomCreated>;
  logout(): Promise<void>;
  joinByCode(code: string): Promise<JoinInfo>;
  joinAsGuest(code: string, name: string): Promise<{ user: User; activityId: string }>;
  listTopics(): Promise<Topic[]>;
  generateTopics(direction: string): Promise<Topic[]>;
  createClassroom(name: string, topicId: string): Promise<ClassroomCreated>;
  liveStudents(activityId: string): Promise<StudentLive[]>;
  dialogueHistory(activityId: string): Promise<DialogueMessage[]>;
  sendDialogue(
    activityId: string,
    text: string,
    onDelta: (delta: string) => void,
    signal?: AbortSignal,
  ): Promise<DialogueMessage>;
  stt(audio: Blob): Promise<string>;
  tts(text: string, onAmplitude: (value: number) => void, signal?: AbortSignal): Promise<void>;
  createTopic(input: { title: string; statement: string; summary?: string; prompts: string[] }): Promise<Topic>;
  activityInfo(activityId: string): Promise<ActivityInfo>;
  finishActivity(activityId: string): Promise<void>;
  report(activityId: string): Promise<Report>;
  byokStatus(): Promise<ByokStatus>;
  byokSet(provider: string, key: string): Promise<ByokStatus>;
  byokClear(): Promise<ByokStatus>;
  lookupTerm(term: string): Promise<TermExplanation>;
}

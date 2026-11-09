import { z } from "zod";
import type { ClassReport, StudentAnalysis } from "./reports";

export type Lang = "zh" | "en" | "es";
export const LANG_NAMES: Record<Lang, string> = {
  zh: "Traditional Chinese (繁體中文)",
  en: "English",
  es: "Spanish (Español)",
};

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(["student", "teacher"]),
});
export type User = z.infer<typeof UserSchema>;

export const TopicSchema = z.object({
  id: z.string(),
  title: z.string(),
  statement: z.string(),
  summary: z.string().optional(),
  prompts: z.array(z.string()),
});
export type Topic = z.infer<typeof TopicSchema>;

export const JoinInfoSchema = z.object({
  code: z.string(),
  classroomName: z.string(),
  topic: TopicSchema,
});
export type JoinInfo = z.infer<typeof JoinInfoSchema>;

export const ClassroomCreatedSchema = z.object({
  classroomId: z.string(),
  code: z.string(),
  url: z.string(),
  activityId: z.string(),
});
export type ClassroomCreated = z.infer<typeof ClassroomCreatedSchema>;

export const ActivityInfoSchema = z.object({
  id: z.string(),
  classroomId: z.string(),
  classroomName: z.string(),
  topic: TopicSchema,
  finishedAt: z.string().nullable(),
});
export type ActivityInfo = z.infer<typeof ActivityInfoSchema>;

export const StudentLiveSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.enum(["active", "speaking", "idle"]),
  rounds: z.number(),
  flagged: z.boolean(),
  flagReason: z.string().optional(),
  lastUtterance: z.string(),
});
export type StudentLive = z.infer<typeof StudentLiveSchema>;

export interface ViolationSlice {
  turn: number;
  type: ViolationType;
  excerpt: string;
}

export interface TeacherReport {
  topicTitle: string;
  classReport: ClassReport;
  students: Array<{
    studentId: string;
    pseudonym: string;
    analysis: StudentAnalysis | null;
    violations: ViolationSlice[];
  }>;
}

export interface StudentReport {
  topicTitle: string;
  pseudonym: string;
  analysis: StudentAnalysis | null;
  violations: ViolationSlice[];
}
export type Report = TeacherReport | StudentReport;

export const TermExplanationSchema = z.object({ term: z.string(), markdown: z.string() });
export type TermExplanation = z.infer<typeof TermExplanationSchema>;

const emailField = z.email().transform((value) => value.toLowerCase());

export const LoginInputSchema = z.object({ email: emailField, password: z.string().min(8).max(128) });
export const RegisterInputSchema = z.object({
  code: z.string().min(4).max(32),
  email: emailField,
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(80),
  tosAccepted: z.boolean(),
});
export const JoinInputSchema = z.object({
  code: z.string().min(4).max(32),
  name: z.string().trim().max(80).optional(),
  tosAccepted: z.boolean(),
});
export const TopicCreateInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  statement: z.string().trim().min(1).max(2000),
  summary: z.string().trim().max(500).optional(),
  prompts: z.array(z.string().trim().min(1).max(160)).max(6),
});
export const GenerateTopicsInputSchema = z.object({
  direction: z.string().trim().min(1).max(200),
});
export const ClassroomCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  topicId: z.string().min(1),
});
export const ActivityStartInputSchema = z.object({ topicId: z.string().min(1) });
export const DialogueInputSchema = z.object({ text: z.string().trim().min(1).max(2000) });
export const LookupInputSchema = z.object({ term: z.string().trim().min(1).max(30) });
export const TtsInputSchema = z.object({ text: z.string().min(1).max(2000), lang: z.enum(["zh", "en", "es"]) });
export const ClassroomSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(["teacher", "student"]),
  teacherName: z.string(),
  memberCount: z.number(),
  code: z.string().nullable(),
  url: z.string().nullable(),
  current: z
    .object({
      activityId: z.string(),
      topicId: z.string(),
      topicTitle: z.string(),
      topicStatement: z.string(),
      finished: z.boolean(),
    })
    .nullable(),
  createdAt: z.string(),
});
export type ClassroomSummary = z.infer<typeof ClassroomSummarySchema>;

export const TeacherKeyStatusSchema = z.object({
  provider: z.string(),
  model: z.string(),
  last4: z.string(),
  sortOrder: z.number(),
  updatedAt: z.string(),
});
export type TeacherKeyStatus = z.infer<typeof TeacherKeyStatusSchema>;

export const VIOLATION_TYPES = ["on_topic", "math", "coding", "injection", "other"] as const;
export type ViolationType = (typeof VIOLATION_TYPES)[number];
export const ViolationChoiceSchema = z.object({
  type: z.enum(VIOLATION_TYPES),
  probability: z.number().min(0).max(1),
});

export const SttResultSchema = z.object({ text: z.string() });
export type SttResult = z.infer<typeof SttResultSchema>;

export const ERROR_CODES = [
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
  "validation",
  "rate_limited",
  "internal_error",
  "join_code_invalid",
  "tos_required",
  "name_taken",
  "only_student",
  "already_streaming",
  "activity_finished",
  "llm_unavailable",
  "llm_rate_limited",
  "llm_timeout",
  "report_pending",
  "report_failed",
  "byok_provider_invalid",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode,
    public readonly vars: Record<string, string | number> = {},
  ) {
    super(code);
  }
}
export * from "./reports";

import { z } from "zod";
import { ClassReportSchema, StudentAnalysisSchema, type ClassReport, type StudentAnalysis } from "./reports";

export type Lang = "zh" | "en" | "es";
export const LANG_NAMES: Record<Lang, string> = {
  zh: "Traditional Chinese (繁體中文)",
  en: "English",
  es: "Spanish (Español)",
};

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  canManageClasses: z.boolean(),
  isAdmin: z.boolean(),
});
export type User = z.infer<typeof UserSchema>;

export const TopicDraftSchema = z.object({
  id: z.string(),
  title: z.string(),
  statement: z.string(),
  summary: z.string().optional(),
  prompts: z.array(z.string()),
});
export type TopicDraft = z.infer<typeof TopicDraftSchema>;

export const TopicSchema = TopicDraftSchema.extend({
  classroomId: z.string().nullable(),
});
export type Topic = z.infer<typeof TopicSchema>;

export const JoinInfoSchema = z.object({
  code: z.string(),
  classroomName: z.string(),
  topic: TopicSchema,
});
export type JoinInfo = z.infer<typeof JoinInfoSchema>;

export const ACTIVITY_MODES = ["live", "test"] as const;
export const ActivityModeSchema = z.enum(ACTIVITY_MODES);
export type ActivityMode = z.infer<typeof ActivityModeSchema>;

export const ACTIVITY_SLOT_MAX = 6;

export const ClassroomCreatedSchema = z.object({
  classroomId: z.string(),
  code: z.string(),
  url: z.string(),
});
export type ClassroomCreated = z.infer<typeof ClassroomCreatedSchema>;

export const ActivityStartedSchema = z.object({
  classroomId: z.string(),
  code: z.string(),
  url: z.string(),
  activityId: z.string(),
  mode: ActivityModeSchema,
});
export type ActivityStarted = z.infer<typeof ActivityStartedSchema>;

export const ActivityInviteSchema = z.object({
  token: z.string(),
  activityId: z.string(),
  url: z.string(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
});
export type ActivityInvite = z.infer<typeof ActivityInviteSchema>;

export const InviteInfoSchema = z.object({
  token: z.string(),
  activityId: z.string(),
  classroomName: z.string(),
  topic: TopicSchema,
  finishedAt: z.string().nullable(),
});
export type InviteInfo = z.infer<typeof InviteInfoSchema>;

export const InviteJoinInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  tosAccepted: z.boolean(),
});
export type InviteJoinInput = z.infer<typeof InviteJoinInputSchema>;

export const InviteJoinedSchema = z.object({
  activityId: z.string(),
  participantId: z.string(),
  displayName: z.string(),
  kind: z.enum(["guest", "member"]),
});
export type InviteJoined = z.infer<typeof InviteJoinedSchema>;

export const ActivityInfoSchema = z.object({
  id: z.string(),
  classroomId: z.string(),
  classroomName: z.string(),
  participantId: z.string().nullable(),
  mode: ActivityModeSchema,
  topic: TopicSchema,
  finishedAt: z.string().nullable(),
});
export type ActivityInfo = z.infer<typeof ActivityInfoSchema>;

export const ActivitySlotSchema = z.object({
  id: z.string(),
  name: z.string(),
  rounds: z.number().int(),
  lastUtterance: z.string(),
});
export type ActivitySlot = z.infer<typeof ActivitySlotSchema>;

export const ActivitySlotsSchema = z.object({
  activityId: z.string(),
  mode: ActivityModeSchema,
  maxSlots: z.number().int(),
  slots: z.array(ActivitySlotSchema),
});
export type ActivitySlots = z.infer<typeof ActivitySlotsSchema>;

export const ActivitySlotCreateInputSchema = z.object({
  count: z.number().int().min(1).max(ACTIVITY_SLOT_MAX),
});

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

export const VIOLATION_TYPES = ["on_topic", "math", "coding", "injection", "other"] as const;
export type ViolationType = (typeof VIOLATION_TYPES)[number];

export const ViolationSliceSchema = z.object({
  turn: z.number().int(),
  type: z.enum(VIOLATION_TYPES),
  excerpt: z.string(),
});

export interface ViolationSlice {
  turn: number;
  type: ViolationType;
  excerpt: string;
}

export const ReportPositionSchema = z.object({
  axis: z.string(),
  view: z.string(),
  end: z.enum(["low", "middle", "high"]),
  at: z.number().int().min(0).max(100),
});

export const StudentReportEntrySchema = z.object({
  participantName: z.string().optional(),
  pseudonym: z.string(),
  analysis: StudentAnalysisSchema.nullable(),
  violations: z.array(ViolationSliceSchema),
  positions: z.array(ReportPositionSchema),
});

export const StoredTeacherReportSchema = z.object({
  topicTitle: z.string(),
  classReport: ClassReportSchema.nullable(),
});

export const StoredStudentReportsSchema = z.record(z.string(), StudentReportEntrySchema);

export interface ReportPosition {
  axis: string;
  view: string;
  end: "low" | "middle" | "high";
  at: number;
}

export interface StudentReportEntry {
  participantId: string;
  participantName: string;
  pseudonym: string;
  analysis: StudentAnalysis | null;
  violations: ViolationSlice[];
  positions: ReportPosition[];
}

export interface TeacherReport {
  topicTitle: string;
  classReport: ClassReport | null;
  students: StudentReportEntry[];
}

export interface StudentReport {
  topicTitle: string;
  participantName: string;
  pseudonym: string;
  analysis: StudentAnalysis | null;
  violations: ViolationSlice[];
  positions: ReportPosition[];
}
export type Report = TeacherReport | StudentReport;

export const TermExplanationSchema = z.object({ term: z.string(), markdown: z.string() });
export type TermExplanation = z.infer<typeof TermExplanationSchema>;

const emailField = z.email().transform((value) => value.toLowerCase());

export const LoginInputSchema = z.object({ email: emailField, password: z.string().min(8).max(128) });
export const DevLoginInputSchema = z.object({ email: emailField });
export const RegisterInputSchema = z.object({
  code: z.string().min(4).max(32),
  email: emailField,
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(80),
  tosAccepted: z.boolean(),
});
export const SignupInputSchema = z.object({
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
export const JoinResultSchema = z.object({
  user: UserSchema.nullable(),
  activityId: z.string(),
  participantId: z.string().nullable(),
  kind: z.enum(["member", "guest"]).nullable(),
});
export type JoinResult = z.infer<typeof JoinResultSchema>;
export const AdminUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  canManageClasses: z.boolean(),
  isAdmin: z.boolean(),
  disabled: z.boolean(),
  createdAt: z.string(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;
export const AdminUserCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: emailField,
  password: z.string().min(8).max(128),
  canManageClasses: z.boolean().default(false),
});
export const AdminUserUpdateInputSchema = z
  .object({ canManageClasses: z.boolean().optional(), disabled: z.boolean().optional() })
  .refine((value) => value.canManageClasses !== undefined || value.disabled !== undefined, {
    message: "at least one field is required",
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
});
export const TopicCopyInputSchema = z.object({
  classroomId: z.string().min(1),
});
export const ActivityStartInputSchema = z.object({
  topicId: z.string().min(1),
  mode: ActivityModeSchema.default("live"),
});
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

export const DEV_FIXTURE_ROLES = ["admin", "teacher", "student"] as const;
export const DevAccountClassroomSchema = z.object({
  id: z.string(),
  name: z.string(),
  role: z.enum(["teacher", "student"]),
  code: z.string().nullable(),
  url: z.string().nullable(),
  activityId: z.string().nullable(),
});
export type DevAccountClassroom = z.infer<typeof DevAccountClassroomSchema>;

export const DevAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  canManageClasses: z.boolean(),
  isAdmin: z.boolean(),
  fixtureRole: z.enum(DEV_FIXTURE_ROLES),
  classrooms: z.array(DevAccountClassroomSchema),
});
export type DevAccount = z.infer<typeof DevAccountSchema>;

export const DevAccountsSchema = z.object({ password: z.string(), accounts: z.array(DevAccountSchema) });
export type DevAccounts = z.infer<typeof DevAccountsSchema>;

export const TeacherKeyModelSchema = z.object({
  model: z.string(),
  maxConcurrency: z.number().int().min(1).max(100).nullable(),
  sortOrder: z.number(),
});
export type TeacherKeyModel = z.infer<typeof TeacherKeyModelSchema>;

export const TeacherKeyStatusSchema = z.object({
  provider: z.string(),
  last4: z.string(),
  maxConcurrency: z.number().int().min(1).max(100).nullable(),
  sortOrder: z.number(),
  updatedAt: z.string(),
  models: z.array(TeacherKeyModelSchema),
});
export type TeacherKeyStatus = z.infer<typeof TeacherKeyStatusSchema>;

export const ViolationChoiceSchema = z.object({
  type: z.string(),
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
  "invite_invalid",
  "invite_revoked",
  "invite_expired",
  "tos_required",
  "name_taken",
  "account_disabled",
  "capability_required",
  "already_streaming",
  "activity_finished",
  "llm_unavailable",
  "llm_rate_limited",
  "llm_timeout",
  "report_pending",
  "report_failed",
  "byok_provider_invalid",
  "oauth_unavailable",
  "oauth_state_invalid",
  "oauth_email_unverified",
  "oauth_failed",
  "email_taken",
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

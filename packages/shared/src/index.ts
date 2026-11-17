import { z } from "zod";
import { ClassReportSchema, StudentAnalysisSchema, type ClassReport, type StudentAnalysis } from "./reports";

export type Lang = "zh" | "en" | "es";
export const LANG_NAMES: Record<Lang, string> = {
  zh: "Traditional Chinese (繁體中文)",
  en: "English",
  es: "Spanish (Español)",
};

export const ACCOUNT_KINDS = ["member", "student", "guest"] as const;
export type AccountKind = (typeof ACCOUNT_KINDS)[number];
export const TEACHER_PLANS = ["trial", "school"] as const;
export type TeacherPlan = (typeof TEACHER_PLANS)[number];
export const TRIAL_LIMITS = { classrooms: 3, membersPerClassroom: 40 } as const;

export const UserSchema = z.object({
  id: z.string(),
  name: z.string(),
  canManageClasses: z.boolean(),
  isAdmin: z.boolean(),
  guest: z.boolean(),
  kind: z.enum(ACCOUNT_KINDS).optional(),
  teacherPlan: z.enum(TEACHER_PLANS).nullable().optional(),
  teacherMode: z.boolean().optional(),
  teacherRequested: z.boolean().optional(),
  schoolName: z.string().nullable().optional(),
  username: z.string().nullable().optional(),
  classroomId: z.string().nullable().optional(),
  activityId: z.string().nullable().optional(),
  preview: z.boolean().optional(),
  previewClassroomId: z.string().optional(),
});
export type User = z.infer<typeof UserSchema>;

export const AUTH_PROVIDERS = ["google"] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];
export type AuthProviders = Record<AuthProvider, boolean>;

export const SoloChatSchema = z.object({
  id: z.string(),
  title: z.string(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type SoloChat = z.infer<typeof SoloChatSchema>;

export const ClassroomActivitySchema = z.object({
  id: z.string(),
  topicId: z.string(),
  topicTitle: z.string(),
  topicStatement: z.string(),
  createdAt: z.string(),
  finished: z.boolean(),
});
export type ClassroomActivity = z.infer<typeof ClassroomActivitySchema>;

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

export const LIVE_ACTIVE_WINDOW_MS = 120_000;

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
  status: z.enum(["active", "idle"]),
  rounds: z.number(),
  flags: z.array(z.object({ turn: z.number().int(), type: z.string(), excerpt: z.string() })),
  lastUtterance: z.string(),
  lastActiveAt: z.string().nullable(),
});
export type StudentLive = z.infer<typeof StudentLiveSchema>;
export const LiveBoardSchema = z.object({ students: z.array(StudentLiveSchema), finished: z.boolean() });
export type LiveBoard = z.infer<typeof LiveBoardSchema>;

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

export const LoginInputSchema = z
  .object({
    identifier: z.string().trim().toLowerCase().min(3).max(254).optional(),
    email: z.string().trim().toLowerCase().min(3).max(254).optional(),
    password: z.string().min(6).max(128),
  })
  .refine((input) => (input.identifier ?? input.email) !== undefined)
  .transform((input) => ({ identifier: (input.identifier ?? input.email)!, password: input.password }));
export const DevLoginInputSchema = z.object({ email: emailField });
export const RegisterInputSchema = z.object({
  code: z.string().min(4).max(32).optional(),
  email: emailField,
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(80).optional(),
  tosAccepted: z.boolean(),
});
export const ProfileInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    teacherMode: z.boolean().optional(),
    acceptTeacherTerms: z.literal(true).optional(),
  })
  .refine((input) => input.name !== undefined || input.teacherMode !== undefined);
export const StudentsCreateInputSchema = z.object({
  names: z.array(z.string().trim().min(1).max(80)).min(1).max(50),
});
export const StudentCredentialSchema = z.object({
  id: z.string(),
  name: z.string(),
  username: z.string(),
  password: z.string(),
});
export type StudentCredential = z.infer<typeof StudentCredentialSchema>;
export const TeacherRequestInputSchema = z.object({ acceptTeacherTerms: z.literal(true) });
export const TeacherRequestSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  requestedAt: z.string(),
});
export type TeacherRequest = z.infer<typeof TeacherRequestSchema>;

export const USAGE_THRESHOLDS = [60, 80, 100] as const;
export const UsageSchema = z.object({
  month: z.string(),
  tokens: z.number(),
  requests: z.number(),
  quota: z.number().nullable(),
  resetsAt: z.string(),
  emailReady: z.boolean(),
  thresholds: z.array(
    z.object({ threshold: z.number(), reachedAt: z.string().nullable(), emailedAt: z.string().nullable() }),
  ),
});
export type Usage = z.infer<typeof UsageSchema>;
export const UsageQuotaInputSchema = z.object({
  tokens: z.number().int().min(1000).max(100_000_000_000).nullable(),
});
export const AdminUsageAlertSchema = z.object({
  ownerId: z.string(),
  name: z.string(),
  email: z.string().nullable(),
  month: z.string(),
  threshold: z.number(),
  tokens: z.number(),
  quota: z.number().nullable(),
  createdAt: z.string(),
  emailedAt: z.string().nullable(),
});
export type AdminUsageAlert = z.infer<typeof AdminUsageAlertSchema>;

export const AdminOverviewSchema = z.object({
  users: z.number(),
  teachers: z.number(),
  students: z.number(),
  classrooms: z.number(),
  runningActivities: z.number(),
  pendingRequests: z.number(),
  schools: z.number(),
});
export type AdminOverview = z.infer<typeof AdminOverviewSchema>;

export const NotificationInputSchema = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().trim().max(2000),
});
export const NotificationSchema = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof NotificationSchema>;
export const NotificationFeedSchema = z.object({ items: z.array(NotificationSchema), unread: z.number() });
export type NotificationFeed = z.infer<typeof NotificationFeedSchema>;

export const SchoolInputSchema = z.object({ name: z.string().trim().min(1).max(120) });
export const SchoolSchema = z.object({
  id: z.string(),
  name: z.string(),
  teacherCount: z.number(),
  createdAt: z.string(),
});
export type School = z.infer<typeof SchoolSchema>;
export const SchoolTeacherInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  email: emailField,
  schoolId: z.string().min(1),
});
export const SchoolTeacherSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  schoolId: z.string(),
  schoolName: z.string(),
  temporaryPassword: z.string().nullable().optional(),
});
export type SchoolTeacher = z.infer<typeof SchoolTeacherSchema>;
export const SoloChatInputSchema = z.object({ title: z.string().trim().min(1).max(120) });
export const SignupInputSchema = z.object({
  email: emailField,
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(80).optional(),
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
  teacherPlan: z.enum(TEACHER_PLANS).nullable().optional(),
  schoolName: z.string().nullable().optional(),
  classrooms: z.number().optional(),
  username: z.string().nullable().optional(),
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
export const ClassroomRenameInputSchema = z.object({ name: z.string().trim().min(1).max(80) });
export const ClassroomCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
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

export const AnnouncementInputSchema = z.object({ body: z.string().trim().min(1).max(2000) });
export const PostInputSchema = z.object({
  body: z.string().trim().min(1).max(2000),
  parentId: z.string().min(1).optional(),
});

export const AnnouncementSchema = z.object({
  id: z.string(),
  body: z.string(),
  authorName: z.string(),
  createdAt: z.string(),
});
export type Announcement = z.infer<typeof AnnouncementSchema>;

export const ClassroomMembersSchema = z.object({
  teacher: z.object({ id: z.string(), name: z.string() }),
  members: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      joinedAt: z.string(),
      kind: z.enum(ACCOUNT_KINDS).optional(),
      username: z.string().nullable().optional(),
    }),
  ),
});
export type ClassroomMembers = z.infer<typeof ClassroomMembersSchema>;

export const PostReplySchema = z.object({
  id: z.string(),
  body: z.string(),
  authorId: z.string(),
  authorName: z.string(),
  isTeacher: z.boolean(),
  createdAt: z.string(),
});
export type PostReply = z.infer<typeof PostReplySchema>;
export const PostSchema = PostReplySchema.extend({ replies: z.array(PostReplySchema) });
export type Post = z.infer<typeof PostSchema>;

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

export const TeacherKeyStatusSchema = z.object({
  id: z.string(),
  provider: z.string(),
  model: z.string(),
  last4: z.string(),
  sortOrder: z.number(),
  updatedAt: z.string(),
});
export type TeacherKeyStatus = z.infer<typeof TeacherKeyStatusSchema>;
export const TeacherKeyCreateInputSchema = z
  .object({
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    key: z.string().min(8).max(256).optional(),
    fromEntry: z.string().min(1).max(64).optional(),
  })
  .refine((input) => Boolean(input.key) !== Boolean(input.fromEntry));
export const TeacherKeyUpdateInputSchema = z
  .object({ model: z.string().min(1).max(200).optional(), key: z.string().min(8).max(256).optional() })
  .refine((input) => input.model !== undefined || input.key !== undefined);
export const TeacherKeyOrderInputSchema = z.object({ ids: z.array(z.string().min(1).max(64)).max(50) });

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
  "account_required",
  "oauth_unavailable",
  "oauth_state_invalid",
  "oauth_email_unverified",
  "oauth_failed",
  "email_taken",
  "teacher_required",
  "teacher_terms_required",
  "teacher_approval_required",
  "trial_limit",
  "student_restricted",
  "guest_session_expired",
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

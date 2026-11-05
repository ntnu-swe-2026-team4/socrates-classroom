import { z } from "zod";

export type Lang = "zh" | "en" | "es";

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

export const DialogueMessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant"]),
  text: z.string(),
  at: z.string(),
});
export type DialogueMessage = z.infer<typeof DialogueMessageSchema>;

export const DialogueSseEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("delta"), data: z.object({ text: z.string() }) }),
  z.object({ event: z.literal("done"), data: z.object({ message: DialogueMessageSchema }) }),
  z.object({ event: z.literal("error"), data: z.object({ message: z.string(), code: z.string() }) }),
]);
export type DialogueSseEvent = z.infer<typeof DialogueSseEventSchema>;

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

export const ActivitySseEventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("live"), data: z.array(StudentLiveSchema), id: z.number().optional() }),
  z.object({ event: z.literal("update"), data: StudentLiveSchema, id: z.number().optional() }),
  z.object({
    event: z.literal("violation"),
    data: z.object({ studentId: z.string(), turn: z.number(), type: z.string(), excerpt: z.string() }),
    id: z.number().optional(),
  }),
]);
export type ActivitySseEvent = z.infer<typeof ActivitySseEventSchema>;

export const HexagonAxisSchema = z.object({ label: z.string(), value: z.number() });
export type HexagonAxis = z.infer<typeof HexagonAxisSchema>;

export const ArgumentPointSchema = z.object({
  claim: z.string(),
  reason: z.string(),
  tension: z.string(),
});
export type ArgumentPoint = z.infer<typeof ArgumentPointSchema>;

export const ViolationSliceSchema = z.object({
  turn: z.number(),
  type: z.string(),
  excerpt: z.string(),
});
export type ViolationSlice = z.infer<typeof ViolationSliceSchema>;

export const ReportAxisSchema = z.object({
  name: z.string(),
  left: z.string(),
  right: z.string(),
  color: z.string(),
});
export type ReportAxis = z.infer<typeof ReportAxisSchema>;

export const StancePointSchema = z.object({
  pseudonym: z.string(),
  values: z.array(z.number()),
  cluster: z.number(),
});
export type StancePoint = z.infer<typeof StancePointSchema>;

export const GroupReportSchema = z.object({
  axes: z.array(ReportAxisSchema),
  points: z.array(StancePointSchema),
  clusters: z.array(z.object({ id: z.number(), label: z.string() })),
});
export type GroupReport = z.infer<typeof GroupReportSchema>;

export const IndividualReportSchema = z.object({
  pseudonym: z.string(),
  hexagon: z.array(HexagonAxisSchema),
  arguments: z.array(ArgumentPointSchema),
  violations: z.array(ViolationSliceSchema),
});
export type IndividualReport = z.infer<typeof IndividualReportSchema>;

export const TeacherReportSchema = z.object({
  topicTitle: z.string(),
  group: GroupReportSchema,
  individuals: z.array(IndividualReportSchema),
});
export type TeacherReport = z.infer<typeof TeacherReportSchema>;

export const StudentReportSchema = z.object({
  topicTitle: z.string(),
  group: GroupReportSchema,
  individual: IndividualReportSchema,
});
export type StudentReport = z.infer<typeof StudentReportSchema>;

export const TermExplanationSchema = z.object({ term: z.string(), markdown: z.string() });
export type TermExplanation = z.infer<typeof TermExplanationSchema>;

export const ByokStatusSchema = z.object({ provider: z.string(), last4: z.string() });
export type ByokStatus = z.infer<typeof ByokStatusSchema>;

export const LoginInputSchema = z.object({ email: z.email(), password: z.string().min(8).max(128) });
export const RegisterInputSchema = z.object({
  code: z.string().min(4).max(32),
  email: z.email(),
  password: z.string().min(8).max(128),
  name: z.string().trim().min(1).max(80),
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
  prompts: z.array(z.string().trim().min(1).max(160)).min(1).max(6),
});
export const GenerateTopicsInputSchema = z.object({
  direction: z.string().trim().min(1).max(200),
});
export const ClassroomCreateInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  topicId: z.string().min(1),
});
export const DialogueInputSchema = z.object({ text: z.string().trim().min(1).max(2000) });
export const LookupInputSchema = z.object({ term: z.string().trim().min(1).max(30) });
export const TtsInputSchema = z.object({ text: z.string().min(1).max(2000), lang: z.enum(["zh", "en", "es"]) });
export const ByokSetInputSchema = z.object({
  provider: z.enum(["openrouter", "opencode-go"]),
  key: z.string().min(8).max(256),
});

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

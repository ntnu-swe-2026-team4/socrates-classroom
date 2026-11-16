import { httpApi, type Api } from "./http";

export const api: Api = httpApi;
export { ApiError } from "./http";
export type { Api } from "./http";
export type {
  ActivityInfo,
  ActivityInvite,
  ActivityMode,
  ActivitySlot,
  ActivitySlots,
  ActivityStarted,
  AdminUser,
  ClassroomCreated,
  ClassroomSummary,
  DevAccount,
  DevAccountClassroom,
  DevAccounts,
  InviteInfo,
  InviteJoined,
  JoinInfo,
  JoinResult,
  Report,
  ReportPosition,
  StudentAnalysis,
  StudentLive,
  TeacherReport,
  TermExplanation,
  Topic,
  TopicDraft,
  User,
  ViolationSlice,
} from "@socrates/shared";
export { readTermHistory, recordTerm, readActivityId, persistActivityId } from "./local";
export type { TermQuery } from "./local";

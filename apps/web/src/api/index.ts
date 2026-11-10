import { httpApi, type Api } from "./http";

export const api: Api = httpApi;
export { ApiError } from "./http";
export type { Api } from "./http";
export type {
  ActivityInfo,
  ClassroomCreated,
  ClassroomSummary,
  JoinInfo,
  Report,
  ReportPosition,
  StudentAnalysis,
  StudentLive,
  TeacherReport,
  TermExplanation,
  Topic,
  User,
  ViolationSlice,
} from "@socrates/shared";
export { readTermHistory, recordTerm, readActivityId, persistActivityId } from "./local";
export type { TermQuery } from "./local";

import { httpApi, type Api, type ByokStatus } from "./http";

export const api: Api = httpApi;
export { ApiError } from "./http";
export type { Api, ByokStatus };
export type {
  ActivityInfo,
  ClassroomCreated,
  JoinInfo,
  Report,
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

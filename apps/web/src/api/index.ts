import { httpApi, type Api, type ByokStatus } from "./http";

export const api: Api = httpApi;
export { ApiError } from "./http";
export type { Api, ByokStatus };
export type {
  ActivityInfo,
  ClassroomCreated,
  GroupReport,
  JoinInfo,
  Report,
  StudentLive,
  TeacherReport,
  TermExplanation,
  Topic,
  User,
} from "@socrates/shared";
export { readTermHistory, recordTerm, readActivityId, persistActivityId } from "./local";
export type { TermQuery } from "./local";

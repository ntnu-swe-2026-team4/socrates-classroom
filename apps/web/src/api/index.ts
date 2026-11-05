import { httpApi } from "./http";
import type { Api } from "./types";

export const api: Api = httpApi;
export type * from "./types";
export { ApiError } from "./types";
export { readTermHistory, recordTerm, readActivityId, persistActivityId } from "./local";

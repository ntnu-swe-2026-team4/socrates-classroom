import { httpApi } from "./http";
import { mockApi } from "./client";
import type { Api } from "./types";

export const api: Api = import.meta.env.VITE_API_MODE === "http" ? httpApi : mockApi;
export type * from "./types";
export { ApiError } from "./types";
export { readTermHistory, recordTerm, readActivityId, persistActivityId } from "./local";

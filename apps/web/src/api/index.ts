import type { Api } from "./api";
import { httpApi } from "./http";

export * from "./types";
export type { Api } from "./api";

export const api: Api = import.meta.env.VITE_API_MODE === "mock" ? (await import("./mock")).mockApi : httpApi;

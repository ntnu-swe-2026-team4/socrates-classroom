import type { Api } from "./api";
import { httpApi } from "./http";

export * from "./types";
export type { Api } from "./api";

/**
 * VITE_API_MODE=http 才會連後端；預設用內建的示範資料（src/mock，只在 mock 模式才會被打包）。
 */
export const api: Api = import.meta.env.VITE_API_MODE === "http" ? httpApi : (await import("./mock")).mockApi;

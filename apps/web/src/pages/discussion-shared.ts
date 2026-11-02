import type { DiscussionSessionStatus } from "@/api/types";

export const SESSION_NAME: Record<DiscussionSessionStatus, string> = {
  submitted: "已送出結論",
  talking: "對話中",
  todo: "未開始",
};
export const SESSION_TONE: Record<DiscussionSessionStatus, "olive" | "bronze" | "neutral"> = {
  submitted: "olive",
  talking: "bronze",
  todo: "neutral",
};

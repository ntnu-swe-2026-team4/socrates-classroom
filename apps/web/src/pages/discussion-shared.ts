import type { DiscussionSessionStatus } from "@/api/types";

/** 討論狀態的顯示文案與色調；列表頁（DiscussionTasks）與作業頁（DiscussionTaskPage）共用，
 *  抽成獨立模組避免兩頁互相 import 成循環。 */
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

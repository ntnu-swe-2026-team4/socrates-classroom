export const STORY_SCENES = [
  {
    title: "喚醒一段對話",
    text: "一群工程師，在漫長的開發之中，重新喚醒了一個活在兩千四百年前的靈魂。",
    animations: [1, 2],
    aside: "",
  },
  {
    title: "每個人都帶著問題",
    text: "消息傳開之後，人們趨之若鶩——每個人都渴望，能和這位「希臘三哲」對話。",
    animations: [3, 4],
    aside: "他從不直接給答案。",
  },
  {
    title: "讓問題被聽見",
    text: "蘇格拉底接受了每一個問題——",
    animations: [5, 6],
    aside: "",
  },
  {
    title: "找到自己的答案",
    text: "但他從不直接回答，只用一個又一個提問，領著你走向自己的答案。",
    animations: [7, 8],
    aside: "",
  },
] as const;

// Match the compositions in public/landing; reserve their shape before lazy loading.
export const ANIMATION_ASPECT_RATIOS: Record<number, string> = {
  1: "720 / 416", 2: "720 / 383", 3: "720 / 331", 4: "720 / 248",
  5: "720 / 353", 6: "720 / 257", 7: "720 / 325", 8: "720 / 353",
};

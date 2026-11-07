// class-report：群體報告（#74）。讀題目和全班的對話紀錄，整理每位學生的想法、訂立場軸、給每條軸上的落點
// 軸越少越好：只有前面的軸分不開想法不同的學生時才加一條
// 落點放在每條軸底下：寫落點時，這條軸兩端的定義就在正上方
import { defineOneShot, Type } from "../../runtime/index.ts";

const id = Type.String({ description: "student ID" });
const turns = Type.Array(Type.Integer({ minimum: 1 }), {
  minItems: 1,
  description: "line numbers where they talked about this axis",
});
const view = Type.String({ description: "their thinking on this axis, one plain sentence" });
// 一條軸的落點至少要有兩種 end，不然這條軸沒有分開任何人
const has = (end: string) => ({ contains: { properties: { end: { const: end } }, required: ["end"] } });
const twoEnds = {
  anyOf: [
    { allOf: [has("low"), has("high")] },
    { allOf: [has("low"), has("middle")] },
    { allOf: [has("middle"), has("high")] },
  ],
};

export default defineOneShot({
  input: Type.Object({
    title: Type.String({ description: "題目名稱" }),
    statement: Type.String({ description: "題目情境" }),
    students: Type.Array(
      Type.Object({
        id: Type.String({ description: "學生代號，不含真名" }),
        transcript: Type.String({
          description: "這位學生的對話紀錄，一行一則；學生的話依序編號（AI：… / 學生（1）：…）",
        }),
      }),
      { description: "全班的對話紀錄" },
    ),
    locale: Type.Optional(Type.String({ description: "預設語言（瀏覽器語言，例：zh-TW、en）；不給就用繁體中文" })),
  }),

  output: Type.Object({
    students: Type.Array(
      Type.Object({
        id,
        summary: Type.Array(
          Type.Object({
            step: Type.String({
              pattern: '^[^「」“”"]*$',
              description: "cause → result, in plain words, not copying their exact words, no quotation marks",
            }),
            turns: Type.Array(Type.Integer({ minimum: 1 }), {
              minItems: 1,
              description: "line numbers this step is based on",
            }),
          }),
          { minItems: 1, maxItems: 3, description: "summary: their thinking, one to three steps" },
        ),
      }),
      { description: "students who stated a position, in roster order" },
    ),
    unstated: Type.Array(Type.String(), { description: "IDs of students who never stated a position" }),
    axes: Type.Array(
      Type.Object({
        name: Type.String({ description: "what this axis asks" }),
        low: Type.String({ description: "the position at the 0 end" }),
        high: Type.String({ description: "the position at the 100 end" }),
        positions: Type.Array(
          Type.Union([
            Type.Object({ id, turns, view, end: Type.Literal("low"), at: Type.Integer({ minimum: 0, maximum: 49 }) }),
            Type.Object({
              id,
              turns,
              view,
              end: Type.Literal("high"),
              at: Type.Integer({ minimum: 51, maximum: 100 }),
            }),
            Type.Object({ id, turns, view, end: Type.Literal("middle"), at: Type.Literal(50) }),
          ]),
          {
            ...twoEnds,
            description:
              "positions on this axis of the students who talked about it: toward low (0-49), toward high (51-100), between the ends (50); do not list students who did not talk about it; end must have at least two kinds; do not set an axis where all fall at the same end",
          },
        ),
        why: Type.String({
          description:
            "why this axis is needed, naming only students listed in positions above: the first axis states the class's main disagreement; each later one states which students it separates who could not be separated on the earlier axes",
        }),
      }),
      { minItems: 1, description: "the questions this class actually disagrees on, as few as possible" },
    ),
    overview: Type.Array(Type.String(), {
      minItems: 1,
      maxItems: 5,
      description: "class overview: main disagreement, reasons most rely on, common things not yet thought through",
    }),
  }),

  example: {
    title: "電車難題",
    statement: "拉下拉桿，電車會轉進側線，撞死一個人，救下五個人。你會拉桿嗎？",
    students: [
      {
        id: "S01",
        transcript:
          "AI：你會拉嗎？\n學生（1）：會，五個人比一個人多。\nAI：那推一個人下去擋車，也是死一個救五個，你會推嗎？\n學生（2）：不會，那太可怕了。\nAI：拉桿跟推人差在哪？\n學生（3）：不知道，就感覺不一樣。",
      },
      {
        id: "S02",
        transcript:
          "AI：你會拉嗎？\n學生（1）：會，死一個總比死五個好。\nAI：那推一個人下去擋車，你會推嗎？\n學生（2）：會，一樣是一換五，怎麼做的不重要。",
      },
      {
        id: "S03",
        transcript:
          "AI：你會拉嗎？\n學生（1）：不會，拉了就是我殺了那個人。\nAI：不拉的話五個人會死，這樣也是你造成的嗎？\n學生（2）：不是，車本來就會撞過去，不是我開的。",
      },
      {
        id: "S04",
        transcript: "AI：你會拉嗎？\n學生（1）：幫我算一下微積分。\nAI：先回到電車，你會拉嗎？\n學生（2）：我要走了。",
      },
    ],
  },

  exampleOutput: {
    students: [
      {
        id: "S01",
        summary: [
          { step: "救多數 → 會拉", turns: [1] },
          { step: "推人感覺可怕 → 不推，說不出跟拉桿差在哪", turns: [2, 3] },
        ],
      },
      {
        id: "S02",
        summary: [
          { step: "死得少比較好 → 會拉", turns: [1] },
          { step: "怎麼做不重要，只看一換五 → 也會推", turns: [2] },
        ],
      },
      {
        id: "S03",
        summary: [
          { step: "拉了就是自己殺人 → 不拉", turns: [1] },
          { step: "不拉是車撞的 → 不算自己造成", turns: [2] },
        ],
      },
    ],
    unstated: ["S04"],
    axes: [
      {
        name: "人數能不能決定",
        low: "能：救多數就該做",
        high: "不能：不能為了多數讓一個人死",
        positions: [
          { id: "S01", turns: [1], view: "人多就該救，所以拉", end: "low", at: 25 },
          { id: "S02", turns: [1], view: "死得少比較好，所以拉", end: "low", at: 15 },
          { id: "S03", turns: [1], view: "拉了就是自己殺人，人多也不行", end: "high", at: 85 },
        ],
        why: "全班主要的分歧：S01、S02 靠人數會拉，S03 認為拉了就是殺人",
      },
      {
        name: "自己動手有沒有差",
        low: "沒差：結果一樣就一樣",
        high: "有差：自己動手造成的死比較嚴重",
        positions: [
          { id: "S01", turns: [2, 3], view: "推人比拉桿可怕，但說不出差在哪", end: "high", at: 60 },
          { id: "S02", turns: [2], view: "怎麼做都一樣，只看一換五", end: "low", at: 10 },
          { id: "S03", turns: [2], view: "自己拉才算自己造成，不拉是車撞的", end: "high", at: 90 },
        ],
        why: "S01、S02 在人數上一樣，但 S01 不肯推人、S02 肯推",
      },
    ],
    overview: [
      "主要分歧在人數能不能決定：S01、S02 靠人數，S03 認為自己動手殺人就不行",
      "靠人數的人裡，自己動手有沒有差又分兩種：S02 只看結果，S01 覺得有差但說不出差在哪",
    ],
  },
});

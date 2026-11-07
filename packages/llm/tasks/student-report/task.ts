// student-report：個人報告（#74 工作 3）。讀題目和一位學生的對話紀錄，寫論點總結：主張、理由、張力
// 主張、理由、張力各寫成一段給老師讀的總結文字，turns 是出處（他第幾句）
// 立場落點不在這裡算：直接用 class-report 算出的落點，兩份報告才會一致
// 違規片段不經 LLM：後端直接讀 violations 表（#71）附上
import { defineOneShot, Type } from "../../runtime/index.ts";

const turns = Type.Array(Type.Integer({ minimum: 1 }), { minItems: 1, description: "line numbers it is based on" });
const plain = (description: string) =>
  Type.String({ description: `${description}; write flowing sentences in plain words, not copying their exact words` });
const part = (description: string) => Type.Object({ text: plain(description), turns });

export default defineOneShot({
  input: Type.Object({
    title: Type.String({ description: "題目名稱" }),
    statement: Type.String({ description: "題目情境" }),
    transcript: Type.String({ description: "這位學生的對話紀錄，一行一則；學生的話依序編號（AI：… / 學生（1）：…）" }),
    locale: Type.Optional(Type.String({ description: "預設語言（瀏覽器語言，例：zh-TW、en）；不給就用繁體中文" })),
  }),

  output: Type.Object({
    report: Type.Union(
      [
        Type.Object({
          stated: Type.Literal(true),
          claim: part("claim: their final position, one sentence; if it changed, write what it changed from and to"),
          reasons: part("reasons: one paragraph summarizing why they think so"),
          tension: Type.Union(
            [
              part(
                "tension: one paragraph summarizing where they contradict themselves, were stumped, or have not thought it through",
              ),
              Type.Null(),
            ],
            { description: "tension; null if there is none" },
          ),
        }),
        Type.Object({
          stated: Type.Literal(false),
          doing: Type.String({
            description: "what they did throughout, e.g. only talked about other things, left quickly",
          }),
          turns,
        }),
      ],
      { description: "stated: whether they stated their own position on the original topic" },
    ),
  }),

  example: {
    title: "電車難題",
    statement: "拉下拉桿，電車會轉進側線，撞死一個人，救下五個人。你會拉桿嗎？",
    transcript:
      "AI：你會拉嗎？\n學生（1）：會，五個人比一個人多。\nAI：那推一個人下去擋車，也是死一個救五個，你會推嗎？\n學生（2）：不會，那太可怕了。\nAI：拉桿跟推人差在哪？\n學生（3）：不知道，就感覺不一樣。",
  },

  exampleOutput: {
    report: {
      stated: true,
      claim: { text: "會拉桿，但不會推人。", turns: [1, 2] },
      reasons: { text: "他會拉，是因為五個人比一個人多；推人他不肯，因為覺得那太可怕。", turns: [1, 2] },
      tension: {
        text: "拉桿和推人都是死一個救五個，他拉卻不推，被問兩者差在哪時說不出來，只說感覺不一樣。",
        turns: [3],
      },
    },
  },
});

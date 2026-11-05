import { Hono } from "hono";
import { z } from "zod";
import { GenerateTopicsInputSchema, LANG_NAMES, TopicCreateInputSchema } from "@socrates/shared";
import { all, one, run } from "../db/d1";
import { langOf, newId, nowIso, parseBody, requireTeacher, type AppEnv } from "../http";
import { parsePrompts, type TopicRow } from "../services/members";
import { getOneshotBundle, oneshot } from "../providers/oneshot";

const GeneratedTopicsSchema = z.object({
  topics: z
    .array(
      z.object({
        title: z.string(),
        statement: z.string(),
        prompts: z.array(z.string()).min(1).max(6),
      }),
    )
    .min(1)
    .max(6),
});

export function topicsRoutes() {
  return new Hono<AppEnv>()
    .get("/topics", async (c) => {
      const user = requireTeacher(c);
      const rows = await all<TopicRow>(
        c.env.DB,
        "SELECT * FROM topics WHERE owner_id IS NULL OR owner_id = $uid ORDER BY created_at, id",
        { uid: user.id },
      );
      return c.json(rows.map(parsePrompts));
    })
    .post("/topics", async (c) => {
      const user = requireTeacher(c);
      const input = await parseBody(c, TopicCreateInputSchema);
      const id = newId("t_");
      await run(
        c.env.DB,
        "INSERT INTO topics (id, owner_id, title, statement, summary, prompts, created_at) VALUES ($id, $uid, $title, $statement, $summary, $prompts, $at)",
        {
          id,
          uid: user.id,
          title: input.title,
          statement: input.statement,
          summary: input.summary ?? null,
          prompts: JSON.stringify(input.prompts),
          at: nowIso(),
        },
      );
      const row = await one<TopicRow>(c.env.DB, "SELECT * FROM topics WHERE id = $id", { id });
      return c.json(row ? parsePrompts(row) : null, 201);
    })
    .post("/topics/generate", async (c) => {
      requireTeacher(c);
      const input = await parseBody(c, GenerateTopicsInputSchema);
      const lang = langOf(c);
      const result = await oneshot(c.env, getOneshotBundle(c.env), {
        system: `You draft discussion topic sets for a Socratic philosophy classroom (Sandel-style). Write every title, statement, and prompt in ${LANG_NAMES[lang]}. Reply with JSON only.`,
        user: `Direction: ${input.direction}. Produce 3 topics, each with a title, a one-sentence statement, and 2-3 Socratic opening prompts.`,
        schema: GeneratedTopicsSchema,
        mock: () => ({
          topics: [1, 2, 3].map((n) => ({
            title: `${input.direction}（提案 ${n}）`,
            statement: `針對「${input.direction}」設計的蘇格拉底式討論提案 ${n}：先給定一個具體兩難情境，再邀請學生表態與辯護。`,
            prompts: ["你的直覺判斷是什麼？為什麼？", "如果條件改變，你的判斷還成立嗎？"],
          })),
        }),
      });
      return c.json(
        result.topics.map((topic, index) => ({
          id: `gen_${Date.now()}_${index}`,
          title: topic.title,
          statement: topic.statement,
          prompts: topic.prompts,
        })),
      );
    });
}

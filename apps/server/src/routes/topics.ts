import { Hono } from "hono";
import { GenerateTopicsInputSchema, TopicCreateInputSchema, LANG_NAMES, TopicGenSchema } from "@socrates/shared";
import { all, one, run } from "../db/d1";
import { enforceIpLimit, fail, langOf, newId, nowIso, parseBody, requireTeacher, type AppEnv } from "../http";
import { parsePrompts, type TopicRow } from "../services/members";
import { openProfileHarness, runProfile } from "../pi/agents/profiles";

function mockTopics(direction: string) {
  return {
    topics: [1, 2, 3].map((n) => ({
      title: `${direction}（提案 ${n}）`,
      statement: `針對「${direction}」設計的蘇格拉底式討論提案 ${n}：先給定一個具體兩難情境，再邀請學生表態與辯護。`,
      prompts: ["你的直覺判斷是什麼？為什麼？", "如果條件改變，你的判斷還成立嗎？"],
    })),
  };
}

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
      if (!row) fail(500, "internal_error");
      return c.json(parsePrompts(row), 201);
    })
    .post("/topics/generate", async (c) => {
      await enforceIpLimit(c, "topics-generate", 10);
      requireTeacher(c);
      const input = await parseBody(c, GenerateTopicsInputSchema);
      if (!c.env.AI || c.env.LLM_PROVIDER === "mock") {
        return c.json(
          mockTopics(input.direction).topics.map((topic, index) => ({
            id: `gen_${Date.now()}_${index}`,
            ...topic,
          })),
        );
      }
      try {
        const user = requireTeacher(c);
        const { harness, runtime, teacherLegs } = await openProfileHarness(c.env, "topic-gen", async () => user.id);
        const { text } = await runProfile(
          harness,
          runtime,
          "topic-gen",
          `Direction: ${input.direction}\n\nWrite in ${LANG_NAMES[langOf(c)]}.`,
          await teacherLegs,
        );
        const parsed = TopicGenSchema.safeParse(JSON.parse(text));
        if (!parsed.success) throw new Error("schema_mismatch");
        return c.json(
          parsed.data.topics.map((topic, index) => ({
            id: `gen_${Date.now()}_${index}`,
            ...topic,
          })),
        );
      } catch (error) {
        console.error("[topics/generate] failed", error);
        return c.json(
          mockTopics(input.direction).topics.map((topic, index) => ({
            id: `gen_${Date.now()}_${index}`,
            ...topic,
          })),
        );
      }
    });
}

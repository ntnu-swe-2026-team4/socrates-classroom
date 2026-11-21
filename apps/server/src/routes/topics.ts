import { Hono } from "hono";
import {
  GenerateTopicsInputSchema,
  TopicCopyInputSchema,
  TopicCreateInputSchema,
  LANG_NAMES,
  TopicGenSchema,
  ApiError,
} from "@socrates/shared";
import { all, one, run } from "../db/d1";
import {
  enforceIpLimit,
  fail,
  guardUser,
  langOf,
  newId,
  nowIso,
  parseBody,
  requireUser,
  validateJson,
  type AppEnv,
} from "../http";
import { classroomAccess, parsePrompts, type TopicRow } from "../services/members";
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
      const user = requireUser(c);
      const rows = await all<TopicRow>(
        c.env.DB,
        "SELECT * FROM topics WHERE classroom_id IS NULL AND (owner_id IS NULL OR owner_id = $uid) ORDER BY created_at, id",
        { uid: user.id },
      );
      return c.json(rows.map(parsePrompts));
    })
    .post("/topics/:id/copy", guardUser(), validateJson(TopicCopyInputSchema), async (c) => {
      const user = requireUser(c);
      const input = c.req.valid("json");
      const { classroom, isTeacher } = await classroomAccess(c.env.DB, input.classroomId, user);
      if (!isTeacher) fail(403, "forbidden");
      const source = await one<TopicRow>(c.env.DB, "SELECT * FROM topics WHERE id = $id", { id: c.req.param("id") });
      if (!source) fail(404, "not_found");
      if (source.classroom_id === null) {
        if (source.owner_id !== null && source.owner_id !== user.id) fail(404, "not_found");
      } else {
        const owner = await one<{ teacher_id: string }>(c.env.DB, "SELECT teacher_id FROM classrooms WHERE id = $id", {
          id: source.classroom_id,
        });
        if (owner?.teacher_id !== user.id) fail(404, "not_found");
      }
      const id = newId("t_");
      await run(
        c.env.DB,
        "INSERT INTO topics (id, owner_id, classroom_id, copied_from, title, statement, summary, prompts, created_at) VALUES ($id, $uid, $cid, $from, $title, $statement, $summary, $prompts, $at)",
        {
          id,
          uid: user.id,
          cid: classroom.id,
          from: source.id,
          title: source.title,
          statement: source.statement,
          summary: source.summary,
          prompts: source.prompts,
          at: nowIso(),
        },
      );
      const row = await one<TopicRow>(c.env.DB, "SELECT * FROM topics WHERE id = $id", { id });
      if (!row) fail(500, "internal_error");
      return c.json(parsePrompts(row), 201);
    })
    .post("/topics", async (c) => {
      const user = requireUser(c);
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
      const input = await parseBody(c, GenerateTopicsInputSchema);
      requireUser(c);
      if (c.env.LLM_PROVIDER === "mock") {
        return c.json(
          mockTopics(input.direction).topics.map((topic, index) => ({
            id: `gen_${Date.now()}_${index}`,
            ...topic,
          })),
          200,
          { "X-Socrates-Fallback": "mock" },
        );
      }
      if (!c.env.AI) fail(502, "llm_unavailable");
      try {
        const user = requireUser(c);
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
        if (error instanceof ApiError) throw error;
        console.error("[topics/generate] failed", error instanceof Error ? error.name : typeof error);
        fail(502, "llm_unavailable");
      }
    });
}

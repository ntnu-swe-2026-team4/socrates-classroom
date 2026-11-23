import { Hono } from "hono";
import {
  GenerateTopicsInputSchema,
  TopicCopyInputSchema,
  TopicCreateInputSchema,
  TopicGenSchema,
  ApiError,
  type TopicDraft,
} from "@socrates/shared";
import { all, one, run } from "../db/d1";
import { fail, guardUser, langOf, newId, nowIso, rateLimit, requireUser, validateJson, type AppEnv } from "../http";
import { classroomAccess, parsePrompts, topicCopyInsert, type TopicRow } from "../services/members";
import { openProfileHarness, runProfile } from "../pi/agents/profiles";
import { topicGenInput } from "../prompts/assemble";

function mockTopics(direction: string) {
  return {
    topics: [1, 2, 3].map((n) => ({
      title: `${direction}（提案 ${n}）`,
      statement: `針對「${direction}」設計的蘇格拉底式討論提案 ${n}：先給定一個具體兩難情境，再邀請學生表態與辯護。`,
      prompts: ["你的直覺判斷是什麼？為什麼？", "如果條件改變，你的判斷還成立嗎？"],
    })),
  };
}

function withGeneratedTopicIds(topics: Array<{ title: string; statement: string; prompts: string[] }>): TopicDraft[] {
  return topics.map((topic, index) => ({
    id: `gen_${Date.now()}_${index}`,
    ...topic,
    axes: [],
  }));
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
      const copy = topicCopyInsert(source, { id, userId: user.id, classroomId: classroom.id, axes: input.axes });
      await run(c.env.DB, copy.sql, copy.params);
      const row = await one<TopicRow>(c.env.DB, "SELECT * FROM topics WHERE id = $id", { id });
      if (!row) fail(500, "internal_error");
      return c.json(parsePrompts(row), 201);
    })
    .post("/topics", guardUser(), validateJson(TopicCreateInputSchema), async (c) => {
      const user = requireUser(c);
      const input = c.req.valid("json");
      const id = newId("t_");
      await run(
        c.env.DB,
        "INSERT INTO topics (id, owner_id, title, statement, summary, prompts, axes, created_at) VALUES ($id, $uid, $title, $statement, $summary, $prompts, $axes, $at)",
        {
          id,
          uid: user.id,
          title: input.title,
          statement: input.statement,
          summary: input.summary ?? null,
          prompts: JSON.stringify(input.prompts),
          axes: JSON.stringify(input.axes),
          at: nowIso(),
        },
      );
      const row = await one<TopicRow>(c.env.DB, "SELECT * FROM topics WHERE id = $id", { id });
      if (!row) fail(500, "internal_error");
      return c.json(parsePrompts(row), 201);
    })
    .post("/topics/generate", rateLimit("topics-generate", 10), validateJson(GenerateTopicsInputSchema), async (c) => {
      const input = c.req.valid("json");
      requireUser(c);
      if (c.env.LLM_PROVIDER === "mock") {
        return c.json(withGeneratedTopicIds(mockTopics(input.direction).topics), 200, {
          "X-Socrates-Fallback": "mock",
        });
      }
      if (!c.env.AI) fail(502, "llm_unavailable");
      try {
        const user = requireUser(c);
        const { harness, runtime, teacherLegs } = await openProfileHarness(c.env, "topic-gen", async () => user.id);
        const { text } = await runProfile(
          harness,
          runtime,
          "topic-gen",
          topicGenInput(input.direction, langOf(c)),
          await teacherLegs,
        );
        const parsed = TopicGenSchema.safeParse(JSON.parse(text));
        if (!parsed.success) throw new Error("schema_mismatch");
        return c.json(withGeneratedTopicIds(parsed.data.topics));
      } catch (error) {
        if (error instanceof ApiError) throw error;
        console.error("[topics/generate] failed", error instanceof Error ? error.name : typeof error);
        fail(502, "llm_unavailable");
      }
    });
}

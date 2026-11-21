import { Hono } from "hono";
import {
  ActivityStartInputSchema,
  ClassroomCreateInputSchema,
  TopicCreateInputSchema,
  type ActivityMode,
  type ClassroomSummary,
  type User,
} from "@socrates/shared";
import { all, batch, one, run, type SqlEntry } from "../db/d1";
import { fail, guardUser, newId, nowIso, requireUser, validateJson, type AppEnv } from "../http";
import { classroomAccess, parsePrompts, topicForActivity, type TopicRow } from "../services/members";

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const CODE_MAX = 256 - (256 % CODE_ALPHABET.length);

function newCode(): string {
  let code = "";
  while (code.length < 6) {
    const [byte] = crypto.getRandomValues(new Uint8Array(1));
    if (byte === undefined || byte >= CODE_MAX) continue;
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length]!;
  }
  return code;
}

function baseUrl(env: { PUBLIC_BASE_URL?: string }): string {
  return env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
}

async function createActivity(
  db: D1Database,
  classroomId: string,
  topicId: string,
  mode: ActivityMode,
): Promise<string> {
  const id = newId("a_");
  const queries: SqlEntry[] = [
    {
      sql: "INSERT INTO activities (id, classroom_id, topic_id, mode, created_at) VALUES ($id, $cid, $tid, $mode, $at)",
      params: { id, cid: classroomId, tid: topicId, mode, at: nowIso() },
    },
  ];
  if (mode === "live") {
    queries.push({
      sql: "UPDATE classrooms SET current_activity_id = $aid WHERE id = $cid",
      params: { aid: id, cid: classroomId },
    });
  }
  await batch(db, queries);
  return id;
}

interface SummaryRow {
  id: string;
  name: string;
  teacher_id: string;
  teacher_name: string;
  join_code: string;
  created_at: string;
  member_count: number;
  activity_id: string | null;
  finished_at: string | null;
  topic_id: string | null;
  topic_title: string | null;
  topic_statement: string | null;
}

const SUMMARY_SQL = `SELECT c.id, c.name, c.teacher_id, u.name AS teacher_name, c.join_code, c.created_at,
  (SELECT COUNT(*) FROM members mm WHERE mm.classroom_id = c.id) AS member_count,
  a.id AS activity_id, a.finished_at, t.id AS topic_id, t.title AS topic_title, t.statement AS topic_statement
  FROM classrooms c
  JOIN users u ON u.id = c.teacher_id
  LEFT JOIN activities a ON a.id = c.current_activity_id
  LEFT JOIN topics t ON t.id = a.topic_id`;

function toSummary(row: SummaryRow, user: User, base: string): ClassroomSummary {
  const owner = row.teacher_id === user.id;
  return {
    id: row.id,
    name: row.name,
    role: owner ? "teacher" : "student",
    teacherName: row.teacher_name,
    memberCount: row.member_count,
    code: owner ? row.join_code : null,
    url: owner ? `${base}/join/${row.join_code}` : null,
    current:
      row.activity_id && row.topic_id
        ? {
            activityId: row.activity_id,
            topicId: row.topic_id,
            topicTitle: row.topic_title ?? "",
            topicStatement: row.topic_statement ?? "",
            finished: Boolean(row.finished_at),
          }
        : null,
    createdAt: row.created_at,
  };
}

export function classroomsRoutes() {
  return new Hono<AppEnv>()
    .get("/classrooms", async (c) => {
      const user = requireUser(c);
      const base = baseUrl(c.env);
      const rows = await all<SummaryRow>(
        c.env.DB,
        `${SUMMARY_SQL} WHERE c.teacher_id = $uid
           OR EXISTS (SELECT 1 FROM members m WHERE m.classroom_id = c.id AND m.user_id = $uid)
         ORDER BY c.created_at DESC`,
        { uid: user.id },
      );
      return c.json(rows.map((row) => toSummary(row, user, base)));
    })
    .post("/classrooms", guardUser(), validateJson(ClassroomCreateInputSchema), async (c) => {
      const user = requireUser(c);
      const input = c.req.valid("json");
      const id = newId("c_");
      const at = nowIso();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = newCode();
        const clash = await one<{ id: string }>(c.env.DB, "SELECT id FROM classrooms WHERE join_code = $code", {
          code,
        });
        if (clash) continue;
        try {
          await run(
            c.env.DB,
            "INSERT INTO classrooms (id, name, teacher_id, join_code, current_activity_id, created_at) VALUES ($id, $name, $tid, $code, NULL, $at)",
            { id, name: input.name, tid: user.id, code, at },
          );
        } catch {
          continue;
        }
        return c.json({ classroomId: id, code, url: `${baseUrl(c.env)}/join/${code}` }, 201);
      }
      fail(500, "internal_error");
    })
    .get("/classrooms/:id/topics", async (c) => {
      const user = requireUser(c);
      const { classroom } = await classroomAccess(c.env.DB, c.req.param("id"), user);
      const rows = await all<TopicRow>(
        c.env.DB,
        "SELECT * FROM topics WHERE classroom_id = $cid ORDER BY created_at, id",
        { cid: classroom.id },
      );
      return c.json(rows.map(parsePrompts));
    })
    .post("/classrooms/:id/topics", guardUser(), validateJson(TopicCreateInputSchema), async (c) => {
      const user = requireUser(c);
      const input = c.req.valid("json");
      const { classroom, isTeacher } = await classroomAccess(c.env.DB, c.req.param("id"), user);
      if (!isTeacher) fail(403, "forbidden");
      const id = newId("t_");
      await run(
        c.env.DB,
        "INSERT INTO topics (id, owner_id, classroom_id, title, statement, summary, prompts, created_at) VALUES ($id, $uid, $cid, $title, $statement, $summary, $prompts, $at)",
        {
          id,
          uid: user.id,
          cid: classroom.id,
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
    .post("/classrooms/:id/activities", guardUser(), validateJson(ActivityStartInputSchema), async (c) => {
      const user = requireUser(c);
      const input = c.req.valid("json");
      const { classroom, isTeacher } = await classroomAccess(c.env.DB, c.req.param("id"), user);
      if (!isTeacher) fail(403, "forbidden");
      await topicForActivity(c.env.DB, input.topicId, classroom.id, user.id);
      const activityId = await createActivity(c.env.DB, classroom.id, input.topicId, input.mode);
      return c.json(
        {
          classroomId: classroom.id,
          code: classroom.join_code,
          url: `${baseUrl(c.env)}/join/${classroom.join_code}`,
          activityId,
          mode: input.mode,
        },
        201,
      );
    });
}

import { Hono } from "hono";
import { ClassroomCreateInputSchema, type ClassroomSummary, type User } from "@socrates/shared";
import { all, one, run } from "../db/d1";
import { fail, newId, nowIso, parseBody, requireTeacher, requireUser, type AppEnv } from "../http";
import type { ClassroomRow } from "../services/members";

const CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]!).join("");
}

async function createActivity(db: D1Database, classroomId: string, topicId: string): Promise<string> {
  const id = newId("a_");
  await run(db, "INSERT INTO activities (id, classroom_id, topic_id, created_at) VALUES ($id, $cid, $tid, $at)", {
    id,
    cid: classroomId,
    tid: topicId,
    at: nowIso(),
  });
  await run(db, "UPDATE classrooms SET current_activity_id = $aid WHERE id = $cid", { aid: id, cid: classroomId });
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
    memberCount: Number(row.member_count ?? 0),
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

async function classroomSummaries(db: D1Database, user: User, classroomId?: string): Promise<SummaryRow[]> {
  const scope =
    user.role === "teacher"
      ? "c.teacher_id = $uid"
      : "EXISTS (SELECT 1 FROM members m WHERE m.classroom_id = c.id AND m.user_id = $uid)";
  const only = classroomId ? " AND c.id = $cid" : "";
  return all<SummaryRow>(db, `${SUMMARY_SQL} WHERE ${scope}${only} ORDER BY c.created_at DESC`, {
    uid: user.id,
    ...(classroomId ? { cid: classroomId } : {}),
  });
}

export function classroomsRoutes() {
  return new Hono<AppEnv>()
    .get("/classrooms", async (c) => {
      const user = requireUser(c);
      const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
      const rows = await classroomSummaries(c.env.DB, user);
      return c.json(rows.map((row) => toSummary(row, user, base)));
    })
    .get("/classrooms/:id", async (c) => {
      const user = requireUser(c);
      const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
      const [row] = await classroomSummaries(c.env.DB, user, c.req.param("id"));
      if (!row) {
        const exists = await one<{ id: string }>(c.env.DB, "SELECT id FROM classrooms WHERE id = $id", {
          id: c.req.param("id"),
        });
        fail(exists ? 403 : 404, exists ? "forbidden" : "not_found");
      }
      return c.json(toSummary(row, user, base));
    })
    .post("/classrooms", async (c) => {
      const user = requireTeacher(c);
      const input = await parseBody(c, ClassroomCreateInputSchema);
      const topic = await one<{ id: string }>(c.env.DB, "SELECT id FROM topics WHERE id = $id", {
        id: input.topicId,
      });
      if (!topic) fail(404, "not_found");
      const id = newId("c_");
      const at = nowIso();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = newCode();
        const clash = await one<{ id: string }>(c.env.DB, "SELECT id FROM classrooms WHERE join_code = $code", {
          code,
        });
        if (clash) continue;
        await run(
          c.env.DB,
          "INSERT INTO classrooms (id, name, teacher_id, join_code, current_activity_id, created_at) VALUES ($id, $name, $tid, $code, NULL, $at)",
          { id, name: input.name, tid: user.id, code, at },
        );
        const activityId = await createActivity(c.env.DB, id, input.topicId);
        const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
        void id;
        return c.json({ classroomId: id, code, url: `${base}/join/${code}`, activityId }, 201);
      }
      fail(500, "internal_error");
    })
    .post("/classrooms/:id/activities", async (c) => {
      const user = requireTeacher(c);
      const input = await parseBody(c, ClassroomCreateInputSchema);
      const classroom = await one<ClassroomRow>(c.env.DB, "SELECT * FROM classrooms WHERE id = $id", {
        id: c.req.param("id"),
      });
      if (!classroom) fail(404, "not_found");
      if (classroom.teacher_id !== user.id) fail(403, "forbidden");
      const topic = await one<{ id: string }>(c.env.DB, "SELECT id FROM topics WHERE id = $id", {
        id: input.topicId,
      });
      if (!topic) fail(404, "not_found");
      const activityId = await createActivity(c.env.DB, classroom.id, input.topicId);
      const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
      return c.json(
        {
          classroomId: classroom.id,
          code: classroom.join_code,
          url: `${base}/join/${classroom.join_code}`,
          activityId,
        },
        201,
      );
    });
}

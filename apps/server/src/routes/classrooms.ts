import { Hono } from "hono";
import {
  ActivityStartInputSchema,
  ClassroomCreateInputSchema,
  ClassroomRenameInputSchema,
  TRIAL_LIMITS,
  type ClassroomActivity,
  type ClassroomSummary,
  type Lang,
  type User,
} from "@socrates/shared";
import { getCookie } from "hono/cookie";
import { all, batch, one, run, type Db } from "../db/d1";
import { SESSION_COOKIE, enterPreviewSession, leavePreviewSession, startSession } from "../auth";
import {
  fail,
  langOf,
  newId,
  nowIso,
  parseBody,
  requireAccount,
  requireTeacher,
  requireUser,
  type AppEnv,
} from "../http";
import { TRIAL_LIMIT_VARS, translationOf, type ClassroomRow } from "../services/members";

const PREVIEW_NAMES = { zh: "測試學生", en: "Test Student", es: "Estudiante de prueba" } as const;
const UNTITLED_COURSE = { zh: "未命名課程", en: "Untitled course", es: "Curso sin título" } as const;

async function ensurePreviewStudent(db: Db, classroomId: string, lang: keyof typeof PREVIEW_NAMES): Promise<User> {
  const existing = await one<{ id: string; name: string }>(
    db,
    "SELECT id, name FROM users WHERE preview_classroom_id = $cid",
    { cid: classroomId },
  );
  if (existing)
    return { id: existing.id, name: existing.name, guest: true, preview: true, previewClassroomId: classroomId };
  const id = newId("u_");
  const at = nowIso();
  const taken = await one<{ user_id: string }>(
    db,
    "SELECT user_id FROM members WHERE classroom_id = $cid AND name = $name",
    { cid: classroomId, name: PREVIEW_NAMES[lang] },
  );
  const name = taken ? `${PREVIEW_NAMES[lang]} ${id.slice(2, 6)}` : PREVIEW_NAMES[lang];
  await batch(db, [
    {
      sql: "INSERT INTO users (id, name, is_guest, lang, preview_classroom_id, created_at) VALUES ($id, $name, 1, $lang, $cid, $at)",
      params: { id, name, lang, cid: classroomId, at },
    },
    {
      sql: "INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at) VALUES ($cid, $uid, $name, $at, $at)",
      params: { cid: classroomId, uid: id, name, at },
    },
  ]);
  return { id, name, guest: true, preview: true, previewClassroomId: classroomId };
}

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

async function createActivity(db: D1Database, classroomId: string, topicId: string): Promise<string> {
  const id = newId("a_");
  await batch(db, [
    {
      sql: "INSERT INTO activities (id, classroom_id, topic_id, created_at) VALUES ($id, $cid, $tid, $at)",
      params: { id, cid: classroomId, tid: topicId, at: nowIso() },
    },
    {
      sql: "UPDATE classrooms SET current_activity_id = $aid WHERE id = $cid",
      params: { aid: id, cid: classroomId },
    },
  ]);
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
  topic_i18n: string | null;
}

const VISIBLE_SCOPE =
  "c.teacher_id = $uid OR EXISTS (SELECT 1 FROM members m WHERE m.classroom_id = c.id AND m.user_id = $uid)";

const SUMMARY_SQL = `SELECT c.id, c.name, c.teacher_id, u.name AS teacher_name, c.join_code, c.created_at,
  (SELECT COUNT(*) FROM members mm JOIN users mu ON mu.id = mm.user_id WHERE mm.classroom_id = c.id AND mu.preview_classroom_id IS NULL) AS member_count,
  a.id AS activity_id, a.finished_at, t.id AS topic_id, t.title AS topic_title, t.statement AS topic_statement, t.i18n AS topic_i18n
  FROM classrooms c
  JOIN users u ON u.id = c.teacher_id
  LEFT JOIN activities a ON a.id = c.current_activity_id
  LEFT JOIN topics t ON t.id = a.topic_id`;

function toSummary(row: SummaryRow, user: User, base: string, lang: Lang): ClassroomSummary {
  const owner = row.teacher_id === user.id;
  const local = translationOf(row.topic_i18n, lang);
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
            topicTitle: local.title ?? row.topic_title ?? "",
            topicStatement: local.statement ?? row.topic_statement ?? "",
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
      const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
      const rows = await all<SummaryRow>(c.env.DB, `${SUMMARY_SQL} WHERE ${VISIBLE_SCOPE} ORDER BY c.created_at DESC`, {
        uid: user.id,
      });
      return c.json(rows.map((row) => toSummary(row, user, base, langOf(c))));
    })
    .get("/classrooms/:id", async (c) => {
      const user = requireUser(c);
      const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
      const row = await one<SummaryRow>(c.env.DB, `${SUMMARY_SQL} WHERE c.id = $cid AND (${VISIBLE_SCOPE})`, {
        cid: c.req.param("id"),
        uid: user.id,
      });
      if (!row) fail(404, "not_found");
      return c.json(toSummary(row, user, base, langOf(c)));
    })
    .get("/classrooms/:id/activities", async (c) => {
      const user = requireUser(c);
      const visible = await one<{ id: string }>(
        c.env.DB,
        `SELECT c.id FROM classrooms c WHERE c.id = $cid AND (${VISIBLE_SCOPE})`,
        { cid: c.req.param("id"), uid: user.id },
      );
      if (!visible) fail(404, "not_found");
      const rows = await all<{
        id: string;
        topic_id: string;
        title: string;
        statement: string;
        i18n: string | null;
        created_at: string;
        finished_at: string | null;
      }>(
        c.env.DB,
        "SELECT a.id, a.topic_id, t.title, t.statement, t.i18n, a.created_at, a.finished_at FROM activities a JOIN topics t ON t.id = a.topic_id WHERE a.classroom_id = $cid ORDER BY a.created_at DESC, a.id DESC",
        { cid: visible.id },
      );
      return c.json(
        rows.map(
          (row): ClassroomActivity => ({
            id: row.id,
            topicId: row.topic_id,
            topicTitle: translationOf(row.i18n, langOf(c)).title ?? row.title,
            topicStatement: translationOf(row.i18n, langOf(c)).statement ?? row.statement,
            createdAt: row.created_at,
            finished: Boolean(row.finished_at),
          }),
        ),
      );
    })
    .post("/classrooms", async (c) => {
      const user = requireTeacher(c);
      const input = await parseBody(c, ClassroomCreateInputSchema);
      if (user.teacherPlan === "trial") {
        const owned = await one<{ n: number }>(
          c.env.DB,
          "SELECT COUNT(*) AS n FROM classrooms WHERE teacher_id = $uid",
          {
            uid: user.id,
          },
        );
        if (Number(owned?.n ?? 0) >= TRIAL_LIMITS.classrooms) fail(403, "trial_limit", TRIAL_LIMIT_VARS);
      }
      if (input.topicId) {
        const topic = await one<{ id: string }>(
          c.env.DB,
          "SELECT id FROM topics WHERE id = $id AND (owner_id IS NULL OR owner_id = $uid)",
          { id: input.topicId, uid: user.id },
        );
        if (!topic) fail(404, "not_found");
      }
      const name = input.name ?? UNTITLED_COURSE[langOf(c)];
      const id = newId("c_");
      const at = nowIso();
      for (let attempt = 0; attempt < 5; attempt += 1) {
        const code = newCode();
        const clash = await one<{ id: string }>(c.env.DB, "SELECT id FROM classrooms WHERE join_code = $code", {
          code,
        });
        if (clash) continue;
        const activityId = input.topicId ? newId("a_") : null;
        try {
          await batch(c.env.DB, [
            {
              sql: "INSERT INTO classrooms (id, name, teacher_id, join_code, current_activity_id, created_at) VALUES ($id, $name, $tid, $code, NULL, $at)",
              params: { id, name, tid: user.id, code, at },
            },
            ...(activityId && input.topicId
              ? [
                  {
                    sql: "INSERT INTO activities (id, classroom_id, topic_id, created_at) VALUES ($aid, $cid, $tid2, $at2)",
                    params: { aid: activityId, cid: id, tid2: input.topicId, at2: at },
                  },
                  {
                    sql: "UPDATE classrooms SET current_activity_id = $aid WHERE id = $cid",
                    params: { aid: activityId, cid: id },
                  },
                ]
              : []),
          ]);
        } catch {
          continue;
        }
        const base = c.env.PUBLIC_BASE_URL?.replace(/\/$/, "") ?? "";
        return c.json({ classroomId: id, code, url: `${base}/join/${code}`, activityId }, 201);
      }
      fail(500, "internal_error");
    })
    .post("/classrooms/:id/activities", async (c) => {
      const user = requireAccount(c);
      const input = await parseBody(c, ActivityStartInputSchema);
      const classroom = await one<ClassroomRow>(c.env.DB, "SELECT * FROM classrooms WHERE id = $id", {
        id: c.req.param("id"),
      });
      if (!classroom) fail(404, "not_found");
      if (classroom.teacher_id !== user.id) fail(403, "forbidden");
      const topic = await one<{ id: string }>(
        c.env.DB,
        "SELECT id FROM topics WHERE id = $id AND (owner_id IS NULL OR owner_id = $uid)",
        { id: input.topicId, uid: user.id },
      );
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
    })
    .patch("/classrooms/:id", async (c) => {
      const user = requireAccount(c);
      const input = await parseBody(c, ClassroomRenameInputSchema);
      const classroom = await one<ClassroomRow>(c.env.DB, "SELECT * FROM classrooms WHERE id = $id", {
        id: c.req.param("id"),
      });
      if (!classroom) fail(404, "not_found");
      if (classroom.teacher_id !== user.id) fail(403, "forbidden");
      await run(c.env.DB, "UPDATE classrooms SET name = $name WHERE id = $id", { id: classroom.id, name: input.name });
      return c.json({ id: classroom.id, name: input.name });
    })
    .delete("/classrooms/:id", async (c) => {
      const user = requireAccount(c);
      const classroom = await one<ClassroomRow>(c.env.DB, "SELECT * FROM classrooms WHERE id = $id", {
        id: c.req.param("id"),
      });
      if (!classroom) fail(404, "not_found");
      if (classroom.teacher_id !== user.id) fail(403, "forbidden");
      await run(c.env.DB, "DELETE FROM classrooms WHERE id = $id", { id: classroom.id });
      return c.body(null, 204);
    })
    .post("/classrooms/:id/preview", async (c) => {
      const user = requireAccount(c);
      const classroom = await one<ClassroomRow>(c.env.DB, "SELECT * FROM classrooms WHERE id = $id", {
        id: c.req.param("id"),
      });
      if (!classroom) fail(404, "not_found");
      if (classroom.teacher_id !== user.id) fail(403, "forbidden");
      if (!classroom.current_activity_id) fail(404, "not_found");
      const student = await ensurePreviewStudent(c.env.DB, classroom.id, langOf(c));
      await enterPreviewSession(c, getCookie(c, SESSION_COOKIE), student);
      return c.json({ user: student, activityId: classroom.current_activity_id });
    })
    .post("/preview/reset", async (c) => {
      const user = requireUser(c);
      if (!user.preview) fail(403, "forbidden");
      const owner = await one<{ preview_classroom_id: string | null }>(
        c.env.DB,
        "SELECT preview_classroom_id FROM users WHERE id = $id",
        { id: user.id },
      );
      if (!owner?.preview_classroom_id) fail(403, "forbidden");
      const classroom = await one<ClassroomRow>(c.env.DB, "SELECT * FROM classrooms WHERE id = $id", {
        id: owner.preview_classroom_id,
      });
      if (!classroom?.current_activity_id) fail(404, "not_found");
      await run(c.env.DB, "DELETE FROM users WHERE id = $id", { id: user.id });
      const student = await ensurePreviewStudent(c.env.DB, classroom.id, langOf(c));
      await startSession(c, student);
      return c.json({ user: student, activityId: classroom.current_activity_id });
    })
    .post("/preview/exit", async (c) => {
      const user = requireUser(c);
      if (!user.preview) fail(403, "forbidden");
      const teacher = await leavePreviewSession(c);
      if (!teacher) fail(401, "unauthorized");
      return c.json(teacher);
    });
}

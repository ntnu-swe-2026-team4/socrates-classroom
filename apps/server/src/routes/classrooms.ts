import { Hono } from "hono";
import {
  ActivityStartInputSchema,
  ClassroomCreateInputSchema,
  ClassroomRenameInputSchema,
  TopicCreateInputSchema,
  TRIAL_LIMITS,
  type ActivityMode,
  type ClassroomActivity,
  type ClassroomSummary,
  type Lang,
  type User,
} from "@socrates/shared";
import { getCookie } from "hono/cookie";
import { all, batch, one, run, type Db, type SqlEntry } from "../db/d1";
import { SESSION_COOKIE, enterPreviewSession, leavePreviewSession, startSession } from "../auth";
import {
  fail,
  langOf,
  newId,
  nowIso,
  parseBody,
  requireCapability,
  requireUser,
  uniqueViolationColumns,
  type AppEnv,
  type Ctx,
} from "../http";
import {
  TRIAL_LIMIT_VARS,
  classroomAccess,
  parsePrompts,
  topicForActivity,
  translationOf,
  type ClassroomRow,
  type TopicRow,
} from "../services/members";

const PREVIEW_NAMES = { zh: "測試學生", en: "Test Student", es: "Estudiante de prueba" } as const;
const UNTITLED_COURSE = { zh: "未命名課程", en: "Untitled course", es: "Curso sin título" } as const;

async function ensurePreviewStudent(db: Db, classroomId: string, lang: Lang): Promise<User> {
  const previewOf = (id: string, name: string): User => ({
    id,
    name,
    canManageClasses: false,
    isAdmin: false,
    guest: false,
    preview: true,
    previewClassroomId: classroomId,
  });
  const findExisting = () =>
    one<{ id: string; name: string }>(db, "SELECT id, name FROM users WHERE preview_classroom_id = $cid", {
      cid: classroomId,
    });
  const existing = await findExisting();
  if (existing) return previewOf(existing.id, existing.name);
  for (let attempt = 0; ; attempt += 1) {
    const id = newId("u_");
    const at = nowIso();
    const taken = await one<{ user_id: string }>(
      db,
      "SELECT user_id FROM members WHERE classroom_id = $cid AND name = $name",
      {
        cid: classroomId,
        name: PREVIEW_NAMES[lang],
      },
    );
    const name = taken ? `${PREVIEW_NAMES[lang]} ${id.slice(2, 6)}` : PREVIEW_NAMES[lang];
    try {
      await batch(db, [
        {
          sql: "INSERT INTO users (id, name, lang, preview_classroom_id, created_at) VALUES ($id, $name, $lang, $cid, $at)",
          params: { id, name, lang, cid: classroomId, at },
        },
        {
          sql: "INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at) VALUES ($cid, $uid, $name, $at, $at)",
          params: { cid: classroomId, uid: id, name, at },
        },
      ]);
    } catch (error) {
      const columns = uniqueViolationColumns(error);
      if (columns.some(([table, column]) => table === "users" && column === "preview_classroom_id")) {
        const raced = await findExisting();
        if (raced) return previewOf(raced.id, raced.name);
      }
      if (attempt < 2 && columns.length > 0) continue;
      throw error;
    }
    return previewOf(id, name);
  }
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
  topic_i18n: string | null;
}

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
      const base = baseUrl(c.env);
      const rows = await all<SummaryRow>(
        c.env.DB,
        `${SUMMARY_SQL} WHERE c.teacher_id = $uid
           OR EXISTS (SELECT 1 FROM members m WHERE m.classroom_id = c.id AND m.user_id = $uid)
         ORDER BY c.created_at DESC`,
        { uid: user.id },
      );
      return c.json(rows.map((row) => toSummary(row, user, base, langOf(c))));
    })
    .post("/classrooms", async (c) => {
      const user = requireCapability(c, "manage_classes");
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
            { id, name: input.name ?? UNTITLED_COURSE[langOf(c)], tid: user.id, code, at },
          );
        } catch (error) {
          if (
            !uniqueViolationColumns(error).some(([table, column]) => table === "classrooms" && column === "join_code")
          ) {
            throw error;
          }
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
      return c.json(rows.map((row) => parsePrompts(row, langOf(c))));
    })
    .post("/classrooms/:id/topics", async (c) => {
      const user = requireCapability(c, "manage_classes");
      const input = await parseBody(c, TopicCreateInputSchema);
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
    .post("/classrooms/:id/activities", async (c) => {
      const user = requireCapability(c, "manage_classes");
      const input = await parseBody(c, ActivityStartInputSchema);
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
    })
    .get("/classrooms/:id", async (c) => {
      const user = requireUser(c);
      const row = await one<SummaryRow>(
        c.env.DB,
        `${SUMMARY_SQL} WHERE c.id = $cid
           AND (c.teacher_id = $uid OR EXISTS (SELECT 1 FROM members m WHERE m.classroom_id = c.id AND m.user_id = $uid))`,
        { cid: c.req.param("id"), uid: user.id },
      );
      if (!row) fail(404, "not_found");
      return c.json(toSummary(row, user, baseUrl(c.env), langOf(c)));
    })
    .get("/classrooms/:id/activities", async (c) => {
      const user = requireUser(c);
      const classroom = await one<ClassroomRow>(
        c.env.DB,
        `SELECT c.* FROM classrooms c WHERE c.id = $cid
           AND (c.teacher_id = $uid OR EXISTS (SELECT 1 FROM members m WHERE m.classroom_id = c.id AND m.user_id = $uid))`,
        { cid: c.req.param("id"), uid: user.id },
      );
      if (!classroom) fail(404, "not_found");
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
        { cid: classroom.id },
      );
      const lang = langOf(c);
      return c.json(
        rows.map(
          (row): ClassroomActivity => ({
            id: row.id,
            topicId: row.topic_id,
            topicTitle: translationOf(row.i18n, lang).title ?? row.title,
            topicStatement: translationOf(row.i18n, lang).statement ?? row.statement,
            createdAt: row.created_at,
            finished: Boolean(row.finished_at),
          }),
        ),
      );
    })
    .patch("/classrooms/:id", async (c) => {
      const user = requireUser(c);
      const input = await parseBody(c, ClassroomRenameInputSchema);
      const { classroom, isTeacher } = await classroomAccess(c.env.DB, c.req.param("id"), user);
      if (!isTeacher) fail(403, "forbidden");
      await run(c.env.DB, "UPDATE classrooms SET name = $name WHERE id = $id", { id: classroom.id, name: input.name });
      return c.json({ id: classroom.id, name: input.name });
    })
    .delete("/classrooms/:id", async (c) => {
      const user = requireUser(c);
      const { classroom, isTeacher } = await classroomAccess(c.env.DB, c.req.param("id"), user);
      if (!isTeacher) fail(403, "forbidden");
      await run(c.env.DB, "DELETE FROM classrooms WHERE id = $id", { id: classroom.id });
      return c.body(null, 204);
    })
    .post("/classrooms/:id/preview", async (c) => {
      const user = requireUser(c);
      const { classroom, isTeacher } = await classroomAccess(c.env.DB, c.req.param("id"), user);
      if (!isTeacher) fail(403, "forbidden");
      if (!classroom.current_activity_id) fail(404, "not_found");
      const student = await ensurePreviewStudent(c.env.DB, classroom.id, langOf(c));
      await enterPreviewSession(c, getCookie(c, SESSION_COOKIE), student);
      return c.json({ user: student, activityId: classroom.current_activity_id });
    })
    .post("/preview/reset", async (c) => {
      const user = requireUser(c);
      if (!user.preview) fail(403, "forbidden");
      const classroom = await previewClassroom(c, user.id);
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

async function previewClassroom(c: Ctx, userId: string): Promise<ClassroomRow & { current_activity_id: string }> {
  const owner = await one<{ preview_classroom_id: string | null }>(
    c.env.DB,
    "SELECT preview_classroom_id FROM users WHERE id = $id",
    { id: userId },
  );
  if (!owner?.preview_classroom_id) fail(403, "forbidden");
  const classroom = await one<ClassroomRow>(c.env.DB, "SELECT * FROM classrooms WHERE id = $id", {
    id: owner.preview_classroom_id,
  });
  if (!classroom?.current_activity_id) fail(404, "not_found");
  return classroom as ClassroomRow & { current_activity_id: string };
}

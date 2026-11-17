import { Hono } from "hono";
import {
  SchoolInputSchema,
  SchoolTeacherInputSchema,
  StudentsCreateInputSchema,
  type AdminOverview,
  type School,
  type SchoolTeacher,
  type StudentCredential,
  type TeacherRequest,
} from "@socrates/shared";
import { all, batch, one, run, type Db } from "../db/d1";
import { hashPassword } from "../auth";
import {
  fail,
  langOf,
  newId,
  nowIso,
  parseBody,
  requireAdmin,
  requireUser,
  uniqueViolationColumns,
  type AppEnv,
  type Ctx,
} from "../http";
import { assertSeats, type ClassroomRow } from "../services/members";

const PASSWORD_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const PASSWORD_MAX = 256 - (256 % PASSWORD_ALPHABET.length);

function newPassword(length: number): string {
  let out = "";
  while (out.length < length) {
    const [byte] = crypto.getRandomValues(new Uint8Array(1));
    if (byte === undefined || byte >= PASSWORD_MAX) continue;
    out += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length]!;
  }
  return `${out.slice(0, length / 2)}-${out.slice(length / 2)}`;
}

async function ownedClassroom(c: Ctx, classroomId: string): Promise<ClassroomRow> {
  const user = requireUser(c);
  const classroom = await one<ClassroomRow>(c.env.DB, "SELECT * FROM classrooms WHERE id = $id", { id: classroomId });
  if (!classroom) fail(404, "not_found");
  if (classroom.teacher_id !== user.id || user.preview) fail(403, "forbidden");
  return classroom;
}

async function nextStudentNumber(db: Db, classroomId: string, prefix: string): Promise<number> {
  const rows = await all<{ username: string }>(
    db,
    "SELECT username FROM users WHERE student_classroom_id = $cid AND username IS NOT NULL",
    { cid: classroomId },
  );
  const used = rows
    .map((row) => (row.username.startsWith(prefix) ? Number(row.username.slice(prefix.length)) : 0))
    .filter((value) => Number.isFinite(value));
  return Math.max(0, ...used) + 1;
}

interface SchoolTeacherRow {
  id: string;
  name: string;
  email: string;
  school_id: string;
  school_name: string;
}

const toSchoolTeacher = (row: SchoolTeacherRow, temporaryPassword: string | null = null): SchoolTeacher => ({
  id: row.id,
  name: row.name,
  email: row.email,
  schoolId: row.school_id,
  schoolName: row.school_name,
  temporaryPassword,
});

const SCHOOL_TEACHER_SQL = `SELECT u.id, u.name, u.email, u.school_id, s.name AS school_name
  FROM users u JOIN schools s ON s.id = u.school_id WHERE u.teacher_plan = 'school'`;

export function accountRoutes() {
  return new Hono<AppEnv>()
    .post("/classrooms/:id/students", async (c) => {
      const classroom = await ownedClassroom(c, c.req.param("id"));
      const input = await parseBody(c, StudentsCreateInputSchema);
      const names = input.names.map((name) => name.trim());
      if (new Set(names).size !== names.length) fail(409, "name_taken");
      await assertSeats(c.env.DB, classroom.id, names.length);
      const prefix = `${classroom.join_code}-`;
      const start = await nextStudentNumber(c.env.DB, classroom.id, prefix);
      const at = nowIso();
      const lang = langOf(c);
      const created: StudentCredential[] = [];
      const statements = [];
      for (const [index, name] of names.entries()) {
        const id = newId("u_");
        const username = `${prefix}${String(start + index).padStart(2, "0")}`;
        const password = newPassword(8);
        created.push({ id, name, username, password });
        statements.push(
          {
            sql: "INSERT INTO users (id, name, username, password_hash, student_classroom_id, lang, created_at) VALUES ($id, $name, $username, $hash, $cid, $lang, $at)",
            params: { id, name, username, hash: await hashPassword(password), cid: classroom.id, lang, at },
          },
          {
            sql: "INSERT INTO members (classroom_id, user_id, name, tos_accepted_at, joined_at) VALUES ($cid, $id, $name, $at, $at)",
            params: { cid: classroom.id, id, name, at },
          },
        );
      }
      try {
        await batch(c.env.DB, statements);
      } catch (error) {
        const columns = uniqueViolationColumns(error);
        if (columns.some(([table, column]) => table === "members" && column === "name")) fail(409, "name_taken");
        if (columns.length > 0) fail(409, "conflict");
        throw error;
      }
      return c.json(created, 201);
    })
    .post("/classrooms/:id/students/:userId/password", async (c) => {
      const classroom = await ownedClassroom(c, c.req.param("id"));
      const student = await one<{ id: string; name: string; username: string }>(
        c.env.DB,
        "SELECT id, name, username FROM users WHERE id = $uid AND student_classroom_id = $cid",
        { uid: c.req.param("userId"), cid: classroom.id },
      );
      if (!student) fail(404, "not_found");
      const password = newPassword(8);
      await run(c.env.DB, "UPDATE users SET password_hash = $hash WHERE id = $id", {
        id: student.id,
        hash: await hashPassword(password),
      });
      const body: StudentCredential = { ...student, password };
      return c.json(body);
    })
    .get("/admin/overview", async (c) => {
      requireAdmin(c);
      const row = await one<Record<keyof AdminOverview, number>>(
        c.env.DB,
        `SELECT
           (SELECT COUNT(*) FROM users WHERE can_manage_classes = 0 AND student_classroom_id IS NULL) AS users,
           (SELECT COUNT(*) FROM users WHERE can_manage_classes = 1) AS teachers,
           (SELECT COUNT(*) FROM users WHERE student_classroom_id IS NOT NULL) AS students,
           (SELECT COUNT(*) FROM classrooms) AS classrooms,
           (SELECT COUNT(*) FROM classrooms c JOIN activities a ON a.id = c.current_activity_id
              WHERE a.finished_at IS NULL) AS runningActivities,
           (SELECT COUNT(*) FROM users WHERE teacher_request_at IS NOT NULL AND teacher_plan IS NULL) AS pendingRequests,
           (SELECT COUNT(*) FROM schools) AS schools`,
      );
      if (!row) fail(500, "internal_error");
      return c.json(row satisfies AdminOverview);
    })
    .put("/admin/users/:id/teacher", async (c) => {
      requireAdmin(c);
      const found = await one<{ id: string }>(
        c.env.DB,
        "SELECT id FROM users WHERE id = $id AND student_classroom_id IS NULL",
        { id: c.req.param("id") },
      );
      if (!found) fail(404, "not_found");
      await run(
        c.env.DB,
        "UPDATE users SET teacher_plan = COALESCE(teacher_plan, 'trial'), teacher_request_at = NULL WHERE id = $id",
        { id: found.id },
      );
      return c.body(null, 204);
    })
    .delete("/admin/users/:id/teacher", async (c) => {
      const admin = requireAdmin(c);
      const id = c.req.param("id");
      if (id === admin.id) fail(403, "forbidden");
      const found = await one<{ id: string }>(c.env.DB, "SELECT id FROM users WHERE id = $id", { id });
      if (!found) fail(404, "not_found");
      await run(
        c.env.DB,
        "UPDATE users SET teacher_plan = NULL, teacher_mode = 0, school_id = NULL, teacher_request_at = NULL WHERE id = $id",
        { id: found.id },
      );
      return c.body(null, 204);
    })
    .get("/admin/teacher-requests", async (c) => {
      requireAdmin(c);
      const rows = await all<{ id: string; name: string; email: string | null; teacher_request_at: string }>(
        c.env.DB,
        `SELECT id, name, email, teacher_request_at FROM users
         WHERE teacher_request_at IS NOT NULL AND teacher_plan IS NULL ORDER BY teacher_request_at`,
      );
      return c.json(
        rows.map(
          (row): TeacherRequest => ({
            id: row.id,
            name: row.name,
            email: row.email,
            requestedAt: row.teacher_request_at,
          }),
        ),
      );
    })
    .post("/admin/teacher-requests/:id/approve", async (c) => {
      requireAdmin(c);
      const found = await one<{ id: string }>(
        c.env.DB,
        "SELECT id FROM users WHERE id = $id AND teacher_request_at IS NOT NULL AND teacher_plan IS NULL",
        { id: c.req.param("id") },
      );
      if (!found) fail(404, "not_found");
      await run(c.env.DB, "UPDATE users SET teacher_plan = 'trial', teacher_request_at = NULL WHERE id = $id", {
        id: found.id,
      });
      return c.body(null, 204);
    })
    .delete("/admin/teacher-requests/:id", async (c) => {
      requireAdmin(c);
      const found = await one<{ id: string }>(
        c.env.DB,
        "SELECT id FROM users WHERE id = $id AND teacher_request_at IS NOT NULL AND teacher_plan IS NULL",
        { id: c.req.param("id") },
      );
      if (!found) fail(404, "not_found");
      await run(c.env.DB, "UPDATE users SET teacher_request_at = NULL WHERE id = $id", { id: found.id });
      return c.body(null, 204);
    })
    .get("/admin/schools", async (c) => {
      requireAdmin(c);
      const rows = await all<{ id: string; name: string; teacher_count: number; created_at: string }>(
        c.env.DB,
        `SELECT s.id, s.name, s.created_at,
           (SELECT COUNT(*) FROM users u WHERE u.school_id = s.id AND u.teacher_plan = 'school') AS teacher_count
         FROM schools s ORDER BY s.created_at DESC`,
      );
      return c.json(
        rows.map(
          (row): School => ({
            id: row.id,
            name: row.name,
            teacherCount: Number(row.teacher_count),
            createdAt: row.created_at,
          }),
        ),
      );
    })
    .post("/admin/schools", async (c) => {
      requireAdmin(c);
      const input = await parseBody(c, SchoolInputSchema);
      const school: School = { id: newId("sch_"), name: input.name, teacherCount: 0, createdAt: nowIso() };
      await run(c.env.DB, "INSERT INTO schools (id, name, created_at) VALUES ($id, $name, $at)", {
        id: school.id,
        name: school.name,
        at: school.createdAt,
      });
      return c.json(school, 201);
    })
    .get("/admin/teachers", async (c) => {
      requireAdmin(c);
      const rows = await all<SchoolTeacherRow>(c.env.DB, `${SCHOOL_TEACHER_SQL} ORDER BY s.name, u.name`);
      return c.json(rows.map((row) => toSchoolTeacher(row)));
    })
    .post("/admin/teachers", async (c) => {
      requireAdmin(c);
      const input = await parseBody(c, SchoolTeacherInputSchema);
      const school = await one<{ id: string }>(c.env.DB, "SELECT id FROM schools WHERE id = $id", {
        id: input.schoolId,
      });
      if (!school) fail(404, "not_found");
      const existing = await one<{ id: string; student_classroom_id: string | null }>(
        c.env.DB,
        "SELECT id, student_classroom_id FROM users WHERE email = $email",
        { email: input.email },
      );
      if (existing?.student_classroom_id) fail(409, "conflict");
      const at = nowIso();
      let temporaryPassword: string | null = null;
      const id = existing?.id ?? newId("u_");
      if (existing) {
        await run(
          c.env.DB,
          "UPDATE users SET teacher_plan = 'school', school_id = $sid, teacher_terms_at = COALESCE(teacher_terms_at, $at) WHERE id = $id",
          { id, sid: school.id, at },
        );
      } else {
        temporaryPassword = newPassword(12);
        await run(
          c.env.DB,
          "INSERT INTO users (id, name, email, password_hash, teacher_plan, school_id, teacher_terms_at, can_manage_classes, teacher_mode, lang, created_at) VALUES ($id, $name, $email, $hash, 'school', $sid, $at, 1, 0, $lang, $at)",
          {
            id,
            name: input.name ?? input.email.split("@")[0] ?? input.email,
            email: input.email,
            hash: await hashPassword(temporaryPassword),
            sid: school.id,
            lang: langOf(c),
            at,
          },
        );
      }
      const row = await one<SchoolTeacherRow>(c.env.DB, `${SCHOOL_TEACHER_SQL} AND u.id = $id`, { id });
      if (!row) fail(500, "internal_error");
      return c.json(toSchoolTeacher(row, temporaryPassword), 201);
    })
    .delete("/admin/teachers/:id", async (c) => {
      requireAdmin(c);
      const result = await run(
        c.env.DB,
        "UPDATE users SET teacher_plan = 'trial', school_id = NULL WHERE id = $id AND teacher_plan = 'school'",
        { id: c.req.param("id") },
      );
      if (!result.meta.changes) fail(404, "not_found");
      return c.body(null, 204);
    });
}

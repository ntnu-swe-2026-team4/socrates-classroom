import { Hono } from "hono";
import type { Db } from "../db/d1";
import { all, one, parseJson, run } from "../db/d1";
import { requireUser } from "../auth";
import { bodyOf, boolean, fail, newId, nowIso, str, type AppEnv, type UserRow } from "../http";
import { msg } from "../messages";
import {
  accessClassroom,
  accessClassroomTeacher,
  classroomById,
  membershipOf,
  type ClassroomRole,
  type ClassroomRow,
} from "../services/access";
import { classroomJson } from "../services/serialize";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode(): string {
  const bytes = crypto.getRandomValues(new Uint32Array(6));
  return Array.from(bytes, (n) => CODE_CHARS[n % CODE_CHARS.length]).join("");
}

async function uniqueCode(db: Db): Promise<string> {
  for (;;) {
    const code = newCode();
    if (!(await one(db, "SELECT 1 AS x FROM join_policies WHERE code = $code", { code }))) return code;
  }
}

function policyJson(row: any) {
  return {
    code: row.code,
    codeEnabled: !!row.code_enabled,
    discoverable: !!row.discoverable,
    requireApproval: !!row.require_approval,
    questionnaire: parseJson(row.questionnaire, []),
  };
}

async function ensurePolicy(db: Db, classroomId: string) {
  let row = await one<any>(db, "SELECT * FROM join_policies WHERE classroom_id = $cid", { cid: classroomId });
  if (!row) {
    await run(
      db,
      `INSERT INTO join_policies (classroom_id, code, code_enabled, discoverable, require_approval, questionnaire)
       VALUES ($cid, $code, 1, 0, 0, '[]')`,
      { cid: classroomId, code: await uniqueCode(db) },
    );
    row = await one<any>(db, "SELECT * FROM join_policies WHERE classroom_id = $cid", { cid: classroomId });
  }
  return row;
}

async function latestApplication(db: Db, classroomId: string, studentId: string) {
  return await one<any>(
    db,
    "SELECT * FROM join_applications WHERE classroom_id = $cid AND student_id = $sid ORDER BY created_at DESC LIMIT 1",
    { cid: classroomId, sid: studentId },
  );
}

async function previewJson(db: Db, classroom: ClassroomRow, user: UserRow) {
  const policy = await ensurePolicy(db, classroom.id);
  const teacher = await one<{ name: string }>(db, "SELECT name FROM users WHERE id = $id", {
    id: classroom.teacher_id,
  });
  const count = await one<{ n: number }>(
    db,
    "SELECT COUNT(*) AS n FROM classroom_members WHERE classroom_id = $cid AND role = 'student' AND status = 'active'",
    { cid: classroom.id },
  );
  const membership = await membershipOf(db, classroom.id, user.id);
  const application = await latestApplication(db, classroom.id, user.id);
  return {
    id: classroom.id,
    name: classroom.name,
    description: classroom.description,
    teacherName: teacher?.name ?? "",
    studentCount: count?.n ?? 0,
    requireApproval: !!policy.require_approval,
    questionnaire: policy.require_approval ? parseJson(policy.questionnaire, []) : [],
    joined: membership?.status === "active",
    myApplication: application?.status ?? null,
  };
}

async function applicationJson(db: Db, row: any) {
  const classroom = await one<ClassroomRow>(db, "SELECT * FROM classrooms WHERE id = $id", { id: row.classroom_id });
  const student = await one<UserRow>(db, "SELECT id, name, role, avatar_url, created_at FROM users WHERE id = $id", {
    id: row.student_id,
  });
  return {
    id: row.id,
    classroomId: row.classroom_id,
    classroomName: classroom?.name ?? "",
    studentId: row.student_id,
    studentName: student?.name ?? "",
    answers: parseJson(row.answers, []),
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    note: row.note,
  };
}

function validateQuestionnaire(input: unknown): any[] {
  if (!Array.isArray(input)) fail(422, "validation");
  return input.map((raw) => {
    const q = raw as any;
    const prompt = typeof q?.prompt === "string" ? q.prompt.trim() : "";
    if (!prompt) fail(422, "question_prompt_required");
    const kind = q.kind === "paragraph" || q.kind === "choice" ? q.kind : "text";
    const options =
      kind === "choice"
        ? Array.isArray(q.options)
          ? q.options.map((o: unknown) => String(o).trim()).filter(Boolean)
          : []
        : undefined;
    if (kind === "choice" && (options?.length ?? 0) < 2) fail(422, "choice_options_required", { prompt });
    return {
      id: typeof q.id === "string" && q.id ? q.id : newId("q_"),
      prompt,
      kind,
      ...(options ? { options } : {}),
      required: !!q.required,
    };
  });
}

async function memberJson(db: Db, classroomId: string, userId: string, role: string) {
  const user = (await one<UserRow>(db, "SELECT id, name, role, avatar_url, created_at FROM users WHERE id = $id", {
    id: userId,
  }))!;
  const session = await one<{ created_at: string }>(
    db,
    "SELECT created_at FROM sessions WHERE user_id = $uid AND expires_at > $now ORDER BY created_at DESC LIMIT 1",
    { uid: userId, now: nowIso() },
  );
  const activities =
    (
      await one<{ n: number }>(db, "SELECT COUNT(*) AS n FROM activities WHERE classroom_id = $cid", {
        cid: classroomId,
      })
    )?.n ?? 0;
  const confirmed =
    (
      await one<{ n: number }>(
        db,
        `SELECT COUNT(*) AS n FROM positions p JOIN activities a ON a.id = p.activity_id
     WHERE a.classroom_id = $cid AND p.student_id = $sid AND p.confirmed = 1`,
        { cid: classroomId, sid: userId },
      )
    )?.n ?? 0;
  const last = await one<{ at: string | null }>(
    db,
    "SELECT MAX(at) AS at FROM (SELECT MAX(last_active_at) AS at FROM discussion_sessions WHERE student_id = $sid UNION ALL SELECT MAX(created_at) AS at FROM activity_dialogue WHERE student_id = $sid)",
    { sid: userId },
  );
  return {
    id: user.id,
    name: user.name,
    role: role === "assistant" ? "assistant" : "student",
    online: !!session && Date.now() - new Date(session.created_at).getTime() < 5 * 60_000,
    lastActive: last?.at || session?.created_at || user.created_at,
    progress: activities ? Math.round((confirmed / activities) * 100) : 0,
  };
}

export function classroomRoutes(db: Db) {
  const r = new Hono<AppEnv>();

  r.get("/classrooms/discover", async (c) => {
    const user = requireUser(c);
    if (user.role !== "student") fail(403, "only_student");
    const q = (c.req.query("q") ?? "").trim().toLowerCase();
    const rows = await all<any>(
      db,
      `SELECT c.* FROM classrooms c JOIN join_policies p ON p.classroom_id = c.id
       WHERE p.discoverable = 1 ORDER BY c.created_at DESC`,
    );
    const out = await Promise.all(rows.map((row) => previewJson(db, row, user)));
    return c.json(
      q ? out.filter((x) => [x.name, x.description, x.teacherName].some((v) => v.toLowerCase().includes(q))) : out,
    );
  });

  r.get("/join-codes/:code", async (c) => {
    const user = requireUser(c);
    if (user.role !== "student") fail(403, "only_student");
    const code = (c.req.param("code") ?? "").trim().toUpperCase();
    const policy = await one<any>(db, "SELECT * FROM join_policies WHERE code = $code AND code_enabled = 1", { code });
    if (!policy) fail(404, "join_code_invalid");
    const classroom = await classroomById(db, policy.classroom_id);
    if (!classroom) fail(404, "classroom_not_found");
    return c.json(await previewJson(db, classroom, user));
  });

  r.get("/classrooms", async (c) => {
    const user = requireUser(c);
    const rows = await all<any>(
      db,
      `SELECT c.*, m.role AS member_role, m.status AS member_status
       FROM classrooms c
       LEFT JOIN classroom_members m ON m.classroom_id = c.id AND m.user_id = $uid
       WHERE c.teacher_id = $uid OR m.user_id = $uid
       ORDER BY c.created_at DESC`,
      { uid: user.id },
    );
    return c.json(
      await Promise.all(
        rows.map(async (row) => {
          const role = row.teacher_id === user.id ? "teacher" : row.member_role;
          return classroomJson(
            db,
            row,
            user,
            role as ClassroomRole,
            row.teacher_id === user.id || row.member_status === "active",
          );
        }),
      ),
    );
  });

  r.post("/classrooms", async (c) => {
    const user = requireUser(c);
    if (user.role !== "teacher") fail(403, "only_teacher");
    const body = await bodyOf(c);
    const name = str(body.name, "classroom_name_required", { min: 1, max: 120 });
    const description = typeof body.description === "string" ? body.description.trim().slice(0, 4000) : "";
    const at = nowIso();
    const id = newId("c_");
    await run(
      db,
      "INSERT INTO classrooms (id, name, description, teacher_id, created_at, updated_at) VALUES ($id, $name, $description, $teacher, $at, $at)",
      {
        id,
        name,
        description,
        teacher: user.id,
        at,
      },
    );
    await run(
      db,
      "INSERT INTO join_policies (classroom_id, code, code_enabled, discoverable, require_approval, questionnaire) VALUES ($id, $code, 1, 0, 0, '[]')",
      {
        id,
        code: await uniqueCode(db),
      },
    );
    return c.json(await classroomJson(db, (await classroomById(db, id))!, user, "teacher", true));
  });

  r.get("/classrooms/:id", async (c) => {
    const user = requireUser(c);
    const { classroom, role } = await accessClassroom(db, c.req.param("id"), user);
    return c.json(await classroomJson(db, classroom, user, role, true));
  });

  r.patch("/classrooms/:id", async (c) => {
    const user = requireUser(c);
    const classroom = await accessClassroomTeacher(db, c.req.param("id"), user);
    const body = await bodyOf(c);
    if (body.name !== undefined) {
      const name = str(body.name, "classroom_name_required", { min: 1, max: 120 });
      await run(db, "UPDATE classrooms SET name = $name WHERE id = $id", { name, id: classroom.id });
    }
    if (body.description !== undefined) {
      if (typeof body.description !== "string") fail(422, "validation");
      await run(db, "UPDATE classrooms SET description = $d WHERE id = $id", {
        d: body.description.trim().slice(0, 4000),
        id: classroom.id,
      });
    }
    await run(db, "UPDATE classrooms SET updated_at = $at WHERE id = $id", { at: nowIso(), id: classroom.id });
    return c.json(await classroomJson(db, (await classroomById(db, classroom.id))!, user, "teacher", true));
  });

  r.post("/classrooms/:id/invite/accept", async (c) => {
    const user = requireUser(c);
    const classroom = await classroomById(db, c.req.param("id"));
    if (!classroom) fail(404, "classroom_not_found");
    const membership = await membershipOf(db, classroom.id, user.id);
    if (!membership) fail(404, "invite_not_found");
    if (membership.status !== "active") {
      await run(db, "UPDATE classroom_members SET status = 'active' WHERE classroom_id = $cid AND user_id = $uid", {
        cid: classroom.id,
        uid: user.id,
      });
    }
    return c.json(await classroomJson(db, classroom, user, membership.role, true));
  });

  r.post("/classrooms/:id/invite/decline", async (c) => {
    const user = requireUser(c);
    const classroom = await classroomById(db, c.req.param("id"));
    if (!classroom) fail(404, "classroom_not_found");
    const membership = await membershipOf(db, classroom.id, user.id);
    if (!membership) fail(404, "invite_not_found");
    if (membership.status !== "invited") fail(409, "conflict");
    await run(db, "DELETE FROM classroom_members WHERE classroom_id = $cid AND user_id = $uid", {
      cid: classroom.id,
      uid: user.id,
    });
    return c.body(null, 204);
  });

  r.get("/classrooms/:id/members", async (c) => {
    const user = requireUser(c);
    const { classroom } = await accessClassroom(db, c.req.param("id"), user);
    const rows = await all<any>(
      db,
      "SELECT user_id, role FROM classroom_members WHERE classroom_id = $cid AND status = 'active' ORDER BY created_at, user_id",
      { cid: classroom.id },
    );
    return c.json(await Promise.all(rows.map((m) => memberJson(db, classroom.id, m.user_id, m.role))));
  });

  r.post("/classrooms/:id/members", async (c) => {
    const user = requireUser(c);
    const classroom = await accessClassroomTeacher(db, c.req.param("id"), user);
    const body = await bodyOf(c);
    const name = str(body.name, "name_required", { min: 1, max: 80 });
    let target = await one<UserRow>(db, "SELECT * FROM users WHERE name = $name AND role = 'student' LIMIT 1", {
      name,
    });
    if (!target) {
      const id = newId("u_");
      await run(
        db,
        "INSERT INTO users (id, name, role, avatar_url, created_at) VALUES ($id, $name, 'student', NULL, $at)",
        { id, name, at: nowIso() },
      );
      target = (await one<UserRow>(db, "SELECT * FROM users WHERE id = $id", { id }))!;
    }
    if (await membershipOf(db, classroom.id, target.id)) fail(409, "member_exists");
    await run(
      db,
      "INSERT INTO classroom_members (classroom_id, user_id, role, status, created_at) VALUES ($cid, $uid, 'student', 'active', $at)",
      {
        cid: classroom.id,
        uid: target.id,
        at: nowIso(),
      },
    );
    return c.json(await memberJson(db, classroom.id, target.id, "student"));
  });

  r.post("/classrooms/:id/members/import", async (c) => {
    const user = requireUser(c);
    const classroom = await accessClassroomTeacher(db, c.req.param("id"), user);
    const body = await bodyOf(c);
    if (!Array.isArray(body.names)) fail(422, "validation");
    const added: any[] = [];
    const skipped: { name: string; reason: string }[] = [];
    const seen = new Set<string>();
    const lang = c.get("lang");
    for (const raw of body.names) {
      if (typeof raw !== "string") continue;
      const name = raw.trim();
      if (!name) continue;
      if (seen.has(name)) {
        skipped.push({
          name,
          reason: lang === "en" ? "Duplicate in list" : lang === "es" ? "Duplicado en la lista" : "名單裡重複",
        });
        continue;
      }
      seen.add(name);
      let target = await one<UserRow>(db, "SELECT * FROM users WHERE name = $name AND role = 'student' LIMIT 1", {
        name,
      });
      if (target && (await membershipOf(db, classroom.id, target.id))) {
        skipped.push({ name, reason: msg(lang, "member_exists") });
        continue;
      }
      if (!target) {
        const id = newId("u_");
        await run(
          db,
          "INSERT INTO users (id, name, role, avatar_url, created_at) VALUES ($id, $name, 'student', NULL, $at)",
          { id, name, at: nowIso() },
        );
        target = (await one<UserRow>(db, "SELECT * FROM users WHERE id = $id", { id }))!;
      }
      await run(
        db,
        "INSERT INTO classroom_members (classroom_id, user_id, role, status, created_at) VALUES ($cid, $uid, 'student', 'active', $at)",
        {
          cid: classroom.id,
          uid: target.id,
          at: nowIso(),
        },
      );
      added.push(await memberJson(db, classroom.id, target.id, "student"));
    }
    return c.json({ added, skipped });
  });

  r.delete("/classrooms/:id/members/:memberId", async (c) => {
    const user = requireUser(c);
    const classroom = await accessClassroomTeacher(db, c.req.param("id"), user);
    const memberId = c.req.param("memberId");
    const membership = await membershipOf(db, classroom.id, memberId);
    if (!membership) fail(404, "member_not_found");
    await run(db, "DELETE FROM classroom_members WHERE classroom_id = $cid AND user_id = $uid", {
      cid: classroom.id,
      uid: memberId,
    });
    return c.body(null, 204);
  });

  r.patch("/classrooms/:id/members/:memberId", async (c) => {
    const user = requireUser(c);
    const classroom = await accessClassroomTeacher(db, c.req.param("id"), user);
    const memberId = c.req.param("memberId");
    const membership = await membershipOf(db, classroom.id, memberId);
    if (membership?.status !== "active") fail(404, "member_not_found");
    const body = await bodyOf(c);
    if (body.role !== "student" && body.role !== "assistant") fail(422, "invalid_member_role");
    await run(db, "UPDATE classroom_members SET role = $role WHERE classroom_id = $cid AND user_id = $uid", {
      role: body.role,
      cid: classroom.id,
      uid: memberId,
    });
    return c.json(await memberJson(db, classroom.id, memberId, body.role));
  });

  r.get("/classrooms/:id/join-policy", async (c) => {
    const user = requireUser(c);
    const classroom = await accessClassroomTeacher(db, c.req.param("id"), user);
    return c.json(policyJson(await ensurePolicy(db, classroom.id)));
  });

  r.patch("/classrooms/:id/join-policy", async (c) => {
    const user = requireUser(c);
    const classroom = await accessClassroomTeacher(db, c.req.param("id"), user);
    const policy = await ensurePolicy(db, classroom.id);
    const body = await bodyOf(c);
    if (body.questionnaire !== undefined) {
      const questionnaire = validateQuestionnaire(body.questionnaire);
      await run(db, "UPDATE join_policies SET questionnaire = $q WHERE classroom_id = $cid", {
        q: JSON.stringify(questionnaire),
        cid: classroom.id,
      });
    }
    for (const key of ["codeEnabled", "discoverable", "requireApproval"] as const) {
      const value = boolean(body[key]);
      if (value !== undefined) {
        const column =
          key === "codeEnabled" ? "code_enabled" : key === "requireApproval" ? "require_approval" : "discoverable";
        await run(db, `UPDATE join_policies SET ${column} = $v WHERE classroom_id = $cid`, {
          v: value ? 1 : 0,
          cid: classroom.id,
        });
      }
    }
    const row = await one<any>(db, "SELECT * FROM join_policies WHERE classroom_id = $cid", { cid: classroom.id })!;
    void policy;
    return c.json(policyJson(row));
  });

  r.post("/classrooms/:id/join-policy/code", async (c) => {
    const user = requireUser(c);
    const classroom = await accessClassroomTeacher(db, c.req.param("id"), user);
    await ensurePolicy(db, classroom.id);
    await run(db, "UPDATE join_policies SET code = $code WHERE classroom_id = $cid", {
      code: await uniqueCode(db),
      cid: classroom.id,
    });
    return c.json(
      policyJson(await one<any>(db, "SELECT * FROM join_policies WHERE classroom_id = $cid", { cid: classroom.id })),
    );
  });

  r.post("/classrooms/:id/join", async (c) => {
    const user = requireUser(c);
    if (user.role !== "student") fail(403, "only_student");
    const classroom = await classroomById(db, c.req.param("id"));
    if (!classroom) fail(404, "classroom_not_found");
    const policy = await ensurePolicy(db, classroom.id);
    const membership = await membershipOf(db, classroom.id, user.id);
    if (membership?.status === "active") fail(409, "already_member");
    const body = await bodyOf(c);
    const code = typeof body.code === "string" ? body.code.trim().toUpperCase() : "";
    const codeOk = !!code && !!policy.code_enabled && policy.code === code;
    if (!policy.discoverable && !codeOk && membership?.status !== "invited") fail(403, "join_code_required");
    if (!policy.require_approval) {
      if (membership) {
        await run(db, "UPDATE classroom_members SET status = 'active' WHERE classroom_id = $cid AND user_id = $uid", {
          cid: classroom.id,
          uid: user.id,
        });
      } else {
        await run(
          db,
          "INSERT INTO classroom_members (classroom_id, user_id, role, status, created_at) VALUES ($cid, $uid, 'student', 'active', $at)",
          {
            cid: classroom.id,
            uid: user.id,
            at: nowIso(),
          },
        );
      }
      return c.json({ status: "joined", classroom: await classroomJson(db, classroom, user, "student", true) });
    }
    if ((await latestApplication(db, classroom.id, user.id))?.status === "pending") fail(409, "pending_application");
    const questionnaire = parseJson<any[]>(policy.questionnaire, []);
    const answersInput = (body.answers && typeof body.answers === "object" ? body.answers : {}) as Record<
      string,
      unknown
    >;
    const answers = questionnaire.map((q) => ({
      questionId: q.id,
      prompt: q.prompt,
      answer: typeof answersInput[q.id] === "string" ? String(answersInput[q.id]).trim() : "",
    }));
    for (let i = 0; i < questionnaire.length; i++) {
      const q = questionnaire[i];
      const answer = answers[i].answer;
      if (q.required && !answer) fail(422, "question_required", { prompt: q.prompt });
      if (q.kind === "choice" && answer && !(q.options ?? []).includes(answer))
        fail(422, "choice_invalid", { prompt: q.prompt });
    }
    const id = newId("ap_");
    await run(
      db,
      `INSERT INTO join_applications (id, classroom_id, student_id, answers, status, created_at, reviewed_at, note)
       VALUES ($id, $cid, $sid, $answers, 'pending', $at, NULL, NULL)`,
      { id, cid: classroom.id, sid: user.id, answers: JSON.stringify(answers), at: nowIso() },
    );
    return c.json({
      status: "pending",
      application: await applicationJson(
        db,
        await one<any>(db, "SELECT * FROM join_applications WHERE id = $id", { id }),
      ),
    });
  });

  r.get("/me/applications", async (c) => {
    const user = requireUser(c);
    if (user.role !== "student") fail(403, "only_student");
    const rows = await all<any>(
      db,
      "SELECT * FROM join_applications WHERE student_id = $sid ORDER BY created_at DESC",
      { sid: user.id },
    );
    return c.json(await Promise.all(rows.map((row) => applicationJson(db, row))));
  });

  r.delete("/applications/:id", async (c) => {
    const user = requireUser(c);
    if (user.role !== "student") fail(403, "only_student");
    const row = await one<any>(db, "SELECT * FROM join_applications WHERE id = $id", { id: c.req.param("id") });
    if (!row) fail(404, "application_not_found");
    if (row.student_id !== user.id || row.status !== "pending") fail(403, "cancel_pending_only");
    await run(db, "DELETE FROM join_applications WHERE id = $id", { id: row.id });
    return c.body(null, 204);
  });

  r.get("/classrooms/:id/applications", async (c) => {
    const user = requireUser(c);
    const classroom = await accessClassroomTeacher(db, c.req.param("id"), user);
    const status = c.req.query("status");
    if (status !== undefined && !["pending", "approved", "rejected"].includes(status)) fail(422, "validation");
    const rows = status
      ? await all<any>(
          db,
          "SELECT * FROM join_applications WHERE classroom_id = $cid AND status = $status ORDER BY created_at",
          { cid: classroom.id, status },
        )
      : await all<any>(db, "SELECT * FROM join_applications WHERE classroom_id = $cid ORDER BY created_at", {
          cid: classroom.id,
        });
    return c.json(await Promise.all(rows.map((row) => applicationJson(db, row))));
  });

  r.post("/applications/:id/review", async (c) => {
    const user = requireUser(c);
    const row = await one<any>(db, "SELECT * FROM join_applications WHERE id = $id", { id: c.req.param("id") });
    if (!row) fail(404, "application_not_found");
    const classroom = await accessClassroomTeacher(db, row.classroom_id, user);
    if (row.status !== "pending") fail(409, "application_reviewed");
    const body = await bodyOf(c);
    if (body.decision !== "approve" && body.decision !== "reject") fail(422, "validation");
    const note = typeof body.note === "string" && body.note.trim() ? body.note.trim().slice(0, 2000) : null;
    const status = body.decision === "approve" ? "approved" : "rejected";
    await run(db, "UPDATE join_applications SET status = $status, reviewed_at = $at, note = $note WHERE id = $id", {
      status,
      at: nowIso(),
      note,
      id: row.id,
    });
    if (status === "approved") {
      const membership = await membershipOf(db, classroom.id, row.student_id);
      if (membership) {
        await run(db, "UPDATE classroom_members SET status = 'active' WHERE classroom_id = $cid AND user_id = $uid", {
          cid: classroom.id,
          uid: row.student_id,
        });
      } else {
        await run(
          db,
          "INSERT INTO classroom_members (classroom_id, user_id, role, status, created_at) VALUES ($cid, $uid, 'student', 'active', $at)",
          {
            cid: classroom.id,
            uid: row.student_id,
            at: nowIso(),
          },
        );
      }
    }
    return c.json(
      await applicationJson(db, await one<any>(db, "SELECT * FROM join_applications WHERE id = $id", { id: row.id })),
    );
  });

  return r;
}

export { memberJson, ensurePolicy, uniqueCode, previewJson, policyJson, applicationJson, validateQuestionnaire };

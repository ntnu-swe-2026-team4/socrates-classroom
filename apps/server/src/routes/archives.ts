import { Hono } from "hono";
import type { Lang } from "@socrates/shared";
import type { Db } from "../db/d1";
import { all, one, run } from "../db/d1";
import { requireUser } from "../auth";
import { bodyOf, fail, nowIso, newId, requireIdList, str, type AppEnv, type UserRow } from "../http";
import { checkRate, releaseLock } from "../services/rate-limit";
import { archiveJson, dialogueJson } from "../services/serialize";

async function readAccess(db: Db, archiveId: string, user: UserRow): Promise<any> {
  const archive = await one<any>(db, "SELECT * FROM archives WHERE id = $id", { id: archiveId });
  if (!archive) fail(404, "archive_not_found");
  if (archive.owner_id === user.id) return archive;
  const shared = await one(db, "SELECT 1 AS x FROM archive_shares WHERE archive_id = $aid AND user_id = $uid", {
    aid: archiveId,
    uid: user.id,
  });
  if (shared || archive.bank === "public") return archive;
  fail(403, "archive_not_owner");
}

async function shareTargets(db: Db, user: UserRow) {
  const classrooms = await all<any>(
    db,
    `SELECT c.id, c.teacher_id FROM classrooms c
     LEFT JOIN classroom_members m ON m.classroom_id = c.id AND m.user_id = $uid AND m.status = 'active'
     WHERE c.teacher_id = $uid OR m.user_id IS NOT NULL`,
    { uid: user.id },
  );
  const rank: Record<string, number> = { student: 0, assistant: 1, teacher: 2 };
  const map = new Map<string, { id: string; name: string; role: string }>();
  for (const c of classrooms) {
    const owner = await one<UserRow>(db, "SELECT id, name, role, avatar_url, created_at FROM users WHERE id = $id", {
      id: c.teacher_id,
    });
    if (owner && owner.id !== user.id) map.set(owner.id, { id: owner.id, name: owner.name, role: "teacher" });
    const members = await all<any>(
      db,
      `SELECT u.id, u.name, m.role FROM classroom_members m JOIN users u ON u.id = m.user_id
       WHERE m.classroom_id = $cid AND m.status = 'active'`,
      { cid: c.id },
    );
    for (const m of members) {
      if (m.id === user.id) continue;
      const prev = map.get(m.id);
      if (!prev || rank[m.role] > rank[prev.role]) map.set(m.id, { id: m.id, name: m.name, role: m.role });
    }
  }
  return [...map.values()];
}

function labelFor(role: string, lang: string): string {
  if (role === "teacher") return lang === "en" ? "Teacher" : lang === "es" ? "Profesor" : "老師";
  if (role === "assistant") return lang === "en" ? "Assistant" : lang === "es" ? "Asistente" : "助教";
  return lang === "en" ? "Classmate" : lang === "es" ? "Compañero" : "同學";
}

export function archiveRoutes(db: Db, getLang: (c: any) => Lang) {
  const r = new Hono<AppEnv>();

  r.get("/archives", async (c) => {
    const user = requireUser(c);
    const rows = await all<any>(
      db,
      `SELECT DISTINCT a.* FROM archives a
       LEFT JOIN archive_shares s ON s.archive_id = a.id
       WHERE a.owner_id = $uid OR s.user_id = $uid OR a.bank = 'public'
       ORDER BY a.updated_at DESC, a.created_at DESC`,
      { uid: user.id },
    );
    return c.json(await Promise.all(rows.map((row) => archiveJson(db, row, user))));
  });

  r.post("/archives", async (c) => {
    const user = requireUser(c);
    const body = await bodyOf(c);
    const title = str(body.title, "archive_title_required", { min: 1, max: 200 });
    const at = nowIso();
    const id = newId("a_");
    await run(
      db,
      `INSERT INTO archives (id, owner_id, title, date, rounds, snippet, bank, in_summary, activity_id, created_at, updated_at)
       VALUES ($id, $owner, $title, $at, 0, '', NULL, 0, NULL, $at, $at)`,
      { id, owner: user.id, title, at },
    );
    const row = await one<any>(db, "SELECT * FROM archives WHERE id = $id", { id })!;
    return c.json(await archiveJson(db, row, user));
  });

  r.get("/archives/:id/dialogue", async (c) => {
    const user = requireUser(c);
    const archive = await readAccess(db, c.req.param("id"), user);
    const rows = await all<any>(
      db,
      "SELECT * FROM archive_messages WHERE archive_id = $id ORDER BY created_at, rowid",
      { id: archive.id },
    );
    return c.json(rows.map(dialogueJson));
  });

  r.post("/archives/:id/dialogue", async (c) => {
    const user = requireUser(c);
    const archive = await one<any>(db, "SELECT * FROM archives WHERE id = $id", { id: c.req.param("id") });
    if (!archive) fail(404, "archive_not_found");
    if (archive.owner_id !== user.id) fail(403, "archive_not_owner");
    const body = await bodyOf(c);
    const text = str(body.text, "text_required", { min: 1, max: 2000 });
    checkRate(user.id);
    const stub = c.env.PiAgent.getByName(`archive:${archive.id}`);
    let response: Response;
    try {
      response = await stub.dialogue({
        scope: "archive",
        scopeId: archive.id,
        userId: user.id,
        userText: text,
        lang: getLang(c),
        title: archive.title,
        statement: archive.title,
      });
    } catch (error) {
      releaseLock(`archive:${archive.id}`);
      throw error;
    }
    return new Response(response.body, response);
  });

  r.patch("/archives/:id", async (c) => {
    const user = requireUser(c);
    const archive = await one<any>(db, "SELECT * FROM archives WHERE id = $id", { id: c.req.param("id") });
    if (!archive) fail(404, "archive_not_found");
    if (archive.owner_id !== user.id) fail(403, "archive_not_owner");
    const body = await bodyOf(c);
    if (body.bank !== undefined) {
      if (body.bank !== null && body.bank !== "private" && body.bank !== "public") fail(422, "validation");
      await run(db, "UPDATE archives SET bank = $bank WHERE id = $id", { bank: body.bank, id: archive.id });
      if (body.bank === "public")
        await run(db, "DELETE FROM archive_shares WHERE archive_id = $id", { id: archive.id });
    }
    if (body.inSummary !== undefined) {
      if (typeof body.inSummary !== "boolean") fail(422, "validation");
      await run(db, "UPDATE archives SET in_summary = $v WHERE id = $id", {
        v: body.inSummary ? 1 : 0,
        id: archive.id,
      });
    }
    if (body.sharedWithIds !== undefined) {
      const ids = requireIdList(body.sharedWithIds);
      const allowed = new Set((await shareTargets(db, user)).map((t) => t.id));
      if (ids.some((id) => !allowed.has(id))) fail(422, "unknown_share_target");
      await db.batch([
        { sql: "DELETE FROM archive_shares WHERE archive_id = $id", params: { id: archive.id } },
        ...ids.map((uid) => ({
          sql: "INSERT INTO archive_shares (archive_id, user_id) VALUES ($aid, $uid)",
          params: { aid: archive.id, uid },
        })),
      ]);
    }
    await run(db, "UPDATE archives SET updated_at = $at WHERE id = $id", { at: nowIso(), id: archive.id });
    const row = await one<any>(db, "SELECT * FROM archives WHERE id = $id", { id: archive.id })!;
    return c.json(await archiveJson(db, row, user));
  });

  r.get("/me/share-targets", async (c) => {
    const user = requireUser(c);
    const lang = getLang(c);
    return c.json((await shareTargets(db, user)).map((t) => ({ ...t, role: labelFor(t.role, lang) })));
  });

  return r;
}

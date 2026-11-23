import { Hono } from "hono";
import { ClassroomContentInputSchema, ClassroomPageQuerySchema, type ClassroomEventResource } from "@socrates/shared";
import { sha256Hex } from "../auth-crypto";
import { all, batch, one, run } from "../db/d1";
import { publishClassroom } from "../do/classroom-events";
import {
  fail,
  guardUser,
  newId,
  nowIso,
  requireUser,
  validateJson,
  validateQuery,
  type AppEnv,
  type Ctx,
} from "../http";
import { classroomAccess } from "../services/members";
import { pageBounds, pageOf } from "../services/pagination";

type Content = Extract<ClassroomEventResource, "announcements" | "posts">;

const tables = { announcements: "classroom_announcements", posts: "classroom_posts" } as const;
const contentColumns = "r.id, r.body, r.author_id, r.created_at, u.name AS author_name";
const mayWrite = `EXISTS (
  SELECT 1 FROM classrooms c WHERE c.id = $cid AND (
    c.teacher_id = $uid OR ($canMember AND EXISTS (
      SELECT 1 FROM members m WHERE m.classroom_id = c.id AND m.user_id = $uid
    ))
  )
)`;
const parentExists = `($parent IS NULL OR EXISTS (
  SELECT 1 FROM classroom_posts p WHERE p.classroom_id = $cid AND p.id = $parent AND p.parent_id IS NULL
))`;

interface ContentRow {
  id: string;
  body: string;
  author_id: string | null;
  author_name: string | null;
  created_at: string;
}

function contentOf(row: ContentRow) {
  return {
    id: row.id,
    body: row.body,
    authorId: row.author_id,
    authorName: row.author_name,
    createdAt: row.created_at,
  };
}

async function requireRoot(db: D1Database, classroomId: string, id: string) {
  const root = await one(
    db,
    "SELECT id FROM classroom_posts WHERE classroom_id = $cid AND id = $id AND parent_id IS NULL",
    { cid: classroomId, id },
  );
  if (!root) fail(404, "not_found");
}

async function listContent(
  c: Ctx,
  classroomId: string,
  resource: Content,
  query: { limit?: number; cursor?: string },
  parent: string | null = null,
) {
  await classroomAccess(c.env.DB, classroomId, requireUser(c));
  if (parent) await requireRoot(c.env.DB, classroomId, parent);
  const { limit, at, after } = pageBounds(query);
  const order = parent ? "ASC" : "DESC";
  const bound = parent ? ">" : "<";
  const thread = resource === "posts" ? "AND r.parent_id IS $parent" : "";
  const rows = await all<ContentRow>(
    c.env.DB,
    `SELECT ${contentColumns} FROM ${tables[resource]} r LEFT JOIN users u ON u.id = r.author_id
     WHERE r.classroom_id = $cid ${thread}
       AND ($at IS NULL OR (r.created_at, r.id) ${bound} ($at, $after))
     ORDER BY r.created_at ${order}, r.id ${order} LIMIT $limit`,
    { cid: classroomId, parent, at, after, limit: limit + 1 },
  );
  return c.json(pageOf(rows, limit, (row) => [row.created_at, row.id], contentOf));
}

async function createContent(c: Ctx, cid: string, resource: Content, body: string, parent: string | null = null) {
  const db = c.env.DB;
  const user = requireUser(c);
  const { isTeacher } = await classroomAccess(db, cid, user);
  if (resource === "announcements" && !isTeacher) fail(403, "forbidden");
  if (parent) await requireRoot(db, cid, parent);

  const key = c.req.header("Idempotency-Key");
  if (key !== undefined && !/^[\x21-\x7e]{1,128}$/.test(key)) fail(422, "validation");
  const id = newId(resource === "announcements" ? "an_" : "po_");
  const operation = parent ? `reply:${parent}` : resource;
  const params = { cid, uid: user.id, parent, body, id, at: nowIso(), canMember: resource === "posts" ? 1 : 0 };
  const parentColumn = resource === "posts" ? ", parent_id" : "";
  const parentValue = resource === "posts" ? ", $parent" : "";
  const eligible = `${mayWrite} AND ${parentExists}`;
  const insert = `INSERT INTO ${tables[resource]} (id, classroom_id, author_id, body, created_at ${parentColumn})
    SELECT $id, $cid, $uid, $body, $at ${parentValue} WHERE ${eligible}`;

  let contentId = id;
  if (key !== undefined) {
    const hash = await sha256Hex(body);
    const request = { ...params, operation, key, hash };
    const receipt = "classroom_id = $cid AND user_id = $uid AND operation = $operation AND request_key = $key";
    await batch(db, [
      {
        sql: `INSERT INTO classroom_content_requests (classroom_id, user_id, operation, request_key, content_id, body_hash)
          SELECT $cid, $uid, $operation, $key, $id, $hash WHERE ${eligible} ON CONFLICT DO NOTHING`,
        params: request,
      },
      {
        sql: `${insert} AND EXISTS (SELECT 1 FROM classroom_content_requests WHERE ${receipt} AND content_id = $id)`,
        params: request,
      },
    ]);
    const recorded = await one<{ content_id: string; body_hash: string }>(
      db,
      `SELECT content_id, body_hash FROM classroom_content_requests WHERE ${receipt}`,
      request,
    );
    if (recorded && recorded.body_hash !== hash) fail(409, "conflict");
    contentId = recorded?.content_id ?? id;
  } else {
    await run(db, insert, params);
  }

  const row = await one<ContentRow>(
    db,
    `SELECT ${contentColumns} FROM ${tables[resource]} r LEFT JOIN users u ON u.id = r.author_id
     WHERE r.classroom_id = $cid AND r.id = $id`,
    { cid, id: contentId },
  );
  if (!row) {
    await classroomAccess(db, cid, user);
    fail(404, "not_found");
  }
  if (contentId === id) await publishClassroom(c.env, cid, resource);
  return c.json(contentOf(row), contentId === id ? 201 : 200);
}

async function deleteContent(c: Ctx, cid: string, resource: Content, id: string) {
  const db = c.env.DB;
  const user = requireUser(c);
  const { isTeacher } = await classroomAccess(db, cid, user);
  if (resource === "announcements" && !isTeacher) fail(403, "forbidden");
  const row = await one<{ author_id: string | null }>(
    db,
    `SELECT author_id FROM ${tables[resource]} WHERE classroom_id = $cid AND id = $id`,
    { cid, id },
  );
  if (!row) fail(404, "not_found");
  if (!isTeacher && row.author_id !== user.id) fail(403, "forbidden");
  const deleted = await run(
    db,
    `DELETE FROM ${tables[resource]} WHERE classroom_id = $cid AND id = $id AND ${mayWrite}
      AND (author_id = $uid OR EXISTS (SELECT 1 FROM classrooms WHERE id = $cid AND teacher_id = $uid))`,
    { cid, id, uid: user.id, canMember: resource === "posts" ? 1 : 0 },
  );
  if (deleted.meta.changes) await publishClassroom(c.env, cid, resource);
  return c.body(null, 204);
}

export function communityContentRoutes() {
  return new Hono<AppEnv>()
    .get("/classrooms/:id/announcements", guardUser(), validateQuery(ClassroomPageQuerySchema), (c) =>
      listContent(c, c.req.param("id"), "announcements", c.req.valid("query")),
    )
    .post("/classrooms/:id/announcements", guardUser(), validateJson(ClassroomContentInputSchema), (c) =>
      createContent(c, c.req.param("id"), "announcements", c.req.valid("json").body),
    )
    .delete("/classrooms/:id/announcements/:itemId", (c) =>
      deleteContent(c, c.req.param("id"), "announcements", c.req.param("itemId")),
    )
    .get("/classrooms/:id/posts", guardUser(), validateQuery(ClassroomPageQuerySchema), (c) =>
      listContent(c, c.req.param("id"), "posts", c.req.valid("query")),
    )
    .post("/classrooms/:id/posts", guardUser(), validateJson(ClassroomContentInputSchema), (c) =>
      createContent(c, c.req.param("id"), "posts", c.req.valid("json").body),
    )
    .delete("/classrooms/:id/posts/:postId", (c) => deleteContent(c, c.req.param("id"), "posts", c.req.param("postId")))
    .get("/classrooms/:id/posts/:postId/replies", guardUser(), validateQuery(ClassroomPageQuerySchema), (c) =>
      listContent(c, c.req.param("id"), "posts", c.req.valid("query"), c.req.param("postId")),
    )
    .post("/classrooms/:id/posts/:postId/replies", guardUser(), validateJson(ClassroomContentInputSchema), (c) =>
      createContent(c, c.req.param("id"), "posts", c.req.valid("json").body, c.req.param("postId")),
    );
}

import { Hono } from "hono";
import { SoloThreadCreateInputSchema, SoloThreadUpdateInputSchema, type SoloThread } from "@socrates/shared";
import { all, one, run } from "../db/d1";
import { fail, guardUser, newId, nowIso, requireUser, validateJson, type AppEnv } from "../http";

interface SoloThreadRow {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

function toSoloThread(row: SoloThreadRow): SoloThread {
  return {
    id: row.id,
    title: row.title,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function soloRoutes() {
  return new Hono<AppEnv>()
    .get("/solo/threads", async (c) => {
      const user = requireUser(c);
      const rows = await all<SoloThreadRow>(
        c.env.DB,
        "SELECT id, user_id, title, created_at, updated_at FROM solo_threads WHERE user_id = $uid ORDER BY updated_at DESC",
        { uid: user.id },
      );
      return c.json(rows.map(toSoloThread));
    })
    .post("/solo/threads", guardUser(), validateJson(SoloThreadCreateInputSchema), async (c) => {
      const user = requireUser(c);
      const input = c.req.valid("json");
      const id = newId("solo_");
      const now = nowIso();
      const title = input.title?.trim() ?? "";

      await run(
        c.env.DB,
        "INSERT INTO solo_threads (id, user_id, title, created_at, updated_at) VALUES ($id, $uid, $title, $now, $now)",
        { id, uid: user.id, title, now },
      );

      return c.json<SoloThread>({ id, title, createdAt: now, updatedAt: now }, 201);
    })
    .get("/solo/threads/:id", async (c) => {
      const user = requireUser(c);
      const row = await one<SoloThreadRow>(
        c.env.DB,
        "SELECT id, user_id, title, created_at, updated_at FROM solo_threads WHERE id = $id AND user_id = $uid",
        { id: c.req.param("id"), uid: user.id },
      );
      if (!row) fail(404, "not_found");
      return c.json(toSoloThread(row));
    })
    .patch("/solo/threads/:id", guardUser(), validateJson(SoloThreadUpdateInputSchema), async (c) => {
      const user = requireUser(c);
      const input = c.req.valid("json");
      const id = c.req.param("id");
      const now = nowIso();

      const existing = await one<SoloThreadRow>(
        c.env.DB,
        "SELECT id, user_id, title, created_at, updated_at FROM solo_threads WHERE id = $id AND user_id = $uid",
        { id, uid: user.id },
      );
      if (!existing) fail(404, "not_found");

      await run(
        c.env.DB,
        "UPDATE solo_threads SET title = $title, updated_at = $now WHERE id = $id AND user_id = $uid",
        { id, uid: user.id, title: input.title, now },
      );

      return c.json<SoloThread>({
        id: existing.id,
        title: input.title,
        createdAt: existing.created_at,
        updatedAt: now,
      });
    })
    .delete("/solo/threads/:id", guardUser(), async (c) => {
      const user = requireUser(c);
      const id = c.req.param("id");

      const existing = await one<SoloThreadRow>(
        c.env.DB,
        "SELECT id FROM solo_threads WHERE id = $id AND user_id = $uid",
        { id, uid: user.id },
      );
      if (!existing) fail(404, "not_found");

      await run(c.env.DB, "DELETE FROM solo_threads WHERE id = $id AND user_id = $uid", {
        id,
        uid: user.id,
      });

      return c.body(null, 204);
    });
}

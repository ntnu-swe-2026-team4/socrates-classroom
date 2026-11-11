import { Hono } from "hono";
import { SoloChatInputSchema, type SoloChat } from "@socrates/shared";
import { all, one, run, type Db } from "../db/d1";
import { enforceIpLimit, fail, newId, nowIso, parseBody, requireUser, type AppEnv } from "../http";

export const SOLO_PREFIX = "s_";

interface SoloChatRow {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

function toChat(row: SoloChatRow): SoloChat {
  return { id: row.id, title: row.title, createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function ownedSoloChat(db: Db, chatId: string, userId: string): Promise<SoloChatRow | null> {
  const row = await one<SoloChatRow>(db, "SELECT * FROM solo_chats WHERE id = $id", { id: chatId });
  return row && row.user_id === userId ? row : null;
}

async function requireOwned(db: Db, chatId: string, userId: string): Promise<SoloChatRow> {
  const row = await ownedSoloChat(db, chatId, userId);
  if (!row) fail(404, "not_found");
  return row;
}

export function soloRoutes() {
  return new Hono<AppEnv>()
    .get("/solo/chats", async (c) => {
      const user = requireUser(c);
      const rows = await all<SoloChatRow>(
        c.env.DB,
        "SELECT * FROM solo_chats WHERE user_id = $uid ORDER BY updated_at DESC, id DESC",
        { uid: user.id },
      );
      return c.json(rows.map(toChat));
    })
    .post("/solo/chats", async (c) => {
      const user = requireUser(c);
      await enforceIpLimit(c, "solo-create", 60);
      const input = await parseBody(c, SoloChatInputSchema);
      const at = nowIso();
      const row: SoloChatRow = {
        id: newId(SOLO_PREFIX),
        user_id: user.id,
        title: input.title,
        created_at: at,
        updated_at: at,
      };
      await run(
        c.env.DB,
        "INSERT INTO solo_chats (id, user_id, title, created_at, updated_at) VALUES ($id, $uid, $title, $at, $at)",
        { id: row.id, uid: user.id, title: row.title, at },
      );
      return c.json(toChat(row), 201);
    })
    .get("/solo/chats/:id", async (c) => {
      const user = requireUser(c);
      return c.json(toChat(await requireOwned(c.env.DB, c.req.param("id"), user.id)));
    })
    .patch("/solo/chats/:id", async (c) => {
      const user = requireUser(c);
      const input = await parseBody(c, SoloChatInputSchema);
      const row = await requireOwned(c.env.DB, c.req.param("id"), user.id);
      await run(c.env.DB, "UPDATE solo_chats SET title = $title WHERE id = $id", { id: row.id, title: input.title });
      return c.json(toChat({ ...row, title: input.title }));
    })
    .delete("/solo/chats/:id", async (c) => {
      const user = requireUser(c);
      const row = await requireOwned(c.env.DB, c.req.param("id"), user.id);
      await run(c.env.DB, "DELETE FROM solo_chats WHERE id = $id", { id: row.id });
      return c.body(null, 204);
    });
}

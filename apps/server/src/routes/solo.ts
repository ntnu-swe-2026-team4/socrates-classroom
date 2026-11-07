import { Hono } from "hono";
import { DialogueInputSchema, SoloChatCreateInputSchema, type DialogueMessage, type SoloChat } from "@socrates/shared";
import { all, one, run } from "../db/d1";
import { enforceIpLimit, fail, langOf, newId, nowIso, parseBody, requireUser, type AppEnv } from "../http";

interface SoloChatRow {
  id: string;
  user_id: string;
  title: string;
  created_at: string;
  updated_at: string;
  rounds: number;
  last_text: string | null;
}

const LIST_SQL = `SELECT c.id, c.user_id, c.title, c.created_at, c.updated_at,
  (SELECT COUNT(*) FROM solo_messages m WHERE m.chat_id = c.id AND m.role = 'user') AS rounds,
  (SELECT m.text FROM solo_messages m WHERE m.chat_id = c.id ORDER BY m.at DESC, m.rowid DESC LIMIT 1) AS last_text
  FROM solo_chats c`;

function toChat(row: SoloChatRow): SoloChat {
  return {
    id: row.id,
    title: row.title,
    rounds: Number(row.rounds ?? 0),
    lastText: row.last_text ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function ownedChat(db: D1Database, chatId: string, userId: string): Promise<SoloChatRow> {
  const row = await one<SoloChatRow>(db, `${LIST_SQL} WHERE c.id = $id`, { id: chatId });
  if (!row) fail(404, "not_found");
  if (row.user_id !== userId) fail(403, "forbidden");
  return row;
}

export function soloRoutes() {
  return new Hono<AppEnv>()
    .get("/solo/chats", async (c) => {
      const user = requireUser(c);
      const rows = await all<SoloChatRow>(c.env.DB, `${LIST_SQL} WHERE c.user_id = $uid ORDER BY c.updated_at DESC`, {
        uid: user.id,
      });
      return c.json(rows.map(toChat));
    })
    .post("/solo/chats", async (c) => {
      const user = requireUser(c);
      await enforceIpLimit(c, "solo-create", 60);
      const input = await parseBody(c, SoloChatCreateInputSchema);
      const id = newId("s_");
      const at = nowIso();
      await run(
        c.env.DB,
        "INSERT INTO solo_chats (id, user_id, title, created_at, updated_at) VALUES ($id, $uid, $title, $at, $at)",
        { id, uid: user.id, title: input.title, at },
      );
      return c.json(toChat(await ownedChat(c.env.DB, id, user.id)), 201);
    })
    .get("/solo/chats/:id", async (c) => {
      const user = requireUser(c);
      return c.json(toChat(await ownedChat(c.env.DB, c.req.param("id"), user.id)));
    })
    .delete("/solo/chats/:id", async (c) => {
      const user = requireUser(c);
      const chat = await ownedChat(c.env.DB, c.req.param("id"), user.id);
      await run(c.env.DB, "DELETE FROM solo_chats WHERE id = $id", { id: chat.id });
      return c.body(null, 204);
    })
    .get("/solo/chats/:id/dialogue", async (c) => {
      const user = requireUser(c);
      const chat = await ownedChat(c.env.DB, c.req.param("id"), user.id);
      const messages = await all<DialogueMessage>(
        c.env.DB,
        "SELECT id, role, text, at FROM solo_messages WHERE chat_id = $cid ORDER BY at, rowid",
        { cid: chat.id },
      );
      return c.json(messages);
    })
    .post("/solo/chats/:id/dialogue", async (c) => {
      const user = requireUser(c);
      const input = await parseBody(c, DialogueInputSchema);
      const chat = await ownedChat(c.env.DB, c.req.param("id"), user.id);
      const stub = c.env.PiAgent.getByName(`solo:${chat.id}`);
      try {
        return await stub.dialogue({
          activityId: chat.id,
          userId: user.id,
          userText: input.text,
          title: chat.title,
          lang: langOf(c),
          solo: true,
        });
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        if (raw.includes("already_streaming")) fail(409, "already_streaming");
        fail(503, "llm_unavailable");
      }
    });
}

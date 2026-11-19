import { Hono } from "hono";
import { NotificationInputSchema, type Notification, type NotificationFeed } from "@socrates/shared";
import { all, one, run } from "../db/d1";
import { fail, newId, nowIso, parseBody, requireAccount, requireAdmin, type AppEnv } from "../http";

const FEED_LIMIT = 30;

interface NotificationRow {
  id: string;
  title: string;
  body: string;
  created_at: string;
}

const toNotification = (row: NotificationRow): Notification => ({
  id: row.id,
  title: row.title,
  body: row.body,
  createdAt: row.created_at,
});

export function notificationRoutes() {
  return new Hono<AppEnv>()
    .get("/notifications", async (c) => {
      const user = c.get("user");
      const rows = await all<NotificationRow>(
        c.env.DB,
        "SELECT id, title, body, created_at FROM notifications ORDER BY created_at DESC, id DESC LIMIT $limit",
        { limit: FEED_LIMIT },
      );
      const account = user && !user.guest && !user.preview ? user : null;
      const seen = account
        ? await one<{ notifications_seen_at: string | null }>(
            c.env.DB,
            "SELECT notifications_seen_at FROM users WHERE id = $id",
            { id: account.id },
          )
        : null;
      const seenAt = seen?.notifications_seen_at ?? "";
      const feed: NotificationFeed = {
        items: rows.map(toNotification),
        unread: account ? rows.filter((row) => row.created_at > seenAt).length : 0,
      };
      return c.json(feed);
    })
    .post("/notifications/seen", async (c) => {
      const user = requireAccount(c);
      await run(c.env.DB, "UPDATE users SET notifications_seen_at = $at WHERE id = $id", { at: nowIso(), id: user.id });
      return c.body(null, 204);
    })
    .post("/admin/notifications", async (c) => {
      const admin = requireAdmin(c);
      const input = await parseBody(c, NotificationInputSchema);
      const row: NotificationRow = { id: newId("n_"), title: input.title, body: input.body, created_at: nowIso() };
      await run(
        c.env.DB,
        "INSERT INTO notifications (id, title, body, created_by, created_at) VALUES ($id, $title, $body, $by, $at)",
        { id: row.id, title: row.title, body: row.body, by: admin.id, at: row.created_at },
      );
      return c.json(toNotification(row), 201);
    })
    .delete("/admin/notifications/:id", async (c) => {
      requireAdmin(c);
      const found = await one<{ id: string }>(c.env.DB, "SELECT id FROM notifications WHERE id = $id", {
        id: c.req.param("id"),
      });
      if (!found) fail(404, "not_found");
      await run(c.env.DB, "DELETE FROM notifications WHERE id = $id", { id: found.id });
      return c.body(null, 204);
    });
}

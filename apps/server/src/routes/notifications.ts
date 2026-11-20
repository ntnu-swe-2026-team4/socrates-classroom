import { Hono } from "hono";
import { NotificationInputSchema, type Notification, type NotificationFeed } from "@socrates/shared";
import { all, one, run } from "../db/d1";
import { enforceIpLimit, fail, newId, nowIso, parseBody, requireAdmin, requireUser, type AppEnv } from "../http";

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
      const seen = user
        ? await one<{ notifications_seen_at: string | null }>(
            c.env.DB,
            "SELECT notifications_seen_at FROM users WHERE id = $id",
            { id: user.id },
          )
        : null;
      const seenAt = seen?.notifications_seen_at ?? "";
      const feed: NotificationFeed = {
        items: rows.map(toNotification),
        unread: user ? rows.filter((row) => row.created_at > seenAt).length : null,
      };
      return c.json(feed);
    })
    .post("/notifications/seen", async (c) => {
      const user = requireUser(c);
      await run(c.env.DB, "UPDATE users SET notifications_seen_at = $at WHERE id = $id", { at: nowIso(), id: user.id });
      return c.body(null, 204);
    })
    .post("/admin/notifications", async (c) => {
      const admin = requireAdmin(c);
      await enforceIpLimit(c, "admin-create-notification", 30);
      const input = await parseBody(c, NotificationInputSchema);
      const id = newId("n_");
      const at = nowIso();
      await run(
        c.env.DB,
        "INSERT INTO notifications (id, title, body, created_by, created_at) VALUES ($id, $title, $body, $by, $at)",
        { id, title: input.title, body: input.body, by: admin.id, at },
      );
      const row = await one<NotificationRow>(
        c.env.DB,
        "SELECT id, title, body, created_at FROM notifications WHERE id = $id",
        { id },
      );
      if (!row) fail(500, "internal_error");
      return c.json(toNotification(row), 201);
    });
}

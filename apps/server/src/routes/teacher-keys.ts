import { Hono } from "hono";
import { z } from "zod";
import { all, one, run } from "../db/d1";
import { fail, nowIso, parseBody, requireTeacher, type AppEnv } from "../http";
import { encryptKey } from "../auth-crypto";
import { routingConfig } from "../routing/config.gen";

const KeyInputSchema = z.object({
  provider: z.string(),
  key: z.string().min(8).max(256),
});

const OrderInputSchema = z.object({ providers: z.array(z.string()).max(50) });

interface TeacherKeyRow {
  provider_id: string;
  last4: string;
  sort_order: number;
  updated_at: string;
}

function knownProvider(providerId: string): boolean {
  return routingConfig.providers[providerId] !== undefined;
}

export function teacherKeyRoutes() {
  return new Hono<AppEnv>()
    .get("/settings/keys", async (c) => {
      const user = requireTeacher(c);
      const rows = await all<TeacherKeyRow>(
        c.env.DB,
        "SELECT provider_id, last4, sort_order, updated_at FROM teacher_keys WHERE user_id = $uid ORDER BY sort_order",
        { uid: user.id },
      );
      return c.json(
        rows.map((row) => ({
          provider: row.provider_id,
          last4: row.last4,
          sortOrder: row.sort_order,
          updatedAt: row.updated_at,
        })),
      );
    })
    .put("/settings/keys/order", async (c) => {
      const user = requireTeacher(c);
      const input = await parseBody(c, OrderInputSchema);
      const owned = await all<{ provider_id: string }>(
        c.env.DB,
        "SELECT provider_id FROM teacher_keys WHERE user_id = $uid",
        { uid: user.id },
      );
      const ownedProviders = new Set(owned.map((row) => row.provider_id));
      if (input.providers.some((pid) => !ownedProviders.has(pid))) fail(422, "validation");
      if (input.providers.length > 0) {
        await c.env.DB.batch(
          input.providers.map((pid, index) =>
            c.env.DB.prepare(
              "UPDATE teacher_keys SET sort_order = $order WHERE user_id = $uid AND provider_id = $pid",
            ).bind(index, user.id, pid),
          ),
        );
      }
      return c.json({ providers: input.providers });
    })
    .put("/settings/keys/:provider", async (c) => {
      const user = requireTeacher(c);
      const provider = c.req.param("provider");
      const input = await parseBody(c, KeyInputSchema);
      if (provider !== input.provider || !knownProvider(provider)) fail(422, "byok_provider_invalid");
      const enc = await encryptKey(c.env, input.key);
      const existing = await one<{ n: number }>(
        c.env.DB,
        "SELECT COALESCE(MAX(sort_order), 0) AS n FROM teacher_keys WHERE user_id = $uid AND provider_id != $pid",
        { uid: user.id, pid: provider },
      );
      const order = existing?.n ?? 0;
      await run(
        c.env.DB,
        `INSERT INTO teacher_keys (user_id, provider_id, key_enc, last4, sort_order, updated_at)
         VALUES ($uid, $pid, $enc, $last4, $order, $at)
         ON CONFLICT(user_id, provider_id) DO UPDATE SET key_enc = $enc, last4 = $last4, updated_at = $at`,
        { uid: user.id, pid: provider, enc, last4: input.key.slice(-4), order, at: nowIso() },
      );
      return c.json({ provider, last4: input.key.slice(-4) });
    })
    .delete("/settings/keys/:provider", async (c) => {
      const user = requireTeacher(c);
      const result = await run(c.env.DB, "DELETE FROM teacher_keys WHERE provider_id = $pid AND user_id = $uid", {
        pid: c.req.param("provider"),
        uid: user.id,
      });
      if ((result.meta?.changes ?? 0) === 0) fail(404, "not_found");
      return c.body(null, 204);
    })
    .put("/settings/keys/order", async (c) => {
      const user = requireTeacher(c);
      const input = await parseBody(c, OrderInputSchema);
      const owned = await all<{ provider_id: string }>(
        c.env.DB,
        "SELECT provider_id FROM teacher_keys WHERE user_id = $uid",
        { uid: user.id },
      );
      const ownedProviders = new Set(owned.map((row) => row.provider_id));
      if (input.providers.some((pid) => !ownedProviders.has(pid))) fail(422, "validation");
      if (input.providers.length > 0) {
        await c.env.DB.batch(
          input.providers.map((pid, index) =>
            c.env.DB.prepare(
              "UPDATE teacher_keys SET sort_order = $order WHERE user_id = $uid AND provider_id = $pid",
            ).bind(index, user.id, pid),
          ),
        );
      }
      return c.json({ providers: input.providers });
    });
}

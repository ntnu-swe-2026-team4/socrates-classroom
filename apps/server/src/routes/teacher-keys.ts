import { Hono } from "hono";
import { z } from "zod";
import { all, batch, one, run } from "../db/d1";
import { fail, nowIso, parseBody, requireTeacher, type AppEnv } from "../http";
import { encryptKey } from "../auth-crypto";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

const KeyInputSchema = z.object({
  provider: z.string(),
  model: z.string().min(1).max(200),
  key: z.string().min(8).max(256),
});

const OrderInputSchema = z.object({ providers: z.array(z.string()).max(50) });

interface TeacherKeyRow {
  provider_id: string;
  model: string;
  last4: string;
  sort_order: number;
  updated_at: string;
}

const keyableProviders = builtinProviders().filter((provider) => provider.auth.apiKey !== undefined);

function keyableProvider(providerId: string) {
  return keyableProviders.find((provider) => provider.id === providerId);
}

export function teacherKeyRoutes() {
  return new Hono<AppEnv>()
    .get("/settings/keys", async (c) => {
      const user = requireTeacher(c);
      const rows = await all<TeacherKeyRow>(
        c.env.DB,
        "SELECT provider_id, model, last4, sort_order, updated_at FROM teacher_keys WHERE user_id = $uid ORDER BY sort_order",
        { uid: user.id },
      );
      return c.json(
        rows.map((row) => ({
          provider: row.provider_id,
          model: row.model,
          last4: row.last4,
          sortOrder: row.sort_order,
          updatedAt: row.updated_at,
        })),
      );
    })
    .get("/settings/keys/providers", async (c) => {
      requireTeacher(c);
      return c.json(keyableProviders.map((provider) => ({ id: provider.id, name: provider.name })));
    })
    .get("/settings/keys/providers/:provider/models", async (c) => {
      requireTeacher(c);
      const provider = keyableProvider(c.req.param("provider"));
      if (!provider) fail(404, "not_found");
      return c.json(provider.getModels().map((model) => ({ id: model.id, name: model.name })));
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
        await batch(
          c.env.DB,
          input.providers.map((pid, index) => ({
            sql: "UPDATE teacher_keys SET sort_order = $order WHERE user_id = $uid AND provider_id = $pid",
            params: { order: index, uid: user.id, pid },
          })),
        );
      }
      return c.json({ providers: input.providers });
    })
    .put("/settings/keys/:provider", async (c) => {
      const user = requireTeacher(c);
      const provider = c.req.param("provider");
      const input = await parseBody(c, KeyInputSchema);
      const def = provider !== input.provider ? undefined : keyableProvider(provider);
      if (!def) fail(422, "byok_provider_invalid");
      if (!def.getModels().some((model) => model.id === input.model)) fail(422, "validation");
      const enc = await encryptKey(c.env, input.key);
      const existing = await one<{ n: number }>(
        c.env.DB,
        "SELECT COALESCE(MAX(sort_order), -1) AS n FROM teacher_keys WHERE user_id = $uid AND provider_id != $pid",
        { uid: user.id, pid: provider },
      );
      const order = (existing?.n ?? -1) + 1;
      await run(
        c.env.DB,
        `INSERT INTO teacher_keys (user_id, provider_id, key_enc, last4, model, sort_order, updated_at)
         VALUES ($uid, $pid, $enc, $last4, $model, $order, $at)
         ON CONFLICT(user_id, provider_id) DO UPDATE SET key_enc = $enc, last4 = $last4, model = $model, updated_at = $at`,
        {
          uid: user.id,
          pid: provider,
          enc,
          last4: input.key.slice(-4),
          model: input.model,
          order,
          at: nowIso(),
        },
      );
      return c.json({ provider, model: input.model, last4: input.key.slice(-4) });
    })
    .delete("/settings/keys/:provider", async (c) => {
      const user = requireTeacher(c);
      const result = await run(c.env.DB, "DELETE FROM teacher_keys WHERE provider_id = $pid AND user_id = $uid", {
        pid: c.req.param("provider"),
        uid: user.id,
      });
      if ((result.meta?.changes ?? 0) === 0) fail(404, "not_found");
      return c.body(null, 204);
    });
}

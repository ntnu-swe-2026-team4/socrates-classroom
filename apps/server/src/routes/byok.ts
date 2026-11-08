import { Hono } from "hono";
import { z } from "zod";
import { one, run } from "../db/d1";
import { fail, nowIso, parseBody, requireUser, type AppEnv } from "../http";
import { encryptKey, isAllowedProvider } from "../auth-crypto";

const ByokSetInputSchema = z.object({
  provider: z.string(),
  key: z.string().min(8).max(256),
});

export function byokRoutes() {
  return new Hono<AppEnv>()
    .get("/settings/byok", async (c) => {
      const user = requireUser(c);
      const row = await one<{ provider: string; last4: string }>(
        c.env.DB,
        "SELECT provider, last4 FROM byok_keys WHERE user_id = $uid",
        { uid: user.id },
      );
      if (!row) return c.json(null);
      return c.json({ provider: row.provider, last4: row.last4 });
    })
    .put("/settings/byok", async (c) => {
      const user = requireUser(c);
      const input = await parseBody(c, ByokSetInputSchema);
      if (!isAllowedProvider(input.provider)) fail(422, "byok_provider_invalid");
      const enc = await encryptKey(c.env, input.key);
      await run(
        c.env.DB,
        `INSERT INTO byok_keys (user_id, provider, key_enc, last4, updated_at) VALUES ($uid, $provider, $enc, $last4, $at)
         ON CONFLICT(user_id) DO UPDATE SET provider = $provider, key_enc = $enc, last4 = $last4, updated_at = $at`,
        { uid: user.id, provider: input.provider, enc, last4: input.key.slice(-4), at: nowIso() },
      );
      return c.json({ provider: input.provider, last4: input.key.slice(-4) });
    })
    .delete("/settings/byok", async (c) => {
      const user = requireUser(c);
      await run(c.env.DB, "DELETE FROM byok_keys WHERE user_id = $uid", { uid: user.id });
      return c.body(null, 204);
    });
}

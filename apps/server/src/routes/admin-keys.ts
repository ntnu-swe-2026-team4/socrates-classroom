import { Hono } from "hono";
import {
  AdminKeyCreateInputSchema,
  AdminKeyModelEchoSchema,
  AdminKeyModelInputSchema,
  AdminKeyModelOrderInputSchema,
  AdminKeyOrderInputSchema,
  AdminKeyUpdateInputSchema,
  AdminKeyZdrInputSchema,
  type AdminKeyStatus,
} from "@socrates/shared";
import { all, batch, one } from "../db/d1";
import { adminActionEntry } from "../services/audit";
import { keyableProvider, keyableProviders } from "../pi/keyable-providers";
import { zdrBlockedModels } from "../gateway/zdr";
import { encryptKey } from "../auth-crypto";
import {
  fail,
  guardAdmin,
  newId,
  nowIso,
  rateLimit,
  requireAdmin,
  uniqueViolationColumns,
  validateJson,
  type AppEnv,
} from "../http";

interface AdminKeyRow {
  id: string;
  provider_id: string;
  last4: string;
  sort_order: number;
  updated_at: string;
  max_concurrency: number | null;
  monthly_quota_usd: number | null;
  zdr_status: "unverified" | "approved";
  zdr_retention_source: string | null;
  zdr_verified_at: string | null;
}

interface ModelRow {
  admin_key_id: string;
  model: string;
  max_concurrency: number | null;
  sort_order: number;
}

async function loadAdminKey(db: D1Database, id: string): Promise<AdminKeyRow | null> {
  return await one<AdminKeyRow>(
    db,
    "SELECT id, provider_id, last4, sort_order, updated_at, max_concurrency, monthly_quota_usd, zdr_status, zdr_retention_source, zdr_verified_at FROM admin_keys WHERE id = $id",
    { id },
  );
}

export function adminKeyRoutes() {
  return new Hono<AppEnv>()
    .get("/admin/keys", async (c) => {
      requireAdmin(c);
      const keys = await all<AdminKeyRow>(
        c.env.DB,
        "SELECT id, provider_id, last4, sort_order, updated_at, max_concurrency, monthly_quota_usd, zdr_status, zdr_retention_source, zdr_verified_at FROM admin_keys ORDER BY sort_order",
      );
      const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
      const usage = await all<{ admin_key_id: string; cost: number; tokens: number }>(
        c.env.DB,
        "SELECT admin_key_id, COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(total_tokens), 0) AS tokens FROM admin_key_usage WHERE created_at >= $start GROUP BY admin_key_id",
        { start: monthStart },
      );
      const usageById = new Map(usage.map((row) => [row.admin_key_id, row]));
      const legs = await all<ModelRow>(
        c.env.DB,
        "SELECT admin_key_id, model, max_concurrency, sort_order FROM admin_key_models ORDER BY sort_order",
      );
      const byKey = new Map<string, ModelRow[]>();
      for (const leg of legs) {
        const list = byKey.get(leg.admin_key_id) ?? [];
        list.push(leg);
        byKey.set(leg.admin_key_id, list);
      }
      const statuses: AdminKeyStatus[] = keys.map((row) => ({
        id: row.id,
        provider: row.provider_id,
        last4: row.last4,
        maxConcurrency: row.max_concurrency,
        monthlyQuotaUsd: row.monthly_quota_usd,
        monthCostUsd: usageById.get(row.id)?.cost ?? 0,
        monthTokens: usageById.get(row.id)?.tokens ?? 0,
        sortOrder: row.sort_order,
        updatedAt: row.updated_at,
        zdrStatus: row.zdr_status,
        zdrRetentionSource: row.zdr_retention_source,
        zdrVerifiedAt: row.zdr_verified_at,
        models: (byKey.get(row.id) ?? []).map((leg) => ({
          model: leg.model,
          maxConcurrency: leg.max_concurrency,
          sortOrder: leg.sort_order,
        })),
      }));
      return c.json(statuses);
    })
    .get("/admin/keys/providers", async (c) => {
      requireAdmin(c);
      return c.json(keyableProviders.map((provider) => ({ id: provider.id, name: provider.name })));
    })
    .get("/admin/keys/providers/:provider/models", async (c) => {
      requireAdmin(c);
      const provider = keyableProvider(c.req.param("provider"));
      if (!provider) fail(404, "not_found");
      return c.json(provider.getModels().map((model) => ({ id: model.id, name: model.name })));
    })
    .post(
      "/admin/keys",
      guardAdmin(),
      rateLimit("admin-create-key", 30),
      validateJson(AdminKeyCreateInputSchema),
      async (c) => {
        const actor = requireAdmin(c);
        const input = c.req.valid("json");
        if (!keyableProvider(input.provider)) fail(422, "byok_provider_invalid");
        const enc = await encryptKey(c.env, input.key);
        const id = newId("ak_");
        try {
          await batch(c.env.DB, [
            {
              sql: `INSERT INTO admin_keys (id, provider_id, key_enc, last4, sort_order, updated_at, max_concurrency, monthly_quota_usd)
                    SELECT $id, $pid, $enc, $last4, COALESCE((SELECT MAX(sort_order) FROM admin_keys), -1) + 1, $at, $maxConcurrency, $quota`,
              params: {
                id,
                pid: input.provider,
                enc,
                last4: input.key.slice(-4),
                at: nowIso(),
                maxConcurrency: input.maxConcurrency ?? null,
                quota: input.monthlyQuotaUsd ?? null,
              },
            },
            adminActionEntry({
              actorId: actor.id,
              action: "admin_key.create",
              target: `admin_key:${id}`,
              after: {
                provider: input.provider,
                last4: input.key.slice(-4),
                maxConcurrency: input.maxConcurrency ?? null,
                monthlyQuotaUsd: input.monthlyQuotaUsd ?? null,
              },
            }),
          ]);
        } catch (error) {
          if (
            uniqueViolationColumns(error).some(([table, column]) => table === "admin_keys" && column === "provider_id")
          ) {
            fail(409, "conflict");
          }
          throw error;
        }
        const created = await loadAdminKey(c.env.DB, id);
        if (!created) fail(500, "internal_error");
        return c.json(
          {
            id: created.id,
            provider: created.provider_id,
            last4: created.last4,
            maxConcurrency: created.max_concurrency,
            monthlyQuotaUsd: created.monthly_quota_usd,
          },
          201,
        );
      },
    )
    .put("/admin/keys/order", guardAdmin(), validateJson(AdminKeyOrderInputSchema), async (c) => {
      requireAdmin(c);
      const input = c.req.valid("json");
      const owned = await all<{ id: string }>(c.env.DB, "SELECT id FROM admin_keys");
      const ownedIds = new Set(owned.map((row) => row.id));
      if (input.keys.some((id) => !ownedIds.has(id))) fail(422, "validation");
      const ordered = new Set(input.keys);
      let unlisted = 0;
      await batch(
        c.env.DB,
        owned.map((row) => {
          const order = ordered.has(row.id) ? input.keys.indexOf(row.id) : input.keys.length + unlisted++;
          return {
            sql: "UPDATE admin_keys SET sort_order = $order, updated_at = $at WHERE id = $id",
            params: { order, at: nowIso(), id: row.id },
          };
        }),
      );
      return c.json({ keys: input.keys });
    })
    .put(
      "/admin/keys/:id",
      guardAdmin(),
      rateLimit("admin-update-key", 30),
      validateJson(AdminKeyUpdateInputSchema),
      async (c) => {
        const actor = requireAdmin(c);
        const target = await loadAdminKey(c.env.DB, c.req.param("id"));
        if (!target) fail(404, "not_found");
        const input = c.req.valid("json");
        const keyEnc = input.key === undefined ? null : await encryptKey(c.env, input.key);
        const last4 = input.key === undefined ? null : input.key.slice(-4);
        const maxConcurrency = ("maxConcurrency" in input ? input.maxConcurrency : target.max_concurrency) ?? null;
        const monthlyQuotaUsd = ("monthlyQuotaUsd" in input ? input.monthlyQuotaUsd : target.monthly_quota_usd) ?? null;
        await batch(c.env.DB, [
          {
            sql: `UPDATE admin_keys SET
                key_enc = COALESCE($enc, key_enc),
                last4 = COALESCE($last4, last4),
                max_concurrency = $maxConcurrency,
                monthly_quota_usd = $quota,
                updated_at = $at
              WHERE id = $id`,
            params: {
              enc: keyEnc,
              last4,
              maxConcurrency,
              quota: monthlyQuotaUsd,
              at: nowIso(),
              id: target.id,
            },
          },
          adminActionEntry({
            actorId: actor.id,
            action: "admin_key.update",
            target: `admin_key:${target.id}`,
            before: {
              provider: target.provider_id,
              last4: target.last4,
              maxConcurrency: target.max_concurrency,
              monthlyQuotaUsd: target.monthly_quota_usd,
            },
            after: { provider: target.provider_id, last4: last4 ?? target.last4, maxConcurrency, monthlyQuotaUsd },
          }),
        ]);
        const updated = await loadAdminKey(c.env.DB, target.id);
        if (!updated) fail(500, "internal_error");
        return c.json({
          id: updated.id,
          provider: updated.provider_id,
          last4: updated.last4,
          maxConcurrency: updated.max_concurrency,
          monthlyQuotaUsd: updated.monthly_quota_usd,
        });
      },
    )
    .delete("/admin/keys/:id", guardAdmin(), async (c) => {
      const actor = requireAdmin(c);
      const target = await loadAdminKey(c.env.DB, c.req.param("id"));
      if (!target) fail(404, "not_found");
      await batch(c.env.DB, [
        { sql: "DELETE FROM admin_keys WHERE id = $id", params: { id: target.id } },
        adminActionEntry({
          actorId: actor.id,
          action: "admin_key.delete",
          target: `admin_key:${target.id}`,
          before: {
            provider: target.provider_id,
            last4: target.last4,
            maxConcurrency: target.max_concurrency,
            monthlyQuotaUsd: target.monthly_quota_usd,
          },
        }),
      ]);
      return c.body(null, 204);
    })
    .put("/admin/keys/:id/models/order", guardAdmin(), validateJson(AdminKeyModelOrderInputSchema), async (c) => {
      requireAdmin(c);
      const key = await loadAdminKey(c.env.DB, c.req.param("id"));
      if (!key) fail(404, "not_found");
      const input = c.req.valid("json");
      const owned = await all<{ model: string }>(
        c.env.DB,
        "SELECT model FROM admin_key_models WHERE admin_key_id = $id",
        { id: key.id },
      );
      const ownedModels = new Set(owned.map((row) => row.model));
      if (input.models.some((model) => !ownedModels.has(model))) fail(422, "validation");
      const ordered = new Set(input.models);
      let unlisted = 0;
      await batch(
        c.env.DB,
        owned.map((row) => {
          const order = ordered.has(row.model) ? input.models.indexOf(row.model) : input.models.length + unlisted++;
          return {
            sql: "UPDATE admin_key_models SET sort_order = $order, updated_at = $at WHERE admin_key_id = $id AND model = $model",
            params: { order, at: nowIso(), id: key.id, model: row.model },
          };
        }),
      );
      return c.json({ models: input.models });
    })
    .put("/admin/keys/:id/models", guardAdmin(), validateJson(AdminKeyModelInputSchema), async (c) => {
      const actor = requireAdmin(c);
      const key = await loadAdminKey(c.env.DB, c.req.param("id"));
      if (!key) fail(404, "not_found");
      const input = c.req.valid("json");
      const def = keyableProvider(key.provider_id);
      if (!def) fail(422, "byok_provider_invalid");
      if (!def.getModels().some((model) => model.id === input.model)) fail(422, "byok_provider_invalid");
      const existing = await one<{ max_concurrency: number | null }>(
        c.env.DB,
        "SELECT max_concurrency FROM admin_key_models WHERE admin_key_id = $id AND model = $model",
        { id: key.id, model: input.model },
      );
      const maxConcurrency =
        ("maxConcurrency" in input ? input.maxConcurrency : (existing?.max_concurrency ?? null)) ?? null;
      const write = existing
        ? {
            sql: "UPDATE admin_key_models SET max_concurrency = $maxConcurrency, updated_at = $at WHERE admin_key_id = $id AND model = $model",
            params: { id: key.id, model: input.model, maxConcurrency, at: nowIso() },
          }
        : {
            sql: `INSERT INTO admin_key_models (admin_key_id, model, max_concurrency, sort_order, updated_at)
                  SELECT $id, $model, $maxConcurrency, COALESCE(
                    (SELECT MAX(sort_order) FROM admin_key_models WHERE admin_key_id = $id
                  ), -1) + 1, $at`,
            params: { id: key.id, model: input.model, maxConcurrency, at: nowIso() },
          };
      await batch(c.env.DB, [
        write,
        adminActionEntry({
          actorId: actor.id,
          action: "admin_key_model.upsert",
          target: `admin_key:${key.id}`,
          before: existing ? { model: input.model, maxConcurrency: existing.max_concurrency } : null,
          after: { model: input.model, maxConcurrency },
        }),
      ]);
      const payload = AdminKeyModelEchoSchema.parse({
        id: key.id,
        provider: key.provider_id,
        model: input.model,
        maxConcurrency,
      });
      return c.json(payload);
    })
    .post("/admin/keys/:id/zdr", guardAdmin(), validateJson(AdminKeyZdrInputSchema), async (c) => {
      const actor = requireAdmin(c);
      const key = await loadAdminKey(c.env.DB, c.req.param("id"));
      if (!key) fail(404, "not_found");
      const input = c.req.valid("json");
      const legs = await all<{ model: string }>(
        c.env.DB,
        "SELECT model FROM admin_key_models WHERE admin_key_id = $id ORDER BY sort_order",
        { id: key.id },
      );
      if (legs.length === 0) fail(422, "validation");
      const models = legs.map((leg) => leg.model);
      const blocked = zdrBlockedModels(key.provider_id, models);
      if (blocked.length > 0) fail(422, "zdr_model_unverified", { models: blocked.join(", ") });
      await batch(c.env.DB, [
        {
          sql: `UPDATE admin_keys SET zdr_status = 'approved', zdr_retention_source = $source, zdr_verified_at = $verified, updated_at = $at
              WHERE id = $id`,
          params: { source: input.retentionSource, verified: input.verifiedAt, at: nowIso(), id: key.id },
        },
        adminActionEntry({
          actorId: actor.id,
          action: "admin_key.zdr_approve",
          target: `admin_key:${key.id}`,
          before: {
            zdrStatus: key.zdr_status,
            zdrRetentionSource: key.zdr_retention_source,
            zdrVerifiedAt: key.zdr_verified_at,
          },
          after: {
            zdrStatus: "approved",
            zdrRetentionSource: input.retentionSource,
            zdrVerifiedAt: input.verifiedAt,
            models,
          },
        }),
      ]);
      const approved = await loadAdminKey(c.env.DB, key.id);
      if (!approved) fail(500, "internal_error");
      return c.json({
        id: approved.id,
        provider: approved.provider_id,
        last4: approved.last4,
        maxConcurrency: approved.max_concurrency,
        monthlyQuotaUsd: approved.monthly_quota_usd,
        zdrStatus: approved.zdr_status,
        zdrRetentionSource: approved.zdr_retention_source,
        zdrVerifiedAt: approved.zdr_verified_at,
      });
    })
    .delete("/admin/keys/:id/models/:model", guardAdmin(), async (c) => {
      const actor = requireAdmin(c);
      const key = await loadAdminKey(c.env.DB, c.req.param("id"));
      if (!key) fail(404, "not_found");
      const model = c.req.param("model");
      const existing = await one<{ max_concurrency: number | null }>(
        c.env.DB,
        "SELECT max_concurrency FROM admin_key_models WHERE admin_key_id = $id AND model = $model",
        { id: key.id, model },
      );
      if (!existing) fail(404, "not_found");
      await batch(c.env.DB, [
        {
          sql: "DELETE FROM admin_key_models WHERE admin_key_id = $id AND model = $model",
          params: { id: key.id, model },
        },
        adminActionEntry({
          actorId: actor.id,
          action: "admin_key_model.delete",
          target: `admin_key:${key.id}`,
          before: { model, maxConcurrency: existing.max_concurrency },
        }),
      ]);
      return c.body(null, 204);
    });
}

import { Hono } from "hono";
import { z } from "zod";
import type { TeacherKeyStatus } from "@socrates/shared";
import { all, batch, one, run } from "../db/d1";
import { fail, nowIso, parseBody, requireCapability, type AppEnv } from "../http";
import { encryptKey } from "../auth-crypto";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

const KeyInputSchema = z
  .object({
    key: z.string().min(8).max(256).optional(),
    maxConcurrency: z.number().int().min(1).max(100).nullable().optional(),
    monthlyQuotaUsd: z.number().positive().max(100000).nullable().optional(),
  })
  .refine(
    (input) => input.key !== undefined || input.maxConcurrency !== undefined || input.monthlyQuotaUsd !== undefined,
    {
      message: "key, maxConcurrency or monthlyQuotaUsd required",
    },
  );

const ModelInputSchema = z.object({
  model: z.string().min(1).max(200),
  maxConcurrency: z.number().int().min(1).max(100).nullable().optional(),
});

const ModelOrderInputSchema = z.object({ models: z.array(z.string().min(1).max(200)).max(200) });

const OrderInputSchema = z.object({ providers: z.array(z.string()).max(50) });

interface ProviderKeyRow {
  provider_id: string;
  last4: string;
  sort_order: number;
  updated_at: string;
  max_concurrency: number | null;
  monthly_quota_usd: number | null;
}

interface ModelRow {
  provider_id: string;
  model: string;
  max_concurrency: number | null;
  sort_order: number;
}

const keyableProviders = builtinProviders().filter((provider) => provider.auth.apiKey !== undefined);

function keyableProvider(providerId: string) {
  return keyableProviders.find((provider) => provider.id === providerId);
}

export function teacherKeyRoutes() {
  return new Hono<AppEnv>()
    .get("/settings/keys", async (c) => {
      const user = requireCapability(c, "manage_classes");
      const keys = await all<ProviderKeyRow>(
        c.env.DB,
        "SELECT provider_id, last4, sort_order, updated_at, max_concurrency, monthly_quota_usd FROM teacher_keys WHERE user_id = $uid ORDER BY sort_order",
        { uid: user.id },
      );
      const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
      const usage = await all<{ provider_id: string; cost: number; tokens: number }>(
        c.env.DB,
        "SELECT provider_id, COALESCE(SUM(cost_usd), 0) AS cost, COALESCE(SUM(total_tokens), 0) AS tokens FROM teacher_key_usage WHERE user_id = $uid AND created_at >= $start GROUP BY provider_id",
        { uid: user.id, start: monthStart },
      );
      const usageByProvider = new Map(usage.map((row) => [row.provider_id, row]));
      const legs = await all<ModelRow>(
        c.env.DB,
        "SELECT provider_id, model, max_concurrency, sort_order FROM teacher_key_models WHERE user_id = $uid ORDER BY sort_order",
        { uid: user.id },
      );
      const byProvider = new Map<string, ModelRow[]>();
      for (const leg of legs) {
        const list = byProvider.get(leg.provider_id) ?? [];
        list.push(leg);
        byProvider.set(leg.provider_id, list);
      }
      const statuses: TeacherKeyStatus[] = keys.map((row) => ({
        provider: row.provider_id,
        last4: row.last4,
        maxConcurrency: row.max_concurrency,
        monthlyQuotaUsd: row.monthly_quota_usd,
        monthCostUsd: usageByProvider.get(row.provider_id)?.cost ?? 0,
        monthTokens: usageByProvider.get(row.provider_id)?.tokens ?? 0,
        sortOrder: row.sort_order,
        updatedAt: row.updated_at,
        models: (byProvider.get(row.provider_id) ?? []).map((leg) => ({
          model: leg.model,
          maxConcurrency: leg.max_concurrency,
          sortOrder: leg.sort_order,
        })),
      }));
      return c.json(statuses);
    })
    .get("/settings/keys/providers", async (c) => {
      requireCapability(c, "manage_classes");
      return c.json(keyableProviders.map((provider) => ({ id: provider.id, name: provider.name })));
    })
    .get("/settings/keys/providers/:provider/models", async (c) => {
      requireCapability(c, "manage_classes");
      const provider = keyableProvider(c.req.param("provider"));
      if (!provider) fail(404, "not_found");
      return c.json(provider.getModels().map((model) => ({ id: model.id, name: model.name })));
    })
    .put("/settings/keys/order", async (c) => {
      const user = requireCapability(c, "manage_classes");
      const input = await parseBody(c, OrderInputSchema);
      const owned = await all<{ provider_id: string }>(
        c.env.DB,
        "SELECT provider_id FROM teacher_keys WHERE user_id = $uid",
        { uid: user.id },
      );
      const ownedProviders = new Set(owned.map((row) => row.provider_id));
      if (input.providers.some((pid) => !ownedProviders.has(pid))) fail(422, "validation");
      const ordered = new Set(input.providers);
      let unlisted = 0;
      await batch(
        c.env.DB,
        owned.map((row) => {
          const order = ordered.has(row.provider_id)
            ? input.providers.indexOf(row.provider_id)
            : input.providers.length + unlisted++;
          return {
            sql: "UPDATE teacher_keys SET sort_order = $order, updated_at = $at WHERE user_id = $uid AND provider_id = $pid",
            params: { order, at: nowIso(), uid: user.id, pid: row.provider_id },
          };
        }),
      );
      return c.json({ providers: input.providers });
    })
    .put("/settings/keys/:provider/models/order", async (c) => {
      const user = requireCapability(c, "manage_classes");
      const provider = c.req.param("provider");
      const input = await parseBody(c, ModelOrderInputSchema);
      const owned = await all<{ model: string }>(
        c.env.DB,
        "SELECT model FROM teacher_key_models WHERE user_id = $uid AND provider_id = $pid",
        { uid: user.id, pid: provider },
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
            sql: "UPDATE teacher_key_models SET sort_order = $order, updated_at = $at WHERE user_id = $uid AND provider_id = $pid AND model = $model",
            params: { order, at: nowIso(), uid: user.id, pid: provider, model: row.model },
          };
        }),
      );
      return c.json({ models: input.models });
    })
    .put("/settings/keys/:provider/models", async (c) => {
      const user = requireCapability(c, "manage_classes");
      const provider = c.req.param("provider");
      const input = await parseBody(c, ModelInputSchema);
      const def = keyableProvider(provider);
      if (!def) fail(422, "byok_provider_invalid");
      if (!def.getModels().some((model) => model.id === input.model)) fail(422, "byok_provider_invalid");
      const key = await one<{ n: number }>(
        c.env.DB,
        "SELECT 1 AS n FROM teacher_keys WHERE user_id = $uid AND provider_id = $pid",
        { uid: user.id, pid: provider },
      );
      if (!key) fail(422, "validation");
      const existing = await one<{ max_concurrency: number | null }>(
        c.env.DB,
        "SELECT max_concurrency FROM teacher_key_models WHERE user_id = $uid AND provider_id = $pid AND model = $model",
        { uid: user.id, pid: provider, model: input.model },
      );
      const maxConcurrency = existing
        ? "maxConcurrency" in input
          ? input.maxConcurrency
          : existing.max_concurrency
        : (input.maxConcurrency ?? null);
      if (existing) {
        await run(
          c.env.DB,
          "UPDATE teacher_key_models SET max_concurrency = $maxConcurrency, updated_at = $at WHERE user_id = $uid AND provider_id = $pid AND model = $model",
          { uid: user.id, pid: provider, model: input.model, maxConcurrency, at: nowIso() },
        );
      } else {
        await run(
          c.env.DB,
          `INSERT INTO teacher_key_models (user_id, provider_id, model, max_concurrency, sort_order, updated_at)
           SELECT $uid, $pid, $model, $maxConcurrency, COALESCE((
             SELECT MAX(sort_order) FROM teacher_key_models WHERE user_id = $uid AND provider_id = $pid
           ), -1) + 1, $at`,
          { uid: user.id, pid: provider, model: input.model, maxConcurrency, at: nowIso() },
        );
      }
      return c.json({ provider, model: input.model, maxConcurrency });
    })
    .delete("/settings/keys/:provider/models/:model", async (c) => {
      const user = requireCapability(c, "manage_classes");
      const result = await run(
        c.env.DB,
        "DELETE FROM teacher_key_models WHERE user_id = $uid AND provider_id = $pid AND model = $model",
        { uid: user.id, pid: c.req.param("provider"), model: c.req.param("model") },
      );
      if ((result.meta?.changes ?? 0) === 0) fail(404, "not_found");
      return c.body(null, 204);
    })
    .put("/settings/keys/:provider", async (c) => {
      const user = requireCapability(c, "manage_classes");
      const provider = c.req.param("provider");
      const input = await parseBody(c, KeyInputSchema);
      if (!keyableProvider(provider)) fail(422, "byok_provider_invalid");
      if (input.key === undefined) {
        const existing = await one<{ max_concurrency: number | null; monthly_quota_usd: number | null }>(
          c.env.DB,
          "SELECT max_concurrency, monthly_quota_usd FROM teacher_keys WHERE user_id = $uid AND provider_id = $pid",
          { uid: user.id, pid: provider },
        );
        if (!existing) fail(404, "not_found");
        const maxConcurrency = "maxConcurrency" in input ? input.maxConcurrency : existing.max_concurrency;
        const monthlyQuotaUsd = "monthlyQuotaUsd" in input ? input.monthlyQuotaUsd : existing.monthly_quota_usd;
        await run(
          c.env.DB,
          "UPDATE teacher_keys SET max_concurrency = $maxConcurrency, monthly_quota_usd = $quota, updated_at = $at WHERE user_id = $uid AND provider_id = $pid",
          { uid: user.id, pid: provider, maxConcurrency, quota: monthlyQuotaUsd, at: nowIso() },
        );
        return c.json({ provider, maxConcurrency, monthlyQuotaUsd });
      }
      const enc = await encryptKey(c.env, input.key);
      const existing = await one<{
        sort_order: number;
        max_concurrency: number | null;
        monthly_quota_usd: number | null;
      }>(
        c.env.DB,
        "SELECT sort_order, max_concurrency, monthly_quota_usd FROM teacher_keys WHERE user_id = $uid AND provider_id = $pid",
        { uid: user.id, pid: provider },
      );
      const last = await one<{ n: number }>(
        c.env.DB,
        "SELECT COALESCE(MAX(sort_order), -1) AS n FROM teacher_keys WHERE user_id = $uid AND provider_id != $pid",
        { uid: user.id, pid: provider },
      );
      const order = existing?.sort_order ?? (last?.n ?? -1) + 1;
      const maxConcurrency = "maxConcurrency" in input ? input.maxConcurrency : (existing?.max_concurrency ?? null);
      const monthlyQuotaUsd =
        "monthlyQuotaUsd" in input ? input.monthlyQuotaUsd : (existing?.monthly_quota_usd ?? null);
      await run(
        c.env.DB,
        `INSERT INTO teacher_keys (user_id, provider_id, key_enc, last4, sort_order, updated_at, max_concurrency, monthly_quota_usd)
         VALUES ($uid, $pid, $enc, $last4, $order, $at, $maxConcurrency, $quota)
         ON CONFLICT(user_id, provider_id) DO UPDATE SET key_enc = $enc, last4 = $last4, updated_at = $at, max_concurrency = $maxConcurrency, monthly_quota_usd = $quota`,
        {
          uid: user.id,
          pid: provider,
          enc,
          last4: input.key.slice(-4),
          order,
          maxConcurrency,
          quota: monthlyQuotaUsd,
          at: nowIso(),
        },
      );
      return c.json({ provider, last4: input.key.slice(-4), maxConcurrency, monthlyQuotaUsd });
    })
    .delete("/settings/keys/:provider", async (c) => {
      const user = requireCapability(c, "manage_classes");
      const result = await run(c.env.DB, "DELETE FROM teacher_keys WHERE provider_id = $pid AND user_id = $uid", {
        pid: c.req.param("provider"),
        uid: user.id,
      });
      if ((result.meta?.changes ?? 0) === 0) fail(404, "not_found");
      return c.body(null, 204);
    });
}

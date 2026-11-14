import { Hono } from "hono";
import {
  TeacherKeyCreateInputSchema,
  TeacherKeyOrderInputSchema,
  TeacherKeyUpdateInputSchema,
  type TeacherKeyStatus,
} from "@socrates/shared";
import { all, batch, one, run, type Db } from "../db/d1";
import { fail, newId, nowIso, parseBody, requireMember, type AppEnv } from "../http";
import { encryptKey } from "../auth-crypto";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

const MAX_ENTRIES = 20;

interface TeacherKeyRow {
  id: string;
  provider_id: string;
  key_enc: string;
  model: string;
  last4: string;
  sort_order: number;
  updated_at: string;
}

const keyableProviders = builtinProviders().filter((provider) => provider.auth.apiKey !== undefined);

function keyableProvider(providerId: string) {
  return keyableProviders.find((provider) => provider.id === providerId);
}

function assertModel(providerId: string, model: string): void {
  const def = keyableProvider(providerId);
  if (!def?.getModels().some((entry) => entry.id === model)) fail(422, "byok_provider_invalid");
}

function toStatus(row: TeacherKeyRow): TeacherKeyStatus {
  return {
    id: row.id,
    provider: row.provider_id,
    model: row.model,
    last4: row.last4,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
  };
}

async function entriesOf(db: Db, userId: string): Promise<TeacherKeyRow[]> {
  return all<TeacherKeyRow>(db, "SELECT * FROM teacher_key_entries WHERE user_id = $uid ORDER BY sort_order, id", {
    uid: userId,
  });
}

async function ownedEntry(db: Db, userId: string, id: string): Promise<TeacherKeyRow> {
  const row = await one<TeacherKeyRow>(db, "SELECT * FROM teacher_key_entries WHERE id = $id AND user_id = $uid", {
    id,
    uid: userId,
  });
  if (!row) fail(404, "not_found");
  return row;
}

export function teacherKeyRoutes() {
  return new Hono<AppEnv>()
    .get("/settings/keys", async (c) => {
      const user = requireMember(c);
      return c.json((await entriesOf(c.env.DB, user.id)).map(toStatus));
    })
    .get("/settings/keys/providers", async (c) => {
      requireMember(c);
      return c.json(keyableProviders.map((provider) => ({ id: provider.id, name: provider.name })));
    })
    .get("/settings/keys/providers/:provider/models", async (c) => {
      requireMember(c);
      const provider = keyableProvider(c.req.param("provider"));
      if (!provider) fail(404, "not_found");
      return c.json(provider.getModels().map((model) => ({ id: model.id, name: model.name })));
    })
    .post("/settings/keys", async (c) => {
      const user = requireMember(c);
      const input = await parseBody(c, TeacherKeyCreateInputSchema);
      assertModel(input.provider, input.model);
      const existing = await entriesOf(c.env.DB, user.id);
      if (existing.length >= MAX_ENTRIES) fail(409, "conflict");
      let keyEnc: string;
      let last4: string;
      if (input.fromEntry) {
        const source = existing.find((row) => row.id === input.fromEntry);
        if (!source) fail(404, "not_found");
        if (source.provider_id !== input.provider) fail(422, "byok_provider_invalid");
        keyEnc = source.key_enc;
        last4 = source.last4;
      } else {
        const key = input.key ?? "";
        keyEnc = await encryptKey(c.env, key);
        last4 = key.slice(-4);
      }
      const row: TeacherKeyRow = {
        id: newId("k_"),
        provider_id: input.provider,
        key_enc: keyEnc,
        model: input.model,
        last4,
        sort_order: existing.reduce((max, entry) => Math.max(max, entry.sort_order), -1) + 1,
        updated_at: nowIso(),
      };
      await run(
        c.env.DB,
        `INSERT INTO teacher_key_entries (id, user_id, provider_id, key_enc, last4, model, sort_order, updated_at)
         VALUES ($id, $uid, $pid, $enc, $last4, $model, $order, $at)`,
        {
          id: row.id,
          uid: user.id,
          pid: row.provider_id,
          enc: row.key_enc,
          last4: row.last4,
          model: row.model,
          order: row.sort_order,
          at: row.updated_at,
        },
      );
      return c.json(toStatus(row), 201);
    })
    .put("/settings/keys/order", async (c) => {
      const user = requireMember(c);
      const input = await parseBody(c, TeacherKeyOrderInputSchema);
      const owned = await entriesOf(c.env.DB, user.id);
      const ownedIds = new Set(owned.map((row) => row.id));
      if (new Set(input.ids).size !== input.ids.length || input.ids.some((id) => !ownedIds.has(id))) {
        fail(422, "validation");
      }
      const unlisted = owned.filter((row) => !input.ids.includes(row.id)).map((row) => row.id);
      const ordered = [...input.ids, ...unlisted];
      await batch(
        c.env.DB,
        ordered.map((id, index) => ({
          sql: "UPDATE teacher_key_entries SET sort_order = $order WHERE id = $id AND user_id = $uid",
          params: { order: index, id, uid: user.id },
        })),
      );
      return c.json({ ids: ordered });
    })
    .patch("/settings/keys/:id", async (c) => {
      const user = requireMember(c);
      const input = await parseBody(c, TeacherKeyUpdateInputSchema);
      const row = await ownedEntry(c.env.DB, user.id, c.req.param("id"));
      const model = input.model ?? row.model;
      if (input.model) assertModel(row.provider_id, model);
      const keyEnc = input.key ? await encryptKey(c.env, input.key) : row.key_enc;
      const last4 = input.key ? input.key.slice(-4) : row.last4;
      const updated: TeacherKeyRow = { ...row, model, key_enc: keyEnc, last4, updated_at: nowIso() };
      await run(
        c.env.DB,
        "UPDATE teacher_key_entries SET model = $model, key_enc = $enc, last4 = $last4, updated_at = $at WHERE id = $id",
        { id: row.id, model, enc: keyEnc, last4, at: updated.updated_at },
      );
      return c.json(toStatus(updated));
    })
    .delete("/settings/keys/:id", async (c) => {
      const user = requireMember(c);
      const row = await ownedEntry(c.env.DB, user.id, c.req.param("id"));
      await run(c.env.DB, "DELETE FROM teacher_key_entries WHERE id = $id", { id: row.id });
      return c.body(null, 204);
    });
}

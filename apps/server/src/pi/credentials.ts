import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { all, one } from "../db/d1";
import { gatewayConfig } from "../gateway/config.gen";
import { decryptKey } from "../auth-crypto";
import type { Env } from "../env";

interface KeyRow {
  key_enc: string;
}

interface KeyRowSource {
  byProvider: (providerId: string) => Promise<KeyRow | null>;
  listProviders: () => Promise<Array<{ provider_id: string }>>;
}

/**
 * Shared read-only credential store over D1 key rows. A missing row is an
 * honest leg failure — the decrypt path never falls back to platform env
 * secrets, so keyed legs can never silently run on the platform pool.
 */
export function d1ApiKeyStore(env: Env, rows: KeyRowSource): CredentialStore {
  return {
    async read(providerId: string): Promise<Credential | undefined> {
      const row = await rows.byProvider(providerId);
      if (!row) return undefined;
      const key = await decryptKey(env, row.key_enc);
      return key === null ? undefined : { type: "api_key", key };
    },
    async list(): Promise<readonly CredentialInfo[]> {
      return (await rows.listProviders()).map((row) => ({
        providerId: row.provider_id,
        type: "api_key" as const,
      }));
    },
    async modify(): Promise<Credential | undefined> {
      return undefined;
    },
    async delete(): Promise<void> {},
  };
}

/**
 * Teacher keys are written only by the REST route; pi reads them here. The
 * teacher id resolves lazily because the owning classroom is not known when
 * the Models collection is built (DO field initializers run synchronously).
 */
export function teacherCredentialStore(env: Env, teacherOf: () => Promise<string | null>): CredentialStore {
  return d1ApiKeyStore(env, {
    byProvider: async (providerId) => {
      const teacherId = await teacherOf();
      if (!teacherId) return null;
      return await one<KeyRow>(env.DB, "SELECT key_enc FROM teacher_keys WHERE user_id = $uid AND provider_id = $pid", {
        uid: teacherId,
        pid: providerId,
      });
    },
    listProviders: async () => {
      const teacherId = await teacherOf();
      if (!teacherId) return [];
      return await all<{ provider_id: string }>(env.DB, "SELECT provider_id FROM teacher_keys WHERE user_id = $uid", {
        uid: teacherId,
      });
    },
  });
}

/**
 * Admin BYOK keys are written only by the REST route; pi reads them here.
 * One key per provider keeps credential attribution honest: pi's credential
 * store resolves by provider id, so a second enabled key for the same
 * provider could not be told apart and would silently share one ledger.
 */
export function adminCredentialStore(env: Env): CredentialStore {
  return d1ApiKeyStore(env, {
    byProvider: (providerId) =>
      one<KeyRow>(env.DB, "SELECT key_enc FROM admin_keys WHERE provider_id = $pid", { pid: providerId }),
    listProviders: () => all<{ provider_id: string }>(env.DB, "SELECT provider_id FROM admin_keys"),
  });
}

// Teacher legs run on the teacher's own keys. pi resolves request auth as
// `credential.key ?? env(name)`, so a missing teacher key would fall back to
// whatever this context resolves — platform env secrets must never back
// teacher traffic. Only env names our own providers declare in
// providers.config.yaml resolve here; everything else (pi builtin provider
// keys like OPENROUTER_API_KEY included) is undefined, making a missing
// teacher key an honest leg failure instead of a silent platform fallback.
const PROVIDER_ENV_NAMES = new Set(
  Object.values(gatewayConfig.providers).flatMap((def) => (def.baseUrlEnv ? [def.baseUrlEnv] : [])),
);

export function workersAuthContext(env: Env): {
  env(name: string): Promise<string | undefined>;
  fileExists(path: string): Promise<boolean>;
} {
  return {
    env: async (name) => {
      if (!PROVIDER_ENV_NAMES.has(name)) return undefined;
      const value: unknown = Reflect.get(env, name);
      return typeof value === "string" ? value : undefined;
    },
    fileExists: async () => false,
  };
}

export async function teacherOfActivity(env: Env, activityId: string): Promise<string | null> {
  const row = await one<{ teacher_id: string }>(
    env.DB,
    "SELECT c.teacher_id FROM activities a JOIN classrooms c ON c.id = a.classroom_id WHERE a.id = $id",
    { id: activityId },
  );
  return row?.teacher_id ?? null;
}

export interface KeyedLeg {
  provider: string;
  model: string;
  credential: string;
  maxConcurrency: number;
  providerMaxConcurrency: number | null;
  priority: number;
}

export interface TeacherLegRow {
  provider_id: string;
  model: string;
  max_concurrency: number | null;
  provider_max_concurrency: number | null;
}

export async function teacherLegsOf(env: Env, teacherId: string | null): Promise<KeyedLeg[]> {
  const fallbackConcurrency = gatewayConfig.teacherChain.maxConcurrency;
  if (!teacherId) return [];
  const rows = await all<TeacherLegRow>(
    env.DB,
    `SELECT m.provider_id, m.model, m.max_concurrency, k.max_concurrency AS provider_max_concurrency
     FROM teacher_key_models m
     JOIN teacher_keys k ON k.user_id = m.user_id AND k.provider_id = m.provider_id
     WHERE m.user_id = $uid
     ORDER BY k.sort_order, m.sort_order`,
    { uid: teacherId },
  );
  return rows.map((row) => ({
    provider: row.provider_id,
    model: row.model,
    credential: `teacher:${teacherId}`,
    maxConcurrency: row.max_concurrency ?? fallbackConcurrency,
    providerMaxConcurrency: row.provider_max_concurrency,
    priority: 0,
  }));
}

interface AdminLegRow {
  admin_key_id: string;
  provider_id: string;
  model: string;
  max_concurrency: number | null;
  provider_max_concurrency: number | null;
  monthly_quota_usd: number | null;
  month_spend: number;
}

/**
 * Admin BYOK legs of the platform pool. A key whose monthly quota is already
 * spent skips the chain until the UTC month window resets — the prepay
 * exposure cap of the middle tier (#355 拍板: skip, not manual disable).
 */
export async function adminLegsOf(env: Env): Promise<KeyedLeg[]> {
  const fallbackConcurrency = gatewayConfig.adminChain.maxConcurrency;
  const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
  const rows = await all<AdminLegRow>(
    env.DB,
    `SELECT m.admin_key_id, m.model, m.max_concurrency, k.provider_id,
            k.max_concurrency AS provider_max_concurrency, k.monthly_quota_usd,
            (SELECT COALESCE(SUM(cost_usd), 0) FROM admin_key_usage u
             WHERE u.admin_key_id = k.id AND u.created_at >= $start) AS month_spend
     FROM admin_key_models m
     JOIN admin_keys k ON k.id = m.admin_key_id
     ORDER BY k.sort_order, m.sort_order`,
    { start: monthStart },
  );
  return rows
    .filter(
      (row) => row.monthly_quota_usd === null || row.monthly_quota_usd <= 0 || row.month_spend < row.monthly_quota_usd,
    )
    .map((row) => ({
      provider: row.provider_id,
      model: row.model,
      credential: `admin:${row.admin_key_id}`,
      maxConcurrency: row.max_concurrency ?? fallbackConcurrency,
      providerMaxConcurrency: row.provider_max_concurrency,
      priority: 0,
    }));
}

export async function keyedLegsOf(env: Env, teacherId: string | null): Promise<KeyedLeg[]> {
  return [...(await teacherLegsOf(env, teacherId)), ...(await adminLegsOf(env))];
}

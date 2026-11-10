import type { Credential, CredentialInfo, CredentialStore } from "@earendil-works/pi-ai";
import { all, one } from "../db/d1";
import { gatewayConfig } from "../gateway/config.gen";
import { decryptKey } from "../auth-crypto";
import type { Env } from "../env";

interface TeacherKeyRow {
  key_enc: string;
}

/**
 * Teacher keys are written only by the REST route; pi reads them here. The
 * teacher id resolves lazily because the owning classroom is not known when
 * the Models collection is built (DO field initializers run synchronously).
 */
export function teacherCredentialStore(env: Env, teacherOf: () => Promise<string | null>): CredentialStore {
  return {
    async read(providerId: string): Promise<Credential | undefined> {
      const teacherId = await teacherOf();
      if (!teacherId) return undefined;
      const row = await one<TeacherKeyRow>(
        env.DB,
        "SELECT key_enc FROM teacher_keys WHERE user_id = $uid AND provider_id = $pid",
        { uid: teacherId, pid: providerId },
      );
      if (!row) return undefined;
      const key = await decryptKey(env, row.key_enc);
      return key === null ? undefined : { type: "api_key", key };
    },
    async list(): Promise<readonly CredentialInfo[]> {
      const teacherId = await teacherOf();
      if (!teacherId) return [];
      const rows = await all<{ provider_id: string }>(
        env.DB,
        "SELECT provider_id FROM teacher_keys WHERE user_id = $uid",
        { uid: teacherId },
      );
      return rows.map((row) => ({ providerId: row.provider_id, type: "api_key" as const }));
    },
    async modify(): Promise<Credential | undefined> {
      return undefined;
    },
    async delete(): Promise<void> {},
  };
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
  const record = env as unknown as Record<string, unknown>;
  return {
    env: async (name) => {
      if (!PROVIDER_ENV_NAMES.has(name)) return undefined;
      const value = record[name];
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

export interface TeacherLeg {
  provider: string;
  model: string;
  credential: string;
  maxConcurrency: number;
  priority: number;
}

export interface TeacherLegRow {
  provider_id: string;
  model: string;
}

export async function teacherLegsOf(env: Env, teacherId: string | null): Promise<TeacherLeg[]> {
  const maxConcurrency = gatewayConfig.teacherChain.maxConcurrency;
  if (!teacherId) return [];
  const rows = await all<TeacherLegRow>(
    env.DB,
    "SELECT provider_id, model FROM teacher_keys WHERE user_id = $uid ORDER BY sort_order",
    { uid: teacherId },
  );
  return rows
    .filter((row) => row.model)
    .map((row) => ({
      provider: row.provider_id,
      model: row.model,
      credential: `teacher:${teacherId}`,
      maxConcurrency,
      priority: 0,
    }));
}

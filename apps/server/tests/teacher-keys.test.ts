import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { seedDemo } from "../src/seed";
import {
  teacherCredentialOf,
  teacherCredentialStore,
  teacherLegsOf,
  withPinnedCredential,
} from "../src/pi/credentials";
import { call, cookieOf, enableTeacher } from "./helpers";

const migrations = inject("d1Migrations");
let teacher: string;
let teacherId: string;

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedDemo(env.DB);
  const login = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
  });
  teacher = await enableTeacher(cookieOf(login));
  teacherId = ((await login.json()) as { id: string }).id;
});

async function addKey(key: string): Promise<string> {
  const res = await call("/api/settings/keys", {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: teacher },
    body: JSON.stringify({ provider: "openrouter", model: "z-ai/glm-5.3-flash", key }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

describe("teacher key entries in the gateway", () => {
  it("each entry is its own leg in priority order, and a pinned leg reads its own key even under concurrency", async () => {
    const first = await addKey("sk-or-v1-first111");
    const second = await addKey("sk-or-v1-second22");
    await call("/api/settings/keys/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ ids: [second, first] }),
    });

    const legs = await teacherLegsOf(env as never, teacherId);
    expect(legs.map((leg) => leg.credential)).toEqual([
      teacherCredentialOf(teacherId, second),
      teacherCredentialOf(teacherId, first),
    ]);

    const store = teacherCredentialStore(env as never, async () => teacherId);
    expect((await store.read("openrouter"))?.key).toBe("sk-or-v1-second22");
    const [pinnedFirst, pinnedSecond] = await Promise.all([
      withPinnedCredential(teacherCredentialOf(teacherId, first), () => store.read("openrouter")),
      withPinnedCredential(teacherCredentialOf(teacherId, second), () => store.read("openrouter")),
    ]);
    expect(pinnedFirst?.key).toBe("sk-or-v1-first111");
    expect(pinnedSecond?.key).toBe("sk-or-v1-second22");
    expect(await withPinnedCredential(teacherCredentialOf(teacherId, first), () => store.read("glm"))).toBeUndefined();
    expect(await store.list()).toEqual([{ providerId: "openrouter", type: "api_key" }]);
  });
});

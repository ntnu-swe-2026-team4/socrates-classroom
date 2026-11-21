import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { inject } from "vitest";
import { run } from "../src/db/d1";
import { seedFixture } from "../src/seed";
import worker from "../src/index";
import type { Env } from "../src/env";
import { call, classroomWithActivity, cookieOf, participantIdOf, registerStudent, speak } from "./helpers";

let teacher: string;
let code: string;
let activityId: string;

const migrations = inject("d1Migrations");

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  const login = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
  });
  expect(login.status).toBe(200);
  teacher = cookieOf(login);

  const created = await classroomWithActivity(teacher, "R6 班");
  code = created.code;
  activityId = created.activityId;
});

describe("R6 REST layer (Hono, real Worker entry)", () => {
  test("API cache policy marks successful, rejected, and unknown API responses private", async () => {
    const me = await call("/api/me", { headers: { Cookie: teacher } });
    expect(me.status).toBe(200);
    expect(me.headers.get("Cache-Control")).toBe("private, no-store");

    const unauthorized = await call("/api/topics");
    expect(unauthorized.status).toBe(401);
    expect(unauthorized.headers.get("Cache-Control")).toBe("private, no-store");

    const unknown = await call("/api/not-a-route");
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get("Cache-Control")).toBe("private, no-store");
  });

  test("API cache policy keeps a route's explicit no-store header", async () => {
    const audio = await call("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ text: "Hello", lang: "en" }),
    });
    expect(audio.status).toBe(200);
    expect(audio.headers.get("Cache-Control")).toBe("no-store");
  });

  test("API cache policy does not change the health response", async () => {
    const health = await call("/health");
    expect(health.status).toBe(200);
    expect(health.headers.has("Cache-Control")).toBe(false);
  });

  test("health / seed guard", async () => {
    expect((await call("/health")).status).toBe(200);
    expect((await call("/api/dev/seed", { method: "POST" })).status).toBe(404);

    const seeded = await call("/api/dev/seed", { method: "POST", headers: { "x-seed-token": "dev-seed-token" } });
    expect(seeded.status).toBe(200);
    const seedBody = (await seeded.json()) as { seeded: boolean; password?: string };
    expect(seedBody.seeded).toBe(true);
    expect(seedBody.password).toBeUndefined();
  });

  test("me / guest join (ToS) → activity resolves", async () => {
    const me = await call("/api/me", { headers: { Cookie: teacher } });
    const teacherMe = (await me.json()) as { isAdmin: boolean };
    expect("canManageClasses" in teacherMe).toBe(false);
    expect(teacherMe.isAdmin).toBe(false);

    const joined = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "R6生", tosAccepted: true }),
    });
    expect(joined.status).toBe(200);
    const {
      user,
      participantId,
      activityId: aid,
    } = (await joined.json()) as {
      user: null;
      participantId: string;
      activityId: string;
    };
    expect(user).toBeNull();
    expect(participantId).toBeTruthy();
    expect(aid).toBe(activityId);
    expect(cookieOf(joined).startsWith("socrates_participant=")).toBe(true);

    const noTos = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "R6生B", tosAccepted: false }),
    });
    expect(noTos.status).toBe(422);
    expect(((await noTos.json()) as { code: string }).code).toBe("tos_required");
  });

  test("GET /classrooms — role-scoped listing; code/url only for teachers", async () => {
    const unauthorized = await call("/api/classrooms");
    expect(unauthorized.status).toBe(401);

    const teacherList = (await (await call("/api/classrooms", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
      role: string;
      code: string | null;
      current: { activityId: string } | null;
    }>;
    const own = teacherList.find((entry) => entry.current?.activityId === activityId);
    expect(own).toBeDefined();
    expect(own!.role).toBe("teacher");
    expect(own!.code).not.toBeNull();

    const joined = await registerStudent(code, "R6生C");
    const student = joined.cookie;
    const studentList = (await (await call("/api/classrooms", { headers: { Cookie: student } })).json()) as Array<{
      role: string;
      code: string | null;
      teacherName: string;
      memberCount: number;
      current: { activityId: string } | null;
    }>;
    const member = studentList.find((entry) => entry.current?.activityId === activityId);
    expect(member).toBeDefined();
    expect(member!.role).toBe("student");
    expect(member!.code).toBeNull();
    expect(member!.teacherName).toBeTruthy();
    expect(member!.memberCount).toBeGreaterThan(0);
  });

  test("startActivity — reopens an activity ({topicId} contract shape; same code yields a new activityId)", async () => {
    const topics = (await (await call("/api/topics", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
    }>;
    const restarted = await call("/api/classrooms/c_missing/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ topicId: topics[0]!.id }),
    });
    expect(restarted.status).toBe(404);

    const classrooms = (await (await call("/api/classrooms", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
      current: { activityId: string } | null;
    }>;
    const own = classrooms.find((entry) => entry.current?.activityId === activityId);
    const res = await call(`/api/classrooms/${own!.id}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ topicId: topics[0]!.id }),
    });
    expect(res.status).toBe(201);
    const payload = (await res.json()) as { activityId: string; code: string };
    expect(payload.activityId).not.toBe(activityId);
    expect(payload.code).toBe(code);
  });

  test("finish → report semantics (pending → 404 report_pending; student IDOR sees only their own)", async () => {
    const created = await classroomWithActivity(teacher, "R6 報告班");
    const student = (await registerStudent(created.code, "R6生報")).cookie;
    await speak(
      `${created.activityId}:${await participantIdOf(created.activityId, student)}`,
      student,
      "契約應該被遵守嗎？",
    );

    const report0 = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacher } });
    expect(report0.status).toBe(404);
    expect(((await report0.json()) as { code: string }).code).toBe("report_pending");

    const finish = await call(`/api/activities/${created.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacher, "CF-Connecting-IP": "198.51.100.10" },
    });
    expect(finish.status).toBe(204);
    const again = await call(`/api/activities/${created.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacher, "CF-Connecting-IP": "198.51.100.11" },
    });
    expect(again.status).toBe(204);

    const lateJoin = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: created.code, name: "R6遲到生", tosAccepted: true }),
    });
    expect(lateJoin.status).toBe(409);
    expect(((await lateJoin.json()) as { code: string }).code).toBe("activity_finished");

    const rejoin = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: student },
      body: JSON.stringify({ code: created.code, tosAccepted: true }),
    });
    expect(rejoin.status).toBe(200);
    expect(((await rejoin.json()) as { activityId: string }).activityId).toBe(created.activityId);

    await vi.waitFor(
      async () => {
        const res = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacher } });
        expect(res.status).toBe(200);
      },
      { timeout: 30_000 },
    );

    const mine = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: student } });
    expect(mine.status).toBe(200);
    const mineData = (await mine.json()) as Record<string, unknown>;
    expect("students" in mineData).toBe(false);
    expect("classReport" in mineData).toBe(false);
    expect(typeof mineData.pseudonym).toBe("string");
  }, 60_000);

  test("authorization matrix spot checks: outsider 403 / owner-only 403 / cross-class report IDOR", async () => {
    const outsiderLogin = await call("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "demo@socrates.tw", password: "wrong-password" }),
    });
    expect(outsiderLogin.status).toBe(401);

    const topics = await call("/api/topics");
    expect(topics.status).toBe(401);

    const studentCookie = (await registerStudent(code, "R6生G")).cookie;
    const genAsStudent = await call("/api/topics/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: studentCookie },
      body: JSON.stringify({ direction: "測試" }),
    });
    expect(genAsStudent.status).toBe(200);

    const student = (await registerStudent(code, "R6生D")).cookie;
    const finish = await call(`/api/activities/${activityId}/finish`, {
      method: "POST",
      headers: { Cookie: student, "CF-Connecting-IP": "198.51.100.12" },
    });
    expect(finish.status).toBe(403);

    const other = await classroomWithActivity(teacher, "R6 他班");
    const otherStudent = (await registerStudent(other.code, "他班學生")).cookie;
    const crossClass = await call(`/api/activities/${activityId}/report`, {
      headers: { Cookie: otherStudent },
    });
    expect(crossClass.status).toBe(403);
  });

  test("teacher keys CRUD: key per provider, model legs with own maxConcurrency, ordering, last4 only, per-user isolation", async () => {
    const put = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ key: "sk-or-v1-abcdefgh" }),
    });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { last4: string }).last4).toBe("efgh");

    const again = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ key: "sk-or-v1-zzzzzzzz", maxConcurrency: 6 }),
    });
    expect(again.status).toBe(200);
    expect((await again.json()) as { last4: string; maxConcurrency: number | null }).toEqual({
      provider: "openrouter",
      last4: "zzzz",
      maxConcurrency: 6,
      monthlyQuotaUsd: null,
    });

    const keep = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ key: "sk-or-v1-zzzzzzzz" }),
    });
    expect(((await keep.json()) as { maxConcurrency: number | null }).maxConcurrency).toBe(6);

    const badProviderLimit = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ key: "sk-or-v1-zzzzzzzz", maxConcurrency: 0 }),
    });
    expect(badProviderLimit.status).toBe(422);

    const clear = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ key: "sk-or-v1-zzzzzzzz", maxConcurrency: null }),
    });
    expect(((await clear.json()) as { maxConcurrency: number | null }).maxConcurrency).toBeNull();

    const keyless = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ maxConcurrency: 3 }),
    });
    expect(keyless.status).toBe(200);
    expect((await keyless.json()) as { provider: string; maxConcurrency: number | null }).toEqual({
      provider: "openrouter",
      maxConcurrency: 3,
      monthlyQuotaUsd: null,
    });
    const keylessClear = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ maxConcurrency: null }),
    });
    expect(((await keylessClear.json()) as { maxConcurrency: number | null }).maxConcurrency).toBeNull();

    const second = await call("/api/settings/keys/deepseek", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ key: "sk-ds-abcdefgh" }),
    });
    expect(second.status).toBe(200);
    const ordered = await (await call("/api/settings/keys", { headers: { Cookie: teacher } })).json();
    expect(
      (ordered as Array<{ provider: string; sortOrder: number }>).map((entry) => [entry.provider, entry.sortOrder]),
    ).toEqual([
      ["openrouter", 0],
      ["deepseek", 1],
    ]);
    const removeSecond = await call("/api/settings/keys/deepseek", { method: "DELETE", headers: { Cookie: teacher } });
    expect(removeSecond.status).toBe(204);

    const legA = await call("/api/settings/keys/openrouter/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ model: "z-ai/glm-5.3-flash", maxConcurrency: 2 }),
    });
    expect(legA.status).toBe(200);
    expect(((await legA.json()) as { maxConcurrency: number | null }).maxConcurrency).toBe(2);

    const legB = await call("/api/settings/keys/openrouter/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ model: "z-ai/glm-4.7-flash" }),
    });
    expect(legB.status).toBe(200);
    expect(((await legB.json()) as { maxConcurrency: number | null }).maxConcurrency).toBeNull();

    const badModel = await call("/api/settings/keys/openrouter/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ model: "not-a-model" }),
    });
    expect(badModel.status).toBe(422);

    const badLimit = await call("/api/settings/keys/openrouter/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ model: "z-ai/glm-5.3-flash", maxConcurrency: 0 }),
    });
    expect(badLimit.status).toBe(422);

    const listKeys = async () =>
      (await (await call("/api/settings/keys", { headers: { Cookie: teacher } })).json()) as Array<{
        provider: string;
        last4: string;
        maxConcurrency: number | null;
        monthlyQuotaUsd: number | null;
        monthCostUsd: number;
        monthTokens: number;
        models: Array<{ model: string; maxConcurrency: number | null; sortOrder: number }>;
      }>;
    expect(await listKeys()).toEqual([
      {
        provider: "openrouter",
        last4: "zzzz",
        maxConcurrency: null,
        monthlyQuotaUsd: null,
        monthCostUsd: 0,
        monthTokens: 0,
        sortOrder: 0,
        updatedAt: expect.any(String),
        models: [
          { model: "z-ai/glm-5.3-flash", maxConcurrency: 2, sortOrder: 0 },
          { model: "z-ai/glm-4.7-flash", maxConcurrency: null, sortOrder: 1 },
        ],
      },
    ]);

    const badProvider = await call("/api/settings/keys/evil", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ key: "sk-or-v1-abcdefgh" }),
    });
    expect(badProvider.status).toBe(422);

    const providers = (await (
      await call("/api/settings/keys/providers", { headers: { Cookie: teacher } })
    ).json()) as Array<{
      id: string;
    }>;
    expect(providers.some((entry) => entry.id === "openrouter")).toBe(true);
    const models = (await (
      await call("/api/settings/keys/providers/openrouter/models", { headers: { Cookie: teacher } })
    ).json()) as Array<{ id: string }>;
    expect(models.some((entry) => entry.id === "z-ai/glm-5.3-flash")).toBe(true);

    const reorder = await call("/api/settings/keys/openrouter/models/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ models: ["z-ai/glm-4.7-flash", "z-ai/glm-5.3-flash"] }),
    });
    expect(reorder.status).toBe(200);
    expect((await listKeys())[0].models.map((leg) => leg.model)).toEqual(["z-ai/glm-4.7-flash", "z-ai/glm-5.3-flash"]);

    const studentCookie = (await registerStudent(code, "R6生F")).cookie;
    const studentPut = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: studentCookie },
      body: JSON.stringify({ key: "sk-or-v1-abcdefgh" }),
    });
    expect(studentPut.status).toBe(200);
    const studentLeg = await call("/api/settings/keys/openrouter/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: studentCookie },
      body: JSON.stringify({ model: "z-ai/glm-5.3-flash" }),
    });
    expect(studentLeg.status).toBe(200);

    const studentList = await call("/api/settings/keys", { headers: { Cookie: studentCookie } });
    const studentProviders = ((await studentList.json()) as Array<{ provider: string }>).map((row) => row.provider);
    expect(studentProviders).toEqual(["openrouter"]);
    expect((await listKeys())[0].models.map((leg) => leg.model)).toEqual(["z-ai/glm-4.7-flash", "z-ai/glm-5.3-flash"]);

    const removeLeg = await call("/api/settings/keys/openrouter/models/z-ai%2Fglm-5.3-flash", {
      method: "DELETE",
      headers: { Cookie: teacher },
    });
    expect(removeLeg.status).toBe(204);
    expect((await listKeys())[0].models.map((leg) => leg.model)).toEqual(["z-ai/glm-4.7-flash"]);

    const order = await call("/api/settings/keys/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ providers: ["openrouter"] }),
    });
    expect(order.status).toBe(200);

    const badQuota = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ monthlyQuotaUsd: 0 }),
    });
    expect(badQuota.status).toBe(422);

    const setQuota = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ monthlyQuotaUsd: 5 }),
    });
    expect(setQuota.status).toBe(200);
    expect(((await setQuota.json()) as { monthlyQuotaUsd: number | null }).monthlyQuotaUsd).toBe(5);

    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    await run(
      env.DB,
      `INSERT INTO teacher_key_usage (user_id, provider_id, model, input_tokens, output_tokens, total_tokens, cost_usd, billed)
       VALUES ((SELECT id FROM users WHERE email = 'demo@socrates.tw'), 'openrouter', 'z-ai/glm-5.3-flash', 10, 5, 15, 0.004, 0)`,
    );
    expect(monthStart).toBeTruthy();
    expect((await listKeys())[0].monthCostUsd).toBeCloseTo(0.004, 6);
    expect((await listKeys())[0].monthTokens).toBe(15);
    expect((await listKeys())[0].monthlyQuotaUsd).toBe(5);

    const rekeyKeepsQuota = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ key: "sk-or-v1-rekey-9999" }),
    });
    expect(rekeyKeepsQuota.status).toBe(200);
    const rekeyBody = (await rekeyKeepsQuota.json()) as { last4: string; monthlyQuotaUsd: number | null };
    expect(rekeyBody.last4).toBe("9999");
    expect(rekeyBody.monthlyQuotaUsd).toBe(5);

    const del = await call("/api/settings/keys/openrouter", { method: "DELETE", headers: { Cookie: teacher } });
    expect(del.status).toBe(204);
    expect(await listKeys()).toEqual([]);

    const noKeyLeg = await call("/api/settings/keys/openrouter/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ model: "z-ai/glm-4.7-flash" }),
    });
    expect(noKeyLeg.status).toBe(422);
    expect(((await noKeyLeg.json()) as { code: string }).code).toBe("validation");

    const orphanCap = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ maxConcurrency: 3 }),
    });
    expect(orphanCap.status).toBe(404);
  });

  test("register → login student track: registering creates a member, same email and password can log in", async () => {
    const email = `reg-${Date.now()}@socrates.tw`;
    const registered = await call("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, email, password: "student-pass-1", name: "註冊生A", tosAccepted: true }),
    });
    expect(registered.status).toBe(200);
    expect("canManageClasses" in ((await registered.json()) as Record<string, unknown>)).toBe(false);

    const registeredTopics = await call("/api/topics", { headers: { Cookie: cookieOf(registered) } });
    expect(registeredTopics.status).toBe(200);

    const teacherJoin = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ code, tosAccepted: true }),
    });
    expect(teacherJoin.status).toBe(200);
    expect(typeof ((await teacherJoin.json()) as { activityId: string }).activityId).toBe("string");

    const noConsent = await call("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code,
        email: `nc-${Date.now()}@socrates.tw`,
        password: "student-pass-1",
        name: "未同意生",
        tosAccepted: false,
      }),
    });
    expect(noConsent.status).toBe(422);
    expect(((await noConsent.json()) as { code?: string }).code).toBe("tos_required");

    const login = await call("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "student-pass-1" }),
    });
    expect(login.status).toBe(200);
    const me = await call("/api/me", { headers: { Cookie: cookieOf(login) } });
    expect("canManageClasses" in ((await me.json()) as Record<string, unknown>)).toBe(false);
  });

  test("no-mode (#210): a freshly signed-up account can create a classroom and start an activity", async () => {
    const email = `nomode-${Date.now()}@socrates.tw`;
    const signup = await call("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "nomode-pass-1", name: "無模組帳", tosAccepted: true }),
    });
    expect(signup.status).toBe(200);
    const account = cookieOf(signup);

    const classroom = await call("/api/classrooms", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: account },
      body: JSON.stringify({ name: "無模組班" }),
    });
    expect(classroom.status).toBe(201);
    const classroomId = ((await classroom.json()) as { classroomId: string }).classroomId;

    const topic = await call("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: account },
      body: JSON.stringify({ title: "自建題", statement: "自建題描述", prompts: ["你的判斷是什麼？"] }),
    });
    expect(topic.status).toBe(201);
    const topicId = ((await topic.json()) as { id: string }).id;

    const started = await call(`/api/classrooms/${classroomId}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: account },
      body: JSON.stringify({ topicId, mode: "live" }),
    });
    expect(started.status).toBe(201);
  });

  test("lookup mock: websearch without binding → fallback text (prose mock)", async () => {
    const student = (await registerStudent(code, "R6生E")).cookie;
    const lookup = await call("/api/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: student },
      body: JSON.stringify({ term: "功利主義" }),
    });
    expect(lookup.status).toBe(200);
    expect(lookup.headers.get("X-Socrates-Fallback")).toBe("mock");
    expect(((await lookup.json()) as { markdown: string }).markdown).toContain("功利主義");
  });

  test("topics/generate mock → canned topics marked with X-Socrates-Fallback", async () => {
    const generated = await call("/api/topics/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher, "CF-Connecting-IP": "198.51.100.42" },
      body: JSON.stringify({ direction: "契約" }),
    });
    expect(generated.status).toBe(200);
    expect(generated.headers.get("X-Socrates-Fallback")).toBe("mock");
    expect(Array.isArray(await generated.json())).toBe(true);
  });

  test.each([
    ["no AI binding", undefined],
    [
      "an AI binding whose calls fail (the model returns nothing)",
      {
        run: async () => {
          throw new Error("upstream down");
        },
      },
    ],
  ])("#160: without the mock provider and with %s, the answer is a 502, never canned content", async (_, ai) => {
    const realEnv = Object.create(env, { LLM_PROVIDER: { value: "" }, AI: { value: ai } }) as Env;
    const callReal = (path: string, init: RequestInit) =>
      worker.fetch(new Request(`http://worker.test${path}`, init), realEnv);
    const student = (await registerStudent(code, `R6生H${ai ? "2" : "1"}`)).cookie;
    const lookup = await callReal("/api/lookup", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: student },
      body: JSON.stringify({ term: "功利主義" }),
    });
    expect(lookup.status).toBe(502);
    expect(lookup.headers.get("X-Socrates-Fallback")).toBeNull();
    const lookupBody = (await lookup.json()) as { code: string; markdown?: unknown };
    expect(lookupBody.code).toBe("llm_unavailable");
    expect(lookupBody).not.toHaveProperty("markdown");

    const generated = await callReal("/api/topics/generate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: teacher,
        "CF-Connecting-IP": ai ? "198.51.100.44" : "198.51.100.43",
      },
      body: JSON.stringify({ direction: "契約" }),
    });
    expect(generated.status).toBe(502);
    expect(generated.headers.get("X-Socrates-Fallback")).toBeNull();
    const generatedBody = (await generated.json()) as { code: string };
    expect(Array.isArray(generatedBody)).toBe(false);
    expect(generatedBody.code).toBe("llm_unavailable");
  });
});

describe("report (#74: finish → pending → ready → GET)", () => {
  test("finish triggers the ReportRunner: pending → ready → role-scoped report", async () => {
    const [topic] = (await (await call("/api/topics", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
      title: string;
    }>;
    const created = await classroomWithActivity(teacher, "Report 班", topic!.id);
    const student = (await registerStudent(created.code, "報告生")).cookie;
    await speak(
      `${created.activityId}:${await participantIdOf(created.activityId, student)}`,
      student,
      "契約應該被遵守嗎？",
    );

    const finish = await call(`/api/activities/${created.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacher },
    });
    expect(finish.status).toBe(204);

    const report = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacher } });
    expect([200, 404]).toContain(report.status);
    if (report.status === 404) {
      expect(((await report.json()) as { code: string }).code).toBe("report_pending");
    }

    const settled = await vi.waitFor(
      async () => {
        const res = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacher } });
        expect(res.status).toBe(200);
        return (await res.json()) as { topicTitle: string; classReport: unknown; students: unknown[] };
      },
      { timeout: 30_000, interval: 500 },
    );
    expect(settled.topicTitle).toBe(topic!.title);
    expect(Array.isArray(settled.students)).toBe(true);

    const asStudent = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: student } });
    expect(asStudent.status).toBe(200);
    const studentReport = (await asStudent.json()) as { pseudonym: string; analysis: unknown };
    expect(typeof studentReport.pseudonym).toBe("string");
    expect("analysis" in studentReport).toBe(true);
  }, 40_000);
});

describe("rate limiting + register gate (round-6 restores)", () => {
  test("activity finish: calls 1-6 → 204, the 7th inside one minute → 429 rate_limited", async () => {
    const created = await classroomWithActivity(teacher, "限流班");
    const ip = "198.51.100.30";
    let last: Response | null = null;
    for (let i = 0; i < 7; i += 1) {
      last = await call(`/api/activities/${created.activityId}/finish`, {
        method: "POST",
        headers: { Cookie: teacher, "CF-Connecting-IP": ip },
      });
      if (i < 6) expect(last?.status).toBe(204);
    }
    expect(last?.status).toBe(429);
    const body = (await last?.json()) as { code?: string };
    expect(body?.code).toBe("rate_limited");

    const noHeader = await call(`/api/activities/${created.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacher },
    });
    expect(noHeader.status).not.toBe(429);
  });

  test("register after the classroom activity finished → 409 activity_finished (mirrors join)", async () => {
    const created = await classroomWithActivity(teacher, "註冊截止班");
    const finish = await call(`/api/activities/${created.activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacher, "CF-Connecting-IP": "198.51.100.31" },
    });
    expect(finish.status).toBe(204);
    const registered = await call("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        code: created.code,
        email: `late-${Date.now()}@socrates.tw`,
        password: "student-pass-1",
        name: "遲到註冊",
        tosAccepted: true,
      }),
    });
    expect(registered.status).toBe(409);
    expect(((await registered.json()) as { code?: string }).code).toBe("activity_finished");
  });
});

describe("uniqueViolationColumns (real D1 error envelope)", () => {
  test("parses the Miniflare envelope (D1_ERROR prefix, SQLITE_CONSTRAINT suffix, cause chain) and the bare raw message", async () => {
    const { uniqueViolationColumns } = await import("../src/http");
    const causeMessage =
      "UNIQUE constraint failed: members.classroom_id, members.name: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_UNIQUE)";
    const envelope = new Error(`D1_ERROR: ${causeMessage}`, { cause: new Error(causeMessage) });
    expect(uniqueViolationColumns(envelope)).toEqual([
      ["members", "classroom_id"],
      ["members", "name"],
    ]);
    expect(uniqueViolationColumns(envelope.cause as Error)).toEqual([
      ["members", "classroom_id"],
      ["members", "name"],
    ]);
    expect(uniqueViolationColumns(new Error("UNIQUE constraint failed: users.email"))).toEqual([["users", "email"]]);
    expect(uniqueViolationColumns(new Error("FOREIGN KEY constraint failed"))).toEqual([]);
  });
});
describe("zValidator migration (#264): envelope and guard ordering parity", () => {
  test("malformed JSON body → 422 validation, not hono's raw 400", async () => {
    const res = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{oops",
    });
    expect(res.status).toBe(422);
    expect(((await res.json()) as { code: string }).code).toBe("validation");
  });

  test("auth guards run before body validation on param routes (anonymous bodyless POST → 401)", async () => {
    const topics = await call("/api/classrooms/c_whatever/topics", { method: "POST" });
    expect(topics.status).toBe(401);

    const models = await call("/api/settings/keys/openrouter/models", { method: "PUT" });
    expect(models.status).toBe(401);

    const admin = await call("/api/admin/users/u_whatever", { method: "PATCH" });
    expect(admin.status).toBe(401);
  });
});

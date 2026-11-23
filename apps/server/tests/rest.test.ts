import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { TopicDraftSchema } from "@socrates/shared";
import { z } from "zod";
import { beforeAll, describe, expect, test, vi } from "vitest";
import { inject } from "vitest";
import { one, run } from "../src/db/d1";
import { setReportAxesPolicy } from "../src/services/settings";
import { seedFixture } from "../src/seed";
import worker from "../src/index";
import {
  bool,
  call,
  classroomWithActivity,
  cookieOf,
  createClassroom,
  failingAi,
  field,
  must,
  num,
  optNum,
  optStr,
  participantIdOf,
  registerStudent,
  rows,
  scopedEnv,
  speak,
  str,
} from "./helpers";

let teacher: string;
let classroomId: string;
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
  classroomId = created.classroomId;
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
    const seedJson = await seeded.json();
    expect(bool(seedJson, "seeded")).toBe(true);
    expect(field(seedJson, "password")).toBeUndefined();
  });

  test("me / guest join (ToS) → activity resolves", async () => {
    const me = await call("/api/me", { headers: { Cookie: teacher } });
    const meJson: unknown = await me.json();
    expect("canManageClasses" in (typeof meJson === "object" && meJson !== null ? meJson : {})).toBe(false);
    expect(bool(meJson, "isAdmin")).toBe(false);

    const joined = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, name: "R6生", tosAccepted: true }),
    });
    expect(joined.status).toBe(200);
    const joinedBody = await joined.json();
    const user: unknown = field(joinedBody, "user");
    const participantId = str(joinedBody, "participantId");
    const aid = str(joinedBody, "activityId");
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
    expect(str(await noTos.json(), "code")).toBe("tos_required");
  });

  test("GET /classrooms — role-scoped listing; code/url only for teachers", async () => {
    const unauthorized = await call("/api/classrooms");
    expect(unauthorized.status).toBe(401);

    const teacherList = rows(await (await call("/api/classrooms", { headers: { Cookie: teacher } })).json());
    const own = must(
      teacherList.find((entry) => {
        const current: unknown = field(entry, "current");
        return typeof current === "object" && current !== null && str(current, "activityId") === activityId;
      }),
      "teacher classroom entry",
    );
    expect(str(own, "role")).toBe("teacher");
    expect(optStr(own, "code")).not.toBeNull();

    const joined = await registerStudent(code, "R6生C");
    const student = joined.cookie;
    const studentList = rows(await (await call("/api/classrooms", { headers: { Cookie: student } })).json());
    const member = must(
      studentList.find((entry) => {
        const current: unknown = field(entry, "current");
        return typeof current === "object" && current !== null && str(current, "activityId") === activityId;
      }),
      "student classroom entry",
    );
    expect(str(member, "role")).toBe("student");
    expect(optStr(member, "code")).toBeNull();
    expect(str(member, "teacherName")).toBeTruthy();
    expect(num(member, "memberCount")).toBeGreaterThan(0);
  });

  test("startActivity — reopens an activity ({topicId} contract shape; same code yields a new activityId)", async () => {
    const topics = rows(await (await call("/api/topics", { headers: { Cookie: teacher } })).json());
    const restarted = await call("/api/classrooms/c_missing/activities", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ topicId: str(topics[0], "id") }),
    });
    expect(restarted.status).toBe(404);

    const classrooms = rows(await (await call("/api/classrooms", { headers: { Cookie: teacher } })).json());
    const own = must(
      classrooms.find((entry) => {
        const current: unknown = field(entry, "current");
        return typeof current === "object" && current !== null && str(current, "activityId") === activityId;
      }),
      "teacher classroom entry",
    );
    const res = await call(`/api/classrooms/${str(own, "id")}/activities`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ topicId: str(topics[0], "id") }),
    });
    expect(res.status).toBe(201);
    const startBody = await res.json();
    expect(str(startBody, "activityId")).not.toBe(activityId);
    expect(str(startBody, "code")).toBe(code);
  });

  test("topics carry value axes: seeded fixtures, optional default, 1..3 validation, and copy preserve/override", async () => {
    const seededList = z
      .array(TopicDraftSchema)
      .parse(await (await call("/api/topics", { headers: { Cookie: teacher } })).json());
    for (const id of ["t_fx_trolley", "t_fx_surrogate", "t_fx_ai_rights"]) {
      const fixture = must(
        seededList.find((entry) => entry.id === id),
        `seeded fixture ${id}`,
      );
      expect(fixture.axes.length).toBeGreaterThan(0);
    }

    const noAxesRes = await call("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ title: "無軸個人題", statement: "未填軸時預設空陣列", prompts: [] }),
    });
    expect(noAxesRes.status).toBe(201);
    const noAxesTopic = TopicDraftSchema.parse(await noAxesRes.json());
    expect(noAxesTopic.axes).toEqual([]);

    const maxLabel = "a".repeat(40);
    const threeAxes = [
      { name: "  契約與人情  ", left: "  契約優先 ", right: " 人情優先  " },
      { name: maxLabel, left: maxLabel, right: maxLabel },
      { name: "第三軸", left: "左端", right: "右端" },
    ];
    const expectedTrimmed = [
      { name: "契約與人情", left: "契約優先", right: "人情優先" },
      { name: maxLabel, left: maxLabel, right: maxLabel },
      { name: "第三軸", left: "左端", right: "右端" },
    ];
    const withAxesRes = await call("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ title: "帶軸個人題", statement: "含一至三條軸", prompts: ["為何？"], axes: threeAxes }),
    });
    expect(withAxesRes.status).toBe(201);
    const withAxesTopic = TopicDraftSchema.parse(await withAxesRes.json());
    expect(withAxesTopic.axes).toEqual(expectedTrimmed);

    const listedAfter = z
      .array(TopicDraftSchema)
      .parse(await (await call("/api/topics", { headers: { Cookie: teacher } })).json());
    expect(listedAfter.find((entry) => entry.id === withAxesTopic.id)?.axes).toEqual(expectedTrimmed);

    const classNoAxes = await call(`/api/classrooms/${classroomId}/topics`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ title: "無軸班級題", statement: "班級題未填軸", prompts: [] }),
    });
    expect(classNoAxes.status).toBe(201);
    const classNoAxesTopic = TopicDraftSchema.parse(await classNoAxes.json());
    expect(classNoAxesTopic.axes).toEqual([]);

    const oneAxis = [{ name: "程序與結果", left: "程序正義", right: "結果效益" }];
    const classWithAxes = await call(`/api/classrooms/${classroomId}/topics`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ title: "帶軸班級題", statement: "班級題帶一條軸", prompts: ["怎麼選？"], axes: oneAxis }),
    });
    expect(classWithAxes.status).toBe(201);
    const classWithAxesTopic = TopicDraftSchema.parse(await classWithAxes.json());
    expect(classWithAxesTopic.axes).toEqual(oneAxis);

    const classTopics = z
      .array(TopicDraftSchema)
      .parse(await (await call(`/api/classrooms/${classroomId}/topics`, { headers: { Cookie: teacher } })).json());
    expect(classTopics.find((entry) => entry.id === classWithAxesTopic.id)?.axes).toEqual(oneAxis);

    const invalidAxesCases = [
      [
        { name: "軸1", left: "L", right: "R" },
        { name: "軸2", left: "L", right: "R" },
        { name: "軸3", left: "L", right: "R" },
        { name: "軸4", left: "L", right: "R" },
      ],
      [{ name: "", left: "L", right: "R" }],
      [{ name: "   ", left: "L", right: "R" }],
      [{ name: "軸", left: "   ", right: "R" }],
      [{ name: "軸", left: "L", right: "" }],
      [{ name: "a".repeat(41), left: "L", right: "R" }],
      [{ name: "軸", left: "a".repeat(41), right: "R" }],
      [{ name: "軸", left: "L", right: "a".repeat(41) }],
      [
        { name: "重複軸", left: "A", right: "B" },
        { name: "重複軸", left: "C", right: "D" },
      ],
      [
        { name: "軸", left: "A", right: "B" },
        { name: " 軸 ", left: "C", right: "D" },
      ],
    ];
    for (const badAxes of invalidAxesCases) {
      const badPersonal = await call("/api/topics", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: teacher },
        body: JSON.stringify({ title: "壞軸", statement: "驗證失敗", prompts: [], axes: badAxes }),
      });
      expect(badPersonal.status).toBe(422);

      const badClassroom = await call(`/api/classrooms/${classroomId}/topics`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: teacher },
        body: JSON.stringify({ title: "壞軸班級題", statement: "驗證失敗", prompts: [], axes: badAxes }),
      });
      expect(badClassroom.status).toBe(422);

      const badCopy = await call(`/api/topics/${noAxesTopic.id}/copy`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: teacher },
        body: JSON.stringify({ classroomId, axes: badAxes }),
      });
      expect(badCopy.status).toBe(422);
    }

    const copiedWithAxes = await call(`/api/topics/${noAxesTopic.id}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ classroomId, axes: oneAxis }),
    });
    expect(copiedWithAxes.status).toBe(201);
    const copiedTopic = TopicDraftSchema.parse(await copiedWithAxes.json());
    expect(copiedTopic.axes).toEqual(oneAxis);

    const copiedKeep = await call(`/api/topics/${copiedTopic.id}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ classroomId }),
    });
    expect(copiedKeep.status).toBe(200);
    const kept = TopicDraftSchema.parse(await copiedKeep.json());
    expect(kept.id).toBe(copiedTopic.id);
    expect(kept.axes).toEqual(oneAxis);

    const overrideAxes = [{ name: "個人與群體", left: "個人自由", right: "群體福祉" }];
    const copiedOverride = await call(`/api/topics/${copiedTopic.id}/copy`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ classroomId, axes: overrideAxes }),
    });
    expect(copiedOverride.status).toBe(201);
    expect(TopicDraftSchema.parse(await copiedOverride.json()).axes).toEqual(overrideAxes);
  });

  test("finish → report semantics (pending → 404 report_pending; late join blocked; rejoin keeps the activity)", async () => {
    const created = await classroomWithActivity(teacher, "R6 報告班");
    const student = (await registerStudent(created.code, "R6生報")).cookie;
    await speak(
      `${created.activityId}:${await participantIdOf(created.activityId, student)}`,
      student,
      "契約應該被遵守嗎？",
    );

    const report0 = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacher } });
    expect(report0.status).toBe(404);
    expect(str(await report0.json(), "code")).toBe("report_pending");

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
    expect(str(await lateJoin.json(), "code")).toBe("activity_finished");

    const rejoin = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: student },
      body: JSON.stringify({ code: created.code, tosAccepted: true }),
    });
    expect(rejoin.status).toBe(200);
    expect(str(await rejoin.json(), "activityId")).toBe(created.activityId);
  }, 15_000);

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
    expect(str(await put.json(), "last4")).toBe("efgh");

    const again = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ key: "sk-or-v1-zzzzzzzz", maxConcurrency: 6 }),
    });
    expect(again.status).toBe(200);
    const againBody = await again.json();
    expect({
      provider: str(againBody, "provider"),
      last4: str(againBody, "last4"),
      maxConcurrency: optNum(againBody, "maxConcurrency"),
    }).toEqual({
      provider: "openrouter",
      last4: "zzzz",
      maxConcurrency: 6,
    });

    const keep = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ key: "sk-or-v1-zzzzzzzz" }),
    });
    expect(optNum(await keep.json(), "maxConcurrency")).toBe(6);

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
    expect(optNum(await clear.json(), "maxConcurrency")).toBeNull();

    const keyless = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ maxConcurrency: 3 }),
    });
    expect(keyless.status).toBe(200);
    const keylessBody = await keyless.json();
    expect({
      provider: str(keylessBody, "provider"),
      maxConcurrency: optNum(keylessBody, "maxConcurrency"),
    }).toEqual({ provider: "openrouter", maxConcurrency: 3 });
    const keylessClear = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ maxConcurrency: null }),
    });
    expect(optNum(await keylessClear.json(), "maxConcurrency")).toBeNull();

    const second = await call("/api/settings/keys/deepseek", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ key: "sk-ds-abcdefgh" }),
    });
    expect(second.status).toBe(200);
    const ordered = rows(await (await call("/api/settings/keys", { headers: { Cookie: teacher } })).json());
    expect(ordered.map((entry) => [str(entry, "provider"), num(entry, "sortOrder")])).toEqual([
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
    expect(optNum(await legA.json(), "maxConcurrency")).toBe(2);

    const legB = await call("/api/settings/keys/openrouter/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ model: "z-ai/glm-4.7-flash" }),
    });
    expect(legB.status).toBe(200);
    expect(optNum(await legB.json(), "maxConcurrency")).toBeNull();

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
      rows(await (await call("/api/settings/keys", { headers: { Cookie: teacher } })).json()).map((row) => ({
        provider: str(row, "provider"),
        last4: str(row, "last4"),
        maxConcurrency: optNum(row, "maxConcurrency"),
        monthlyQuotaUsd: optNum(row, "monthlyQuotaUsd"),
        monthCostUsd: num(row, "monthCostUsd"),
        monthTokens: num(row, "monthTokens"),
        models: rows(field(row, "models")).map((model) => ({
          model: str(model, "model"),
          maxConcurrency: optNum(model, "maxConcurrency"),
          sortOrder: num(model, "sortOrder"),
        })),
      }));
    expect(await listKeys()).toEqual([
      {
        provider: "openrouter",
        last4: "zzzz",
        maxConcurrency: null,
        monthlyQuotaUsd: null,
        monthCostUsd: 0,
        monthTokens: 0,
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

    const providers = rows(await (await call("/api/settings/keys/providers", { headers: { Cookie: teacher } })).json());
    expect(providers.some((entry) => str(entry, "id") === "openrouter")).toBe(true);
    const models = rows(
      await (await call("/api/settings/keys/providers/openrouter/models", { headers: { Cookie: teacher } })).json(),
    );
    expect(models.some((entry) => str(entry, "id") === "z-ai/glm-5.3-flash")).toBe(true);

    const reorder = await call("/api/settings/keys/openrouter/models/order", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ models: ["z-ai/glm-4.7-flash", "z-ai/glm-5.3-flash"] }),
    });
    expect(reorder.status).toBe(200);
    expect(must((await listKeys())[0], "key row").models.map((leg) => leg.model)).toEqual([
      "z-ai/glm-4.7-flash",
      "z-ai/glm-5.3-flash",
    ]);

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
    const studentProviders = rows(await studentList.json()).map((row) => str(row, "provider"));
    expect(studentProviders).toEqual(["openrouter"]);
    expect(must((await listKeys())[0], "key row").models.map((leg) => leg.model)).toEqual([
      "z-ai/glm-4.7-flash",
      "z-ai/glm-5.3-flash",
    ]);

    const removeLeg = await call("/api/settings/keys/openrouter/models/z-ai%2Fglm-5.3-flash", {
      method: "DELETE",
      headers: { Cookie: teacher },
    });
    expect(removeLeg.status).toBe(204);
    expect(must((await listKeys())[0], "key row").models.map((leg) => leg.model)).toEqual(["z-ai/glm-4.7-flash"]);

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
    expect(optNum(await setQuota.json(), "monthlyQuotaUsd")).toBe(5);

    const monthStart = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)).toISOString();
    await run(
      env.DB,
      `INSERT INTO teacher_key_usage (user_id, provider_id, model, input_tokens, output_tokens, total_tokens, cost_usd, billed)
       VALUES ((SELECT id FROM users WHERE email = 'demo@socrates.tw'), 'openrouter', 'z-ai/glm-5.3-flash', 10, 5, 15, 0.004, 0)`,
    );
    expect(monthStart).toBeTruthy();
    const listed = must((await listKeys())[0], "key row");
    expect(listed.monthCostUsd).toBeCloseTo(0.004, 6);
    expect(listed.monthTokens).toBe(15);
    expect(listed.monthlyQuotaUsd).toBe(5);

    const rekeyKeepsQuota = await call("/api/settings/keys/openrouter", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ key: "sk-or-v1-rekey-9999" }),
    });
    expect(rekeyKeepsQuota.status).toBe(200);
    const rekeyBody = await rekeyKeepsQuota.json();
    expect(str(rekeyBody, "last4")).toBe("9999");
    expect(optNum(rekeyBody, "monthlyQuotaUsd")).toBe(5);

    const del = await call("/api/settings/keys/openrouter", { method: "DELETE", headers: { Cookie: teacher } });
    expect(del.status).toBe(204);
    expect(await listKeys()).toEqual([]);

    const noKeyLeg = await call("/api/settings/keys/openrouter/models", {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ model: "z-ai/glm-4.7-flash" }),
    });
    expect(noKeyLeg.status).toBe(422);
    expect(str(await noKeyLeg.json(), "code")).toBe("validation");

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
    const registeredBody = await registered.json();
    expect(
      "canManageClasses" in (typeof registeredBody === "object" && registeredBody !== null ? registeredBody : {}),
    ).toBe(false);

    const registeredTopics = await call("/api/topics", { headers: { Cookie: cookieOf(registered) } });
    expect(registeredTopics.status).toBe(200);

    const teacherJoin = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher },
      body: JSON.stringify({ code, tosAccepted: true }),
    });
    expect(teacherJoin.status).toBe(200);
    expect(typeof str(await teacherJoin.json(), "activityId")).toBe("string");

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
    expect(str(await noConsent.json(), "code")).toBe("tos_required");

    const login = await call("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "student-pass-1" }),
    });
    expect(login.status).toBe(200);
    const me = await call("/api/me", { headers: { Cookie: cookieOf(login) } });
    const meBody = await me.json();
    expect("canManageClasses" in (typeof meBody === "object" && meBody !== null ? meBody : {})).toBe(false);
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
    const classroomId = str(await classroom.json(), "classroomId");

    const topic = await call("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: account },
      body: JSON.stringify({
        title: "自建題",
        statement: "自建題描述",
        prompts: ["你的判斷是什麼？"],
        axes: [{ name: "判斷依據", left: "原則", right: "後果" }],
      }),
    });
    expect(topic.status).toBe(201);
    const topicId = str(await topic.json(), "id");

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
    expect(str(await lookup.json(), "markdown")).toContain("功利主義");
  });

  test("topics/generate mock → canned topics marked with X-Socrates-Fallback", async () => {
    const generated = await call("/api/topics/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: teacher, "CF-Connecting-IP": "198.51.100.42" },
      body: JSON.stringify({ direction: "契約" }),
    });
    expect(generated.status).toBe(200);
    expect(generated.headers.get("X-Socrates-Fallback")).toBe("mock");
    const topics = z.array(TopicDraftSchema).parse(await generated.json());
    expect(topics.length).toBeGreaterThan(0);
    for (const topic of topics) expect(topic.axes).toEqual([]);
  });

  test.each([
    ["no AI binding", undefined],
    ["an AI binding whose calls fail (the model returns nothing)", failingAi()],
  ])("#160: without the mock provider and with %s, the answer is a 502, never canned content", async (_, ai) => {
    const realEnv = scopedEnv({ LLM_PROVIDER: "", AI: ai });
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
    const lookupBody = await lookup.json();
    expect(str(lookupBody, "code")).toBe("llm_unavailable");
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
    const generatedBody = await generated.json();
    expect(Array.isArray(generatedBody)).toBe(false);
    expect(str(generatedBody, "code")).toBe("llm_unavailable");
  });
});

describe("report (#74: finish → pending → ready → GET)", () => {
  test("finish triggers the ReportRunner: pending → ready → role-scoped report", async () => {
    const topic = must(
      rows(await (await call("/api/topics", { headers: { Cookie: teacher } })).json())[0],
      "report topic",
    );
    const created = await classroomWithActivity(teacher, "Report 班", str(topic, "id"));
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
      expect(str(await report.json(), "code")).toBe("report_pending");
    }

    const settled = await vi.waitFor(
      async () => {
        const res = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: teacher } });
        expect(res.status).toBe(200);
        return await res.json();
      },
      { timeout: 60_000, interval: 500 },
    );
    expect(str(settled, "topicTitle")).toBe(str(topic, "title"));
    expect(Array.isArray(field(settled, "students"))).toBe(true);

    const asStudent = await call(`/api/activities/${created.activityId}/report`, { headers: { Cookie: student } });
    expect(asStudent.status).toBe(200);
    const studentReport: unknown = await asStudent.json();
    expect(typeof studentReport === "object" && studentReport !== null).toBe(true);
    expect(str(studentReport, "pseudonym")).toBeTruthy();
    expect(field(studentReport, "analysis")).toBeDefined();
    expect(field(studentReport, "students")).toBeUndefined();
    expect(field(studentReport, "classReport")).toBeUndefined();
  }, 120_000);
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
    const body = await last?.json();
    expect(str(body, "code")).toBe("rate_limited");

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
    expect(str(await registered.json(), "code")).toBe("activity_finished");
  });

  test("GET /api/config tells the web app who decides the class report's axes (default: both)", async () => {
    const res = await call("/api/config");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reportAxes: "both" });
  });

  test("starting an activity in teacher-axes mode requires topic axes; legacy starts still accept axisless topics and store ai mode", async () => {
    const json = { "Content-Type": "application/json", Cookie: teacher };
    const bareRes = await call(`/api/classrooms/${classroomId}/topics`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ title: "無軸活動題", statement: "未設軸", prompts: [] }),
    });
    expect(bareRes.status).toBe(201);
    const bareTopic = TopicDraftSchema.parse(await bareRes.json());

    const blocked = await call(`/api/classrooms/${classroomId}/activities`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ topicId: bareTopic.id, mode: "test", reportAxes: "teacher" }),
    });
    expect(blocked.status).toBe(422);
    expect(str(await blocked.json(), "code")).toBe("topic_axes_required");

    const aiStarted = await call(`/api/classrooms/${classroomId}/activities`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ topicId: bareTopic.id, mode: "test" }),
    });
    expect(aiStarted.status).toBe(201);
    const aiPayload = { activityId: str(await aiStarted.json(), "activityId") };
    const aiRow = await one<{ report_axes: string | null }>(
      env.DB,
      "SELECT report_axes FROM activities WHERE id = $id",
      { id: aiPayload.activityId },
    );
    expect(aiRow?.report_axes).toBe("ai");

    const copied = await call(`/api/topics/${bareTopic.id}/copy`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        classroomId,
        axes: [{ name: "契約與人情", left: "契約優先", right: "人情優先" }],
      }),
    });
    expect(copied.status).toBe(201);
    const copy = { id: str(await copied.json(), "id") };

    const teacherStarted = await call(`/api/classrooms/${classroomId}/activities`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ topicId: copy.id, mode: "test", reportAxes: "teacher" }),
    });
    expect(teacherStarted.status).toBe(201);
    const teacherPayload = { activityId: str(await teacherStarted.json(), "activityId") };
    const teacherRow = await one<{ report_axes: string | null }>(
      env.DB,
      "SELECT report_axes FROM activities WHERE id = $id",
      { id: teacherPayload.activityId },
    );
    expect(teacherRow?.report_axes).toBe("teacher");
  });
});

describe("starting with edited topic axes", () => {
  const topicAxes = [{ name: "Justice", left: "Rules", right: "Outcomes" }];

  async function setupAxesClassroom(name: string) {
    const { classroomId } = await createClassroom(teacher, name);
    const json = { "Content-Type": "application/json", Cookie: teacher };
    const seed = await call(`/api/classrooms/${classroomId}/topics`, {
      method: "POST",
      headers: json,
      body: JSON.stringify({ title: "A topic", statement: "A statement", prompts: [] }),
    });
    expect(seed.status).toBe(201);
    const topicId = str(await seed.json(), "id");
    const start = (id = topicId) =>
      call(`/api/classrooms/${classroomId}/activities`, {
        method: "POST",
        headers: json,
        body: JSON.stringify({ topicId: id, reportAxes: "teacher", topicAxes }),
      });
    const state = () =>
      one(
        env.DB,
        `SELECT current_activity_id,
        (SELECT COUNT(*) FROM topics WHERE classroom_id = $id) AS topics,
        (SELECT COUNT(*) FROM activities WHERE classroom_id = $id) AS activities
        FROM classrooms WHERE id = $id`,
        { id: classroomId },
      );
    return { topicId, start, state };
  }

  test("starting with edited topic axes saves a snapshot and reuses it when unchanged", async () => {
    const { topicId, start, state } = await setupAxesClassroom("Atomic axes success");
    const started = await start();
    expect(started.status).toBe(201);
    const activityId = str(await started.json(), "activityId");
    const snapshot = await one<{ id: string; copied_from: string; axes: string; title: string; statement: string }>(
      env.DB,
      "SELECT t.* FROM activities a JOIN topics t ON a.topic_id = t.id WHERE a.id = $id",
      { id: activityId },
    );
    expect(snapshot).toMatchObject({
      copied_from: topicId,
      axes: JSON.stringify(topicAxes),
      title: "A topic",
      statement: "A statement",
    });
    expect(await one(env.DB, "SELECT axes FROM topics WHERE id = $id", { id: topicId })).toEqual({ axes: "[]" });
    expect(await state()).toEqual({ topics: 2, activities: 1, current_activity_id: activityId });

    expect((await start(must(snapshot, "copied topic").id)).status).toBe(201);
    expect(await state()).toMatchObject({ topics: 2, activities: 2 });
  });

  test("starting with edited topic axes after an AI policy lock writes nothing", async () => {
    const { start, state } = await setupAxesClassroom("Atomic axes policy lock");
    await setReportAxesPolicy(env.DB, "ai");
    try {
      const denied = await start();
      expect(denied.status).toBe(422);
      expect(await denied.json()).toMatchObject({ code: "report_axes_not_allowed" });
      expect(await state()).toEqual({ topics: 1, activities: 0, current_activity_id: null });
    } finally {
      await setReportAxesPolicy(env.DB, "both");
    }
  });

  test("starting with edited topic axes rolls back both inserts if the live pointer update fails", async () => {
    const { start, state } = await setupAxesClassroom("Atomic axes rollback");
    await run(
      env.DB,
      `CREATE TRIGGER abort_live_axes_start
      BEFORE UPDATE OF current_activity_id ON classrooms
      WHEN NEW.name = 'Atomic axes rollback'
      BEGIN SELECT RAISE(ABORT, 'test live activity pointer write failed'); END`,
    );
    try {
      expect((await start()).status).toBe(500);
      expect(await state()).toEqual({ topics: 1, activities: 0, current_activity_id: null });
    } finally {
      await run(env.DB, "DROP TRIGGER abort_live_axes_start");
    }
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
    expect(uniqueViolationColumns(envelope.cause)).toEqual([
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
    expect(str(await res.json(), "code")).toBe("validation");
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

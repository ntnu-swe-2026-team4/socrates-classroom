import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import type { LiveBoard } from "@socrates/shared";
import { seedDemo } from "../src/seed";
import { call, cookieOf, enableTeacher } from "./helpers";

const json = { "Content-Type": "application/json" };
const migrations = inject("d1Migrations");
let teacher: string;

function send(path: string, cookie: string | null, method: string, body?: unknown): Promise<Response> {
  return call(path, {
    method,
    headers: { ...json, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedDemo(env.DB);
  teacher = await enableTeacher(
    cookieOf(await send("/api/auth/login", null, "POST", { email: "demo@socrates.tw", password: "demo-demo" })),
  );
});

describe("live board", () => {
  it("lists every student of the activity for the teacher only", async () => {
    const topics = (await (await call("/api/topics", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
    }>;
    const created = (await (
      await send("/api/classrooms", teacher, "POST", { name: "即時面板班", topicId: topics[0]!.id })
    ).json()) as { classroomId: string; code: string; activityId: string };

    const empty = (await (
      await send(`/api/activities/${created.activityId}/live`, teacher, "GET")
    ).json()) as LiveBoard;
    expect(empty).toEqual({ students: [], finished: false });

    const joined = await send("/api/join", null, "POST", { code: created.code, name: "小明", tosAccepted: true });
    expect(joined.status).toBe(200);
    const guest = cookieOf(joined);

    const denied = await send(`/api/activities/${created.activityId}/live`, guest, "GET");
    expect(denied.status).toBe(403);
    expect((await send(`/api/activities/${created.activityId}/live`, null, "GET")).status).toBe(401);

    const res = await send(`/api/activities/${created.activityId}/live`, teacher, "GET");
    expect(res.status).toBe(200);
    const board = (await res.json()) as LiveBoard;
    expect(board.finished).toBe(false);
    expect(board.students).toHaveLength(1);
    expect(board.students[0]).toMatchObject({
      name: "小明",
      status: "idle",
      rounds: 0,
      flags: [],
      lastUtterance: "",
      lastActiveAt: null,
    });

    expect((await send(`/api/activities/${created.activityId}/finish`, teacher, "POST")).status).toBe(204);
    const after = (await (
      await send(`/api/activities/${created.activityId}/live`, teacher, "GET")
    ).json()) as LiveBoard;
    expect(after.finished).toBe(true);
  }, 30_000);
});

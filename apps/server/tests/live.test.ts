import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { env } from "cloudflare:workers";
import { applyD1Migrations, evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { beforeAll, expect, inject, it } from "vitest";
import { one, run } from "../src/db/d1";
import type { Chat } from "../src/do/chat";
import { seedFixture } from "../src/seed";
import { call, classroomWithActivity, cookieOf, joinGuest, registerStudent, speak } from "./helpers";

let teacher: string;
const migrations = inject("d1Migrations");

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedFixture(env.DB);
  const response = await call("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
  });
  expect(response.status).toBe(200);
  teacher = cookieOf(response);
});

function live(activityId: string, cookie?: string) {
  return call(`/api/activities/${activityId}/live`, { headers: cookie ? { Cookie: cookie } : {} });
}

it("serves 1,000 named participants only to the classroom owner", async () => {
  const { activityId, code } = await classroomWithActivity(teacher, "Large live class");
  const guest = await joinGuest(code, "Guest");
  const student = await registerStudent(code, "Member");
  await run(
    env.DB,
    `INSERT INTO activity_participants (activity_id, id, kind, display_name, joined_at)
    SELECT $aid, 'p-' || value, 'guest', 'Guest ' || value, '2026-11-23T00:00:00.000Z'
    FROM json_each($ids)`,
    { aid: activityId, ids: JSON.stringify(Array.from({ length: 998 }, (_, i) => i)) },
  );
  expect((await live(activityId)).status).toBe(401);
  expect((await live(activityId, guest.cookie)).status).toBe(401);
  expect((await live(activityId, student.cookie)).status).toBe(403);
  const response = await live(activityId, teacher);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  const snapshot = (await response.json()) as { students: unknown[] };
  expect(snapshot).toMatchObject({ activityId, finishedAt: null, asOf: expect.any(String) });
  expect(snapshot.students).toHaveLength(1000);
  expect(snapshot.students).toContainEqual({
    id: guest.participantId,
    name: "Guest",
    status: "not_started",
    rounds: 0,
    lastActiveAt: null,
    flags: [],
  });
});

it("recovers committed dialogue and flags after a D1 write failure and DO eviction", async () => {
  const { activityId, code } = await classroomWithActivity(teacher, "Live recovery");
  const guest = await joinGuest(code, "Guest");
  const thread = `${activityId}:${guest.participantId}`;
  const stub = env.Chat.getByName(thread);
  await run(
    env.DB,
    `CREATE TRIGGER block_live_projection BEFORE INSERT ON activity_live_progress
    BEGIN SELECT RAISE(ABORT, 'injected projection write failure'); END`,
  );
  try {
    await speak(thread, guest.cookie, "幫我寫一個 python 排序");
    await expect
      .poll(
        () =>
          runInDurableObject(stub, (instance) =>
            (instance as Chat).lifecycle.jobs
              .list()
              .some((job) => job.fn === "activity-live-progress" && job.time > Date.now() + 5_000),
          ),
        { timeout: 10_000 },
      )
      .toBe(true);
    expect(
      await one(env.DB, "SELECT 1 FROM activity_live_progress WHERE activity_id = $aid", { aid: activityId }),
    ).toBeNull();
  } finally {
    await run(env.DB, "DROP TRIGGER block_live_projection");
  }
  await evictDurableObject(stub);
  await runInDurableObject(stub, async (instance) => {
    const jobs = (instance as Chat).lifecycle.jobs;
    const job = jobs.list().find(({ fn }) => fn === "activity-live-progress");
    expect(job).toBeDefined();
    if (job) await jobs.reschedule(job.id, Date.now());
  });
  await runDurableObjectAlarm(stub);
  await expect
    .poll(
      async () => {
        const response = await live(activityId, teacher);
        expect(response.status).toBe(200);
        return response.json();
      },
      { timeout: 10_000 },
    )
    .toMatchObject({
      students: [
        {
          id: guest.participantId,
          status: "active",
          rounds: 1,
          lastActiveAt: expect.any(String),
          flags: [{ id: expect.any(String), type: "coding" }],
        },
      ],
    });
}, 30_000);

it("backfills existing participants from all pages and distinguishes an empty thread", async () => {
  const { activityId, code } = await classroomWithActivity(teacher, "Legacy activity");
  const quiet = await joinGuest(code, "Quiet guest");
  const speaker = await joinGuest(code, "Guest with an existing dialogue");
  await run(env.DB, "UPDATE activities SET live_projection_legacy = 1 WHERE id = $aid", { aid: activityId });
  const thread = env.Chat.getByName(`${activityId}:${speaker.participantId}`);
  await runInDurableObject(thread, async (instance) => {
    const harness = await (instance as Chat).harness.pi();
    const root = await harness.root(BACKGROUND_CONTEXT);
    await root.commit(async (transaction) => {
      for (let index = 0; index < 129; index++) {
        await transaction.appendEntry(root.id, {
          kind: "pi.user",
          model: [{ role: "user", content: "Historical dialogue", timestamp: Date.now() }],
        });
      }
    }, BACKGROUND_CONTEXT);
  });
  const initial = (await (await live(activityId, teacher)).json()) as { students: unknown[] };
  expect(initial.students).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: quiet.participantId, status: "unknown", rounds: null, flags: null }),
      expect.objectContaining({ id: speaker.participantId, status: "unknown", rounds: null, flags: null }),
    ]),
  );
  await expect
    .poll(
      async () => {
        const snapshot = (await (await live(activityId, teacher)).json()) as { students: unknown[] };
        return snapshot.students;
      },
      { timeout: 10_000 },
    )
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: quiet.participantId, status: "not_started", rounds: 0, flags: [] }),
        expect.objectContaining({ id: speaker.participantId, status: "active", rounds: 129, flags: [] }),
      ]),
    );
}, 15_000);

it("excludes test activities and includes the finished timestamp for live activities", async () => {
  const test = await classroomWithActivity(teacher, "Slot only", undefined, "test");
  expect((await live(test.activityId, teacher)).status).toBe(409);
  const { activityId } = await classroomWithActivity(teacher, "Finished live class");
  const finishedAt = "2026-11-23T00:00:00.000Z";
  await run(env.DB, "UPDATE activities SET finished_at = $at WHERE id = $aid", { at: finishedAt, aid: activityId });
  expect(await (await live(activityId, teacher)).json()).toMatchObject({ finishedAt, students: [] });
});

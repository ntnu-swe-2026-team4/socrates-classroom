import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { routeAgentRequest } from "agents";
import { byCodeUnit } from "@socrates/shared";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { inject } from "vitest";
import { seedFixture } from "../src/seed";
import { run } from "../src/db/d1";

import {
  call,
  classroomWithActivity,
  cookieOf,
  frames,
  joinGuest,
  latestAssistantText,
  registerStudent,
  must,
  speak,
  systemTopicId,
} from "./helpers";

let teacher: string;
let classroomId: string;
let code: string;
let liveActivityId: string;
let topicId: string;

const migrations = inject("d1Migrations");

function jsonInit(body: unknown, cookie?: string): RequestInit {
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify(body),
  };
}

async function newTestActivity(): Promise<string> {
  const res = await call(`/api/classrooms/${classroomId}/activities`, jsonInit({ topicId, mode: "test" }, teacher));
  expect(res.status).toBe(201);
  const created = (await res.json()) as { activityId: string; mode: string };
  expect(created.mode).toBe("test");
  return created.activityId;
}

interface SlotRow {
  id: string;
  name: string;
  rounds: number;
}

async function slotsOf(activityId: string): Promise<{ maxSlots: number; slots: SlotRow[] }> {
  const res = await call(`/api/activities/${activityId}/slots`, { headers: { Cookie: teacher } });
  expect(res.status).toBe(200);
  return (await res.json()) as { maxSlots: number; slots: SlotRow[] };
}

async function connect(thread: string, cookie: string): Promise<WebSocket> {
  const response = await routeAgentRequest(
    new Request(`https://example.com/agents/chat/${thread}`, {
      headers: { Upgrade: "websocket", Cookie: cookie },
    }),
    env,
  );
  expect(response?.status).toBe(101);
  const socket = must(response?.webSocket, "test-mode websocket");
  socket.accept();
  return socket;
}

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
  topicId = await systemTopicId(teacher);
  const created = await classroomWithActivity(teacher, "測試模式班", topicId);
  classroomId = created.classroomId;
  code = created.code;
  liveActivityId = created.activityId;
});

describe("test mode (#134): student entry points", () => {
  it("a test activity never becomes the classroom's current activity", async () => {
    const activityId = await newTestActivity();
    const rooms = (await (await call("/api/classrooms", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
      current: { activityId: string } | null;
    }>;
    const room = rooms.find((entry) => entry.id === classroomId);
    expect(room?.current?.activityId).toBe(liveActivityId);
    expect(room?.current?.activityId).not.toBe(activityId);

    const guest = await joinGuest(code, "班碼訪客");
    expect(guest.activityId).toBe(liveActivityId);
    const preview = await call(`/api/join/${code}`);
    expect(preview.status).toBe(200);
  });

  it("students and guests cannot read a test activity, its report, or mint an invite", async () => {
    const activityId = await newTestActivity();
    const student = (await registerStudent(code, "測試外的成員")).cookie;

    const info = await call(`/api/activities/${activityId}`, { headers: { Cookie: student } });
    expect(info.status).toBe(403);
    const report = await call(`/api/activities/${activityId}/report`, { headers: { Cookie: student } });
    expect(report.status).toBe(403);
    const invite = await call(`/api/activities/${activityId}/invites`, {
      method: "POST",
      headers: { Cookie: teacher },
    });
    expect(invite.status).toBe(409);
    expect(((await invite.json()) as { code: string }).code).toBe("conflict");
    const finish = await call(`/api/activities/${activityId}/finish`, {
      method: "POST",
      headers: { Cookie: student, "CF-Connecting-IP": "198.51.100.61" },
    });
    expect(finish.status).toBe(403);
  });

  it("an unknown activity mode is rejected at the boundary", async () => {
    const res = await call(`/api/classrooms/${classroomId}/activities`, jsonInit({ topicId, mode: "solo" }, teacher));
    expect(res.status).toBe(422);
  });
});

describe("test mode (#134): teacher slots", () => {
  it("creates 1–6 slots, caps the total, and rejects look-alike endpoints elsewhere", async () => {
    const activityId = await newTestActivity();
    const created = await call(`/api/activities/${activityId}/slots`, jsonInit({ count: 3 }, teacher));
    expect(created.status).toBe(201);
    const payload = (await created.json()) as { maxSlots: number; slots: Array<{ id: string; name: string }> };
    expect(payload.maxSlots).toBe(6);
    expect(payload.slots).toHaveLength(3);
    expect(new Set(payload.slots.map((slot) => slot.id)).size).toBe(3);
    expect(new Set(payload.slots.map((slot) => slot.name)).size).toBe(3);

    const overCap = await call(`/api/activities/${activityId}/slots`, jsonInit({ count: 4 }, teacher));
    expect(overCap.status).toBe(409);
    const zero = await call(`/api/activities/${activityId}/slots`, jsonInit({ count: 0 }, teacher));
    expect(zero.status).toBe(422);

    const student = (await registerStudent(code, "不能開 slot 的成員")).cookie;
    const listDenied = await call(`/api/activities/${activityId}/slots`, { headers: { Cookie: student } });
    expect(listDenied.status).toBe(403);
    const createDenied = await call(`/api/activities/${activityId}/slots`, jsonInit({ count: 1 }, student));
    expect(createDenied.status).toBe(403);

    const liveSlots = await call(`/api/activities/${liveActivityId}/slots`, { headers: { Cookie: teacher } });
    expect(liveSlots.status).toBe(409);
  });

  it("slot names skip display names already taken in the activity", async () => {
    const activityId = await newTestActivity();
    const at = new Date().toISOString();
    await run(
      env.DB,
      `INSERT INTO activity_participants (activity_id, id, user_id, kind, display_name, tos_accepted_at, joined_at)
       VALUES ($aid, $pid, NULL, 'guest', '測試 2', $at, $at)`,
      { aid: activityId, pid: "p_slotcollide", at },
    );

    const created = await call(`/api/activities/${activityId}/slots`, jsonInit({ count: 3 }, teacher));
    expect(created.status).toBe(201);
    const payload = (await created.json()) as { slots: Array<{ name: string }> };
    expect(payload.slots.map((slot) => slot.name).sort(byCodeUnit)).toEqual(["測試 1", "測試 3", "測試 4"]);
  });

  it("the teacher reads a slot through GET /activities/:id?participantId=…", async () => {
    const activityId = await newTestActivity();
    await call(`/api/activities/${activityId}/slots`, jsonInit({ count: 2 }, teacher));
    const { slots } = await slotsOf(activityId);

    const mine = await call(`/api/activities/${activityId}?participantId=${slots[0].id}`, {
      headers: { Cookie: teacher },
    });
    expect(mine.status).toBe(200);
    const info = (await mine.json()) as { participantId: string | null; mode: string };
    expect(info.mode).toBe("test");
    expect(info.participantId).toBe(slots[0].id);

    const student = (await registerStudent(code, "偷看 slot 的成員")).cookie;
    const denied = await call(`/api/activities/${activityId}?participantId=${slots[0].id}`, {
      headers: { Cookie: student },
    });
    expect(denied.status).toBe(403);
  });
});

describe("test mode (#134): parallel dialogues and report", () => {
  it("three slots keep separate transcripts, then finish produces a report without moving the live activity", async () => {
    const activityId = await newTestActivity();
    await call(`/api/activities/${activityId}/slots`, jsonInit({ count: 3 }, teacher));
    const { slots } = await slotsOf(activityId);
    const questions = ["問題甲：正義是什麼？", "問題乙：自由是什麼？", "問題丙：幸福是什麼？"];
    for (const [index, slot] of slots.entries()) {
      await speak(`${activityId}:${slot.id}`, teacher, questions[index]);
    }

    const stats = await slotsOf(activityId);
    expect(stats.slots.map((slot) => slot.rounds)).toEqual([1, 1, 1]);

    const first = await connect(`${activityId}:${slots[0].id}`, teacher);
    const rx = frames(first);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    first.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    const transcript = latestAssistantText(rx.list);
    expect(transcript).toContain("問題甲");
    expect(transcript).not.toContain("問題乙");
    expect(transcript).not.toContain("問題丙");
    first.close();

    const student = (await registerStudent(code, "不能進 slot 的成員")).cookie;
    const intruder = await connect(`${activityId}:${slots[1].id}`, student);
    const intruderRx = frames(intruder);
    intruder.send(JSON.stringify({ type: "watch" }));
    await intruderRx.until((f) => f.length > 0 || intruder.readyState === WebSocket.CLOSED);
    expect(intruderRx.list.some((m) => m.type === "hello")).toBe(false);
    intruder.close();

    const finish = await call(`/api/activities/${activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacher, "CF-Connecting-IP": "198.51.100.62" },
    });
    expect(finish.status).toBe(204);

    const report = await vi.waitFor(
      async () => {
        const res = await call(`/api/activities/${activityId}/report`, { headers: { Cookie: teacher } });
        expect(res.status).toBe(200);
        return (await res.json()) as {
          classReport: unknown;
          students: Array<{ participantId: string; pseudonym: string; participantName: string }>;
        };
      },
      { timeout: 30_000, interval: 500 },
    );
    expect(report.classReport).not.toBeNull();
    expect(report.students).toHaveLength(3);
    expect(report.students.map((entry) => entry.participantId).sort(byCodeUnit)).toEqual(
      slots.map((slot) => slot.id).sort(byCodeUnit),
    );
    expect(new Set(report.students.map((entry) => entry.pseudonym)).size).toBe(3);

    const rooms = (await (await call("/api/classrooms", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
      current: { activityId: string } | null;
    }>;
    expect(rooms.find((room) => room.id === classroomId)?.current?.activityId).toBe(liveActivityId);
  }, 60_000);
});

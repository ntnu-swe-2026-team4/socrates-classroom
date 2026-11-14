import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { routeAgentRequest } from "agents";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { seedDemo } from "../src/seed";
import { assistantText, call, cookieOf, frames, latestView, registerAccount, enableTeacher } from "./helpers";

const json = { "Content-Type": "application/json" };
const migrations = inject("d1Migrations");
let teacher: string;

async function upgrade(path: string, cookie?: string): Promise<Response | null> {
  return routeAgentRequest(
    new Request(`https://example.com/agents/chat/${path}`, {
      headers: { Upgrade: "websocket", ...(cookie ? { Cookie: cookie } : {}) },
    }),
    env,
  );
}

async function refused(path: string, cookie: string): Promise<number | null> {
  const response = await upgrade(path, cookie);
  if (response?.status !== 101) return response?.status ?? null;
  const socket = response.webSocket as WebSocket;
  socket.accept();
  const rx = frames(socket);
  const code = await new Promise<number | null>((resolve) => {
    socket.addEventListener("close", (event) => resolve(event.code));
    setTimeout(() => resolve(null), 5000);
  });
  expect(rx.list.some((m) => m.type === "hello")).toBe(false);
  return code;
}

beforeAll(async () => {
  await applyD1Migrations(env.DB, migrations);
  await seedDemo(env.DB);
  const login = await call("/api/auth/login", {
    method: "POST",
    headers: json,
    body: JSON.stringify({ email: "demo@socrates.tw", password: "demo-demo" }),
  });
  teacher = await enableTeacher(cookieOf(login));
});

describe("unified accounts", () => {
  it("a new account cannot open a classroom until it turns on teacher mode", async () => {
    const visitor = await registerAccount();
    const topics = (await (await call("/api/topics", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
    }>;
    const blocked = await call("/api/classrooms", {
      method: "POST",
      headers: { ...json, Cookie: visitor.cookie },
      body: JSON.stringify({ name: "還不是老師", topicId: topics[0]!.id }),
    });
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { code: string }).code).toBe("teacher_required");

    const cookie = await enableTeacher(visitor.cookie);
    const opened = await call("/api/classrooms", {
      method: "POST",
      headers: { ...json, Cookie: cookie },
      body: JSON.stringify({ name: "試用老師的班", topicId: topics[0]!.id }),
    });
    expect(opened.status).toBe(201);
  });

  it("registration needs no display name; PATCH /me renames and re-issues the session", async () => {
    const fresh = await call("/api/auth/register", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        email: `local-part-${Date.now()}@socrates.tw`,
        password: "noname-pass-1",
        tosAccepted: true,
      }),
    });
    expect(((await fresh.json()) as { name: string }).name.startsWith("local-part-")).toBe(true);

    const renamed = await call("/api/me", {
      method: "PATCH",
      headers: { ...json, Cookie: cookieOf(fresh) },
      body: JSON.stringify({ name: "新名字" }),
    });
    expect(renamed.status).toBe(200);
    const me = (await (await call("/api/me", { headers: { Cookie: cookieOf(renamed) } })).json()) as {
      name: string;
      guest: boolean;
    };
    expect(me).toMatchObject({ name: "新名字", guest: false });

    const empty = await call("/api/me", {
      method: "PATCH",
      headers: { ...json, Cookie: cookieOf(fresh) },
      body: JSON.stringify({ name: "  " }),
    });
    expect(empty.status).toBe(422);
    expect((await call("/api/me", { method: "PATCH", headers: json, body: "{}" })).status).toBe(401);
  });

  it("one account both teaches and joins: per-classroom roles, owner cannot join own room, detail + activities", async () => {
    const topics = (await (await call("/api/topics", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
    }>;
    const register = await call("/api/auth/register", {
      method: "POST",
      headers: json,
      body: JSON.stringify({
        email: `both-${Date.now()}@socrates.tw`,
        password: "both-pass-12",
        name: "雙棲者",
        tosAccepted: true,
      }),
    });
    const cookie = await enableTeacher(cookieOf(register));
    const own = (await (
      await call("/api/classrooms", {
        method: "POST",
        headers: { ...json, Cookie: cookie },
        body: JSON.stringify({ name: "雙棲者開的班", topicId: topics[0]!.id }),
      })
    ).json()) as { classroomId: string; code: string };
    const other = (await (
      await call("/api/classrooms", {
        method: "POST",
        headers: { ...json, Cookie: teacher },
        body: JSON.stringify({ name: "林老師的班", topicId: topics[1]!.id }),
      })
    ).json()) as { classroomId: string; code: string };

    const ownJoin = await call("/api/join", {
      method: "POST",
      headers: { ...json, Cookie: cookie },
      body: JSON.stringify({ code: own.code, tosAccepted: true }),
    });
    expect(ownJoin.status).toBe(403);
    expect(((await ownJoin.json()) as { code: string }).code).toBe("only_student");

    const joined = await call("/api/join", {
      method: "POST",
      headers: { ...json, Cookie: cookie },
      body: JSON.stringify({ code: other.code, tosAccepted: true }),
    });
    expect(joined.status).toBe(200);

    const list = (await (await call("/api/classrooms", { headers: { Cookie: cookie } })).json()) as Array<{
      id: string;
      role: string;
    }>;
    expect(list.find((room) => room.id === own.classroomId)?.role).toBe("teacher");
    expect(list.find((room) => room.id === other.classroomId)?.role).toBe("student");

    const detail = await call(`/api/classrooms/${other.classroomId}`, { headers: { Cookie: cookie } });
    expect(detail.status).toBe(200);
    expect(((await detail.json()) as { role: string; code: string | null }).code).toBeNull();

    const stranger = await registerAccount("路人");
    expect((await call(`/api/classrooms/${own.classroomId}`, { headers: { Cookie: stranger.cookie } })).status).toBe(
      404,
    );

    await call(`/api/classrooms/${own.classroomId}/activities`, {
      method: "POST",
      headers: { ...json, Cookie: cookie },
      body: JSON.stringify({ topicId: topics[2]!.id }),
    });
    const activities = (await (
      await call(`/api/classrooms/${own.classroomId}/activities`, { headers: { Cookie: cookie } })
    ).json()) as Array<{ id: string; topicTitle: string; finished: boolean }>;
    expect(activities).toHaveLength(2);
    expect(activities[0]!.topicTitle).toBeTruthy();
    expect(
      (await call(`/api/classrooms/${own.classroomId}/activities`, { headers: { Cookie: stranger.cookie } })).status,
    ).toBe(404);
  });
});

describe("solo chats", () => {
  it("CRUD is owner-scoped", async () => {
    const owner = await registerAccount("獨白者");
    const created = await call("/api/solo/chats", {
      method: "POST",
      headers: { ...json, Cookie: owner.cookie },
      body: JSON.stringify({ title: "什麼是正義？" }),
    });
    expect(created.status).toBe(201);
    const chat = (await created.json()) as { id: string; title: string };
    expect(chat.id.startsWith("s_")).toBe(true);

    const list = (await (await call("/api/solo/chats", { headers: { Cookie: owner.cookie } })).json()) as Array<{
      id: string;
    }>;
    expect(list.map((entry) => entry.id)).toContain(chat.id);

    const renamed = await call(`/api/solo/chats/${chat.id}`, {
      method: "PATCH",
      headers: { ...json, Cookie: owner.cookie },
      body: JSON.stringify({ title: "正義與公平" }),
    });
    expect(((await renamed.json()) as { title: string }).title).toBe("正義與公平");

    const intruder = await registerAccount("闖入者");
    expect((await call(`/api/solo/chats/${chat.id}`, { headers: { Cookie: intruder.cookie } })).status).toBe(404);
    expect(
      (await call(`/api/solo/chats/${chat.id}`, { method: "DELETE", headers: { Cookie: intruder.cookie } })).status,
    ).toBe(404);

    expect(
      (await call(`/api/solo/chats/${chat.id}`, { method: "DELETE", headers: { Cookie: owner.cookie } })).status,
    ).toBe(204);
    expect((await call(`/api/solo/chats/${chat.id}`, { headers: { Cookie: owner.cookie } })).status).toBe(404);
  });

  it("solo thread: owner talks over the same WebSocket protocol; strangers are refused", async () => {
    const owner = await registerAccount("對話者");
    const chat = (await (
      await call("/api/solo/chats", {
        method: "POST",
        headers: { ...json, Cookie: owner.cookie },
        body: JSON.stringify({ title: "勇氣是什麼？" }),
      })
    ).json()) as { id: string; updatedAt: string };
    const thread = `${chat.id}:${owner.id}`;

    const intruder = await registerAccount("偷聽者");
    expect(await refused(thread, intruder.cookie)).toBe(1008);
    expect(await refused(`${chat.id}:${intruder.id}`, intruder.cookie)).toBe(1008);

    const response = await upgrade(thread, owner.cookie);
    expect(response?.status).toBe(101);
    const socket = response!.webSocket as WebSocket;
    socket.accept();
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "solo1", input: "勇氣是什麼？" }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "solo1"));
    await rx.until((f) => {
      const view = latestView(f);
      return view !== undefined && assistantText(view).length > 0;
    });
    socket.close();

    const after = (await (await call(`/api/solo/chats/${chat.id}`, { headers: { Cookie: owner.cookie } })).json()) as {
      updatedAt: string;
    };
    expect(after.updatedAt >= chat.updatedAt).toBe(true);
  }, 20_000);
});

describe("classroom deletion and topic translations", () => {
  it("only the owner deletes a classroom; members and topics list stop showing it", async () => {
    const topics = (await (await call("/api/topics", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
    }>;
    const created = (await (
      await call("/api/classrooms", {
        method: "POST",
        headers: { ...json, Cookie: teacher },
        body: JSON.stringify({ name: "要刪的班", topicId: topics[0]!.id }),
      })
    ).json()) as { classroomId: string; code: string };
    const student = await registerAccount("將被移除");
    await call("/api/join", {
      method: "POST",
      headers: { ...json, Cookie: student.cookie },
      body: JSON.stringify({ code: created.code, tosAccepted: true }),
    });

    const forbidden = await call(`/api/classrooms/${created.classroomId}`, {
      method: "DELETE",
      headers: { Cookie: student.cookie },
    });
    expect(forbidden.status).toBe(403);

    const deleted = await call(`/api/classrooms/${created.classroomId}`, {
      method: "DELETE",
      headers: { Cookie: teacher },
    });
    expect(deleted.status).toBe(204);
    expect((await call(`/api/classrooms/${created.classroomId}`, { headers: { Cookie: teacher } })).status).toBe(404);
    const studentList = (await (
      await call("/api/classrooms", { headers: { Cookie: student.cookie } })
    ).json()) as Array<{
      id: string;
    }>;
    expect(studentList.some((room) => room.id === created.classroomId)).toBe(false);
  });

  it("system topics come back in the request language; zh stays the source", async () => {
    const en = (await (
      await call("/api/topics", { headers: { Cookie: teacher, "Accept-Language": "en" } })
    ).json()) as Array<{ title: string; prompts: string[] }>;
    expect(en.some((topic) => topic.title === "Should AI have rights?")).toBe(true);
    const es = (await (
      await call("/api/topics", { headers: { Cookie: teacher, "Accept-Language": "es" } })
    ).json()) as Array<{ title: string }>;
    expect(es.some((topic) => topic.title === "¿Debería la IA tener derechos?")).toBe(true);
    const zh = (await (
      await call("/api/topics", { headers: { Cookie: teacher, "Accept-Language": "zh" } })
    ).json()) as Array<{ title: string }>;
    expect(zh.some((topic) => topic.title === "AI 應該有權利嗎？")).toBe(true);
  });
});

describe("create-then-edit courses", () => {
  it("creates an untitled course without a topic, renames it, then starts the first topic", async () => {
    const created = await call("/api/classrooms", {
      method: "POST",
      headers: { ...json, Cookie: teacher, "Accept-Language": "zh" },
      body: "{}",
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { classroomId: string; code: string; activityId: string | null };
    expect(body.activityId).toBeNull();
    const detail = (await (
      await call(`/api/classrooms/${body.classroomId}`, { headers: { Cookie: teacher } })
    ).json()) as {
      name: string;
      current: unknown;
    };
    expect(detail).toMatchObject({ name: "未命名課程", current: null });

    const stranger = await registerAccount("改名路人");
    expect(
      (
        await call(`/api/classrooms/${body.classroomId}`, {
          method: "PATCH",
          headers: { ...json, Cookie: stranger.cookie },
          body: JSON.stringify({ name: "偷改" }),
        })
      ).status,
    ).toBe(403);
    const renamed = await call(`/api/classrooms/${body.classroomId}`, {
      method: "PATCH",
      headers: { ...json, Cookie: teacher },
      body: JSON.stringify({ name: "倫理學入門" }),
    });
    expect(renamed.status).toBe(200);

    const topics = (await (await call("/api/topics", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
    }>;
    const started = await call(`/api/classrooms/${body.classroomId}/activities`, {
      method: "POST",
      headers: { ...json, Cookie: teacher },
      body: JSON.stringify({ topicId: topics[0]!.id }),
    });
    expect(started.status).toBe(201);
    const after = (await (
      await call(`/api/classrooms/${body.classroomId}`, { headers: { Cookie: teacher } })
    ).json()) as {
      name: string;
      current: { activityId: string } | null;
    };
    expect(after.name).toBe("倫理學入門");
    expect(after.current?.activityId).toBeTruthy();
  });
});

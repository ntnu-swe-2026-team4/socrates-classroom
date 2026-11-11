import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { routeAgentRequest } from "agents";
import { beforeAll, describe, expect, it } from "vitest";
import { inject } from "vitest";
import { seedDemo } from "../src/seed";
import { assistantText, call, cookieOf, frames, latestView } from "./helpers";

const json = { "Content-Type": "application/json" };
const migrations = inject("d1Migrations");
let teacher: string;

async function guest(name?: string): Promise<{ cookie: string; id: string }> {
  const res = await call("/api/auth/guest", {
    method: "POST",
    headers: json,
    body: JSON.stringify(name ? { name } : {}),
  });
  expect(res.status).toBe(200);
  const user = (await res.json()) as { id: string; guest: boolean };
  expect(user.guest).toBe(true);
  return { cookie: cookieOf(res), id: user.id };
}

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
  teacher = cookieOf(login);
});

describe("unified accounts", () => {
  it("guest sign-in → cannot open a classroom → registering upgrades the same user, who then can", async () => {
    const visitor = await guest();
    const topics = (await (await call("/api/topics", { headers: { Cookie: teacher } })).json()) as Array<{
      id: string;
    }>;
    const blocked = await call("/api/classrooms", {
      method: "POST",
      headers: { ...json, Cookie: visitor.cookie },
      body: JSON.stringify({ name: "訪客班", topicId: topics[0]!.id }),
    });
    expect(blocked.status).toBe(403);
    expect(((await blocked.json()) as { code: string }).code).toBe("account_required");

    const registered = await call("/api/auth/register", {
      method: "POST",
      headers: { ...json, Cookie: visitor.cookie },
      body: JSON.stringify({
        email: `up-${Date.now()}@socrates.tw`,
        password: "upgrade-pass-1",
        name: "升級者",
        tosAccepted: true,
      }),
    });
    expect(registered.status).toBe(200);
    const account = (await registered.json()) as { id: string; guest: boolean };
    expect(account).toMatchObject({ id: visitor.id, guest: false });
    const cookie = cookieOf(registered);

    const opened = await call("/api/classrooms", {
      method: "POST",
      headers: { ...json, Cookie: cookie },
      body: JSON.stringify({ name: "升級者的班", topicId: topics[0]!.id }),
    });
    expect(opened.status).toBe(201);
  });

  it("registration needs no display name (guest keeps theirs); PATCH /me renames and re-issues the session", async () => {
    const visitor = await guest("原本的名字");
    const registered = await call("/api/auth/register", {
      method: "POST",
      headers: { ...json, Cookie: visitor.cookie },
      body: JSON.stringify({ email: `noname-${Date.now()}@socrates.tw`, password: "noname-pass-1", tosAccepted: true }),
    });
    expect(registered.status).toBe(200);
    expect(((await registered.json()) as { name: string }).name).toBe("原本的名字");

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
    const cookie = cookieOf(register);
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

    const stranger = await guest("路人");
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
    const owner = await guest("獨白者");
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

    const intruder = await guest("闖入者");
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
    const owner = await guest("對話者");
    const chat = (await (
      await call("/api/solo/chats", {
        method: "POST",
        headers: { ...json, Cookie: owner.cookie },
        body: JSON.stringify({ title: "勇氣是什麼？" }),
      })
    ).json()) as { id: string; updatedAt: string };
    const thread = `${chat.id}:${owner.id}`;

    const intruder = await guest("偷聽者");
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

describe("assistant (quick AI answers)", () => {
  it("answers the latest user turn (mock), validates shape, and requires a session", async () => {
    const asker = await guest("提問者");
    const answered = await call("/api/assistant", {
      method: "POST",
      headers: { ...json, Cookie: asker.cookie },
      body: JSON.stringify({
        messages: [
          { role: "user", text: "光速是多少？" },
          { role: "assistant", text: "約每秒 30 萬公里。" },
          { role: "user", text: "那聲速呢？" },
        ],
      }),
    });
    expect(answered.status).toBe(200);
    expect(((await answered.json()) as { markdown: string }).markdown.length).toBeGreaterThan(0);

    const endsWithAssistant = await call("/api/assistant", {
      method: "POST",
      headers: { ...json, Cookie: asker.cookie },
      body: JSON.stringify({ messages: [{ role: "assistant", text: "hi" }] }),
    });
    expect(endsWithAssistant.status).toBe(422);

    const anonymous = await call("/api/assistant", {
      method: "POST",
      headers: json,
      body: JSON.stringify({ messages: [{ role: "user", text: "hi" }] }),
    });
    expect(anonymous.status).toBe(401);
  });
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
    const student = await guest("將被移除");
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

    const stranger = await guest("改名路人");
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

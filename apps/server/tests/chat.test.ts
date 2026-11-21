import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { routeAgentRequest } from "agents";
import { ROOT_SESSION } from "agents/harness/pi";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { ROOT_CONVERSATION_ID, type ConversationId } from "@earendil-works/pi-durable";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { inject } from "vitest";

vi.setConfig({ testTimeout: 15_000 });
import { seedFixture } from "../src/seed";
import { all, run } from "../src/db/d1";
import type { Chat } from "../src/do/chat";
import { BTW_THINKING_LEVEL, PROFILES } from "../src/pi/agents/profiles";
import { SOCRATES_PROMPTS, socratesExtension } from "../src/pi/extensions/socrates";
import {
  assistantText,
  call,
  classroomWithActivity,
  cookieOf,
  frames,
  joinGuest,
  latestView,
  must,
  participantIdOf,
  registerStudent,
} from "./helpers";

let teacherCookie: string;
let classroomCode: string;
let activityId: string;

async function joinStudent(name: string): Promise<{ cookie: string; participantId: string }> {
  const guest = await joinGuest(classroomCode, name);
  return { cookie: guest.cookie, participantId: guest.participantId };
}

async function connect(thread: string, cookie?: string, lang?: string): Promise<WebSocket> {
  const response = await routeAgentRequest(
    new Request(`https://example.com/agents/chat/${thread}${lang ? `?lang=${lang}` : ""}`, {
      headers: { Upgrade: "websocket", ...(cookie ? { Cookie: cookie } : {}) },
    }),
    env,
  );
  expect(response?.status).toBe(101);
  const socket = must(response?.webSocket, "chat websocket");
  socket.accept();
  return socket;
}

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
  teacherCookie = cookieOf(login);
  const created = await classroomWithActivity(teacherCookie, "WS 班");
  classroomCode = created.code;
  activityId = created.activityId;
});

describe("chat core (real DO + real WebSocket + faux model)", () => {
  it("Socrates' prompt is the one written in the student's language", async () => {
    for (const lang of ["zh", "en", "es"] as const) {
      const sections = socratesExtension(() => lang).sections;
      const render = must(sections?.[0], "socrates section").render as () => Promise<string>;
      expect(await render()).toBe(SOCRATES_PROMPTS[lang]);
    }
    expect(new Set(Object.values(SOCRATES_PROMPTS)).size).toBe(3);
  });

  it("a student connected with ?lang=en is answered through the English prompt", async () => {
    const student = await joinStudent("英文生");
    const socket = await connect(`${activityId}:${student.participantId}`, student.cookie, "en");
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "s1", input: "Is it fair?" }));
    await rx.until((f) => {
      const view = latestView(f);
      return view !== undefined && assistantText(view).includes("You said");
    });
    socket.close();
  });

  it("the student's connection sets the language; a watching teacher's does not", async () => {
    const student = await joinStudent("語言生");
    const thread = `${activityId}:${student.participantId}`;
    const stub = env.Chat.get(env.Chat.idFromName(thread)) as unknown as DurableObjectStub<Chat>;
    const langNow = () =>
      runInDurableObject(stub, async (instance) =>
        (instance as unknown as { ctx: DurableObjectState }).ctx.storage.get<string>("studentLang"),
      );

    const own = await connect(thread, student.cookie, "en");
    await frames(own).until((f) => f.some((m) => m.type === "hello"));
    expect(await langNow()).toBe("en");

    const teacher = await connect(thread, teacherCookie, "es");
    await frames(teacher).until((f) => f.some((m) => m.type === "hello"));
    expect(await langNow()).toBe("en");

    const unsupported = await connect(thread, student.cookie, "fr");
    await frames(unsupported).until((f) => f.some((m) => m.type === "hello"));
    expect(await langNow()).toBe("en");
    unsupported.close();

    own.close();
    teacher.close();
  });

  it("WS upgrade → hello → watch → submit → answer lands in transcript", async () => {
    const student = await joinStudent("小明");
    const thread = `${activityId}:${student.participantId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));

    socket.send(JSON.stringify({ type: "submit", id: "s1", input: "正義是什麼？" }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "s1"));
    await rx.until((f) => {
      const view = latestView(f);
      return view !== undefined && assistantText(view).includes("正義是什麼");
    });

    const view = must(latestView(rx.list), "latest view");
    const roles = view.entries.map((entry) => entry.model?.[0]?.role ?? entry.kind);
    expect(roles).toContain("user");
    expect(roles).toContain("assistant");
    expect(assistantText(view)).toContain("直覺判斷");
    socket.close();
  });

  it("a turn on a teacher leg records usage for the teacher's keyed provider", async () => {
    const teacher = await all<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = 'demo@socrates.tw'");
    expect(teacher).toHaveLength(1);
    await run(
      env.DB,
      `INSERT INTO teacher_keys (user_id, provider_id, key_enc, last4, sort_order, updated_at)
       VALUES ($uid, 'faux', 'enc', 'xxxx', 0, '2026-11-21T00:00:00.000Z')`,
      { uid: teacher[0].id },
    );
    await run(
      env.DB,
      `INSERT INTO teacher_key_models (user_id, provider_id, model, max_concurrency, sort_order, updated_at)
       VALUES ($uid, 'faux', 'faux-1', NULL, 0, '2026-11-21T00:00:00.000Z')`,
      { uid: teacher[0].id },
    );

    const student = await joinStudent("額度生");
    const thread = `${activityId}:${student.participantId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "s1", input: "正義是什麼？" }));
    await rx.until((f) => {
      const view = latestView(f);
      return view !== undefined && assistantText(view).includes("直覺判斷");
    });
    socket.close();

    let usage: Array<{ provider_id: string; model: string }> = [];
    for (let i = 0; i < 20 && usage.length === 0; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      usage = await all<{ provider_id: string; model: string }>(
        env.DB,
        "SELECT provider_id, model FROM teacher_key_usage WHERE user_id = $uid AND provider_id = 'faux'",
        { uid: teacher[0].id },
      );
    }
    expect(usage).toEqual([{ provider_id: "faux", model: "faux-1" }]);
  });

  it("reconnect after disconnect: transcript restored persistently from pi storage", async () => {
    const student = await joinStudent("阿華");
    const thread = `${activityId}:${student.participantId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "s1", input: "第一個問題" }));
    await rx.until((f) => {
      const view = latestView(f);
      return view !== undefined && assistantText(view).includes("第一個問題");
    });
    socket.close();

    await evictDurableObject(env.Chat.get(env.Chat.idFromName(thread)));

    const again = await connect(thread, student.cookie);
    const rx2 = frames(again);
    await rx2.until((f) => f.some((m) => m.type === "hello"));
    again.send(JSON.stringify({ type: "watch" }));
    await rx2.until((f) => f.some((m) => m.type === "view"));
    const view = must(latestView(rx2.list), "latest view");
    expect(assistantText(view)).toContain("第一個問題");
    again.close();
  });

  it("hibernated socket survives eviction and is reused: first frame is not 1008 (#authorized restored on reattach)", async () => {
    const student = await joinStudent("冬眠本人");
    const thread = `${activityId}:${student.participantId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));

    await evictDurableObject(env.Chat.get(env.Chat.idFromName(thread)));

    socket.send(JSON.stringify({ type: "submit", id: "post-evict", input: "驅逐後的第一句" }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "post-evict"));
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  }, 20_000);

  it("reports and replays an orphaned dialogue run after eviction without a transcript entry", async () => {
    const student = await joinStudent("失聯後重試");
    const thread = `${activityId}:${student.participantId}`;
    const stub = env.Chat.get(env.Chat.idFromName(thread));
    const socket = await connect(thread, student.cookie);
    const isFailure = (frame: ReturnType<typeof frames>["list"][number]) =>
      frame.type === "error" && frame.code === "llm_unavailable" && frame.id === undefined;
    try {
      const rx = frames(socket);
      socket.send(JSON.stringify({ type: "watch" }));
      await rx.until((f) => f.some((m) => m.type === "view"));
      await runInDurableObject(stub, async (instance) => {
        await (instance as Chat).lifecycle.jobs.push({
          fn: "dialogue-run-deadline",
          time: Date.now() + 120_000,
          payload: { session: ROOT_SESSION, operationId: crypto.randomUUID() },
        });
      });
      await evictDurableObject(stub);
      expect(await runDurableObjectAlarm(stub)).toBe(true);
      socket.send(JSON.stringify({ type: "watch", id: "after-alarm" }));
      await rx.until((f) => f.some((m) => m.type === "result" && m.id === "after-alarm"));
      expect(rx.list.filter(isFailure)).toHaveLength(1);
      expect(latestView(rx.list)?.entries).toHaveLength(0);
    } finally {
      socket.close();
    }

    const reconnected = await connect(thread, student.cookie);
    try {
      const rx = frames(reconnected);
      reconnected.send(JSON.stringify({ type: "watch", id: "reconnect" }));
      await rx.until((f) => f.some((m) => m.type === "result" && m.id === "reconnect"));
      expect(rx.list.filter(isFailure)).toHaveLength(1);
    } finally {
      reconnected.close();
    }
  }, 20_000);

  it("does not replay the previous failure after eviction when a newer run was admitted", async () => {
    const student = await joinStudent("重啟後的新一輪");
    const thread = `${activityId}:${student.participantId}`;
    const stub = env.Chat.get(env.Chat.idFromName(thread));
    let socket: WebSocket | undefined;

    try {
      await runInDurableObject(stub, async (instance, state) => {
        const chat = instance as Chat;
        await chat.lifecycle.start();
        await chat.lifecycle.disableAlarms();
        const operationId = crypto.randomUUID();
        state.storage.kv.put(`dialogue-run-failure:${ROOT_SESSION}`, {
          jobId: "previous-failure",
          expiresAt: Date.now() + 120_000,
        });
        await chat.lifecycle.jobs.push({
          fn: "dialogue-run-deadline",
          time: Date.now() + 120_000,
          payload: { session: ROOT_SESSION, operationId },
        });
        const session = chat.harness.session(ROOT_SESSION);
        const receipt = await session.submit("正義是什麼？".repeat(100), { operationId, whenBusy: "reject" });
        expect(receipt.accepted).toBe(true);
        expect(await session.busy()).toBe(true);
        await chat.harness.dispose();
      });

      await evictDurableObject(stub);
      socket = await connect(thread, student.cookie);
      const rx = frames(socket);
      socket.send(JSON.stringify({ type: "watch", id: "after-restart" }));
      await rx.until((f) => f.some((m) => m.type === "result" && m.id === "after-restart"));
      expect(latestView(rx.list)?.entries.some((entry) => entry.kind === "pi.user")).toBe(true);
      expect(rx.list.filter((m) => m.type === "error" && m.code === "llm_unavailable")).toHaveLength(0);

      socket.send(JSON.stringify({ type: "abort", id: "abort-new-run" }));
      await rx.until((f) => f.some((m) => m.type === "result" && m.id === "abort-new-run"));
      await expect
        .poll(
          () =>
            runInDurableObject(stub, (instance) =>
              (instance as Chat).lifecycle.jobs.list().some((job) => job.fn === "dialogue-run-deadline"),
            ),
          { timeout: 5_000 },
        )
        .toBe(false);
      socket.send(JSON.stringify({ type: "watch", id: "after-abort" }));
      await rx.until((f) => f.some((m) => m.type === "result" && m.id === "after-abort"));
      expect(rx.list.filter((m) => m.type === "error" && m.code === "llm_unavailable")).toHaveLength(0);
    } finally {
      socket?.close();
      await runInDurableObject(stub, (instance) => (instance as Chat).harness.session(ROOT_SESSION).abort());
    }
  }, 20_000);

  it("reports a dialogue run deadline while the original run is still active", async () => {
    const student = await joinStudent("回覆逾時");
    const thread = `${activityId}:${student.participantId}`;
    const stub = env.Chat.get(env.Chat.idFromName(thread));
    const socket = await connect(thread, student.cookie);
    try {
      const rx = frames(socket);
      socket.send(JSON.stringify({ type: "watch" }));
      await rx.until((f) => f.some((m) => m.type === "view"));

      const deadline = await runInDurableObject(stub, async (instance) => {
        const chat = instance as Chat;
        const session = chat.harness.session(ROOT_SESSION);
        const receipt = await session.submit("正義是什麼？".repeat(100), { whenBusy: "reject" });
        expect(receipt.accepted).toBe(true);
        expect(await session.busy()).toBe(true);
        const time = Date.now() + 1_000;
        await chat.lifecycle.jobs.push({
          fn: "dialogue-run-deadline",
          time,
          payload: { session: ROOT_SESSION, operationId: receipt.operationId },
        });
        return time;
      });

      await rx.until((f) => f.some((m) => m.type === "error" && m.code === "llm_unavailable" && m.id === undefined));
      expect(Date.now()).toBeGreaterThanOrEqual(deadline);
      expect(
        await runInDurableObject(stub, (instance) => (instance as Chat).harness.session(ROOT_SESSION).busy()),
      ).toBe(true);
    } finally {
      socket.close();
      await runInDurableObject(stub, (instance) => (instance as Chat).harness.session(ROOT_SESSION).abort());
    }
  }, 20_000);

  it("revoked participant is refused after hibernation wake (ownership re-verified, not trusted from connect time)", async () => {
    const student = await joinStudent("被移出的學生");
    const thread = `${activityId}:${student.participantId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));

    await run(env.DB, "DELETE FROM activity_participants WHERE activity_id = $aid AND id = $pid", {
      aid: activityId,
      pid: student.participantId,
    });
    await evictDurableObject(env.Chat.get(env.Chat.idFromName(thread)));

    socket.send(JSON.stringify({ type: "submit", id: "revoked", input: "還能送嗎" }));
    const closed = await new Promise<{ code: number; reason: string; wasClean: boolean } | null>((resolve) => {
      socket.addEventListener("close", (event) =>
        resolve({ code: event.code, reason: event.reason, wasClean: event.wasClean }),
      );
      setTimeout(() => resolve(null), 8000);
    });
    expect(closed?.code).toBe(1008);
    expect(rx.list.some((m) => m.type === "result" && m.id === "revoked")).toBe(false);
  }, 20_000);

  it("submit bounds: empty string / over 2000 chars → error frame, nothing enters the transcript", async () => {
    const student = await joinStudent("邊界本人");
    const thread = `${activityId}:${student.participantId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "empty", input: "   " }));
    await rx.until((f) => f.some((m) => m.type === "error" && m.id === "empty"));
    socket.send(JSON.stringify({ type: "submit", id: "huge", input: "x".repeat(2001) }));
    await rx.until((f) => f.some((m) => m.type === "error" && m.id === "huge"));
    expect(latestView(rx.list)?.entries.some((entry) => entry.kind === "pi.user")).toBe(false);
    socket.close();
  });

  it("a second submit during a run is rejected (ConversationBusy error frame); the connection is unaffected", async () => {
    const student = await joinStudent("小美");
    const thread = `${activityId}:${student.participantId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "a", input: "問題 A" }));
    socket.send(JSON.stringify({ type: "submit", id: "b", input: "問題 B" }));
    await rx.until((f) => f.some((m) => m.type === "error" && m.id === "b"));
    const busy = rx.list.find((m) => m.type === "error" && m.id === "b");
    expect(busy).toMatchObject({ code: "ConversationBusy" });
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "a"));
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  }, 20_000);

  it("abort op: replies with a result (one of the three values); connection unaffected", async () => {
    const student = await joinStudent("阿捷");
    const thread = `${activityId}:${student.participantId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "q", input: "長問題" }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "q"));
    socket.send(JSON.stringify({ type: "abort", id: "ab" }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "ab"));
    const abortResult = rx.list.find((m) => m.type === "result" && m.id === "ab") as unknown as {
      result: unknown;
    };
    expect(typeof abortResult.result).toBe("boolean");
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  }, 20_000);

  it("entries op: replies with paged items; limit takes effect", async () => {
    const student = await joinStudent("阿查");
    const thread = `${activityId}:${student.participantId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "q", input: "正義是什麼？" }));
    await rx.until((f) => {
      const view = latestView(f);
      return view?.entries.some((entry) => entry.kind === "pi.assistant" && assistantText(view).length > 0) ?? false;
    });
    socket.send(JSON.stringify({ type: "entries", id: "e1", query: { order: "ascending" }, limit: 100 }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "e1"));
    const page = rx.list.find((m) => m.type === "result" && m.id === "e1") as unknown as {
      result: { items: Array<{ kind: string }> };
    };
    const kinds = page.result.items.map((entry) => entry.kind);
    expect(kinds).toContain("pi.user");
    expect(kinds).toContain("pi.assistant");
    socket.send(JSON.stringify({ type: "entries", id: "e2", query: { order: "ascending" }, limit: 1 }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "e2"));
    const single = rx.list.find((m) => m.type === "result" && m.id === "e2") as unknown as {
      result: { items: unknown[] };
    };
    expect(single.result.items.length).toBeLessThanOrEqual(1);
    socket.close();
  }, 20_000);

  it("authorization: no cookie / non-member / another student's thread → rejected (1008, no hello)", async () => {
    const owner = await joinStudent("本人");
    const peer = await joinStudent("同學");
    const thread = `${activityId}:${owner.participantId}`;

    const noCookie = await connect(thread);
    const r1 = frames(noCookie);
    await r1.until((f) => f.length > 0 || noCookie.readyState === WebSocket.CLOSED);
    expect(r1.list.some((m) => m.type === "hello")).toBe(false);
    noCookie.close();

    const stranger = await joinStudent("路人");
    const strangerThread = `${activityId}:${stranger.participantId}`;
    const asPeer = await connect(strangerThread, peer.cookie);
    const r2 = frames(asPeer);
    await r2.until((f) => f.length > 0 || asPeer.readyState === WebSocket.CLOSED);
    expect(r2.list.some((m) => m.type === "hello")).toBe(false);
    asPeer.close();
  });

  it("transcript guard: externally agents-routed path → 404 (the DO's onRequest only accepts internal shortcuts)", async () => {
    const student = await joinStudent("逐字稿本人");
    const thread = `${activityId}:${student.participantId}`;
    const res = await routeAgentRequest(
      new Request(`https://example.com/agents/chat/${thread}/transcript`, {
        headers: { Cookie: student.cookie },
      }),
      env,
    );
    expect(res?.status).toBe(404);
  });

  it("authorization race: watch sent after rejection but before close → no view (per-message gate)", async () => {
    const owner = await joinStudent("賽窗本人");
    const thread = `${activityId}:${owner.participantId}`;
    const socket = await connect(thread);
    const rx = frames(socket);
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.length > 0 || socket.readyState === WebSocket.CLOSED);
    expect(rx.list.some((m) => m.type === "view")).toBe(false);
    expect(rx.list.some((m) => m.type === "hello")).toBe(false);
    socket.close();
  });

  it("disabled account: the open socket is refused on its next message and reconnects are rejected", async () => {
    const account = await registerStudent(classroomCode, "停用本人");
    const participantId = await participantIdOf(activityId, account.cookie);
    const thread = `${activityId}:${participantId}`;
    const socket = await connect(thread, account.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));

    const adminLogin = await call("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "admin@socrates.tw", password: "demo-demo" }),
    });
    expect(adminLogin.status).toBe(200);
    const disabled = await call(`/api/admin/users/${account.userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: cookieOf(adminLogin) },
      body: JSON.stringify({ disabled: true }),
    });
    expect(disabled.status).toBe(200);

    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until(() => socket.readyState === WebSocket.CLOSED);
    expect(rx.list.some((m) => m.type === "view")).toBe(false);

    const again = await connect(thread, account.cookie);
    const reconnected = frames(again);
    await reconnected.until((f) => f.length > 0 || again.readyState === WebSocket.CLOSED);
    expect(reconnected.list.some((m) => m.type === "hello")).toBe(false);
    again.close();
  });

  it("authorization: a teacher may observe a student thread (hello arrives)", async () => {
    const student = await joinStudent("被觀察");
    const thread = `${activityId}:${student.participantId}`;
    const socket = await connect(thread, teacherCookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.close();
  });
});

describe("teacher thread access: observe and abort yes, submit no (SubmitForbidden)", () => {
  it("teacher submit on a student thread is rejected with code SubmitForbidden; abort still allowed", async () => {
    const student = await joinStudent("代打對象");
    const thread = `${activityId}:${student.participantId}`;
    const socket = await connect(thread, teacherCookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "t1", input: "老師代打" }));
    await rx.until((f) => f.some((m) => m.type === "error" && m.id === "t1"));
    const forbidden = rx.list.find((m) => m.type === "error" && m.id === "t1");
    expect(forbidden).toMatchObject({ code: "SubmitForbidden" });
    expect(latestView(rx.list)?.entries.some((entry) => entry.kind === "pi.user")).toBe(false);
    socket.send(JSON.stringify({ type: "abort", id: "t2" }));
    await rx.until((f) => f.some((m) => m.type === "result" && m.id === "t2"));
    expect(socket.readyState).toBe(WebSocket.OPEN);
    socket.close();
  }, 20_000);
});

describe("btw side session (#121): a fork of the root that never writes back", () => {
  function userTexts(view: ReturnType<typeof latestView>): string[] {
    return (view?.entries ?? [])
      .filter((entry) => entry.kind === "pi.user")
      .flatMap((entry) => entry.model ?? [])
      .map((message) =>
        typeof message.content === "string"
          ? message.content
          : message.content.map((part) => (part.type === "text" ? part.text : "")).join(""),
      );
  }

  async function rootUserTexts(thread: string): Promise<string[]> {
    const chat = env.Chat.get(env.Chat.idFromName(thread)) as unknown as DurableObjectStub<Chat>;
    const { messages } = await chat.transcript();
    return messages.filter((message) => message.role === "user").map((message) => message.text);
  }

  async function opened(thread: string, cookie: string) {
    const socket = await connect(thread, cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    return { socket, rx };
  }

  it("student opens a btw session: it sees the root history, its exchange stays out of the root", async () => {
    const student = await joinStudent("副視窗本人");
    const thread = `${activityId}:${student.participantId}`;
    const main = await opened(thread, student.cookie);
    main.socket.send(JSON.stringify({ type: "watch" }));
    await main.rx.until((f) => f.some((m) => m.type === "view"));
    main.socket.send(JSON.stringify({ type: "submit", id: "m1", input: "主對話第一句" }));
    await main.rx.until((f) => {
      const view = latestView(f);
      return view !== undefined && assistantText(view).includes("主對話第一句");
    });

    const side = await opened(thread, student.cookie);
    side.socket.send(JSON.stringify({ type: "btw", id: "b1" }));
    await side.rx.until((f) => f.some((m) => m.type === "result" && m.id === "b1"));
    const opened1 = side.rx.list.find((m) => m.type === "result" && m.id === "b1");
    const session = (opened1 as { result: { session: string } }).result.session;
    expect(typeof session).toBe("string");
    expect(session).not.toBe("1");
    expect(userTexts(latestView(side.rx.list))).toContain("主對話第一句");

    const stub = env.Chat.get(env.Chat.idFromName(thread)) as unknown as DurableObjectStub<Chat>;
    const levels = await runInDurableObject(stub, async (instance) => {
      const pi = await instance.harness.pi();
      const levelOf = async (id: ConversationId) =>
        (await (await pi.conversation(id, BACKGROUND_CONTEXT))?.agent(BACKGROUND_CONTEXT))?.thinkingLevel;
      return { root: await levelOf(ROOT_CONVERSATION_ID), btw: await levelOf(Number(session) as ConversationId) };
    });
    expect(levels).toEqual({ root: PROFILES.socrates.thinkingLevel, btw: BTW_THINKING_LEVEL });

    side.socket.send(JSON.stringify({ type: "submit", id: "b2", input: "電車難題是什麼" }));
    await side.rx.until((f) => f.some((m) => m.type === "result" && m.id === "b2"));
    await side.rx.until((f) => {
      const view = latestView(f);
      return view !== undefined && view.entries.filter((entry) => entry.kind === "pi.assistant").length >= 2;
    });
    expect(userTexts(latestView(side.rx.list))).toContain("電車難題是什麼");

    expect(userTexts(latestView(main.rx.list))).not.toContain("電車難題是什麼");
    expect(await rootUserTexts(thread)).toEqual(["主對話第一句"]);

    main.socket.close();
    side.socket.close();
  }, 20_000);

  it("a hibernated btw socket stays bound to its session after eviction", async () => {
    const student = await joinStudent("副視窗冬眠");
    const thread = `${activityId}:${student.participantId}`;
    const main = await opened(thread, student.cookie);
    main.socket.send(JSON.stringify({ type: "watch" }));
    await main.rx.until((f) => f.some((m) => m.type === "view"));
    main.socket.send(JSON.stringify({ type: "submit", id: "m1", input: "先說一句" }));
    await main.rx.until((f) => latestView(f)?.entries.some((entry) => entry.kind === "pi.assistant") === true);
    main.socket.close();
    const side = await opened(thread, student.cookie);
    side.socket.send(JSON.stringify({ type: "btw", id: "b1" }));
    await side.rx.until((f) => f.some((m) => m.type === "result" && m.id === "b1"));
    await side.rx.until((f) => latestView(f)?.entries.some((entry) => entry.kind === "pi.assistant") === true);

    await evictDurableObject(env.Chat.get(env.Chat.idFromName(thread)));

    side.socket.send(JSON.stringify({ type: "submit", id: "b2", input: "驅逐後的副問題" }));
    await side.rx.until((f) => f.some((m) => m.type === "result" && m.id === "b2"));
    expect(await rootUserTexts(thread)).toEqual(["先說一句"]);
    side.socket.close();
  }, 20_000);

  it("btw before any dialogue → NothingToFork; teacher may attach but not open; root id is not a btw session", async () => {
    const student = await joinStudent("副視窗權限");
    const thread = `${activityId}:${student.participantId}`;
    const fresh = await opened(thread, student.cookie);
    fresh.socket.send(JSON.stringify({ type: "btw", id: "b0" }));
    await fresh.rx.until((f) => f.some((m) => m.type === "error" && m.id === "b0"));
    expect(fresh.rx.list.find((m) => m.type === "error" && m.id === "b0")).toMatchObject({ code: "NothingToFork" });
    fresh.socket.send(JSON.stringify({ type: "submit", id: "m1", input: "開場" }));
    await fresh.rx.until((f) => f.some((m) => m.type === "result" && m.id === "m1"));
    fresh.socket.send(JSON.stringify({ type: "btw", id: "b1" }));
    await fresh.rx.until((f) => f.some((m) => m.type === "result" && m.id === "b1"));
    const session = (fresh.rx.list.find((m) => m.type === "result" && m.id === "b1") as { result: { session: string } })
      .result.session;

    const teacher = await opened(thread, teacherCookie);
    teacher.socket.send(JSON.stringify({ type: "btw", id: "t1" }));
    await teacher.rx.until((f) => f.some((m) => m.type === "error" && m.id === "t1"));
    expect(teacher.rx.list.find((m) => m.type === "error" && m.id === "t1")).toMatchObject({ code: "SubmitForbidden" });
    teacher.socket.send(JSON.stringify({ type: "btw", id: "t2", session: "1" }));
    await teacher.rx.until((f) => f.some((m) => m.type === "error" && m.id === "t2"));
    expect(teacher.rx.list.find((m) => m.type === "error" && m.id === "t2")).toMatchObject({ code: "UnknownSession" });
    teacher.socket.send(JSON.stringify({ type: "btw", id: "t3", session }));
    await teacher.rx.until((f) => f.some((m) => m.type === "result" && m.id === "t3"));
    expect(teacher.rx.list.find((m) => m.type === "result" && m.id === "t3")).toMatchObject({ result: { session } });

    fresh.socket.close();
    teacher.socket.close();
  }, 20_000);
});

describe("activity_finished reaches the client as a named error code", () => {
  it("submit after finish → error frame code ActivityFinished (not generic Request failed)", async () => {
    const student = await joinStudent("下課本人");
    const thread = `${activityId}:${student.participantId}`;
    const socket = await connect(thread, student.cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    const finish = await call(`/api/activities/${activityId}/finish`, {
      method: "POST",
      headers: { Cookie: teacherCookie },
    });
    expect(finish.status).toBe(204);
    socket.send(JSON.stringify({ type: "submit", id: "late", input: "遲來的訊息" }));
    await rx.until((f) => f.some((m) => m.type === "error" && m.id === "late"));
    const frame = rx.list.find((m) => m.type === "error" && m.id === "late");
    expect(frame).toMatchObject({ code: "ActivityFinished", message: "activity_finished" });
    expect(latestView(rx.list)?.entries.some((entry) => entry.kind === "pi.user")).toBe(false);
    socket.close();
  }, 20_000);
});

describe("WS error-frame hygiene + worker entry CORS", () => {
  it("non-whitelisted error (ZodError from oversized input) yields a generic frame: no code, id echoed", async () => {
    const created = await classroomWithActivity(teacherCookie, "錯誤框架班");
    const joined = await call("/api/join", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: created.code, name: "超長訊息", tosAccepted: true }),
    });
    expect(joined.status).toBe(200);
    const cookie = cookieOf(joined);
    const socket = await connect(`${created.activityId}:${await participantIdOf(created.activityId, cookie)}`, cookie);
    const rx = frames(socket);
    await rx.until((f) => f.some((m) => m.type === "hello"));
    socket.send(JSON.stringify({ type: "watch" }));
    await rx.until((f) => f.some((m) => m.type === "view"));
    socket.send(JSON.stringify({ type: "submit", id: "big", input: "字".repeat(2001) }));
    await rx.until((f) => f.some((m) => m.type === "error" && m.id === "big"));
    const frame = rx.list.find((m) => m.type === "error" && m.id === "big") as { code?: string; message: string };
    expect(frame.message).toBe("Request failed");
    expect(frame.code).toBeUndefined();
    socket.close();
  }, 20_000);

  it("worker entry serves /agents/* and /api/* without CORS headers (cors: false)", async () => {
    const preflight = await call("/agents/chat/whatever", { method: "OPTIONS" });
    expect(preflight.headers.get("access-control-allow-origin")).toBeNull();
    const api = await call("/api/me");
    expect(api.headers.get("access-control-allow-origin")).toBeNull();
  });
});

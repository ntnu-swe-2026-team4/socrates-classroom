import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { httpApi } from "@/api/http";
import { meOf } from "@/api/me";
import { ApiError } from "@/api";

type Handler = (path: string, init: RequestInit) => Response | Promise<Response>;
const handler = vi.fn<Handler>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  localStorage.clear();
  handler.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const path = url.startsWith("http") ? new URL(url).pathname + new URL(url).search : url;
      return handler(path, init ?? {});
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("httpApi contract (browser-side actual code)", () => {
  test("me: GET /api/me with cookie and Accept-Language", async () => {
    handler.mockReturnValue(json({ id: "u1", name: "小明", isAdmin: false }));
    document.documentElement.lang = "zh-TW";
    const user = await httpApi.me();
    expect(user?.name).toBe("小明");
    const [path, init] = handler.mock.calls[0];
    expect(path).toBe("/api/me");
    expect(init.credentials).toBe("include");
    expect(new Headers(init.headers).get("Accept-Language")).toBe("zh");
  });

  test("joinAsGuest: POST /api/join contract shape + activity id persisted", async () => {
    handler.mockReturnValue(json({ user: null, activityId: "a_1", participantId: "p_1", kind: "guest" }));
    const payload = await httpApi.joinAsGuest("socrat", { name: "小明", tosAccepted: true });
    expect(payload.activityId).toBe("a_1");
    expect(payload.user).toBeNull();
    expect(payload.participantId).toBe("p_1");
    const [path, init] = handler.mock.calls[0];
    expect(path).toBe("/api/join");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ code: "socrat", name: "小明", tosAccepted: true });
    expect(localStorage.getItem("socrates_activity")).toBe("a_1");
  });

  test("activity invites: create, preview and join hit the right paths", async () => {
    handler.mockImplementation((_path, init) => {
      if (init.method === "POST")
        return json({ activityId: "a_1", participantId: "p_2", displayName: "訪客", kind: "guest" });
      return json({
        token: "t1",
        activityId: "a_1",
        classroomName: "班",
        topic: { id: "t", title: "題", statement: "述", prompts: [] },
        finishedAt: null,
      });
    });
    await httpApi.createActivityInvite("a_1");
    expect(handler.mock.calls[0][0]).toBe("/api/activities/a_1/invites");
    expect(handler.mock.calls[0][1].method).toBe("POST");

    await httpApi.inviteInfo("t1");
    expect(handler.mock.calls[1][0]).toBe("/api/invites/t1");

    const joined = await httpApi.joinByInvite("t1", { name: "訪客", tosAccepted: true });
    expect(joined.participantId).toBe("p_2");
    const [path, init] = handler.mock.calls[2];
    expect(path).toBe("/api/invites/t1/join");
    expect(JSON.parse(init.body as string)).toEqual({ name: "訪客", tosAccepted: true });
  });

  test("error mapping: 422 tos_required → ApiError.code", async () => {
    handler.mockImplementation(() => json({ message: "需要同意使用條款才能進入。", code: "tos_required" }, 422));
    await expect(httpApi.joinAsGuest("socrat", { name: "小明", tosAccepted: true })).rejects.toMatchObject({
      code: "tos_required",
      message: "需要同意使用條款才能進入。",
    });
    try {
      await httpApi.joinAsGuest("socrat", { name: "小明", tosAccepted: false });
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).code).toBe("tos_required");
      const tosCall = handler.mock.calls.at(-1);
      if (tosCall === undefined) throw new Error("missing tos fetch call");
      expect(JSON.parse(tosCall[1].body as string).tosAccepted).toBe(false);
    }
  });

  test("stt: multipart upload, returns {text}", async () => {
    handler.mockReturnValue(json({ text: "我認為應該拉桿" }));
    const text = await httpApi.stt(new Blob([new Uint8Array([1])], { type: "audio/webm" }));
    expect(text).toBe("我認為應該拉桿");
    const [path] = handler.mock.calls[0];
    expect(path).toBe("/api/stt");
  });

  test("classroom topics: create classroom, list/add/copy topics, start activity", async () => {
    handler.mockImplementation((path, init) => {
      if (path === "/api/classrooms" && init.method === "POST")
        return json({ classroomId: "c_1", code: "abcdef", url: "https://x/join/abcdef" }, 201);
      if (path === "/api/classrooms/c_1/topics" && init.method === "POST")
        return json({ id: "t_1", classroomId: "c_1", title: "題", statement: "述", prompts: [] }, 201);
      if (path === "/api/topics/t_1/copy")
        return json({ id: "t_2", classroomId: "c_2", title: "題", statement: "述", prompts: [] }, 201);
      if (path === "/api/classrooms/c_1/activities")
        return json(
          { classroomId: "c_1", code: "abcdef", url: "https://x/join/abcdef", activityId: "a_1", mode: "live" },
          201,
        );
      return json([]);
    });

    const classroom = await httpApi.createClassroom("班");
    expect(handler.mock.calls[0][0]).toBe("/api/classrooms");
    expect(JSON.parse(handler.mock.calls[0][1].body as string)).toEqual({ name: "班" });
    expect(classroom.classroomId).toBe("c_1");

    await httpApi.listClassroomTopics("c_1");
    expect(handler.mock.calls[1][0]).toBe("/api/classrooms/c_1/topics");

    const topic = await httpApi.createClassroomTopic("c_1", { title: "題", statement: "述", prompts: [] });
    expect(topic.classroomId).toBe("c_1");
    expect(handler.mock.calls[2][0]).toBe("/api/classrooms/c_1/topics");
    expect(handler.mock.calls[2][1].method).toBe("POST");

    const copy = await httpApi.copyTopic("t_1", "c_2");
    expect(copy.id).toBe("t_2");
    expect(handler.mock.calls[3][0]).toBe("/api/topics/t_1/copy");
    expect(JSON.parse(handler.mock.calls[3][1].body as string)).toEqual({ classroomId: "c_2" });

    const started = await httpApi.startActivity("c_1", "t_1");
    expect(started.activityId).toBe("a_1");
    expect(handler.mock.calls[4][0]).toBe("/api/classrooms/c_1/activities");
    expect(JSON.parse(handler.mock.calls[4][1].body as string)).toEqual({ topicId: "t_1", mode: "live" });
  });

  test("finishActivity: POST 204 with no body", async () => {
    handler.mockReturnValue(new Response(null, { status: 204 }));
    await expect(httpApi.finishActivity("a_1")).resolves.toBeUndefined();
    const [path, init] = handler.mock.calls[0];
    expect(path).toBe("/api/activities/a_1/finish");
    expect(init.method).toBe("POST");
  });

  test("login and logout announce the session change for cross-tab sync", async () => {
    handler.mockImplementation((path) => {
      if (path === "/api/auth/login") return json({ id: "u1", name: "小明", isAdmin: false });
      return new Response(null, { status: 204 });
    });
    localStorage.removeItem("socrates_session_changed");
    await httpApi.login("a@b.co", "password123");
    expect(localStorage.getItem("socrates_session_changed")).not.toBeNull();
    localStorage.removeItem("socrates_session_changed");
    await httpApi.logout();
    expect(localStorage.getItem("socrates_session_changed")).not.toBeNull();
  });

  test("logout clears the term history and activity leftovers", async () => {
    handler.mockReturnValue(new Response(null, { status: 204 }));
    localStorage.setItem("socrates_terms", JSON.stringify([{ term: "正義", at: "2026-11-21T00:00:00.000Z" }]));
    localStorage.setItem("socrates_activity", "a_1");
    await httpApi.logout();
    expect(localStorage.getItem("socrates_terms")).toBeNull();
    expect(localStorage.getItem("socrates_activity")).toBeNull();
  });

  test("meOf treats an identity failure as logged out and caches success", async () => {
    handler.mockReturnValue(json({ message: "壞了", code: "internal_error" }, 500));
    const failing = new QueryClient();
    expect(await meOf(failing)).toBeNull();

    handler.mockReturnValue(json({ id: "u1", name: "小明", isAdmin: false }));
    const client = new QueryClient();
    expect((await meOf(client))?.id).toBe("u1");
    handler.mockClear();
    await meOf(client);
    expect(handler).toHaveBeenCalledTimes(0);
    failing.clear();
    client.clear();
  });

  test("authProviders and notifications hit their read endpoints", async () => {
    handler.mockImplementation((path) => {
      if (path === "/api/auth/providers") return json({ providers: ["google"] });
      return json({
        items: [{ id: "n1", title: "維護公告", body: "", createdAt: "2026-01-01T00:00:00.000Z" }],
        unread: null,
      });
    });
    const providers = await httpApi.authProviders();
    expect(providers.providers).toEqual(["google"]);
    expect(handler.mock.calls[0][0]).toBe("/api/auth/providers");

    const feed = await httpApi.notifications();
    expect(feed.items[0].title).toBe("維護公告");
    expect(feed.unread).toBeNull();
    expect(handler.mock.calls[1][0]).toBe("/api/notifications");
  });

  test("signup posts the consented account and announces the session", async () => {
    handler.mockReturnValue(json({ id: "u2", name: "小明", isAdmin: false }, 201));
    localStorage.removeItem("socrates_session_changed");
    const user = await httpApi.signup({
      name: "小明",
      email: "new@example.com",
      password: "password123",
      tosAccepted: true,
    });
    expect(user.id).toBe("u2");
    const [path, init] = handler.mock.calls[0];
    expect(path).toBe("/api/auth/signup");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({
      name: "小明",
      email: "new@example.com",
      password: "password123",
      tosAccepted: true,
    });
    expect(localStorage.getItem("socrates_session_changed")).not.toBeNull();
  });

  test("signup surfaces email_taken as an ApiError", async () => {
    handler.mockReturnValue(json({ message: "這個 Email 已經註冊過。", code: "email_taken" }, 409));
    await expect(
      httpApi.signup({ name: "小明", email: "dup@example.com", password: "password123", tosAccepted: true }),
    ).rejects.toMatchObject({ code: "email_taken" });
  });

  test("teacher key model delete resolves on a 204 with an empty body", async () => {
    handler.mockReturnValue(new Response(null, { status: 204 }));
    await expect(httpApi.deleteTeacherKeyModel("openai", "gpt-4o")).resolves.toBeUndefined();
    const [path, init] = handler.mock.calls[0];
    expect(path).toBe("/api/settings/keys/openai/models/gpt-4o");
    expect(init.method).toBe("DELETE");
  });

  test("teacher key model delete encodes a model id that contains a slash", async () => {
    handler.mockReturnValue(new Response(null, { status: 204 }));
    await httpApi.deleteTeacherKeyModel("openrouter", "anthropic/claude-haiku-4.5");
    expect(handler.mock.calls[0][0]).toBe("/api/settings/keys/openrouter/models/anthropic%2Fclaude-haiku-4.5");
  });

  test("activityInfo serializes the optional participantId without residue", async () => {
    handler.mockImplementation(() =>
      json({
        id: "a_1",
        classroomId: "c_1",
        classroomName: "X",
        participantId: null,
        mode: "live",
        topic: { id: "t_1", title: "T", statement: "S", prompts: [] },
        finishedAt: null,
      }),
    );
    await httpApi.activityInfo("a_1");
    expect(handler.mock.calls[0][0]).toBe("/api/activities/a_1");
    await httpApi.activityInfo("a_1", "p_9");
    expect(handler.mock.calls[1][0]).toBe("/api/activities/a_1?participantId=p_9");
  });

  test("createActivitySlots passes the count through unclamped (the server owns the 1-6 bounds)", async () => {
    handler.mockImplementation(() => json({ activityId: "a_1", mode: "test", maxSlots: 6, slots: [] }));
    await httpApi.createActivitySlots("a_1", 9);
    const [path, init] = handler.mock.calls[0];
    expect(path).toBe("/api/activities/a_1/slots");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ count: 9 });
  });
});

import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { setLocale } from "@/i18n";
import { onExpression } from "@/lib/companion";

vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));

const agent = vi.hoisted(() => ({ options: null as null | { onMessage?: (event: { data: unknown }) => void } }));
vi.mock("agents/react", () => ({
  useAgent: (options: { enabled?: boolean; onMessage?: (event: { data: unknown }) => void }) => {
    if (options.enabled !== false) agent.options = options;
    return {
      send: () => {},
      readyState: 0,
      OPEN: 1,
      addEventListener: () => {},
      removeEventListener: () => {},
    };
  },
}));

function emitView(entries: object[]) {
  agent.options?.onMessage?.({
    data: JSON.stringify({ type: "view", view: { conversation: { id: 1 }, entries, docs: {} } }),
  });
}

const topic = {
  id: "topic-1",
  title: "Invitation topic",
  statement: "Discuss justice",
  summary: "A dilemma",
  prompts: [],
};
const history = [
  {
    id: 1,
    conversationId: "c1",
    kind: "pi.user",
    model: [{ role: "user", content: "My saved question" }],
  },
  {
    id: 2,
    conversationId: "c1",
    kind: "pi.assistant",
    model: [{ role: "assistant", content: [{ type: "text", text: "The saved reply" }] }],
  },
];

beforeEach(() => {
  localStorage.clear();
  setLocale("en");
  agent.options = null;
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const responses: Record<string, unknown> = {
        "/api/me": { id: "student-1", name: "Student", isAdmin: false },
        "/api/join/abcdef": { code: "abcdef", classroomName: "Class", topic },
        "/api/activities/activity-1": {
          id: "activity-1",
          classroomId: "class-1",
          classroomName: "Class",
          participantId: "p_1",
          mode: "live",
          topic,
          finishedAt: null,
        },
        "/api/topics": [topic],
      };
      if (path === "/socrates.glb") return new Response(new Uint8Array());
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), { headers: { "Content-Type": "application/json" } });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

const liveActivity = {
  id: "activity-1",
  classroomId: "class-1",
  classroomName: "Class",
  participantId: "p_1",
  mode: "live",
  topic,
  finishedAt: null,
};

function roomSummary(role: "teacher" | "student") {
  return {
    id: "class-1",
    name: "Class",
    role,
    teacherName: "Teacher",
    memberCount: 3,
    code: role === "teacher" ? "abcdef" : null,
    url: role === "teacher" ? "http://localhost/join/abcdef" : null,
    current: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

async function loadPath(url: string, responses: Record<string, unknown>, statuses: Record<string, number> = {}) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), {
        status: statuses[path] ?? 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [url] }),
    context: { queryClient: client },
  });
  await router.load();
  const path = router.state.location.pathname;
  client.clear();
  return path;
}

async function mountRoute(url: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [url] }),
    context: { queryClient: client },
  });
  await router.load();
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return () => {
    cleanup();
    client.clear();
  };
}

test("F01: a signed-out visitor picks guest and gets the name field and required consent", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const responses: Record<string, unknown> = {
        "/api/me": null,
        "/api/join/abcdef": { code: "abcdef", classroomName: "Class", topic },
      };
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), { headers: { "Content-Type": "application/json" } });
    }),
  );
  const dispose = await mountRoute("/join/abcdef");
  try {
    expect(await screen.findByRole("heading", { name: "Invitation topic" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Your name" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Join as a guest/ }));
    expect(await screen.findByRole("textbox", { name: "Your name" })).toBeTruthy();
    expect(screen.getByRole("checkbox")).toHaveProperty("checked", false);
    expect(screen.getByRole("button", { name: "Start the dialogue" })).toBeTruthy();
  } finally {
    dispose();
    vi.unstubAllGlobals();
  }
});

test("F01b: a signed-in user joins under their account name without retyping it", async () => {
  const dispose = await mountRoute("/join/abcdef");
  try {
    expect(await screen.findByText(/You'll join as/)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Your name" })).toBeNull();
    expect(screen.getByRole("button", { name: "Sign out and switch account" })).toBeTruthy();
    expect(screen.getByRole("checkbox")).toHaveProperty("checked", false);
  } finally {
    dispose();
  }
});

test("F03: real dialogue route restores the user bubble rather than an assistant bubble", async () => {
  const dispose = await mountRoute("/dialogue?activityId=activity-1");
  try {
    await waitFor(() => expect(agent.options).not.toBeNull());
    emitView(history);
    const question = await screen.findByText("My saved question");
    await screen.findByText("The saved reply");
    await waitFor(() => expect(question.closest(".flex-row-reverse")).not.toBeNull());
    expect(screen.getByText("The saved reply").closest(".flex-row-reverse")).toBeNull();
  } finally {
    dispose();
  }
});

test("#90: an emotion already in the loaded history does not replay an expression", async () => {
  const heard: Array<string | null> = [];
  const stop = onExpression((name) => heard.push(name));
  const dispose = await mountRoute("/dialogue?activityId=activity-1");
  try {
    await waitFor(() => expect(agent.options).not.toBeNull());
    emitView([
      ...history,
      {
        id: 3,
        conversationId: "c1",
        kind: "app.emotion",
        data: { emotion: "happy", confidence: 0.9, probabilities: { happy: 0.9 } },
      },
    ]);
    await screen.findByText("The saved reply");
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(heard).toEqual([]);
  } finally {
    stop();
    dispose();
  }
});

test("t.setup: create classroom → add an AI topic → start the activity", async () => {
  const generatedTopic = {
    id: "gen_123_0",
    title: "Generated topic",
    statement: "A generated dilemma",
    prompts: ["Why?"],
  };
  const persisted = { ...generatedTopic, id: "topic-persisted", classroomId: "class-9" };
  const activity = {
    classroomId: "class-9",
    code: "code999",
    url: "http://localhost/join/code999",
    activityId: "activity-9",
    mode: "live",
  };
  const calls: Array<{ path: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (init?.method === "POST" && path !== "/api/topics/generate") {
        calls.push({ path, body: JSON.parse(String(init.body)) });
      }
      const topicAdded = calls.some((call) => call.path === "/api/classrooms/class-9/topics");
      const responses: Record<string, unknown> = {
        "/api/me": { id: "teacher-1", name: "Teacher", isAdmin: false },
        "/api/topics": [topic],
        "/api/topics/generate": [generatedTopic],
        "/api/classrooms": { classroomId: "class-9", code: "code999", url: "http://localhost/join/code999" },
        "/api/classrooms/class-9/topics": topicAdded ? [persisted] : [],
        "/api/classrooms/class-9/activities": activity,
      };
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), {
        status: init?.method === "POST" && path !== "/api/topics/generate" ? 201 : 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const dispose = await mountRoute("/t/setup");
  try {
    fireEvent.change(await screen.findByRole("textbox", { name: "Classroom name" }), {
      target: { value: "My class" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create classroom" }));
    await screen.findByText(/Classroom created/);

    fireEvent.click(await screen.findByRole("tab", { name: "AI generate" }));
    const direction = await screen.findByPlaceholderText("Topic direction");
    fireEvent.change(direction, { target: { value: "justice" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.click(await screen.findByRole("button", { name: "Add to topics" }));

    fireEvent.click(await screen.findByRole("button", { name: /Generated topic/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start activity" }));
    await screen.findByText("Activity ready");

    expect(calls.map((call) => call.path)).toEqual([
      "/api/classrooms",
      "/api/classrooms/class-9/topics",
      "/api/classrooms/class-9/activities",
    ]);
    expect(calls[0]!.body).toEqual({ name: "My class" });
    expect(calls[1]!.body).toMatchObject({ title: "Generated topic", statement: "A generated dilemma" });
    expect(calls[2]!.body).toMatchObject({ topicId: "topic-persisted", mode: "live" });
  } finally {
    dispose();
  }
});

test("t.live: a classroom member who is not the owner is redirected to the classroom", async () => {
  const path = await loadPath("/t/live/activity-1", {
    "/api/me": { id: "student-1", name: "Student", isAdmin: false },
    "/api/activities/activity-1": liveActivity,
    "/api/classrooms": [roomSummary("student")],
  });
  expect(path).toBe("/classrooms/class-1");
});

test("t.live: the classroom owner stays on the live page", async () => {
  const path = await loadPath("/t/live/activity-1", {
    "/api/me": { id: "teacher-1", name: "Teacher", isAdmin: false },
    "/api/activities/activity-1": liveActivity,
    "/api/classrooms": [roomSummary("teacher")],
  });
  expect(path).toBe("/t/live/activity-1");
});

test("t.live: a non-member is redirected to the classroom list", async () => {
  const path = await loadPath(
    "/t/live/activity-1",
    {
      "/api/me": { id: "student-1", name: "Student", isAdmin: false },
      "/api/activities/activity-1": { code: "forbidden" },
    },
    { "/api/activities/activity-1": 403 },
  );
  expect(path).toBe("/classrooms");
});

test("join error surfaces the code-specific message (ApiError from @/api, not shared)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/me") {
        return new Response("null", { headers: { "Content-Type": "application/json" } });
      }
      if (path === "/api/join/abcdef") {
        return new Response(JSON.stringify({ code: "abcdef", classroomName: "Class", topic }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path === "/api/join" && init?.method === "POST") {
        return new Response(JSON.stringify({ message: "name_taken", code: "name_taken" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  const dispose = await mountRoute("/join/abcdef");
  try {
    fireEvent.click(await screen.findByRole("button", { name: /Join as a guest/ }));
    const name = await screen.findByRole("textbox", { name: "Your name" });
    fireEvent.change(name, { target: { value: "Late Joiner" } });
    const consent = screen.getByRole("checkbox");
    fireEvent.click(consent);
    const submit = screen.getByRole("button", { name: "Start the dialogue" });
    await waitFor(() => expect(submit).toHaveProperty("disabled", false));
    fireEvent.click(submit);
    expect(await screen.findByText(/already taken/)).toBeTruthy();
  } finally {
    dispose();
  }
});

test("#181: a failing identity check on /home redirects to login instead of erroring", async () => {
  const path = await loadPath("/home", { "/api/me": { message: "壞了", code: "internal_error" } }, { "/api/me": 500 });
  expect(path).toBe("/login");
});

function stubStoaObservers() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

test("#178: the colonnade login page renders provider buttons from the probe and no demo or guest entry", async () => {
  stubStoaObservers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const responses: Record<string, unknown> = {
        "/api/me": null,
        "/api/auth/providers": { providers: ["google", "facebook"] },
        "/api/notifications": {
          items: [{ id: "n1", title: "Maintenance window", body: "", createdAt: "2026-01-01T00:00:00.000Z" }],
          unread: null,
        },
      };
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), { headers: { "Content-Type": "application/json" } });
    }),
  );
  const dispose = await mountRoute("/login");
  try {
    expect(await screen.findByRole("heading", { name: "Sign in" })).toBeTruthy();
    expect((await screen.findByRole("link", { name: "Sign in with Google" })).getAttribute("href")).toBe(
      "/api/auth/oauth/google/start",
    );
    expect(screen.getByRole("link", { name: "Sign in with Facebook" }).getAttribute("href")).toBe(
      "/api/auth/oauth/facebook/start",
    );
    expect(screen.getByRole("link", { name: "Back to the story" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Forgot password?" }).getAttribute("href")).toBe("/forgot-password");
    expect(screen.getByLabelText("Have an invite code?")).toBeTruthy();
    expect(screen.getByText("Maintenance window")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue as guest" })).toBeNull();
    expect(screen.queryByRole("button", { name: /demo teacher/ })).toBeNull();
  } finally {
    dispose();
    vi.unstubAllGlobals();
  }
});

test("#178: an unconfigured probe disables the buttons and a failed feed hides the notice bar", async () => {
  stubStoaObservers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const status = path === "/api/notifications" ? 401 : 200;
      const responses: Record<string, unknown> = {
        "/api/me": null,
        "/api/auth/providers": { providers: [] },
        "/api/notifications": { message: "unauthorized", code: "unauthorized" },
      };
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), {
        status,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const dispose = await mountRoute("/login");
  try {
    expect(await screen.findByRole("button", { name: "Sign in with Google · Not configured" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign in with Facebook · Not configured" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByText("Announcements")).toBeNull());
  } finally {
    dispose();
    vi.unstubAllGlobals();
  }
});

test("#178: a signed-in admin landing on /login is redirected to the admin console", async () => {
  const path = await loadPath("/login", { "/api/me": { id: "admin-1", name: "Admin", isAdmin: true } });
  expect(path).toBe("/admin");
});

test("#178: register mode gates the account form on name, email, password, and consent", async () => {
  stubStoaObservers();
  const calls: Array<{ path: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (init?.method === "POST") calls.push({ path, body: JSON.parse(String(init.body)) });
      const responses: Record<string, unknown> = {
        "/api/me": null,
        "/api/auth/providers": { providers: [] },
        "/api/notifications": { items: [], unread: null },
        "/api/auth/signup": { id: "user-9", name: "New User", isAdmin: false },
      };
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), {
        status: init?.method === "POST" ? 201 : 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const dispose = await mountRoute("/login?mode=register");
  try {
    const submit = await screen.findByRole("button", { name: "Create account" });
    expect(submit).toHaveProperty("disabled", true);
    fireEvent.change(screen.getByRole("textbox", { name: "Display name" }), { target: { value: "New User" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "new@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    expect(submit).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("checkbox"));
    expect(submit).toHaveProperty("disabled", false);
    fireEvent.click(submit);
    await waitFor(() =>
      expect(calls).toEqual([
        {
          path: "/api/auth/signup",
          body: { name: "New User", email: "new@example.com", password: "password123", tosAccepted: true },
        },
      ]),
    );
  } finally {
    dispose();
    vi.unstubAllGlobals();
  }
});

test("#243 review: a signed-out /dialogue without an activity redirects straight to login", async () => {
  const path = await loadPath("/dialogue", { "/api/me": null });
  expect(path).toBe("/login");
});

test("#243 review: a signed-in join hitting name_taken shows account guidance, not the pick-another-name hint", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const me = { id: "student-1", name: "Student", isAdmin: false };
      if (path === "/api/me") {
        return new Response(JSON.stringify(me), { headers: { "Content-Type": "application/json" } });
      }
      if (path === "/api/join/abcdef") {
        return new Response(JSON.stringify({ code: "abcdef", classroomName: "Class", topic }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path === "/api/join" && init?.method === "POST") {
        return new Response(JSON.stringify({ message: "name_taken", code: "name_taken" }), {
          status: 409,
          headers: { "Content-Type": "application/json" },
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  const dispose = await mountRoute("/join/abcdef");
  try {
    expect(await screen.findByText(/You'll join as/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Start the dialogue" }));
    expect(await screen.findByText(/switch accounts/i)).toBeTruthy();
    expect(screen.queryByText(/already taken — pick another/i)).toBeNull();
  } finally {
    dispose();
    vi.unstubAllGlobals();
  }
});

test("#243 review: a signed-in join still reaches home when fetching the activity fails", async () => {
  const me = { id: "student-1", name: "Student", isAdmin: false };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/me") {
        return new Response(JSON.stringify(me), { headers: { "Content-Type": "application/json" } });
      }
      if (path === "/api/join/abcdef") {
        return new Response(JSON.stringify({ code: "abcdef", classroomName: "Class", topic }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path === "/api/join" && init?.method === "POST") {
        return new Response(
          JSON.stringify({ user: me, activityId: "activity-1", participantId: "p_2", kind: "member" }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (path === "/api/activities/activity-1") {
        return new Response(JSON.stringify({ message: "壞了", code: "internal_error" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (path === "/api/classrooms") {
        return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
      }
      if (path === "/socrates.glb") return new Response(new Uint8Array());
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/join/abcdef"] }),
    context: { queryClient: client },
  });
  await router.load();
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  try {
    expect(await screen.findByText(/You'll join as/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Start the dialogue" }));
    await waitFor(() => expect(router.state.location.pathname).toBe("/home"));
    expect(screen.queryByRole("alert")).toBeNull();
  } finally {
    cleanup();
    client.clear();
    vi.unstubAllGlobals();
  }
});

test("F01c: a signed-in join posts without a name", async () => {
  let joinBody: Record<string, unknown> | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const me = { id: "student-1", name: "Student", isAdmin: false };
      const responses: Record<string, unknown> = {
        "/api/me": me,
        "/api/join/abcdef": { code: "abcdef", classroomName: "Class", topic },
        "/api/activities/activity-1": {
          id: "activity-1",
          classroomId: "class-1",
          classroomName: "Class",
          participantId: "p_2",
          mode: "live",
          topic,
          finishedAt: null,
        },
      };
      if (path === "/api/join" && init?.method === "POST") {
        joinBody = JSON.parse(init.body as string);
        return new Response(
          JSON.stringify({ user: me, activityId: "activity-1", participantId: "p_2", kind: "member" }),
          { headers: { "Content-Type": "application/json" } },
        );
      }
      if (path === "/api/classrooms")
        return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
      if (path === "/api/classrooms/class-1/topics")
        return new Response(JSON.stringify([]), { headers: { "Content-Type": "application/json" } });
      if (path === "/socrates.glb") return new Response(new Uint8Array());
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), { headers: { "Content-Type": "application/json" } });
    }),
  );
  const dispose = await mountRoute("/join/abcdef");
  try {
    expect(await screen.findByText(/You'll join as/)).toBeTruthy();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Start the dialogue" }));
    await waitFor(() => expect(joinBody).not.toBeNull());
    expect(joinBody).toMatchObject({ code: "abcdef", tosAccepted: true });
    expect(joinBody).not.toHaveProperty("name");
  } finally {
    dispose();
    vi.unstubAllGlobals();
  }
});

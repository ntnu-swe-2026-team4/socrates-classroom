import type { ReactNode } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { activityLiveOptions } from "@/api/queries";
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
      if (path.endsWith("socrates.glb")) return new Response(new Uint8Array());
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

async function loadLocation(url: string, responses: Record<string, unknown>, statuses: Record<string, number> = {}) {
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
  const location = router.state.location;
  client.clear();
  return location;
}

async function loadPath(url: string, responses: Record<string, unknown>, statuses: Record<string, number> = {}) {
  return (await loadLocation(url, responses, statuses)).pathname;
}

async function mountRoute(url: string, client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
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

test("#185: a signed-in teacher creates a classroom inline from the index and lands on its page", async () => {
  const created: Array<{ path: string; body: unknown }> = [];
  let createdRoom = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/classrooms" && init?.method === "POST") {
        created.push({ path, body: JSON.parse(String(init.body)) });
        createdRoom = true;
        return new Response(
          JSON.stringify({ classroomId: "class-9", code: "code999", url: "http://localhost/join/code999" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      const room = {
        id: "class-9",
        name: "My class",
        role: "teacher",
        teacherName: "Teacher",
        memberCount: 1,
        code: "code999",
        url: "http://localhost/join/code999",
        current: null,
        createdAt: "2026-01-01T00:00:00.000Z",
      };
      const responses: Record<string, unknown> = {
        "/api/me": { id: "teacher-1", name: "Teacher", isAdmin: false },
        "/api/classrooms": createdRoom ? [room] : [],
        "/api/classrooms/class-9/activities": { items: [], nextCursor: null },
        "/api/classrooms/class-9/topics": [],
        "/api/config": { reportAxes: "ai" },
        "/api/topics": [],
      };
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), { headers: { "Content-Type": "application/json" } });
    }),
  );
  const dispose = await mountRoute("/classrooms");
  try {
    fireEvent.click(await screen.findByRole("button", { name: "New class" }));
    fireEvent.change(await screen.findByRole("textbox", { name: "Classroom name" }), {
      target: { value: "My class" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Create classroom" }));
    expect(await screen.findByRole("heading", { name: "My class" })).toBeTruthy();
    expect(created.map((call) => call.body)).toEqual([{ name: "My class" }]);
  } finally {
    dispose();
    vi.unstubAllGlobals();
  }
});

test("#185: the classroom page covers the retired wizard flow: AI topic → start the activity", async () => {
  const generatedTopic = {
    id: "gen_123_0",
    title: "Generated topic",
    statement: "A generated dilemma",
    prompts: ["Why?"],
    axes: [],
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
        "/api/config": { reportAxes: "ai" },
        "/api/topics": [],
        "/api/topics/generate": [generatedTopic],
        "/api/classrooms": [
          {
            id: "class-9",
            name: "Class 9",
            role: "teacher",
            teacherName: "Teacher",
            memberCount: 3,
            code: "code999",
            url: "http://localhost/join/code999",
            current: null,
            createdAt: "2026-01-01T00:00:00.000Z",
          },
        ],
        "/api/classrooms/class-9/activities": { items: [], nextCursor: null },
        "/api/classrooms/class-9/topics": topicAdded ? [persisted] : [],
      };
      if (init?.method === "POST" && path === "/api/classrooms/class-9/activities") {
        return new Response(JSON.stringify(activity), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), {
        status: init?.method === "POST" && path !== "/api/topics/generate" ? 201 : 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
  const dispose = await mountRoute("/classrooms/class-9");
  try {
    fireEvent.click(await screen.findByRole("tab", { name: "AI generate" }));
    const direction = await screen.findByPlaceholderText("Topic direction");
    fireEvent.change(direction, { target: { value: "justice" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.click(await screen.findByRole("button", { name: /Generated topic/ }));
    fireEvent.click(screen.getByRole("button", { name: "Add to topics" }));

    const startSection = screen.getByRole("button", { name: "Start activity" }).closest("section");
    expect(startSection).not.toBeNull();
    const activitySection = within(startSection as HTMLElement);
    fireEvent.click(await activitySection.findByRole("button", { name: /Generated topic/ }));
    fireEvent.click(activitySection.getByRole("button", { name: "Start activity" }));
    await waitFor(() => expect(calls.length).toBe(2));

    expect(calls.map((call) => call.path)).toEqual([
      "/api/classrooms/class-9/topics",
      "/api/classrooms/class-9/activities",
    ]);
    expect(calls[0].body).toMatchObject({ title: "Generated topic", statement: "A generated dilemma" });
    expect(calls[1].body).toMatchObject({ topicId: "topic-persisted", mode: "live", reportAxes: "ai" });
  } finally {
    dispose();
    vi.unstubAllGlobals();
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

function stubLoginPage(login?: { status: number; code: string }) {
  stubStoaObservers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/auth/login" && login) {
        return new Response(JSON.stringify({ message: login.code, code: login.code }), {
          status: login.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      const responses: Record<string, unknown> = {
        "/api/me": null,
        "/api/auth/providers": { providers: [] },
        "/api/notifications": { items: [], unread: null },
      };
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), { headers: { "Content-Type": "application/json" } });
    }),
  );
}

test.each([
  ["account_disabled", "This account has been disabled. Please contact an administrator."],
  ["oauth_state_invalid", "The sign-in timed out. Please try signing in again."],
  ["oauth_email_unverified", "The email on this third-party account is not verified. Verify it, then sign in again."],
  ["oauth_failed", "Third-party sign-in failed. Please try again."],
])("#317: returning to /login with error=%s explains the reason", async (code, message) => {
  stubLoginPage();
  const dispose = await mountRoute(`/login?error=${code}`);
  try {
    expect((await screen.findByRole("alert")).textContent).toBe(message);
  } finally {
    dispose();
    vi.unstubAllGlobals();
  }
});

test.each([
  [403, "account_disabled", "This account has been disabled. Please contact an administrator."],
  [429, "rate_limited", "Too many attempts. Please try again later."],
  [401, "unauthorized", "Wrong email or password."],
  [500, "internal_error", "Something went wrong"],
])("#317: a password sign-in rejected with %i %s explains the reason", async (status, code, message) => {
  stubLoginPage({ status, code });
  const dispose = await mountRoute("/login");
  try {
    fireEvent.change(await screen.findByRole("textbox", { name: "Email" }), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    const submit = screen
      .getAllByRole("button", { name: "Sign in" })
      .find((button) => button.getAttribute("type") === "submit");
    if (!submit) throw new Error("submit button missing");
    fireEvent.click(submit);
    expect((await screen.findByRole("alert")).textContent).toBe(message);
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

test("#302: the login hint refers to guests instead of students across all locales", async () => {
  stubStoaObservers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const responses: Record<string, unknown> = {
        "/api/me": null,
        "/api/auth/providers": { providers: [] },
        "/api/notifications": { items: [], unread: null },
      };
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), { headers: { "Content-Type": "application/json" } });
    }),
  );
  const dispose = await mountRoute("/login");
  try {
    expect(await screen.findByText("Guests don't need an account — enter from the invite link.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "中" }));
    expect(await screen.findByText("訪客不需要帳號——從邀請連結進入即可。")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ES" }));
    expect(await screen.findByText("Los invitados no necesitan cuenta — entra desde el enlace.")).toBeTruthy();
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
      if (path.endsWith("socrates.glb")) return new Response(new Uint8Array());
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
      if (path.endsWith("socrates.glb")) return new Response(new Uint8Array());
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

function stubClassroomActivitySwitch(onInvite: (activityId: string) => Promise<Response> | Response) {
  const topicA = {
    id: "topic-a",
    classroomId: "class-1",
    title: "Topic A",
    statement: "Statement A",
    prompts: [],
    axes: [],
  };
  const topicB = {
    id: "topic-b",
    classroomId: "class-1",
    title: "Topic B",
    statement: "Statement B",
    prompts: [],
    axes: [],
  };
  let current = {
    activityId: "activity-a",
    topicId: topicA.id,
    topicTitle: topicA.title,
    topicStatement: topicA.statement,
    finished: false,
  };
  let activities = [
    {
      id: "activity-a",
      mode: "live",
      topicTitle: topicA.title,
      createdAt: "2026-01-01T00:00:00.000Z",
      finishedAt: null,
    },
  ];
  class TestSocket extends EventTarget {
    close() {}
  }
  vi.stubGlobal("WebSocket", TestSocket);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (path === "/api/me") return json({ id: "teacher-1", name: "Teacher", isAdmin: false });
      if (path === "/api/classrooms") return json([{ ...roomSummary("teacher"), current }]);
      if (path === "/api/classrooms/class-1/topics") return json([topicA, topicB]);
      if (path === "/api/topics") return json([]);
      if (path === "/api/config") return json({ reportAxes: "ai" });
      if (path === "/api/classrooms/class-1/members") {
        return json({ items: [], nextCursor: null, teacher: { id: "teacher-1", name: "Teacher" } });
      }
      if (path === "/api/classrooms/class-1/invites" && (!init?.method || init.method === "GET")) {
        return json({ items: [], nextCursor: null });
      }
      if (path === "/api/classrooms/class-1/activities" && (!init?.method || init.method === "GET")) {
        return json({ items: activities, nextCursor: null });
      }
      if (path === "/api/classrooms/class-1/activities" && init?.method === "POST") {
        current = {
          activityId: "activity-b",
          topicId: topicB.id,
          topicTitle: topicB.title,
          topicStatement: topicB.statement,
          finished: false,
        };
        activities = [
          {
            id: "activity-b",
            mode: "live",
            topicTitle: topicB.title,
            createdAt: "2026-01-02T00:00:00.000Z",
            finishedAt: null,
          },
          ...activities,
        ];
        return json(
          {
            classroomId: "class-1",
            code: "abcdef",
            url: "http://localhost/join/abcdef",
            activityId: "activity-b",
            mode: "live",
          },
          201,
        );
      }
      if (path === "/api/classrooms/class-1/invites" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { activityId?: string };
        if (!body.activityId) throw new Error("Expected activityId in classroom invite payload");
        return await onInvite(body.activityId);
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
}

test("#314: starting a new live activity on the classroom page resets the activity invite card", async () => {
  const inviteCalls: string[] = [];
  stubClassroomActivitySwitch((activityId) => {
    inviteCalls.push(activityId);
    const token = activityId === "activity-a" ? "tok-a" : "tok-b";
    return new Response(
      JSON.stringify({
        id: `iv_${token}`,
        classroomId: "class-1",
        activityId,
        scope: "activity_guest",
        token,
        url: `/join/i/${token}`,
        createdAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-12-01T00:00:00.000Z",
        revokedAt: null,
      }),
      { status: 201, headers: { "Content-Type": "application/json" } },
    );
  });
  const dispose = await mountRoute("/classrooms/class-1?tab=members");
  try {
    const scope = await screen.findByLabelText("Invitation type");
    fireEvent.change(scope, { target: { value: "activity_guest" } });
    const create = screen.getByRole("button", { name: "Create an invite link" });
    await waitFor(() => expect(create).toHaveProperty("disabled", false));
    fireEvent.click(create);
    expect(await screen.findByText(/\/join\/i\/tok-a/)).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Topics" }));
    expect(await screen.findByRole("heading", { name: "Topic A" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Topic B/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start activity" }));
    expect(await screen.findByRole("heading", { name: "Topic B" })).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Members" }));
    fireEvent.change(await screen.findByLabelText("Invitation type"), { target: { value: "activity_guest" } });
    const nextCreate = screen.getByRole("button", { name: "Create an invite link" });
    await waitFor(() => expect(nextCreate).toHaveProperty("disabled", false));
    expect(screen.queryByText(/\/join\/i\/tok-a/)).toBeNull();
    fireEvent.click(nextCreate);
    expect(await screen.findByText(/\/join\/i\/tok-b/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Activity"), { target: { value: "activity-a" } });
    expect(screen.queryByText(/\/join\/i\/tok-b/)).toBeNull();
    expect(inviteCalls).toEqual(["activity-a", "activity-b"]);
  } finally {
    dispose();
    vi.unstubAllGlobals();
  }
});

test("#314: an in-flight invite creation for the previous activity does not populate the new activity card", async () => {
  const pending: { resolve: ((response: Response) => void) | null } = { resolve: null };
  stubClassroomActivitySwitch((activityId) => {
    if (activityId !== "activity-a") throw new Error(`Unexpected invite activity: ${activityId}`);
    return new Promise<Response>((resolve) => {
      pending.resolve = resolve;
    });
  });
  const dispose = await mountRoute("/classrooms/class-1?tab=members");
  try {
    fireEvent.change(await screen.findByLabelText("Invitation type"), { target: { value: "activity_guest" } });
    const create = screen.getByRole("button", { name: "Create an invite link" });
    await waitFor(() => expect(create).toHaveProperty("disabled", false));
    fireEvent.click(create);
    await waitFor(() => expect(pending.resolve).not.toBeNull());

    fireEvent.click(screen.getByRole("link", { name: "Topics" }));
    expect(await screen.findByRole("heading", { name: "Topic A" })).toBeTruthy();
    fireEvent.click(await screen.findByRole("button", { name: /Topic B/ }));
    fireEvent.click(screen.getByRole("button", { name: "Start activity" }));
    expect(await screen.findByRole("heading", { name: "Topic B" })).toBeTruthy();

    fireEvent.click(screen.getByRole("link", { name: "Members" }));
    fireEvent.change(await screen.findByLabelText("Invitation type"), { target: { value: "activity_guest" } });
    const nextCreate = screen.getByRole("button", { name: "Create an invite link" });
    await waitFor(() => expect(nextCreate).toHaveProperty("disabled", false));

    pending.resolve?.(
      new Response(
        JSON.stringify({
          id: "iv_tok-a",
          classroomId: "class-1",
          activityId: "activity-a",
          scope: "activity_guest",
          token: "tok-a",
          url: "/join/i/tok-a",
          createdAt: "2026-01-01T00:00:00.000Z",
          expiresAt: "2026-12-01T00:00:00.000Z",
          revokedAt: null,
        }),
        { status: 201, headers: { "Content-Type": "application/json" } },
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(screen.queryByText(/\/join\/i\/tok-a/)).toBeNull();
    expect(nextCreate).toHaveProperty("disabled", false);
  } finally {
    dispose();
    vi.unstubAllGlobals();
  }
});

test("#182: prioritizes flags, pages a large roster, and searches all students", async () => {
  const user = userEvent.setup();
  const asOf = "2026-11-23T01:00:00.000Z";
  const students = Array.from({ length: 1000 }, (_, index) => ({
    id: String(index),
    name: `Student ${String(index).padStart(4, "0")}`,
    status: index === 999 ? "active" : "not_started",
    rounds: index === 999 ? 2 : 0,
    lastActiveAt: index === 999 ? asOf : null,
    flags: index === 999 ? [{ id: "1", type: "coding" }] : [],
  }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const responses: Record<string, unknown> = {
        "/api/me": { id: "teacher-1", name: "Teacher", isAdmin: false },
        "/api/activities/activity-1": liveActivity,
        "/api/classrooms": [roomSummary("teacher")],
        "/api/activities/activity-1/live": { activityId: "activity-1", asOf, finishedAt: null, students },
      };
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return Response.json(responses[path]);
    }),
  );
  const dispose = await mountRoute("/t/live/activity-1");
  try {
    const table = await screen.findByRole("table", { name: "Live student roster" });
    const firstPage = within(table).getAllByRole("row");
    expect(firstPage).toHaveLength(51);
    expect(firstPage[1].textContent).toContain("Student 0999");
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(within(table).queryByText("Student 0999")).toBeNull();
    await user.type(screen.getByRole("searchbox", { name: "Search students" }), "0842");
    expect(within(table).getAllByRole("row")).toHaveLength(2);
    expect(within(table).getByText("Student 0842")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Finish & view report" }));
    const dialog = await screen.findByRole("alertdialog", { name: "End this activity?" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("alertdialog")).toBeNull();
  } finally {
    dispose();
  }
});

test("#182: announces only new flags and hides the roster after permission is revoked", async () => {
  const user = userEvent.setup();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  const options = activityLiveOptions("activity-1");
  const asOf = "2026-11-23T01:00:00.000Z";
  let flag = "1";
  let responseStatus = 200;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/activities/activity-1/live" && responseStatus !== 200) {
        const code = responseStatus === 401 ? "unauthorized" : responseStatus === 403 ? "forbidden" : "internal_error";
        return Response.json({ code }, { status: responseStatus });
      }
      const responses: Record<string, unknown> = {
        "/api/me": { id: "teacher-1", name: "Teacher", isAdmin: false },
        "/api/activities/activity-1": liveActivity,
        "/api/classrooms": [roomSummary("teacher")],
        "/api/activities/activity-1/live": {
          activityId: "activity-1",
          asOf,
          finishedAt: null,
          students: [
            {
              id: "student",
              name: "Student",
              status: "active",
              rounds: 1,
              lastActiveAt: asOf,
              flags: [{ id: flag, type: "coding" }],
            },
          ],
        },
      };
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return Response.json(responses[path]);
    }),
  );
  const dispose = await mountRoute("/t/live/activity-1", client);
  try {
    expect(await screen.findByRole("rowheader", { name: "Student" })).toBeTruthy();
    expect(screen.queryByText("New flags: 1")).toBeNull();
    flag = "2";
    await act(() => client.refetchQueries({ queryKey: options.queryKey }));
    expect(await screen.findByText("New flags: 1")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    await act(() => client.refetchQueries({ queryKey: options.queryKey }));
    expect(screen.queryByText("New flags: 1")).toBeNull();
    responseStatus = 500;
    await act(() => client.refetchQueries({ queryKey: options.queryKey }));
    expect(await screen.findByText(/Updates unavailable/)).toBeTruthy();
    expect(screen.getByRole("rowheader", { name: "Student" })).toBeTruthy();
    responseStatus = 401;
    await act(() => client.refetchQueries({ queryKey: options.queryKey }));
    const expiredAlert = await screen.findByRole("alert");
    expect(expiredAlert.textContent).toContain("Your session has expired");
    expect(within(expiredAlert).getByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("rowheader", { name: "Student" })).toBeNull();
    responseStatus = 403;
    await act(() => client.refetchQueries({ queryKey: options.queryKey }));
    const forbiddenAlert = await screen.findByRole("alert");
    expect(forbiddenAlert.textContent).toContain("You can’t view the roster for this activity.");
    expect(within(forbiddenAlert).queryByRole("link", { name: "Sign in" })).toBeNull();
    expect(screen.queryByRole("rowheader", { name: "Student" })).toBeNull();
  } finally {
    dispose();
  }
});

function stubTestActivitySlots(
  initialSlots: Array<{ id: string; name: string; rounds: number; lastUtterance: string | null }>,
) {
  let slots = [...initialSlots];
  const createCounts: number[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/activities/activity-1/slots" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { count: number };
        createCounts.push(body.count);
        for (let i = 0; i < body.count; i += 1) {
          const index = slots.length + 1;
          slots = [...slots, { id: `slot-${index}`, name: `Test ${index}`, rounds: 0, lastUtterance: null }];
        }
        return new Response(JSON.stringify({ activityId: "activity-1", mode: "test", maxSlots: 6, slots }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      const responses: Record<string, unknown> = {
        "/api/me": { id: "teacher-1", name: "Teacher", isAdmin: false },
        "/api/activities/activity-1": { ...liveActivity, mode: "test" },
        "/api/classrooms": [roomSummary("teacher")],
        "/api/activities/activity-1/slots": { activityId: "activity-1", mode: "test", maxSlots: 6, slots },
      };
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), { headers: { "Content-Type": "application/json" } });
    }),
  );
  return createCounts;
}

test("#303: t.live test-slot count input can be cleared with Backspace and retyped to submit", async () => {
  const user = userEvent.setup();
  const createCounts = stubTestActivitySlots([]);
  const dispose = await mountRoute("/t/live/activity-1");
  try {
    const input = (await screen.findByRole("spinbutton", { name: "How many to add" })) as HTMLInputElement;
    const submit = screen.getByRole("button", { name: "Add test dialogues" });
    await waitFor(() => expect(submit).toHaveProperty("disabled", false));
    expect(input.value).toBe("1");

    await user.click(input);
    await user.keyboard("{Backspace}");
    expect(input.value).toBe("");
    expect(submit).toHaveProperty("disabled", true);
    expect(screen.queryByRole("alert")).toBeNull();

    await user.keyboard("3");
    expect(input.value).toBe("3");
    expect(submit).toHaveProperty("disabled", false);
    expect(screen.getByText("After adding: 3 student analyses in the report")).toBeTruthy();

    await user.click(submit);
    await waitFor(() => expect(createCounts).toEqual([3]));
    await waitFor(() => expect(input.value).toBe("1"));
    expect(await screen.findByText("Test 3")).toBeTruthy();
  } finally {
    dispose();
  }
});

test("#303: t.live test-slot count input rejects out-of-range and non-integer values with inline guidance", async () => {
  const user = userEvent.setup();
  const createCounts = stubTestActivitySlots([
    { id: "slot-1", name: "Test 1", rounds: 0, lastUtterance: null },
    { id: "slot-2", name: "Test 2", rounds: 0, lastUtterance: null },
  ]);
  const dispose = await mountRoute("/t/live/activity-1");
  try {
    const input = (await screen.findByRole("spinbutton", { name: "How many to add" })) as HTMLInputElement;
    const submit = screen.getByRole("button", { name: "Add test dialogues" });
    await waitFor(() => expect(submit).toHaveProperty("disabled", false));

    await user.clear(input);
    await user.type(input, "5");
    expect(input.value).toBe("5");
    expect(submit).toHaveProperty("disabled", true);
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByRole("alert").textContent).toContain("4");

    await user.clear(input);
    await user.type(input, "0");
    expect(input.value).toBe("0");
    expect(submit).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toContain("4");

    await user.clear(input);
    await user.type(input, "1.5");
    expect(input.value).toBe("1.5");
    expect(submit).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toContain("4");

    await user.clear(input);
    await user.type(input, "2{Enter}");
    await waitFor(() => expect(createCounts).toEqual([2]));
    expect(screen.queryByRole("alert")).toBeNull();
  } finally {
    dispose();
  }
});

function stubFailedReport(options: { rooms: Array<ReturnType<typeof roomSummary>> | null; activityError?: boolean }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (path === "/api/me") return json({ id: "user-1", name: "User", isAdmin: false });
      if (path === "/api/activities/activity-1/report") {
        return json(
          {
            code: "report_failed",
            message: "Report generation failed. Finish the activity again to retry.",
          },
          500,
        );
      }
      if (path === "/api/activities/activity-1") {
        if (options.activityError) return json({ code: "internal_error", message: "boom" }, 500);
        return json({ ...liveActivity, finishedAt: "2026-01-01T00:00:00.000Z" });
      }
      if (path === "/api/classrooms") {
        if (options.rooms === null) return json({ code: "internal_error", message: "boom" }, 500);
        return json(options.rooms);
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
}

test("#316: report_failed shows student guidance without the teacher button for a classroom student", async () => {
  stubFailedReport({
    rooms: [roomSummary("student"), { ...roomSummary("teacher"), id: "class-other" }],
  });
  const dispose = await mountRoute("/report/activity-1");
  try {
    expect(await screen.findByText("Report generation failed — ask your teacher to run it again.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByText(/Finish the activity again/i)).toBeNull();
  } finally {
    dispose();
  }
});

test("#316: report_failed shows the teacher refinish button for the classroom owner", async () => {
  stubFailedReport({ rooms: [roomSummary("teacher")] });
  const dispose = await mountRoute("/report/activity-1");
  try {
    expect(await screen.findByRole("button", { name: "Back to the session — finish again to retry" })).toBeTruthy();
    expect(screen.getByText("Report generation failed. Finish the activity again to retry.")).toBeTruthy();
    expect(screen.queryByText("Report generation failed — ask your teacher to run it again.")).toBeNull();
  } finally {
    dispose();
  }
});

test("#316: report_failed falls back to student guidance when role lookup fails", async () => {
  stubFailedReport({ rooms: null, activityError: true });
  const dispose = await mountRoute("/report/activity-1");
  try {
    expect(await screen.findByText("Report generation failed — ask your teacher to run it again.")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  } finally {
    dispose();
  }
});

test("#316: a loaded report does not fetch activity or classroom lists for the failed-report role check", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
      if (path === "/api/me") return json({ id: "student-1", name: "Student", isAdmin: false });
      if (path === "/api/activities/activity-1/report") {
        return json({
          topicTitle: topic.title,
          participantName: "Student",
          pseudonym: "Student",
          analysis: null,
          indicators: null,
          engagement: null,
          violations: [],
          positions: [],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  const dispose = await mountRoute("/report/activity-1");
  try {
    expect(await screen.findByRole("heading", { name: "Class report" })).toBeTruthy();
    expect(screen.getByText(topic.title)).toBeTruthy();
  } finally {
    dispose();
  }
});

const engagementFixture = {
  substance: { level: 2, turns: [1, 3], evidence: "Gives short reasons of their own" },
  uptake: { level: 0, turns: [], evidence: "" },
  focus: { level: 3, turns: [2], evidence: "Every line is about the topic" },
};

function stubTeacherReport(visibility: { classReport: boolean; student: boolean }, saveFails = false) {
  const puts: unknown[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
      if (path === "/api/me") return json({ id: "teacher-1", name: "Teacher", isAdmin: false });
      if (path === "/api/activities/activity-1/engagement-visibility" && init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        puts.push(body);
        if (saveFails) {
          return new Response(JSON.stringify({ error: { code: "internal", message: "boom" } }), { status: 500 });
        }
        return json(body);
      }
      if (path === "/api/activities/activity-1/report") {
        return json({
          topicTitle: topic.title,
          classReport: null,
          engagementVisibility: visibility,
          students: [
            {
              participantId: "p1",
              participantName: "Ana",
              pseudonym: "S1",
              analysis: null,
              indicators: null,
              engagement: engagementFixture,
              violations: [],
              positions: [],
            },
          ],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  return puts;
}

test("#267: the teacher toggles engagement sharing; both options start off", async () => {
  const puts = stubTeacherReport({ classReport: false, student: false });
  const dispose = await mountRoute("/report/activity-1");
  try {
    const own = await screen.findByRole("checkbox", { name: "Each student's own report" });
    const group = screen.getByRole("checkbox", { name: "The group report" });
    expect((own as HTMLInputElement).checked).toBe(false);
    expect((group as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByRole("table")).toBeNull();
    fireEvent.click(own);
    await waitFor(() => expect(puts).toEqual([{ classReport: false, student: true }]));
    await waitFor(() => expect((own as HTMLInputElement).checked).toBe(true));
  } finally {
    dispose();
  }
});

test("#267: a failed save shows an alert and the checkbox goes back to the stored value", async () => {
  const puts = stubTeacherReport({ classReport: false, student: false }, true);
  const dispose = await mountRoute("/report/activity-1");
  try {
    const group = await screen.findByRole("checkbox", { name: "The group report" });
    fireEvent.click(group);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(puts).toEqual([{ classReport: true, student: false }]);
    expect((group as HTMLInputElement).checked).toBe(false);
  } finally {
    dispose();
  }
});

test("#267: the group view lists engagement by pseudonym only when shared there", async () => {
  stubTeacherReport({ classReport: true, student: false });
  const dispose = await mountRoute("/report/activity-1");
  try {
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("rowheader", { name: "S1" })).toBeTruthy();
    expect(within(table).queryByText("Ana")).toBeNull();
    expect(
      within(table)
        .getAllByRole("cell")
        .map((cell) => cell.textContent),
    ).toEqual(["2/3", "0/3", "3/3"]);
  } finally {
    dispose();
  }
});

test("#267: the teacher's individual view always shows the student's engagement with lines", async () => {
  stubTeacherReport({ classReport: false, student: false });
  const dispose = await mountRoute("/report/activity-1");
  try {
    fireEvent.click(await screen.findByRole("tab", { name: "Individual" }));
    expect(await screen.findByRole("heading", { name: "Engagement" })).toBeTruthy();
    expect(screen.getByText("Gives short reasons of their own")).toBeTruthy();
    expect(screen.getByText("Line 1、3")).toBeTruthy();
    expect(screen.getByText("Not seen in this conversation")).toBeTruthy();
  } finally {
    dispose();
  }
});

test.each([
  [engagementFixture, true],
  [null, false],
])("#267: a student's own report shows engagement only when the server sends it", async (engagement, shown) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const json = (body: unknown) =>
        new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
      if (path === "/api/me") return json({ id: "student-1", name: "Student", isAdmin: false });
      if (path === "/api/activities/activity-1/report") {
        return json({
          topicTitle: topic.title,
          participantName: "Student",
          pseudonym: "S1",
          analysis: null,
          indicators: null,
          engagement,
          violations: [],
          positions: [],
        });
      }
      throw new Error(`Unexpected request: ${path}`);
    }),
  );
  const dispose = await mountRoute("/report/activity-1");
  try {
    expect(await screen.findByRole("heading", { name: "Class report" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Engagement" }) !== null).toBe(shown);
    expect(screen.queryByRole("checkbox")).toBeNull();
  } finally {
    dispose();
  }
});

test.each([
  "/report/activity-1",
  "/classrooms",
  "/classrooms/room-1?tab=members",
  "/settings?section=keys",
  "/admin",
  "/admin?tab=users",
  "/t/live/activity-1",
])("#318: a signed-out visit to %s goes to login carrying the address to return to", async (url) => {
  const location = await loadLocation(url, { "/api/me": null });
  expect(location.pathname).toBe("/login");
  expect(location.search).toMatchObject({ next: url });
});

test("#185: the console redirects non-admins away from /admin", async () => {
  const path = await loadPath("/admin", { "/api/me": { id: "student-1", name: "Student", isAdmin: false } });
  expect(path).toBe("/classrooms");
});

test("#185: the overview tab shows account-level counts", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const responses: Record<string, unknown> = {
        "/api/me": { id: "admin-1", name: "Admin", isAdmin: true },
        "/api/admin/overview": { users: 12, classrooms: 3, runningActivities: 2 },
      };
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), { headers: { "Content-Type": "application/json" } });
    }),
  );
  const dispose = await mountRoute("/admin");
  try {
    const statOf = (label: string) => {
      const card = screen.getByText(label).closest("[data-stat]") as HTMLElement;
      return within(card).getByText(/^[0-9]+$/).textContent;
    };
    expect(await screen.findByText("Registered accounts")).toBeTruthy();
    expect(statOf("Registered accounts")).toBe("12");
    expect(statOf("Classrooms")).toBe("3");
    expect(statOf("Activities running")).toBe("2");
    expect(screen.queryByRole("button", { name: "Create" })).toBeNull();
  } finally {
    dispose();
    vi.unstubAllGlobals();
  }
});

const adminUserFixture = {
  id: "u-a",
  name: "Lin",
  email: "lin@socrates.tw",
  isAdmin: false,
  disabled: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

test("#185: the users tab creates an account and disables one behind a confirmation", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (init?.method === "POST" || init?.method === "PATCH") {
        calls.push({ path, body: JSON.parse(String(init.body)) });
      }
      const responses: Record<string, unknown> = {
        "/api/me": { id: "admin-1", name: "Admin", isAdmin: true },
        "/api/admin/users": [adminUserFixture],
      };
      if (init?.method === "POST" && path === "/api/admin/users") {
        return new Response(
          JSON.stringify({ ...adminUserFixture, id: "u-new", name: "New User", email: "new@socrates.tw" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      if (init?.method === "PATCH" && path === "/api/admin/users/u-a") {
        return new Response(JSON.stringify({ ...adminUserFixture, disabled: true }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), { headers: { "Content-Type": "application/json" } });
    }),
  );
  const dispose = await mountRoute("/admin?tab=users");
  try {
    fireEvent.change(await screen.findByRole("textbox", { name: "Name" }), { target: { value: "New User" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), { target: { value: "new@socrates.tw" } });
    fireEvent.change(screen.getByLabelText("Initial password"), { target: { value: "abcdefgh" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByText("Created New User")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Disable" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(calls.length).toBe(2));

    expect(calls.map((call) => call.path)).toEqual(["/api/admin/users", "/api/admin/users/u-a"]);
    expect(calls[0].body).toEqual({ name: "New User", email: "new@socrates.tw", password: "abcdefgh" });
    expect(calls[1].body).toEqual({ disabled: true });
  } finally {
    dispose();
    vi.unstubAllGlobals();
  }
});

test("#185: the notify tab posts an announcement to the feed", async () => {
  const calls: Array<{ path: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (init?.method === "POST") calls.push({ path, body: JSON.parse(String(init.body)) });
      const responses: Record<string, unknown> = {
        "/api/me": { id: "admin-1", name: "Admin", isAdmin: true },
        "/api/notifications": { items: [], unread: 0 },
      };
      if (init?.method === "POST" && path === "/api/admin/notifications") {
        return new Response(
          JSON.stringify({ id: "n_1", title: "Maintenance", body: "Tonight", createdAt: "2026-01-01T00:00:00.000Z" }),
          { status: 201, headers: { "Content-Type": "application/json" } },
        );
      }
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), { headers: { "Content-Type": "application/json" } });
    }),
  );
  const dispose = await mountRoute("/admin?tab=notify");
  try {
    fireEvent.change(await screen.findByRole("textbox", { name: "Title" }), { target: { value: "Maintenance" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Message (optional)" }), {
      target: { value: "Tonight" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send notice" }));
    await waitFor(() => expect(calls.length).toBe(1));
    expect(calls[0]).toMatchObject({
      path: "/api/admin/notifications",
      body: { title: "Maintenance", body: "Tonight" },
    });
    expect((screen.getByRole("textbox", { name: "Title" }) as HTMLInputElement).value).toBe("");
  } finally {
    dispose();
    vi.unstubAllGlobals();
  }
});

test("#318: signing in with a return address lands back on that page", async () => {
  stubStoaObservers();
  let signedIn = false;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const user = { id: "u1", name: "Teacher", isAdmin: false };
      if (path === "/api/auth/login" && init?.method === "POST") signedIn = true;
      const responses: Record<string, unknown> = {
        "/api/me": signedIn ? user : null,
        "/api/auth/login": user,
        "/api/auth/providers": { providers: [] },
        "/api/notifications": { items: [], unread: null },
        "/api/classrooms": [],
      };
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), { headers: { "Content-Type": "application/json" } });
    }),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: ["/classrooms"] }),
    context: { queryClient: client },
  });
  await router.load();
  render(
    <QueryClientProvider client={client}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  try {
    expect(router.state.location.pathname).toBe("/login");
    fireEvent.change(await screen.findByRole("textbox", { name: "Email" }), { target: { value: "a@example.com" } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "password123" } });
    const submit = screen
      .getAllByRole("button", { name: "Sign in" })
      .find((button) => button.getAttribute("type") === "submit");
    if (!submit) throw new Error("submit button missing");
    fireEvent.click(submit);
    await waitFor(() => expect(router.state.location.pathname).toBe("/classrooms"));
  } finally {
    cleanup();
    client.clear();
    vi.unstubAllGlobals();
  }
});

test("#318: the join page sends account holders to login with the invite address to return to", async () => {
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
  const dispose = await mountRoute("/join/abcdef?draft=why%20so");
  try {
    await screen.findByRole("heading", { name: "Invitation topic" });
    const link = screen.getAllByRole("link").find((item) => item.getAttribute("href")?.startsWith("/login"));
    const next = new URL(link?.getAttribute("href") ?? "", "http://localhost").searchParams.get("next");
    expect(next).toBe("/join/abcdef?draft=why%20so");
  } finally {
    dispose();
    vi.unstubAllGlobals();
  }
});

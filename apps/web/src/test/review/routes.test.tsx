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

let me: unknown = { id: "student-1", name: "Student", guest: true };

beforeEach(() => {
  me = { id: "student-1", name: "Student", guest: true };
  localStorage.clear();
  setLocale("en");
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const responses: Record<string, unknown> = {
        "/api/me": me,
        "/api/join/abcdef": { code: "abcdef", classroomName: "Class", topic },
        "/api/activities/activity-1": {
          id: "activity-1",
          classroomId: "class-1",
          classroomName: "Class",
          topic,
          finishedAt: null,
        },
        "/api/topics": [topic],
        "/api/classrooms/class-1": {
          id: "class-1",
          name: "Class",
          role: "student",
          teacherName: "Teacher",
          memberCount: 1,
          code: null,
          url: null,
          current: null,
          createdAt: "2026-11-01T00:00:00.000Z",
        },
        "/api/classrooms/class-1/activities": [],
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

test("F01: direct invitation URL renders the topic, name and required consent", async () => {
  me = null;
  const dispose = await mountRoute("/join/abcdef");
  try {
    expect(await screen.findByRole("heading", { name: "Invitation topic" })).toBeTruthy();
    expect(screen.getByRole("link", { name: /Use my account/ }).getAttribute("href")).toContain("/login");
    fireEvent.click(screen.getByRole("button", { name: /Join as a guest/ }));
    expect(screen.getByRole("textbox", { name: "Your name" })).toBeTruthy();
    expect(screen.getByRole("checkbox")).toHaveProperty("checked", false);
    expect(screen.getByRole("button", { name: "Start the dialogue" })).toHaveProperty("disabled", true);
  } finally {
    dispose();
  }
});

test("F01b: a signed-in user joins under their account name without retyping it", async () => {
  me = { id: "student-1", name: "Student", guest: false, kind: "member" };
  const dispose = await mountRoute("/join/abcdef");
  try {
    expect(await screen.findByRole("heading", { name: "Invitation topic" })).toBeTruthy();
    expect(await screen.findByText(/You'll join as/)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Your name" })).toBeNull();
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

test("new course: the first topic can be AI-generated, is persisted, then started in the classroom", async () => {
  const generatedTopic = {
    id: "gen_123_0",
    title: "Generated topic",
    statement: "A generated dilemma",
    prompts: ["Why?"],
  };
  const persisted = { ...generatedTopic, id: "topic-persisted" };
  const calls: Array<{ path: string; body: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (init?.method === "POST") calls.push({ path, body: JSON.parse(String(init.body)) });
      const responses: Record<string, unknown> = {
        "/api/me": { id: "teacher-1", name: "Teacher", guest: false },
        "/api/topics": [topic],
        "/api/topics/generate": [generatedTopic],
        "/api/classrooms/class-9": {
          id: "class-9",
          name: "Untitled course",
          role: "teacher",
          teacherName: "Teacher",
          memberCount: 0,
          code: "code999",
          url: "http://localhost/join/code999",
          current: null,
          createdAt: "2026-11-01T00:00:00.000Z",
        },
        "/api/classrooms/class-9/activities":
          init?.method === "POST"
            ? {
                classroomId: "class-9",
                code: "code999",
                url: "http://localhost/join/code999",
                activityId: "activity-9",
              }
            : [],
      };
      if (path === "/api/topics" && init?.method === "POST")
        return new Response(JSON.stringify(persisted), { headers: { "Content-Type": "application/json" } });
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), { headers: { "Content-Type": "application/json" } });
    }),
  );
  const dispose = await mountRoute("/classrooms/class-9");
  try {
    expect(await screen.findByText("No topic has started yet, so students can’t join with the code.")).toBeTruthy();
    fireEvent.click(await screen.findByRole("tab", { name: "AI generate" }));
    const direction = await screen.findByPlaceholderText("Topic direction");
    fireEvent.change(direction, { target: { value: "justice" } });
    fireEvent.click(screen.getByRole("button", { name: "Generate" }));
    fireEvent.click(await screen.findByRole("button", { name: /Generated topic/ }));
    const startButton = screen.getByRole("button", { name: "Start this topic" });
    await waitFor(() => expect(startButton).toHaveProperty("disabled", false));
    fireEvent.click(startButton);
    await waitFor(() =>
      expect(calls.map((call) => call.path)).toEqual([
        "/api/topics/generate",
        "/api/topics",
        "/api/classrooms/class-9/activities",
      ]),
    );
    expect(calls[1]!.body).toMatchObject({ title: "Generated topic", statement: "A generated dilemma" });
    expect(calls[2]!.body).toMatchObject({ topicId: "topic-persisted" });
  } finally {
    dispose();
  }
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

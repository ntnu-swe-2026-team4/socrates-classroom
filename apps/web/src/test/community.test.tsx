import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { setLocale } from "@/i18n";

vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("agents/react", () => ({
  useAgent: () => ({
    send: () => {},
    readyState: 0,
    OPEN: 1,
    addEventListener: () => {},
    removeEventListener: () => {},
  }),
}));

const classroom = {
  id: "class-1",
  name: "Ethics 101",
  role: "student",
  teacherName: "Ms. Lin",
  memberCount: 2,
  code: null,
  url: null,
  current: null,
  createdAt: "2026-11-01T00:00:00.000Z",
};

const thread = {
  id: "p_1",
  body: "Is lying ever right?",
  authorId: "teacher-1",
  authorName: "Ms. Lin",
  isTeacher: true,
  createdAt: "2026-11-10T00:00:00.000Z",
  replies: [
    {
      id: "p_2",
      body: "Only to save a life.",
      authorId: "student-1",
      authorName: "Student",
      isTeacher: false,
      createdAt: "2026-11-10T01:00:00.000Z",
    },
  ],
};

const posted: Array<{ path: string; body: unknown }> = [];

beforeEach(() => {
  posted.length = 0;
  localStorage.clear();
  setLocale("en");
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const method = init?.method ?? "GET";
      if (method === "POST" && path === "/api/classrooms/class-1/posts") {
        const body = JSON.parse(String(init?.body)) as { body: string };
        posted.push({ path, body });
        return new Response(JSON.stringify({ ...thread, id: "p_3", body: body.body, replies: [], isTeacher: false }), {
          status: 201,
          headers: { "Content-Type": "application/json" },
        });
      }
      const responses: Record<string, unknown> = {
        "/api/me": { id: "student-1", name: "Student", guest: true },
        "/api/classrooms/class-1": classroom,
        "/api/classrooms/class-1/activities": [],
        "/api/classrooms/class-1/posts": [thread],
        "/api/classrooms/class-1/members": { teacher: { id: "teacher-1", name: "Ms. Lin" }, members: [] },
      };
      if (!(path in responses)) throw new Error(`Unexpected request: ${method} ${path}`);
      return new Response(JSON.stringify(responses[path]), { headers: { "Content-Type": "application/json" } });
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

async function mount(url: string) {
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
  return { router, dispose: () => client.clear() };
}

test("switching to the discussion tab renders threads, keeps the tab in the URL, and posts a new thread", async () => {
  const { router, dispose } = await mount("/classrooms/class-1");
  try {
    const tab = await screen.findByRole("tab", { name: "Discussion" });
    expect(screen.getByRole("tab", { name: "Topics" }).getAttribute("aria-selected")).toBe("true");
    fireEvent.click(tab);

    expect(await screen.findByText("Is lying ever right?")).toBeTruthy();
    expect(tab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("tabpanel").getAttribute("aria-labelledby")).toBe(tab.id);
    expect(router.state.location.search).toMatchObject({ tab: "board" });
    expect(screen.getAllByText("Teacher").length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole("button", { name: "1 replies" }));
    expect(await screen.findByText("Only to save a life.")).toBeTruthy();

    const composer = screen.getByRole("textbox", { name: "Ask a question or share an idea with the class…" });
    fireEvent.change(composer, { target: { value: "  What is justice?  " } });
    fireEvent.click(screen.getByRole("button", { name: "Post" }));

    await waitFor(() => expect(posted).toHaveLength(1));
    expect(posted[0]).toEqual({ path: "/api/classrooms/class-1/posts", body: { body: "What is justice?" } });
    await waitFor(() => expect((composer as HTMLTextAreaElement).value).toBe(""));
  } finally {
    dispose();
  }
});

test("arrow keys move between tabs", async () => {
  const { dispose } = await mount("/classrooms/class-1?tab=board");
  try {
    const board = await screen.findByRole("tab", { name: "Discussion" });
    expect(board.getAttribute("aria-selected")).toBe("true");
    fireEvent.keyDown(board, { key: "ArrowRight" });
    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "Members" }).getAttribute("aria-selected")).toBe("true"),
    );
  } finally {
    dispose();
  }
});

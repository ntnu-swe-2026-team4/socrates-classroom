import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setLocale } from "@/i18n";
import { routeTree } from "@/routeTree.gen";

vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/SocratesCompanion", () => ({ SocratesWindow: () => null }));

const token = "1234567890abcdef1234567890abcdef";
const timestamp = "2026-11-22T03:00:00.000Z";
const student = { id: "student", name: "Student", isAdmin: false };
const room = {
  id: "room",
  role: "student",
  name: "Ethics seminar",
  teacherName: "Socrates",
  memberCount: 1,
  current: null,
};
const post = (body: string) => ({
  id: "post",
  authorId: student.id,
  authorName: student.name,
  createdAt: timestamp,
  body,
});
const page = (items: unknown[]) => ({ items, nextCursor: null });
const sockets: TestSocket[] = [];

class TestSocket extends EventTarget {
  constructor(public readonly url: string) {
    super();
    sockets.push(this);
  }

  close() {}
}

function mount(
  path: string,
  respond: (url: URL, init?: RequestInit) => Response | undefined,
  user: typeof student | null = student,
) {
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://localhost");
    if (url.pathname === "/api/me") return Response.json(user);
    if (url.pathname === "/api/classrooms") return Response.json([room]);
    if (url.pathname === "/api/classrooms/room/activities") return Response.json(page([]));
    return respond(url, init) ?? Response.json({ code: "not_found" }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetch);
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    context: { queryClient },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return { fetch, router };
}

beforeEach(() => {
  sockets.length = 0;
  setLocale("en");
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal("WebSocket", TestSocket);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("deep-links to announcements and hides publishing controls for students", async () => {
  const { router } = mount("/classrooms/room?tab=announcements", (url) => {
    if (url.pathname.endsWith("/announcements")) return Response.json(page([post("Read the case before class")]));
    if (url.pathname.endsWith("/posts")) return Response.json(page([]));
  });
  expect(await screen.findByText("Read the case before class")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Post" })).toBeNull();
  fireEvent.click(screen.getByRole("link", { name: "Discussion" }));
  await waitFor(() => expect(router.state.location.searchStr).toBe("?tab=board"));
});

test("retries the same draft with the original idempotency key and reloads after a classroom event", async () => {
  const keys: Array<string | null> = [];
  let items = [post("Initial topic")];
  mount("/classrooms/room?tab=board", (url, init) => {
    if (!url.pathname.endsWith("/posts")) return undefined;
    if (init?.method === "POST") {
      keys.push(new Headers(init.headers).get("Idempotency-Key"));
      if (keys.length === 1) return Response.json({ code: "internal_error" }, { status: 503 });
      const created = { ...post("My argument"), id: "created" };
      items = [created, ...items];
      return Response.json(created, { status: 201 });
    }
    return Response.json(page(items));
  });
  expect(await screen.findByText("Initial topic")).toBeTruthy();
  const input = screen.getByRole("textbox");
  fireEvent.change(input, { target: { value: "My argument" } });
  fireEvent.click(screen.getByRole("button", { name: "Post" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Post" }));
  expect(await screen.findByText("My argument")).toBeTruthy();
  expect(keys).toEqual([expect.any(String), keys[0]]);
  expect(sockets[0]?.url).toMatch(/\/api\/classrooms\/room\/events$/);
  items = [post("A classmate posted")];
  act(() =>
    sockets[0]?.dispatchEvent(
      new MessageEvent("message", { data: JSON.stringify({ type: "classroom.changed", resource: "posts" }) }),
    ),
  );
  expect(await screen.findByText("A classmate posted")).toBeTruthy();
});

test("opens a classroom invitation without joining and preserves the invitation on the sign-in link", async () => {
  const { fetch } = mount(
    `/join/i/${token}`,
    (url) => {
      if (url.pathname === `/api/classroom-invites/${token}`) {
        return Response.json({
          classroomId: "room",
          classroomName: room.name,
          activityId: null,
          scope: "classroom",
          expiresAt: timestamp,
          finishedAt: null,
          topic: null,
        });
      }
    },
    null,
  );
  const signIn = await screen.findByRole("link", { name: "Sign in" });
  expect(new URL(signIn.getAttribute("href") ?? "", "http://localhost").searchParams.get("next")).toBe(
    `/join/i/${token}`,
  );
  expect(fetch.mock.calls.some(([input, init]) => String(input).endsWith("/join") && init?.method === "POST")).toBe(
    false,
  );
});

test("shows personal reports from the classroom index", async () => {
  mount("/classrooms", (url) => {
    if (url.pathname === "/api/me/reports") {
      return Response.json(
        page([
          {
            activityId: "activity",
            classroomId: "former-room",
            classroomName: "Former class",
            topicTitle: "Previous report",
            finishedAt: timestamp,
          },
        ]),
      );
    }
  });
  fireEvent.click(await screen.findByRole("button", { name: "My reports" }));
  const report = await screen.findByRole("link", { name: /Previous report/ });
  expect(report.getAttribute("href")).toBe("/report/activity");
});

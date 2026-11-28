import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { must } from "./helpers";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setLocale } from "@/i18n";
import { parseJoinTarget } from "@/lib/joinCode";
import { routeTree } from "@/routeTree.gen";

vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/components/SocratesCompanion", () => ({ SocratesWindow: () => null }));

const token = "1234567890abcdef1234567890abcdef";
const timestamp = "2026-11-22T03:00:00.000Z";
const student = { id: "student", name: "Student", isAdmin: false, emailVerified: true };
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
    if (url.pathname === "/api/classrooms") return respond(url, init) ?? Response.json([room]);
    if (url.pathname === "/api/classrooms/room/activities") return respond(url, init) ?? Response.json(page([]));
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

test("a teacher schedules a topic and starts the scheduled discussion from its calendar event", async () => {
  const topic = {
    id: "ethics",
    classroomId: "room",
    title: "Privacy debate",
    statement: "Is tracking justified?",
    prompts: [],
    axes: [],
  };
  let event: Record<string, unknown> | undefined;
  const { fetch } = mount("/classrooms/room", (url, init) => {
    if (url.pathname === "/api/classrooms") return Response.json([{ ...room, role: "teacher" }]);
    if (url.pathname === "/api/config") return Response.json({ reportAxes: "ai" });
    if (url.pathname === "/api/topics") return Response.json([]);
    if (url.pathname.endsWith("/topics")) return Response.json([topic]);
    if (url.pathname.endsWith("/calendar-events")) {
      if (init?.method === "POST") {
        const input = JSON.parse(String(init.body));
        event = { ...input, id: "event", classroomId: "room", activity: null, endsAt: null };
        return Response.json(event, { status: 201 });
      }
      return Response.json(page(event ? [event] : []));
    }
    if (url.pathname.endsWith("/activities") && init?.method === "POST") {
      event = { ...event, activity: { id: "activity", finishedAt: null } };
      return Response.json(
        { activityId: "activity", classroomId: "room", mode: "live", code: "code", url: "/join/code" },
        { status: 201 },
      );
    }
  });
  fireEvent.click(await screen.findByRole("button", { name: "Schedule discussion" }));
  const title = await screen.findByLabelText<HTMLInputElement>("Event title");
  expect(title.value).toBe("Privacy debate");
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  fireEvent.click(await screen.findByRole("button", { name: "Start discussion" }));
  fireEvent.click(await screen.findByRole("button", { name: "Start activity" }));
  const dashboard = await screen.findByRole("link", { name: "Live dashboard" });
  expect(dashboard.getAttribute("href")).toBe("/t/live/activity");
  const starts = fetch.mock.calls.filter(
    ([url, init]) => String(url).endsWith("/activities") && init?.method === "POST",
  );
  expect(JSON.parse(String(must(starts[0], "start request")[1]?.body))).toMatchObject({
    topicId: "ethics",
    calendarEventId: "event",
    mode: "live",
  });
});

test("a student uses the same calendar event to join and later find the report", async () => {
  const startsAt = new Date().toISOString();
  let finishedAt: string | null = null;
  mount("/classrooms/room?tab=calendar", (url) => {
    if (url.pathname.endsWith("/calendar-events"))
      return Response.json(
        page([
          {
            id: "event",
            title: "Privacy debate",
            startsAt,
            endsAt: null,
            note: "",
            topicId: "ethics",
            activity: { id: "activity", finishedAt },
          },
        ]),
      );
  });
  const join = await screen.findByRole("link", { name: "Join the discussion" });
  expect(join.getAttribute("href")).toBe("/dialogue?activityId=activity");
  finishedAt = new Date().toISOString();
  act(() =>
    sockets[0]?.dispatchEvent(
      new MessageEvent("message", {
        data: JSON.stringify({ type: "classroom.changed", resource: "activities" }),
      }),
    ),
  );
  const report = await screen.findByRole("link", { name: "View report" });
  expect(report.getAttribute("href")).toBe("/report/activity");
});

test("#459: teacher sees the 6-character invite code in the classroom header and members tab with empty-activity warning", async () => {
  const teacherRoom = { ...room, role: "teacher", code: "abc234", url: "/join/abc234" };
  const writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  const { router } = mount("/classrooms/room", (url) => {
    if (url.pathname === "/api/classrooms") return Response.json([teacherRoom]);
    if (url.pathname === "/api/config") return Response.json({ reportAxes: "ai" });
    if (url.pathname === "/api/topics") return Response.json([]);
    if (url.pathname.endsWith("/topics")) return Response.json([]);
    if (url.pathname.endsWith("/members"))
      return Response.json({ teacher: { id: student.id, name: "Socrates" }, ...page([]) });
    if (url.pathname.endsWith("/invites")) return Response.json(page([]));
  });
  expect(await screen.findByText("abc234")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copy code" }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith("abc234"));
  fireEvent.click(screen.getByRole("link", { name: "QR & links" }));
  await waitFor(() => expect(router.state.location.searchStr).toBe("?tab=members"));
  expect(await screen.findByRole("heading", { name: "Classroom invite code" })).toBeTruthy();
  expect(screen.getByText(`${window.location.origin}/join/abc234`)).toBeTruthy();
  expect(screen.getByText("No topic has started yet, so students can’t join with the code.")).toBeTruthy();
});

test("#459: active live classroom hides the empty-activity warning and students never see the invite code", async () => {
  const activeTeacherRoom = {
    ...room,
    role: "teacher",
    code: "abc234",
    url: "/join/abc234",
    current: {
      activityId: "act-1",
      topicId: "t-1",
      topicTitle: "Trolley",
      topicStatement: "Pull the lever?",
      finished: false,
    },
  };
  mount("/classrooms/room?tab=members", (url) => {
    if (url.pathname === "/api/classrooms") return Response.json([activeTeacherRoom]);
    if (url.pathname.endsWith("/members"))
      return Response.json({ teacher: { id: student.id, name: "Socrates" }, ...page([]) });
    if (url.pathname.endsWith("/invites")) return Response.json(page([]));
  });
  expect(await screen.findByRole("heading", { name: "Classroom invite code" })).toBeTruthy();
  expect(screen.queryByText("No topic has started yet, so students can’t join with the code.")).toBeNull();

  cleanup();
  mount("/classrooms/room?tab=members", (url) => {
    if (url.pathname === "/api/classrooms") return Response.json([{ ...room, code: null, url: null }]);
    if (url.pathname.endsWith("/members"))
      return Response.json({ teacher: { id: "t", name: "Socrates" }, ...page([]) });
  });
  expect(await screen.findByText("Socrates")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Classroom invite code" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Copy code" })).toBeNull();
});

test("#459: classroom management cards show the classroom invite code for teachers", async () => {
  mount("/classrooms?view=teaching", (url) => {
    if (url.pathname === "/api/classrooms") {
      return Response.json([{ ...room, role: "teacher", code: "abc234", url: "/join/abc234" }]);
    }
  });
  expect(await screen.findByText("abc234")).toBeTruthy();
  expect(screen.getByText("Invite code")).toBeTruthy();
});

test("#459: header and members invite code copy buttons surface an alert when clipboard fails", async () => {
  const teacherRoom = { ...room, role: "teacher", code: "abc234", url: "/join/abc234" };
  const writeText = vi.fn(async () => {
    throw new Error("denied");
  });
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  mount("/classrooms/room?tab=members", (url) => {
    if (url.pathname === "/api/classrooms") return Response.json([teacherRoom]);
    if (url.pathname.endsWith("/members"))
      return Response.json({ teacher: { id: student.id, name: "Socrates" }, ...page([]) });
    if (url.pathname.endsWith("/invites")) return Response.json(page([]));
  });
  const copyButtons = await screen.findAllByRole("button", { name: "Copy code" });
  fireEvent.click(must(copyButtons[0], "header copy code button"));
  expect(await screen.findByText("Couldn’t copy the code. Select it above to copy it manually.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
  expect(await screen.findByText("Couldn’t copy the link. Select it above to copy it manually.")).toBeTruthy();
});

test("#459: invite code form routes pasted invitation URLs and spaced codes to the right join route", async () => {
  const { router } = mount("/classrooms?view=enrolled", (url) => {
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
  });
  const input = await screen.findByRole("textbox", { name: "Enter your invite code" });
  fireEvent.change(input, { target: { value: `https://example.com/join/i/${token}` } });
  fireEvent.click(screen.getByRole("button", { name: "Join classroom" }));
  await waitFor(() => expect(router.state.location.pathname).toBe(`/join/i/${token}`));

  cleanup();
  const direct = mount("/classrooms?view=enrolled", (url) => {
    if (url.pathname === "/api/join/abc234") {
      return Response.json({
        code: "abc234",
        classroomName: room.name,
        topic: { id: "t", classroomId: "room", title: "T", statement: "S", prompts: [], axes: [] },
      });
    }
  });
  const secondInput = await screen.findByRole("textbox", { name: "Enter your invite code" });
  fireEvent.change(secondInput, { target: { value: "https://example.com/join/ABC234" } });
  fireEvent.click(screen.getByRole("button", { name: "Join classroom" }));
  await waitFor(() => expect(direct.router.state.location.pathname).toBe("/join/abc234"));

  expect(parseJoinTarget("  AB C 234 ")).toEqual({ to: "/join/$code", params: { code: "abc234" } });
  expect(parseJoinTarget(`/join/i/${token}`)).toEqual({ to: "/join/i/$token", params: { token } });
  expect(parseJoinTarget(`example.com/join/i/${token}`)).toEqual({ to: "/join/i/$token", params: { token } });
  expect(parseJoinTarget("https://example.com/join/ABC%20234")).toEqual({
    to: "/join/$code",
    params: { code: "abc234" },
  });
  expect(parseJoinTarget(`https://example.com/join/a/${token}?x=1`)).toEqual({
    to: "/join/a/$token",
    params: { token },
  });
  expect(parseJoinTarget("   ")).toBeNull();
});

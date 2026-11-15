import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AdminDashboard } from "@socrates/shared";
import { routeTree } from "@/routeTree.gen";
import { setLocale } from "@/i18n";

vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/landing/LandAnimation", () => ({ LandAnimation: () => null }));
const dashboard: AdminDashboard = {
  generatedAt: "2026-11-15T10:00:00.000Z",
  stuckAfterMs: 1_200_000,
  counts: {
    byRole: { teacher: 2, student: 3, auditor: 1 },
    classrooms: 4,
    activeActivities: 3,
    finishedActivities: 1,
    memberships: 7,
  },
  reports: {
    byStatus: { pending: 1, partial: 0, ready: 2, failed: 1 },
    stuck: { items: [{ activityId: "a_stuck_activity", updatedAt: "2026-11-15T09:00:00.000Z" }], total: 1 },
    finishedWithoutReport: { items: [], total: 0 },
  },
  recentClassrooms: {
    items: [
      { id: "c_1", name: "Philosophy A", createdAt: "2026-11-15T08:00:00.000Z", members: 5, state: "active" },
      { id: "c_2", name: "Ethics Club", createdAt: "2026-11-14T08:00:00.000Z", members: 0, state: "finished" },
      { id: "c_4", name: "Fresh room", createdAt: "2026-11-13T08:00:00.000Z", members: 0, state: "none" },
    ],
    total: 3,
  },
  emptyClassrooms: {
    items: [{ id: "c_3", name: "Quiet class", createdAt: "2026-11-10T08:00:00.000Z" }],
    total: 1,
  },
  hourly: [{ hour: "2026-11-15T08:00:00Z", classrooms: 1, joins: 5 }],
};

let requested: string[] = [];
let sessionStatus = 200;

beforeEach(() => {
  localStorage.clear();
  setLocale("en");
  requested = [];
  sessionStatus = 200;
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      requested.push(path);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (path === "/api/me") return json({ id: "teacher-1", name: "Teacher", role: "teacher" });
      if (path === "/api/admin/session") {
        return sessionStatus === 200
          ? json({ admin: true })
          : json({ code: "forbidden", message: "no" }, sessionStatus);
      }
      if (path === "/api/admin/dashboard") return json(dashboard);
      if (path === "/api/classrooms") return json([]);
      throw new Error(`Unexpected request: ${path}`);
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
  return {
    dispose: () => {
      cleanup();
      client.clear();
    },
    router,
  };
}

test("an admin sees every panel, with unknown roles shown as-is", async () => {
  const { dispose } = await mountRoute("/admin/dashboard");
  try {
    expect(await screen.findByRole("heading", { name: "Operations dashboard" })).toBeTruthy();
    expect(await screen.findByText("Philosophy A")).toBeTruthy();
    expect(screen.getByText("Ethics Club")).toBeTruthy();
    expect(screen.getByText("Quiet class")).toBeTruthy();
    const stateOf = (name: string) => screen.getByText(name).closest("tr")?.querySelectorAll("td")[2]?.textContent;
    expect(stateOf("Philosophy A")).toBe("Active");
    expect(stateOf("Ethics Club")).toBe("Finished");
    expect(stateOf("Fresh room")).toBe("No activity");
    expect(screen.getByText("a_stuck_activity")).toBeTruthy();
    expect(screen.getByText("Still generating after 20 minutes")).toBeTruthy();
    expect(screen.getByText("No such activities")).toBeTruthy();
    expect(screen.getByText(/Teacher · 2/)).toBeTruthy();
    expect(screen.getByText(/auditor · 1/)).toBeTruthy();
    expect(screen.getByText("Failed").nextElementSibling?.textContent).toBe("1");
  } finally {
    dispose();
  }
});

const originalRecent = dashboard.recentClassrooms;

function manyClassrooms(count: number, total: number) {
  dashboard.recentClassrooms = {
    items: Array.from({ length: count }, (_, index) => ({
      id: `c_${index}`,
      name: `Class ${String(index).padStart(2, "0")}`,
      createdAt: new Date(Date.UTC(2026, 10, 1, 0, index)).toISOString(),
      members: index,
      state: "active" as const,
    })),
    total,
  };
}

const classNames = () =>
  screen
    .getAllByRole("cell")
    .map((cell) => cell.textContent ?? "")
    .filter((text) => /^Class \d\d$/.test(text));

test("a long list is paged: newest first, ten rows, and the next page continues where it stopped", async () => {
  manyClassrooms(25, 25);
  const { dispose } = await mountRoute("/admin/dashboard");
  try {
    await screen.findByText("Class 24");
    expect(classNames()).toHaveLength(10);
    expect(classNames()[0]).toBe("Class 24");
    expect(screen.getByText("1–10 of 25")).toBeTruthy();
    expect(screen.queryByText(/Only 25 rows were loaded/)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: "Next page" })[0]!);
    await screen.findByText("11–20 of 25");
    expect(classNames()[0]).toBe("Class 14");
    fireEvent.click(screen.getAllByRole("button", { name: "Next page" })[0]!);
    await screen.findByText("21–25 of 25");
    expect(classNames()).toHaveLength(5);
    expect(screen.getAllByRole("button", { name: "Next page" })[0]!.hasAttribute("disabled")).toBe(true);
  } finally {
    dispose();
    dashboard.recentClassrooms = originalRecent;
  }
});

test("rows per page and sorting change what is shown, and sorting returns to page one", async () => {
  manyClassrooms(25, 25);
  const { dispose } = await mountRoute("/admin/dashboard");
  try {
    await screen.findByText("Class 24");
    fireEvent.change(screen.getAllByLabelText("Rows per page")[0]!, { target: { value: "25" } });
    await screen.findByText("1–25 of 25");
    expect(classNames()).toHaveLength(25);
    fireEvent.change(screen.getAllByLabelText("Rows per page")[0]!, { target: { value: "10" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Next page" })[0]!);
    await screen.findByText("11–20 of 25");
    fireEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
    await screen.findByText("1–10 of 25");
    expect(classNames()[0]).toBe("Class 00");
    fireEvent.click(screen.getByRole("button", { name: "Sort by Name" }));
    await waitFor(() => expect(classNames()[0]).toBe("Class 24"));
    expect(screen.getByRole("button", { name: "Sort by Name" }).closest("th")?.getAttribute("aria-sort")).toBe(
      "descending",
    );
  } finally {
    dispose();
    dashboard.recentClassrooms = originalRecent;
  }
});

test("a list cut at the server cap says so instead of hiding the rest", async () => {
  manyClassrooms(12, 340);
  const { dispose } = await mountRoute("/admin/dashboard");
  try {
    expect(await screen.findByText("Only 12 rows were loaded; there are 340 in total.")).toBeTruthy();
    expect(screen.getByText("1–10 of 12")).toBeTruthy();
  } finally {
    dispose();
    dashboard.recentClassrooms = originalRecent;
  }
});

test("short lists show no pager", async () => {
  const { dispose } = await mountRoute("/admin/dashboard");
  try {
    await screen.findByText("Philosophy A");
    expect(screen.queryByRole("button", { name: "Next page" })).toBeNull();
    expect(screen.queryByLabelText("Rows per page")).toBeNull();
  } finally {
    dispose();
  }
});

test("/admin redirects to the dashboard", async () => {
  const { dispose, router } = await mountRoute("/admin");
  try {
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/dashboard"));
    expect(await screen.findByRole("heading", { name: "Operations dashboard" })).toBeTruthy();
  } finally {
    dispose();
  }
});

test("a non-admin is sent away and the dashboard data is never requested", async () => {
  sessionStatus = 403;
  const { dispose, router } = await mountRoute("/admin/dashboard");
  try {
    await waitFor(() => expect(router.state.location.pathname).toBe("/classrooms"));
    expect(screen.queryByRole("heading", { name: "Operations dashboard" })).toBeNull();
    expect(requested).not.toContain("/api/admin/dashboard");
  } finally {
    dispose();
  }
});

test("the dashboard follows the selected language", async () => {
  setLocale("es");
  const { dispose } = await mountRoute("/admin/dashboard");
  try {
    expect(await screen.findByRole("heading", { name: "Panel de operaciones" })).toBeTruthy();
    expect(await screen.findByText("Siguen generándose tras 20 minutos")).toBeTruthy();
  } finally {
    dispose();
  }
});

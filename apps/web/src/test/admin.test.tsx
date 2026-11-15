import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { AdminDashboard } from "@socrates/shared";
import { routeTree } from "@/routeTree.gen";
import { setLocale } from "@/i18n";
import { liveResponse, metricsResponse } from "./opsFixtures";

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
let requestedUrls: string[] = [];
let sessionStatus = 200;
let liveStatus = 200;
let liveBody = liveResponse();
let metricsBody = metricsResponse();

beforeEach(() => {
  localStorage.clear();
  setLocale("en");
  requested = [];
  requestedUrls = [];
  sessionStatus = 200;
  liveStatus = 200;
  liveBody = liveResponse();
  metricsBody = metricsResponse();
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://localhost");
      const path = url.pathname;
      requested.push(path);
      requestedUrls.push(path + url.search);
      const json = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
      if (path === "/api/me") return json({ id: "teacher-1", name: "Teacher", role: "teacher" });
      if (path === "/api/admin/session") {
        return sessionStatus === 200
          ? json({ admin: true })
          : json({ code: "forbidden", message: "no" }, sessionStatus);
      }
      if (path === "/api/admin/dashboard") return json(dashboard);
      if (path === "/api/admin/live")
        return liveStatus === 200 ? json(liveBody) : json({ code: "internal_error", message: "x" }, liveStatus);
      if (path === "/api/admin/metrics") return json(metricsBody);
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

test("/admin redirects to the operations page", async () => {
  const { dispose, router } = await mountRoute("/admin");
  try {
    await waitFor(() => expect(router.state.location.pathname).toBe("/admin/ops"));
    expect(await screen.findByRole("heading", { name: "Operations metrics" })).toBeTruthy();
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

test("the operations page opens in live mode, says the data is a sample, and links both pages", async () => {
  const { dispose } = await mountRoute("/admin/ops");
  try {
    expect(await screen.findByText(/Sample data/)).toBeTruthy();
    expect(screen.getByText("Updates every 5 s, showing the last 15 minutes")).toBeTruthy();
    expect(requestedUrls).toContain("/api/admin/live");
    expect(requested).not.toContain("/api/admin/metrics");
    expect(screen.getByRole("tab", { name: "Live" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("tab", { name: "24 hours" })).toBeNull();
    expect(screen.getByRole("link", { name: "Operations" }).getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("link", { name: "Database overview" }).getAttribute("aria-current")).toBeNull();
  } finally {
    dispose();
  }
});

test("switching to review loads the range endpoint and keeps the choice in the address", async () => {
  const { dispose, router } = await mountRoute("/admin/ops");
  try {
    await screen.findByText(/Sample data/);
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    await waitFor(() => expect(requestedUrls).toContain("/api/admin/metrics?range=24h"));
    expect(router.state.location.search).toEqual({ mode: "review" });
    expect(screen.getByText("Each point is 5 min; does not auto-refresh")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "7 days" }));
    await waitFor(() => expect(requestedUrls).toContain("/api/admin/metrics?range=7d"));
    expect(router.state.location.search).toEqual({ mode: "review", range: "7d" });

    fireEvent.click(screen.getByRole("tab", { name: "Live" }));
    await waitFor(() => expect(router.state.location.search).toEqual({ range: "7d" }));
  } finally {
    dispose();
  }
});

test("the address picks the mode and range, and an unknown range falls back to 24 hours", async () => {
  const first = await mountRoute("/admin/ops?mode=review&range=72h");
  try {
    await waitFor(() => expect(requestedUrls).toContain("/api/admin/metrics?range=72h"));
    expect(requested).not.toContain("/api/admin/live");
    expect(screen.getByRole("tab", { name: "72 hours" }).getAttribute("aria-selected")).toBe("true");
  } finally {
    first.dispose();
  }
  requestedUrls = [];
  const second = await mountRoute("/admin/ops?mode=review&range=15m");
  try {
    await waitFor(() => expect(requestedUrls).toContain("/api/admin/metrics?range=24h"));
    expect(requestedUrls.some((url) => url.includes("15m"))).toBe(false);
  } finally {
    second.dispose();
  }
});

test("live mode polls on the contract's step and stops when review is chosen", async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  const { dispose } = await mountRoute("/admin/ops");
  try {
    await waitFor(() => expect(requested.filter((path) => path === "/api/admin/live")).toHaveLength(1));
    await vi.advanceTimersByTimeAsync(5_100);
    await waitFor(() =>
      expect(requested.filter((path) => path === "/api/admin/live").length).toBeGreaterThanOrEqual(2),
    );
    fireEvent.click(screen.getByRole("tab", { name: "Review" }));
    await waitFor(() => expect(requested).toContain("/api/admin/metrics"));
    const before = requested.filter((path) => path === "/api/admin/live").length;
    await vi.advanceTimersByTimeAsync(12_000);
    expect(requested.filter((path) => path === "/api/admin/live")).toHaveLength(before);
  } finally {
    vi.useRealTimers();
    dispose();
  }
});

test("a failed live request shows an error instead of an empty page", async () => {
  liveStatus = 500;
  const { dispose } = await mountRoute("/admin/ops");
  try {
    expect(await screen.findByText("Could not load the dashboard. Please try again later.")).toBeTruthy();
  } finally {
    dispose();
  }
});

test("a non-admin never reaches the operations data", async () => {
  sessionStatus = 403;
  const { dispose, router } = await mountRoute("/admin/ops?mode=review");
  try {
    await waitFor(() => expect(router.state.location.pathname).toBe("/classrooms"));
    expect(requested).not.toContain("/api/admin/metrics");
    expect(requested).not.toContain("/api/admin/live");
  } finally {
    dispose();
  }
});

test("the operations page follows the selected language", async () => {
  setLocale("es");
  const { dispose } = await mountRoute("/admin/ops");
  try {
    expect(await screen.findByRole("heading", { name: "Métricas de operación" })).toBeTruthy();
    expect(await screen.findByText("Se actualiza cada 5 s y muestra los últimos 15 minutos")).toBeTruthy();
  } finally {
    dispose();
  }
});

test("live mode states the overall verdict, the headline numbers and one card per channel", async () => {
  const { dispose } = await mountRoute("/admin/ops");
  try {
    expect(await screen.findByRole("heading", { name: "Degraded: GLM 5.3 Flash" })).toBeTruthy();
    expect(screen.getByText("No student saw an error in the last minute")).toBeTruthy();
    const tile = (label: string) =>
      screen.getByText(label, { selector: "dt" }).closest("div")?.querySelectorAll("dd")[0]?.textContent;
    expect(tile("Online now")).toBe("12");
    expect(tile("Students saw an error")).toBe("0");
    expect(tile("Attempt error rate")).toBe("50%");
    expect(tile("Time to first token p95")).toBe("800 ms");

    const channels = screen.getByRole("region", { name: /Channels/ });
    expect(channels.querySelectorAll("li")).toHaveLength(2);
    const glm = screen.getByText("GLM 5.3 Flash", { selector: "span" }).closest("li")!;
    expect(glm.textContent).toContain("Degraded");
    expect(glm.textContent).toContain("Error rate 50%");
    expect(glm.textContent).toContain("Last minute: 24 attempts, 12 failed");
    expect(glm.textContent).toContain("Used for: Dialogue");
    expect(glm.textContent).toContain("No concurrency limit set");
    const clef = screen.getByText("Clef Flash", { selector: "span" }).closest("li")!;
    expect(clef.textContent).toContain("OK");
    expect(clef.textContent).toContain("Used for: Judgment");
  } finally {
    dispose();
  }
});

test("a down channel outranks a degraded one and its duration is shown", async () => {
  const body = liveBody;
  body.channels[1]!.usable = "down";
  body.channels[1]!.usableReason = "breaker_open";
  body.channels[1]!.usableSinceSec = body.generatedAtSec - 300;
  body.channels[1]!.breaker = "open";
  const { dispose } = await mountRoute("/admin/ops");
  try {
    expect(await screen.findByRole("heading", { name: "Down: Clef Flash" })).toBeTruthy();
    expect(screen.getByText(/for 5 min/)).toBeTruthy();
    const clef = screen.getByText("Clef Flash", { selector: "span" }).closest("li")!;
    expect(clef.textContent).toContain("Circuit breaker open");
  } finally {
    dispose();
  }
});

test("students who saw errors are counted in the verdict, and unknown values stay dashes", async () => {
  liveBody.now.failedTurns1m = 3;
  liveBody.now.concurrentUsers = null;
  liveBody.now.ttftP95Ms5m = null;
  liveBody.now.errorRate1m = null;
  const { dispose } = await mountRoute("/admin/ops");
  try {
    expect(await screen.findByText("3 turns showed students an error in the last minute")).toBeTruthy();
    const tile = (label: string) =>
      screen.getByText(label, { selector: "dt" }).closest("div")?.querySelectorAll("dd")[0]?.textContent;
    expect(tile("Online now")).toBe("—");
    expect(tile("Time to first token p95")).toBe("—");
    expect(tile("Attempt error rate")).toBe("—");
  } finally {
    dispose();
  }
});

test("when no channel has had a request the verdict says there is no data instead of healthy", async () => {
  for (const channel of liveBody.channels) {
    channel.usable = "unknown";
    channel.usableReason = "no_data";
  }
  const { dispose } = await mountRoute("/admin/ops");
  try {
    expect(await screen.findByRole("heading", { name: "No requests in the last minute" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "All channels are healthy" })).toBeNull();
  } finally {
    dispose();
  }
});

test("review mode shows range summaries and no current-state verdict", async () => {
  const { dispose } = await mountRoute("/admin/ops?mode=review");
  try {
    expect(await screen.findByText("Dialogue turns")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: /Degraded|Down|All channels/ })).toBeNull();
    const tile = (label: string) =>
      screen.getByText(label, { selector: "dt" }).closest("div")?.querySelectorAll("dd")[0]?.textContent;
    expect(tile("Dialogue turns")).toBe("120");
    expect(tile("Peak online")).toBe("12");
    const glm = screen.getByText("GLM 5.3 Flash", { selector: "span" }).closest("li")!;
    expect(glm.textContent).toContain("120 attempts, 60 failed (50%)");
    expect(glm.textContent).toContain("Time to first token p95: 800 ms");
    expect(glm.textContent).toContain("Full response p95: 2.4 sec");
    expect(glm.textContent).not.toContain("Last minute");
  } finally {
    dispose();
  }
});

test("the channel cards follow the selected language", async () => {
  setLocale("zh-TW");
  const { dispose } = await mountRoute("/admin/ops");
  try {
    expect(await screen.findByRole("heading", { name: "降級：GLM 5.3 Flash" })).toBeTruthy();
    expect(screen.getByText("近 1 分鐘沒有學生看到錯誤")).toBeTruthy();
    expect(screen.getByText(/用途：對話/)).toBeTruthy();
  } finally {
    dispose();
  }
});

test("live mode draws the two trend charts with the degraded threshold and a 60 s latency note", async () => {
  const { dispose } = await mountRoute("/admin/ops");
  try {
    expect(await screen.findByRole("heading", { name: "Dialogue turns per second" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Time to first token p95" })).toBeTruthy();
    expect(screen.getByText("Each point is the p95 of the last 60 s")).toBeTruthy();
    expect(await screen.findByText("Degraded threshold")).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll(".recharts-surface")).toHaveLength(2));
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getAllByText("Students saw an error").length).toBeGreaterThanOrEqual(2);
  } finally {
    dispose();
  }
});

test("review mode labels the charts per point and says each latency point covers its own interval", async () => {
  const { dispose } = await mountRoute("/admin/ops?mode=review");
  try {
    expect(await screen.findByRole("heading", { name: "Dialogue turns per point" })).toBeTruthy();
    expect(screen.getByText("Each point is the p95 of that interval")).toBeTruthy();
    await waitFor(() => expect(document.querySelectorAll(".recharts-surface")).toHaveLength(2));
  } finally {
    dispose();
  }
});

test("live quotas show the current level with its source, reset time and the lower-bound caveat", async () => {
  liveBody.now.quotaEta = [{ quotaId: "workers-ai/daily-neurons", etaSec: 13_320 }];
  const { dispose } = await mountRoute("/admin/ops");
  try {
    const region = await screen.findByRole("region", { name: /Quotas/ });
    const meters = Array.from(region.querySelectorAll("meter"));
    expect(meters.map((meter) => meter.getAttribute("aria-label"))).toEqual([
      "Daily Neurons",
      "GLM 5.3 Flash requests per minute",
    ]);
    expect(meters[0]?.getAttribute("value")).toBe("280");
    expect(meters[0]?.getAttribute("max")).toBe("10000");
    expect(region.textContent).toContain("280 / 10,000");
    expect(region.textContent).toContain("Estimated");
    expect(region.textContent).toContain("Inferred from errors");
    expect(region.textContent).toContain("Runs out in 3.7 hr");
    expect(region.textContent).toContain("Resets at");
    expect(region.textContent).toContain("At least this much");
    expect(region.textContent).toContain("4 / 20");
    expect(region.textContent).not.toContain("Highest");
  } finally {
    dispose();
  }
});

test("an exact provider figure carries no lower-bound caveat, and exceeding the limit is called out", async () => {
  const allowance = liveBody.quotas[0]!;
  allowance.source = "provider";
  if (allowance.model === "allowance") allowance.usedIsLowerBound = false;
  const rate = liveBody.quotas[1]!;
  rate.used = 25;
  const { dispose } = await mountRoute("/admin/ops");
  try {
    const region = await screen.findByRole("region", { name: /Quotas/ });
    expect(region.textContent).toContain("Reported by provider");
    expect(region.textContent).not.toContain("At least this much");
    expect(region.textContent).toContain("Over the quota");
    const meter = region.querySelectorAll("meter")[1];
    expect(meter?.getAttribute("value")).toBe("20");
    expect(region.textContent).toContain("25 / 20");
  } finally {
    dispose();
  }
});

test("review quotas show the highest level in the range, not the current one", async () => {
  const { dispose } = await mountRoute("/admin/ops?mode=review");
  try {
    const region = await screen.findByRole("region", { name: /Quotas/ });
    expect(region.textContent).toContain("Highest level in the range");
    expect(region.textContent).toContain("Highest day in the range");
    expect(region.textContent).toContain("Highest in the range");
    expect(region.textContent).toContain("159 / 10,000");
    expect(region.textContent).not.toContain("Resets at");
    expect(region.textContent).not.toContain("Runs out");
    expect(region.textContent).toContain("At least this much");
  } finally {
    dispose();
  }
});

test("without any quota the section is left out", async () => {
  liveBody.quotas = [];
  liveBody.now.quotaEta = [];
  const { dispose } = await mountRoute("/admin/ops");
  try {
    await screen.findByRole("heading", { name: /Degraded/ });
    expect(screen.queryByRole("region", { name: /Quotas/ })).toBeNull();
  } finally {
    dispose();
  }
});

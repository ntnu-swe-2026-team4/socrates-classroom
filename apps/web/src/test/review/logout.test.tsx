import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import { setLocale } from "@/i18n";

const calls = vi.hoisted(() => ({
  logout: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/api", () => ({
  api: {
    me: vi.fn().mockResolvedValue({ id: "teacher-1", role: "teacher", name: "Teacher" }),
    logout: calls.logout,
  },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  useNavigate: () => calls.navigate,
  useRouterState: ({ select }: { select: (state: { location: { pathname: string } }) => unknown }) =>
    select({ location: { pathname: "/report/activity-1" } }),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
});

test("S01: successful logout removes private reports from the shared client", async () => {
  localStorage.clear();
  setLocale("en");
  calls.navigate.mockClear();
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 30_000 } } });
  client.setQueryData(["me"], { id: "teacher-1", role: "teacher", name: "Teacher" });
  client.setQueryData(["report", "activity-1"], {
    topicTitle: "Topic",
    group: { axes: [], points: [], clusters: [] },
    individuals: [
      {
        pseudonym: "Other student",
        hexagon: [],
        arguments: [{ claim: "Private response", reason: "Private reason", tension: "Private tension" }],
        violations: [],
      },
    ],
  });
  try {
    render(
      <QueryClientProvider client={client}>
        <AppShell>
          <p>Report page</p>
        </AppShell>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    fireEvent.click(await screen.findByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(calls.navigate).toHaveBeenCalled());
    expect(client.getQueryData(["report", "activity-1"])).toBeUndefined();
  } finally {
    cleanup();
    client.clear();
  }
});

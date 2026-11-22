import type { ReactNode } from "react";
import { meQueryOptions } from "@/api/me";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { AppShell } from "@/components/AppShell";
import { openAccountSheet, useAccountSheetRequest } from "@/lib/accountSheet";
import { SESSION_SIGNAL_KEY } from "@/api/http";
import { setLocale } from "@/i18n";
import type { User } from "@socrates/shared";

const calls = vi.hoisted(() => ({
  me: vi.fn(),
  logout: vi.fn().mockResolvedValue(undefined),
  navigate: vi.fn().mockResolvedValue(undefined),
  pathname: "/report/activity-1",
}));

vi.mock("@/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api")>();
  return { ...actual, api: { ...actual.api, me: calls.me, logout: calls.logout } };
});
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to?: string }) => <a href={to ?? "#"}>{children}</a>,
  useNavigate: () => calls.navigate,
  useRouterState: ({ select }: { select: (state: unknown) => unknown }) =>
    select({ location: { pathname: calls.pathname } }),
}));

const teacher: User = { id: "u1", name: "Teacher", isAdmin: false };

function mountShell(user: User | null = teacher, pathname = calls.pathname) {
  calls.pathname = pathname;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (user) client.setQueryData(meQueryOptions.queryKey, user);
  render(
    <QueryClientProvider client={client}>
      <AppShell>
        <p>page</p>
      </AppShell>
    </QueryClientProvider>,
  );
  return client;
}

beforeEach(() => {
  setLocale("en");
  localStorage.clear();
  vi.stubGlobal("fetch", async () => Response.json({ items: [], unread: 0 }));
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

test("opening the rail bell shows notices and clears the unread count through the server", async () => {
  const user = userEvent.setup();
  const notice = { id: "n1", title: "Maintenance", body: "On Friday", createdAt: "2026-11-20T00:00:00Z" };
  let unread = 1;
  vi.stubGlobal("fetch", async (path: string, init?: RequestInit) => {
    if (path === "/api/notifications") return Response.json({ items: [notice], unread });
    if (path === "/api/notifications/seen" && init?.method === "POST" && init.credentials === "include") {
      unread = 0;
      return new Response(null, { status: 204 });
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const client = mountShell(teacher, "/home");
  try {
    await user.click(await screen.findByRole("button", { name: "Notifications, 1 unread" }));
    const panel = await screen.findByRole("dialog", { name: "System notices" });
    expect(within(panel).getByText("Maintenance")).toBeTruthy();
    expect(within(panel).getByText("On Friday")).toBeTruthy();
    await waitFor(() => expect(unread).toBe(0));
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "System notices" })).toBeNull();
    expect(await screen.findByRole("button", { name: "Notifications" })).toBeTruthy();
  } finally {
    client.clear();
  }
});

test("a public feed with a null unread count opens without sending a read request", async () => {
  const user = userEvent.setup();
  const fetch = vi.fn(async () => Response.json({ items: [], unread: null }));
  vi.stubGlobal("fetch", fetch);
  const client = mountShell(teacher, "/home");
  try {
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    const panel = await screen.findByRole("dialog", { name: "System notices" });
    expect(await within(panel).findByText("No notices yet.")).toBeTruthy();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith("/api/notifications", expect.objectContaining({ method: "GET" }));
  } finally {
    client.clear();
  }
});

test("openAccountSheet bumps the external store request", () => {
  const { result } = renderHook(() => useAccountSheetRequest());
  const before = result.current;
  act(() => {
    openAccountSheet();
  });
  expect(result.current).toBe(before + 1);
});

test("a session signal from another tab re-queries me", async () => {
  calls.me.mockResolvedValue({ ...teacher });
  const client = mountShell();
  try {
    window.dispatchEvent(new StorageEvent("storage", { key: SESSION_SIGNAL_KEY }));
    await waitFor(() => expect(calls.me).toHaveBeenCalledTimes(1));
  } finally {
    client.clear();
  }
});

test("a re-check that changes identity reloads the page", async () => {
  const original = window.location;
  const reload = vi.fn();
  Reflect.deleteProperty(window, "location");
  (window as unknown as { location: unknown }).location = { ...original, reload };
  try {
    calls.me.mockResolvedValue({ id: "u2", name: "Someone Else", isAdmin: false });
    const client = mountShell();
    window.dispatchEvent(new StorageEvent("storage", { key: SESSION_SIGNAL_KEY }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    client.clear();
  } finally {
    Reflect.deleteProperty(window, "location");
    (window as unknown as { location: unknown }).location = original;
  }
});

test("a re-check that only changes admin rights updates the cache without reloading", async () => {
  calls.me.mockResolvedValue({ id: "u1", name: "Teacher", isAdmin: true });
  const client = mountShell();
  try {
    window.dispatchEvent(new StorageEvent("storage", { key: SESSION_SIGNAL_KEY }));
    await waitFor(() => expect(client.getQueryData<User>(["me"])?.isAdmin).toBe(true));
  } finally {
    client.clear();
  }
});

test("the rail lists home and classrooms, and admins get the manage-site link", () => {
  const client = mountShell({ id: "u1", name: "Admin", isAdmin: true });
  try {
    expect(screen.getByRole("link", { name: "Home" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Classrooms" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Manage site" })).toBeTruthy();
  } finally {
    client.clear();
  }
});

test("non-admins do not see the manage-site link", () => {
  const client = mountShell();
  try {
    expect(screen.queryByRole("link", { name: "Manage site" })).toBeNull();
  } finally {
    client.clear();
  }
});

test("the account button opens the compact sheet with settings and sign out, no language switcher", async () => {
  const client = mountShell();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Account" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Settings" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeTruthy();
    expect(screen.queryByRole("radiogroup")).toBeNull();
  } finally {
    client.clear();
  }
});

test("inner routes render inside the halftone theme wrapper", () => {
  const client = mountShell(teacher, "/settings");
  try {
    expect(document.querySelector("main")?.className).toContain("ht-theme");
  } finally {
    client.clear();
  }
});

test("the mobile menu button opens the drawer with the rail inside a dialog", async () => {
  calls.me.mockResolvedValue({ ...teacher });
  const client = mountShell();
  try {
    fireEvent.click(screen.getByRole("button", { name: "Toggle sidebar" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
    expect(screen.getAllByRole("link", { name: "Home" }).length).toBeGreaterThan(0);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  } finally {
    client.clear();
  }
});

test("a logged-out user on an inner route sees the login link instead of the avatar", async () => {
  calls.me.mockResolvedValue(null);
  const client = mountShell(null, "/report/activity-1");
  try {
    expect(await screen.findByRole("link", { name: "Sign in" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Account" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Notifications" })).toBeNull();
  } finally {
    client.clear();
  }
});

test("the landing and login routes render bare without the rail", () => {
  calls.me.mockResolvedValue(null);
  const client = mountShell(null, "/login");
  try {
    expect(screen.getByText("page")).toBeTruthy();
    expect(document.querySelector("main")).toBeNull();
  } finally {
    client.clear();
  }
});

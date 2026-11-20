import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { setLocale } from "@/i18n";

vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));

interface Sent {
  path: string;
  body: unknown;
}

let sent: Sent[] = [];
let answer: (path: string) => Response = () => new Response(null, { status: 204 });

beforeEach(() => {
  sent = [];
  answer = () => new Response(null, { status: 204 });
  setLocale("en");
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/me") return Response.json(null);
      sent.push({ path, body: init?.body ? JSON.parse(String(init.body)) : null });
      return answer(path);
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
  return router;
}

test("forgot-password posts the email and shows the same confirmation whatever the account", async () => {
  await mountRoute("/forgot-password");

  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "someone@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

  expect((await screen.findByRole("status")).textContent).toContain("If an account uses this email");
  expect(sent).toEqual([{ path: "/api/auth/password/forgot", body: { email: "someone@example.com" } }]);
});

test("forgot-password shows an alert when the request fails", async () => {
  answer = () => Response.json({ code: "internal_error", message: "boom" }, { status: 500 });
  await mountRoute("/forgot-password");

  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "someone@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: "Send reset link" }));

  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});

test("reset-password sends the fragment token with the new password, then drops the token from the URL", async () => {
  const router = await mountRoute("/reset-password#token=abc.def");

  fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "new-password-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));

  expect(await screen.findByRole("status")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
  expect(sent).toEqual([{ path: "/api/auth/password/reset", body: { token: "abc.def", password: "new-password-1" } }]);
  expect(router.state.location.hash).toBe("");
});

test("reset-password with a rejected token offers a new link", async () => {
  answer = () => Response.json({ code: "reset_token_invalid", message: "invalid" }, { status: 400 });
  await mountRoute("/reset-password#token=stale.token");

  fireEvent.change(await screen.findByLabelText("New password"), { target: { value: "new-password-1" } });
  fireEvent.click(screen.getByRole("button", { name: "Set new password" }));

  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Request a new link" }).getAttribute("href")).toBe("/forgot-password");
  expect(screen.queryByLabelText("New password")).toBeNull();
});

test("reset-password without a token shows the invalid state and sends nothing", async () => {
  await mountRoute("/reset-password");

  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Request a new link" })).toBeTruthy();
  expect(screen.queryByLabelText("New password")).toBeNull();
  expect(sent).toEqual([]);
});

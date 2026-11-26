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

test("verify-email posts the fragment token once, confirms, and drops the token from the URL", async () => {
  const router = await mountRoute("/verify-email#token=abc.def");

  fireEvent.click(await screen.findByRole("button", { name: "Verify this address" }));

  expect(await screen.findByRole("status")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toContain("verified");
  expect(sent).toEqual([{ path: "/api/auth/email/verify", body: { token: "abc.def" } }]);
  expect(router.state.location.hash).toBe("");
});

test("verify-email with a rejected token offers a way back", async () => {
  answer = () => Response.json({ code: "verify_token_invalid", message: "invalid" }, { status: 400 });
  await mountRoute("/verify-email#token=stale.token");

  fireEvent.click(await screen.findByRole("button", { name: "Verify this address" }));

  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("alert").textContent).toContain("invalid or has expired");
  expect(screen.getByRole("link", { name: "Go to the classroom" }).getAttribute("href")).toBe("/home");
});

test("verify-email without a token shows the invalid state and sends nothing", async () => {
  await mountRoute("/verify-email");

  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
  expect(sent).toEqual([]);
});

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { setLocale } from "@/i18n";
import { routeTree } from "@/routeTree.gen";
import type { SoloThread, User } from "@socrates/shared";

const socket = vi.hoisted(() => ({
  send: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  readyState: 1,
  OPEN: 1,
  options: null as null | {
    agent: string;
    name: string;
    enabled?: boolean;
    onMessage: (event: { data: string }) => void;
    onClose?: () => void;
  },
}));

vi.mock("agents/react", () => ({
  useAgent: (options: NonNullable<typeof socket.options>) => {
    if (options.enabled !== false) socket.options = options;
    return socket;
  },
}));
vi.mock("@/components/SocratesCompanion", () => ({ SocratesWindow: () => null }));

const thread: SoloThread = {
  id: "solo_1",
  title: "What is justice?",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
};

function mountChat(path: string, user: User | null = { id: "u_1", name: "Socrates", isAdmin: false }) {
  let saved: SoloThread | undefined = path === "/chat" ? undefined : thread;
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const { pathname } = new URL(String(input), "http://localhost");
    if (pathname === "/api/me") return Response.json(user);
    if (pathname === "/api/auth/providers") return Response.json([]);
    if (pathname === "/api/notifications") return Response.json({ items: [] });
    if (pathname === "/api/solo/threads") {
      if (init?.method === "POST") {
        saved = { ...thread, ...JSON.parse(String(init.body)) };
        return Response.json(saved, { status: 201 });
      }
      return Response.json(saved ? [saved] : []);
    }
    if (pathname === `/api/solo/threads/${thread.id}` && saved) {
      if (init?.method === "DELETE") {
        saved = undefined;
        return new Response(null, { status: 204 });
      }
      if (init?.method === "PATCH") {
        saved = { ...saved, ...JSON.parse(String(init.body)), updatedAt: new Date().toISOString() };
      }
      return Response.json(saved);
    }
    return Response.json({ code: "not_found" }, { status: 404 });
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
  localStorage.clear();
  setLocale("en");
  socket.options = null;
  socket.send.mockClear();
  vi.stubGlobal("scrollTo", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

test("retries the first question with the same operation ID after a disconnect and clears it on receipt", async () => {
  const { fetch, router } = mountChat("/chat");
  const input = await screen.findByRole("textbox", { name: "Type a question you want to think through…" });
  fireEvent.change(input, { target: { value: thread.title } });
  fireEvent.click(screen.getByRole("button", { name: "Send" }));

  await waitFor(() => expect(socket.options).toMatchObject({ agent: "solo-chat", name: `u_1:${thread.id}` }));
  expect(router.state.location.href).toBe(`/chat/${thread.id}`);
  expect(fetch).toHaveBeenCalledWith("/api/solo/threads", expect.objectContaining({ method: "POST" }));

  const emitView = () => {
    socket.options?.onMessage({
      data: JSON.stringify({ type: "view", view: { conversation: { id: 1 }, entries: [], docs: {} } }),
    });
  };
  act(emitView);
  expect(router.state.location.state).toHaveProperty("soloQuestion.text", thread.title);
  act(() => socket.options?.onClose?.());
  act(emitView);

  const submits = socket.send.mock.calls.map(([frame]) => JSON.parse(frame)).filter((frame) => frame.type === "submit");
  expect(submits).toHaveLength(2);
  expect(submits[0]).toMatchObject({ input: thread.title, operationId: expect.any(String) });
  expect(submits[1]).toMatchObject({ input: thread.title, operationId: submits[0].operationId });
  act(() => {
    socket.options?.onMessage({
      data: JSON.stringify({
        type: "result",
        id: submits[1].id,
        result: { accepted: false, operationId: submits[1].operationId, session: "root" },
      }),
    });
  });
  await waitFor(() => expect(router.state.location.state).not.toHaveProperty("soloQuestion"));
});

test("renames a selected thread and returns to the composer when that thread is deleted", async () => {
  mountChat(`/chat/${thread.id}`);
  await screen.findByRole("link", { name: thread.title });
  fireEvent.click(screen.getByRole("button", { name: "Rename" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Rename" }), { target: { value: "A new title" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const renamed = await screen.findByRole("link", { name: "A new title" });
  expect(document.activeElement).toBe(renamed);
  fireEvent.click(screen.getByRole("button", { name: "Delete chat" }));
  fireEvent.click(within(screen.getByRole("alertdialog")).getByRole("button", { name: "Delete chat" }));
  await screen.findByRole("textbox", { name: "Type a question you want to think through…" });
  expect(screen.queryByRole("link", { name: "A new title" })).toBeNull();
});

test("requires a signed-in account on direct links to a solo thread", async () => {
  const { fetch, router } = mountChat(`/chat/${thread.id}`, null);
  await waitFor(() => expect(router.state.location.pathname).toBe("/login"));
  expect(router.state.location.search).toMatchObject({ next: `/chat/${thread.id}` });
  expect(fetch.mock.calls.some(([url]) => String(url).includes("/api/solo/threads"))).toBe(false);
});

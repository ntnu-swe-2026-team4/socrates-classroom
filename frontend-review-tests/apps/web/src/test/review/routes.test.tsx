import type { ReactNode } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { setLocale } from "@/i18n";

vi.mock("@/components/AppShell", () => ({ AppShell: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/landing/LandAnimation", () => ({ LandAnimation: () => null }));
vi.mock("@/components/SocratesStage", () => ({ SocratesStage: () => null }));
vi.mock("@/components/constellation/Scene3D", () => ({ default: () => null, CLUSTER_PALETTE: [] }));

const topic = {
  id: "topic-1",
  title: "Invitation topic",
  statement: "Discuss justice",
  summary: "A dilemma",
  prompts: [],
};
const history = [
  { id: "user-1", role: "user", text: "My saved question", at: "2026-11-05T00:00:00Z" },
  { id: "assistant-1", role: "assistant", text: "The saved reply", at: "2026-11-05T00:00:01Z" },
];

beforeEach(() => {
  localStorage.clear();
  setLocale("en");
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input), "http://localhost").pathname;
      const responses: Record<string, unknown> = {
        "/api/me": { id: "student-1", name: "Student", role: "student" },
        "/api/join/abcdef": { code: "abcdef", classroomName: "Class", topic },
        "/api/activities/activity-1": {
          id: "activity-1",
          classroomId: "class-1",
          classroomName: "Class",
          topic,
          finishedAt: null,
        },
        "/api/activities/activity-1/dialogue": history,
        "/api/topics": [topic],
      };
      if (path === "/socrates.glb") return new Response(new Uint8Array());
      if (!(path in responses)) throw new Error(`Unexpected request: ${path}`);
      return new Response(JSON.stringify(responses[path]), { headers: { "Content-Type": "application/json" } });
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
  return () => {
    cleanup();
    client.clear();
  };
}

test("F01: direct invitation URL renders the topic, name and required consent", async () => {
  const dispose = await mountRoute("/join/abcdef");
  try {
    expect(await screen.findByRole("heading", { name: "Invitation topic" })).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Your name" })).toBeTruthy();
    expect(screen.getByRole("checkbox")).toHaveProperty("checked", false);
    expect(screen.getByRole("button", { name: "Start the dialogue" })).toHaveProperty("disabled", true);
  } finally {
    dispose();
  }
});

test("F03: real dialogue route restores the user bubble rather than an assistant bubble", async () => {
  const dispose = await mountRoute("/dialogue?activityId=activity-1");
  try {
    const question = await screen.findByText("My saved question");
    await screen.findByText("The saved reply");
    await waitFor(() => expect(question.closest(".justify-end")).not.toBeNull());
    expect(screen.getByText("The saved reply").closest(".justify-end")).toBeNull();
  } finally {
    dispose();
  }
});

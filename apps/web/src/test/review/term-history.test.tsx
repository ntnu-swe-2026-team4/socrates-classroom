import { createRef } from "react";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, test, vi } from "vitest";
import { TermPanel, type TermPanelHandle } from "@/components/TermPanel";
import { readTermHistory } from "@/api/local";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
});

test("F17: successful lookup in the real panel persists its history", async () => {
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ term: "justice", markdown: "A definition" }), {
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const handle = createRef<TermPanelHandle>();
  try {
    render(
      <QueryClientProvider client={client}>
        <TermPanel ref={handle} open onClose={() => {}} />
      </QueryClientProvider>,
    );
    await act(async () => {
      handle.current?.openTerm("justice");
    });
    await screen.findByRole("heading", { name: "justice" });
    await waitFor(() => expect(readTermHistory().map((query) => query.term)).toEqual(["justice"]));
  } finally {
    cleanup();
    client.clear();
  }
});

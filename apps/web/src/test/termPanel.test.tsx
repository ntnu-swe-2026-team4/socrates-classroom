import { createRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TermPanel, type TermPanelHandle } from "@/components/TermPanel";
import { setLocale } from "@/i18n";

const lookupTerm = vi.fn();

vi.mock("@/api", () => ({
  api: {
    lookupTerm: (...args: unknown[]) => lookupTerm(...args),
    termHistory: vi.fn().mockResolvedValue([]),
  },
}));

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const handle = createRef<TermPanelHandle>();
  render(
    <QueryClientProvider client={client}>
      <TermPanel ref={handle} open onClose={() => {}} />
    </QueryClientProvider>,
  );
  return handle;
}

beforeEach(() => {
  setLocale("zh-TW");
  lookupTerm.mockReset();
});

describe("TermPanel lookup error → retry", () => {
  it("re-issues the request when retry is clicked after a failure", async () => {
    const user = userEvent.setup();
    const handle = renderPanel();
    lookupTerm.mockRejectedValueOnce(new Error("rate_limited"));

    await act(async () => {
      handle.current?.openTerm("正義");
    });

    await waitFor(() => expect(screen.getAllByText("出了點問題").length).toBeGreaterThan(0));
    expect(lookupTerm).toHaveBeenCalledTimes(1);

    lookupTerm.mockResolvedValueOnce({ term: "正義", markdown: "**正義** 的定義內容" });
    await user.click(screen.getByRole("button", { name: "重新查詢" }));

    await waitFor(() => expect(screen.getByText("正義", { selector: "h2" })).toBeTruthy());
    expect(lookupTerm).toHaveBeenCalledTimes(2);
  });
});

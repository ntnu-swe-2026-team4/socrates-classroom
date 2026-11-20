import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ProviderKeys } from "@/components/ProviderKeys";
import { setLocale } from "@/i18n";
import type { TeacherKeyStatus } from "@socrates/shared";

const calls = vi.hoisted(() => ({
  deleteTeacherKey: vi.fn().mockResolvedValue(undefined),
  deleteTeacherKeyModel: vi.fn().mockResolvedValue(undefined),
  putTeacherKeyProviderLimit: vi.fn().mockResolvedValue({
    provider: "openrouter",
    maxConcurrency: null,
  }),
  putTeacherKeyMonthlyQuota: vi.fn().mockResolvedValue({
    provider: "openrouter",
    monthlyQuotaUsd: null,
  }),
  listTeacherKeys: vi.fn(),
}));

vi.mock("@/api", () => ({
  api: {
    listTeacherKeys: calls.listTeacherKeys,
    listKeyProviders: vi.fn().mockResolvedValue([]),
    deleteTeacherKey: calls.deleteTeacherKey,
    deleteTeacherKeyModel: calls.deleteTeacherKeyModel,
    putTeacherKeyProviderLimit: calls.putTeacherKeyProviderLimit,
    putTeacherKeyMonthlyQuota: calls.putTeacherKeyMonthlyQuota,
  },
}));

const fixture: TeacherKeyStatus = {
  provider: "openrouter",
  last4: "abcd",
  maxConcurrency: null,
  monthlyQuotaUsd: null,
  monthCostUsd: 0,
  monthTokens: 0,
  sortOrder: 0,
  updatedAt: "2026-11-20T00:00:00.000Z",
  models: [{ model: "z-ai/glm-4.7-flash", maxConcurrency: null, sortOrder: 0 }],
};

function renderKeys() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <ProviderKeys />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  setLocale("en");
  calls.listTeacherKeys.mockResolvedValue([fixture]);
  calls.deleteTeacherKey.mockClear();
  calls.deleteTeacherKeyModel.mockClear();
  calls.putTeacherKeyProviderLimit.mockClear();
  calls.putTeacherKeyMonthlyQuota.mockClear();
});

afterEach(() => {
  cleanup();
});

const expandRow = async () => {
  await screen.findByRole("button", { name: /Drag to reorder/ });
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  await screen.findByRole("button", { name: "Delete provider" });
};

test("deleting a provider asks for confirmation and only then calls the API", async () => {
  renderKeys();
  await expandRow();
  fireEvent.click(screen.getByRole("button", { name: "Delete provider" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(calls.deleteTeacherKey).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(calls.deleteTeacherKey).toHaveBeenCalledWith("openrouter"));
});

test("canceling the provider delete leaves the row untouched", async () => {
  renderKeys();
  await expandRow();
  fireEvent.click(screen.getByRole("button", { name: "Delete provider" }));
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(calls.deleteTeacherKey).not.toHaveBeenCalled();
  expect(screen.queryByRole("alertdialog")).toBeNull();
});

test("removing a model leg asks for confirmation and names the model", async () => {
  renderKeys();
  await expandRow();
  fireEvent.click(screen.getByRole("button", { name: "Remove model z-ai/glm-4.7-flash" }));
  expect(screen.getByRole("alertdialog")).toBeTruthy();
  expect(calls.deleteTeacherKeyModel).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remove" }));
  await waitFor(() => expect(calls.deleteTeacherKeyModel).toHaveBeenCalledWith("openrouter", "z-ai/glm-4.7-flash"));
});

test("saving an invalid concurrency limit shows an inline error and keeps the editor open", async () => {
  renderKeys();
  await expandRow();
  fireEvent.click(screen.getByRole("button", { name: /Edit concurrency limit/i }));
  const input = screen.getByRole("spinbutton", { name: /Edit concurrency limit/i });
  fireEvent.change(input, { target: { value: "0" } });
  fireEvent.click(screen.getByRole("button", { name: "Save concurrency limit" }));
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.getByRole("spinbutton", { name: /Edit concurrency limit/i })).toBeTruthy();
});

test("editing the provider total cap calls the keyless limit endpoint", async () => {
  renderKeys();
  await expandRow();
  expect(screen.getByRole("button", { name: /total concurrency cap/i })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /total concurrency cap/i }));
  const input = screen.getByRole("spinbutton", { name: /total concurrency cap/i });
  fireEvent.change(input, { target: { value: "3" } });
  fireEvent.click(screen.getByRole("button", { name: "Save the total concurrency cap" }));
  await waitFor(() => expect(calls.putTeacherKeyProviderLimit).toHaveBeenCalledWith("openrouter", 3));
});

test("editing the monthly quota calls the keyless quota endpoint", async () => {
  renderKeys();
  await expandRow();
  fireEvent.click(screen.getByRole("button", { name: /monthly quota/i }));
  const input = screen.getByRole("spinbutton", { name: /monthly quota/i });
  fireEvent.change(input, { target: { value: "5" } });
  fireEvent.click(screen.getByRole("button", { name: "Save the monthly quota" }));
  await waitFor(() => expect(calls.putTeacherKeyMonthlyQuota).toHaveBeenCalledWith("openrouter", 5));
});

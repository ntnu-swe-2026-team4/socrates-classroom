import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { ProviderKeys } from "@/components/ProviderKeys";
import { setLocale } from "@/i18n";
import type { TeacherKeyStatus } from "@socrates/shared";

const calls = vi.hoisted(() => ({
  deleteTeacherKey: vi.fn().mockResolvedValue(undefined),
  deleteTeacherKeyModel: vi.fn().mockResolvedValue(undefined),
  orderTeacherKeys: vi.fn().mockResolvedValue(undefined),
  orderTeacherKeyModels: vi.fn().mockResolvedValue(undefined),
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
    orderTeacherKeys: calls.orderTeacherKeys,
    orderTeacherKeyModels: calls.orderTeacherKeyModels,
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

const keyOf = (provider: string, sortOrder: number): TeacherKeyStatus => ({
  ...fixture,
  provider,
  last4: `${provider.slice(0, 4)}${sortOrder}`,
  sortOrder,
  models: [],
});

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
  calls.orderTeacherKeys.mockClear();
  calls.orderTeacherKeyModels.mockClear();
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

const dragHandle = (provider: string) =>
  screen.getByRole("button", { name: `Drag to reorder — the higher one is tried first ${provider}` });

const sortIds = () =>
  Array.from(document.querySelectorAll("li[data-sort-id]")).map((li) => li.getAttribute("data-sort-id"));

async function renderOrderedKeys() {
  calls.listTeacherKeys.mockResolvedValue([keyOf("openrouter", 0), keyOf("deepseek", 1), keyOf("kimi", 2)]);
  renderKeys();
  await screen.findAllByRole("button", { name: /Drag to reorder/ });
}

test("Alt+ArrowDown on a handle persists the new provider order", async () => {
  await renderOrderedKeys();
  fireEvent.keyDown(dragHandle("openrouter"), { altKey: true, key: "ArrowDown" });
  await waitFor(() => expect(calls.orderTeacherKeys).toHaveBeenCalledWith(["deepseek", "openrouter", "kimi"]));
});

test("Alt+Shift+ArrowDown sends the provider to the bottom", async () => {
  await renderOrderedKeys();
  fireEvent.keyDown(dragHandle("openrouter"), { altKey: true, shiftKey: true, key: "ArrowDown" });
  await waitFor(() => expect(calls.orderTeacherKeys).toHaveBeenCalledWith(["deepseek", "kimi", "openrouter"]));
});

test("a pointer drag past the threshold commits the drop exactly once", async () => {
  await renderOrderedKeys();
  const handle = dragHandle("openrouter");
  fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientX: 8, clientY: 20 });
  fireEvent.pointerMove(handle, { pointerId: 7, clientX: 8, clientY: 70 });
  fireEvent.pointerUp(handle, { pointerId: 7 });
  await waitFor(() => expect(calls.orderTeacherKeys).toHaveBeenCalledTimes(1));
  expect(calls.orderTeacherKeys).toHaveBeenCalledWith(["deepseek", "kimi", "openrouter"]);
});

test("a scrolled list keeps the pointer displacement 1:1 with the dragged row", async () => {
  await renderOrderedKeys();
  const rows = Array.from(document.querySelectorAll<HTMLElement>("li[data-sort-id]"));
  const scrollY = 200;
  rows.forEach((row, index) => {
    Object.defineProperty(row, "offsetTop", { value: index * 30, configurable: true });
    Object.defineProperty(row, "offsetHeight", { value: 30, configurable: true });
    Object.defineProperty(row, "getBoundingClientRect", {
      value: () => ({
        top: index * 30 - scrollY,
        bottom: index * 30 - scrollY + 30,
        height: 30,
        left: 0,
        right: 0,
        width: 0,
        x: 0,
        y: 0,
      }),
      configurable: true,
    });
  });

  const handle = dragHandle("deepseek");
  fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientX: 8, clientY: 30 - scrollY + 15 });
  fireEvent.pointerMove(handle, { pointerId: 7, clientX: 8, clientY: 30 - scrollY + 21 });
  expect(rows[1]?.style.transform).toBe("translateY(6px)");
  fireEvent.pointerUp(handle, { pointerId: 7 });
  expect(calls.orderTeacherKeys).not.toHaveBeenCalled();
});

test("pressing a handle without crossing the threshold commits nothing", async () => {
  await renderOrderedKeys();
  const handle = dragHandle("openrouter");
  fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientX: 8, clientY: 20 });
  fireEvent.pointerUp(handle, { pointerId: 7 });
  expect(calls.orderTeacherKeys).not.toHaveBeenCalled();
});

test("Escape cancels an in-flight drag and nothing is persisted", async () => {
  await renderOrderedKeys();
  const handle = dragHandle("openrouter");
  fireEvent.pointerDown(handle, { button: 0, pointerId: 7, clientX: 8, clientY: 20 });
  fireEvent.pointerMove(handle, { pointerId: 7, clientX: 8, clientY: 70 });
  fireEvent.keyDown(handle, { key: "Escape" });
  fireEvent.pointerUp(handle, { pointerId: 7 });
  expect(calls.orderTeacherKeys).not.toHaveBeenCalled();
  expect(sortIds()).toEqual(["openrouter", "deepseek", "kimi"]);
});

test("a failed order save rolls the visual order back and reports the error", async () => {
  await renderOrderedKeys();
  calls.orderTeacherKeys.mockRejectedValueOnce(new Error("order rejected"));
  fireEvent.keyDown(dragHandle("openrouter"), { altKey: true, key: "ArrowDown" });
  expect((await screen.findByRole("alert")).textContent).toContain("order rejected");
  expect(sortIds()).toEqual(["openrouter", "deepseek", "kimi"]);
});

test("model legs reorder through the same handle semantics", async () => {
  calls.listTeacherKeys.mockResolvedValue([
    {
      ...fixture,
      models: [
        { model: "z-ai/glm-4.7-flash", maxConcurrency: null, sortOrder: 0 },
        { model: "z-ai/glm-4.6", maxConcurrency: null, sortOrder: 1 },
      ],
    },
  ]);
  renderKeys();
  await screen.findAllByRole("button", { name: /Drag to reorder/ });
  fireEvent.click(screen.getByRole("button", { expanded: false }));
  fireEvent.keyDown(
    screen.getByRole("button", { name: "Drag to reorder — the higher one is tried first z-ai/glm-4.7-flash" }),
    { altKey: true, key: "ArrowDown" },
  );
  await waitFor(() =>
    expect(calls.orderTeacherKeyModels).toHaveBeenCalledWith("openrouter", ["z-ai/glm-4.6", "z-ai/glm-4.7-flash"]),
  );
});

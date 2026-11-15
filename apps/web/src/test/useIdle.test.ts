import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { useIdle } from "@/hooks/useIdle";

const MINUTE = 60_000;
const TEN = 10 * MINUTE;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

test("nothing happens until the timeout has passed, then the page counts as idle", async () => {
  const { result } = renderHook(() => useIdle(TEN, true));
  await advance(TEN - MINUTE);
  expect(result.current.idle).toBe(false);
  await advance(2 * MINUTE);
  expect(result.current.idle).toBe(true);
});

test("pointer, keyboard, wheel and touch activity all push the timeout back", async () => {
  for (const name of ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"]) {
    const { result, unmount } = renderHook(() => useIdle(TEN, true));
    await advance(9 * MINUTE);
    act(() => {
      window.dispatchEvent(new Event(name));
    });
    await advance(9 * MINUTE);
    expect(result.current.idle, name).toBe(false);
    await advance(2 * MINUTE);
    expect(result.current.idle, name).toBe(true);
    unmount();
  }
});

test("activity does not undo a pause: only resume does, and it starts a fresh count", async () => {
  const { result } = renderHook(() => useIdle(TEN, true));
  await advance(TEN + MINUTE);
  expect(result.current.idle).toBe(true);
  act(() => {
    window.dispatchEvent(new Event("pointermove"));
  });
  await advance(MINUTE);
  expect(result.current.idle).toBe(true);
  act(() => result.current.resume());
  expect(result.current.idle).toBe(false);
  await advance(9 * MINUTE);
  expect(result.current.idle).toBe(false);
  await advance(2 * MINUTE);
  expect(result.current.idle).toBe(true);
});

test("when it is not watching nothing counts, and turning it off clears a pause", async () => {
  const { result, rerender } = renderHook(({ watching }) => useIdle(TEN, watching), {
    initialProps: { watching: false },
  });
  await advance(30 * MINUTE);
  expect(result.current.idle).toBe(false);
  rerender({ watching: true });
  await advance(TEN + MINUTE);
  expect(result.current.idle).toBe(true);
  rerender({ watching: false });
  expect(result.current.idle).toBe(false);
});

test("listeners and the timer are removed on unmount", async () => {
  const remove = vi.spyOn(window, "removeEventListener");
  const { unmount } = renderHook(() => useIdle(TEN, true));
  unmount();
  expect(remove.mock.calls.map((call) => call[0]).sort()).toEqual([
    "keydown",
    "pointerdown",
    "pointermove",
    "touchstart",
    "wheel",
  ]);
  expect(vi.getTimerCount()).toBe(0);
  remove.mockRestore();
});

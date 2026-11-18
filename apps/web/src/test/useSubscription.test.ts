import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useDomEvent, useElapsed, useMediaQuery, useNow } from "@/hooks/useSubscription";

describe("useSubscription helpers", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("useElapsed", () => {
    it("flips false → true after the window passes and stays true", async () => {
      const { result } = renderHook(() => useElapsed(3000));
      expect(result.current).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(2999);
      });
      expect(result.current).toBe(false);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1);
      });
      expect(result.current).toBe(true);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(result.current).toBe(true);
    });

    it("cancels the timer on unmount", async () => {
      const { result, unmount } = renderHook(() => useElapsed(3000));
      unmount();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(result.current).toBe(false);
    });
  });

  describe("useMediaQuery", () => {
    it("reflects the current match and follows change events", () => {
      let matches = false;
      let notify: (() => void) | null = null;
      const listeners = new Set<() => void>();
      window.matchMedia = vi.fn().mockImplementation((query: string) => ({
        get matches() {
          return matches && query === "(min-width: 600px)";
        },
        addEventListener: (_type: string, listener: () => void) => {
          listeners.add(listener);
          notify = listener;
        },
        removeEventListener: (_type: string, listener: () => void) => {
          listeners.delete(listener);
        },
      }));

      const { result, unmount } = renderHook(() => useMediaQuery("(min-width: 600px)"));
      expect(result.current).toBe(false);

      matches = true;
      act(() => {
        notify?.();
      });
      expect(result.current).toBe(true);

      unmount();
      expect(listeners.size).toBe(0);
    });
  });

  describe("useNow", () => {
    it("ticks on the interval and notifies subscribers", async () => {
      const { result } = renderHook(() => useNow(1000));
      const atStart = result.current;

      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      const firstTick = result.current;
      expect(firstTick).toBeGreaterThan(atStart);

      await act(async () => {
        await vi.advanceTimersByTimeAsync(2500);
      });
      expect(result.current).toBeGreaterThan(firstTick);
    });
  });

  describe("useDomEvent", () => {
    it("always invokes the latest handler", () => {
      const target = new EventTarget();
      const first = vi.fn();
      const second = vi.fn();
      const { rerender } = renderHook(({ handler }) => useDomEvent<CustomEvent>(target, "ping", handler), {
        initialProps: { handler: first },
      });
      target.dispatchEvent(new CustomEvent("ping"));
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).not.toHaveBeenCalled();

      rerender({ handler: second });
      target.dispatchEvent(new CustomEvent("ping"));
      expect(first).toHaveBeenCalledTimes(1);
      expect(second).toHaveBeenCalledTimes(1);
    });

    it("detaches on unmount", () => {
      const target = new EventTarget();
      const handler = vi.fn();
      const { unmount } = renderHook(() => useDomEvent<CustomEvent>(target, "ping", handler));
      unmount();
      target.dispatchEvent(new CustomEvent("ping"));
      expect(handler).not.toHaveBeenCalled();
    });
  });
});

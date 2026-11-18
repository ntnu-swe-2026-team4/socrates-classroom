import { useCallback, useRef, useSyncExternalStore } from "react";

const returnZero = () => 0;
const returnFalse = () => false;

export function useDomEvent<E extends Event>(
  target: EventTarget | null | undefined,
  type: string,
  handler: (event: E) => void,
  capture = false,
): void {
  const latest = useRef(handler);
  latest.current = handler;
  const subscribe = useCallback(
    (_notify: () => void) => {
      if (!target) return () => {};
      const listener = (event: Event) => latest.current(event as E);
      target.addEventListener(type, listener, capture);
      return () => target.removeEventListener(type, listener, capture);
    },
    [target, type, capture],
  );
  useSyncExternalStore(subscribe, returnZero, returnZero);
}

export function useOnUnmount(cleanup: () => void): void {
  const latest = useRef(cleanup);
  latest.current = cleanup;
  const subscribe = useCallback(() => () => latest.current(), []);
  useSyncExternalStore(subscribe, returnZero, returnZero);
}

export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const mql = window.matchMedia?.(query);
      if (!mql) return () => {};
      mql.addEventListener("change", notify);
      return () => mql.removeEventListener("change", notify);
    },
    [query],
  );
  return useSyncExternalStore(subscribe, () => window.matchMedia?.(query).matches ?? false, returnFalse);
}

export function useElapsed(ms: number): boolean {
  const deadlineRef = useRef(0);
  if (deadlineRef.current === 0) deadlineRef.current = Date.now() + ms;
  const subscribe = useCallback((notify: () => void) => {
    const remaining = deadlineRef.current - Date.now();
    if (remaining <= 0) return () => {};
    const id = setTimeout(notify, remaining);
    return () => clearTimeout(id);
  }, []);
  return useSyncExternalStore(subscribe, () => Date.now() >= deadlineRef.current, returnFalse);
}

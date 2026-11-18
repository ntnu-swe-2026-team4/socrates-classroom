import { useCallback, useRef, useLayoutEffect, useSyncExternalStore } from "react";

const returnZero = () => 0;
const returnFalse = () => false;
const mountedNow = Date.now();

export function useDomEvent<E extends Event>(
  target: EventTarget | null | undefined,
  type: string,
  handler: (event: E) => void,
  capture = false,
): void {
  const latest = useRef(handler);
  useLayoutEffect(() => {
    latest.current = handler;
  });
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
  useLayoutEffect(() => {
    latest.current = cleanup;
  });
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
  const doneRef = useRef(false);
  const subscribe = useCallback(
    (notify: () => void) => {
      const id = setTimeout(() => {
        doneRef.current = true;
        notify();
      }, ms);
      return () => clearTimeout(id);
    },
    [ms],
  );
  return useSyncExternalStore(subscribe, () => doneRef.current, returnFalse);
}

export function useNow(intervalMs: number): number {
  const nowRef = useRef(mountedNow);
  const subscribe = useCallback(
    (notify: () => void) => {
      const id = setInterval(() => {
        nowRef.current = Date.now();
        notify();
      }, intervalMs);
      return () => clearInterval(id);
    },
    [intervalMs],
  );
  return useSyncExternalStore(
    subscribe,
    () => nowRef.current,
    () => mountedNow,
  );
}

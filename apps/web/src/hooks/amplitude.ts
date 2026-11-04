import { useSyncExternalStore } from "react";

export function amplitudeStore() {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    get: () => value,
    set: (next: number) => {
      if (Math.abs(next - value) < 0.02) return;
      value = next;
      for (const notify of listeners) notify();
    },
    subscribe: (notify: () => void) => {
      listeners.add(notify);
      return () => listeners.delete(notify);
    },
    snapshot: () => value,
  };
}

export function useAmplitude(store: ReturnType<typeof amplitudeStore>): number {
  return useSyncExternalStore(store.subscribe, store.snapshot);
}

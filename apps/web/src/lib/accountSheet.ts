import { useSyncExternalStore } from "react";

let version = 0;
const listeners = new Set<() => void>();

function subscribe(notify: () => void) {
  listeners.add(notify);
  return () => {
    listeners.delete(notify);
  };
}

function getSnapshot() {
  return version;
}

export function openAccountSheet() {
  version += 1;
  for (const notify of listeners) notify();
}

export function useAccountSheetRequest(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

import { useSyncExternalStore } from "react";

export const TOUR_STEPS = ["home", "chat", "classrooms", "notifications", "theme", "account"] as const;
export type TourStep = (typeof TOUR_STEPS)[number];

const listeners = new Set<() => void>();
const memory = new Set<string>();
let requested = false;

function storageKey(userId: string): string {
  return `tour-seen:${userId}`;
}

function seen(userId: string): boolean {
  const key = storageKey(userId);
  if (memory.has(key)) return true;
  try {
    return localStorage.getItem(key) === "1";
  } catch {
    return false;
  }
}

function emit(): void {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function startTour(): void {
  if (requested) return;
  requested = true;
  emit();
}

export function finishTour(userId: string): void {
  const key = storageKey(userId);
  requested = false;
  memory.add(key);
  try {
    localStorage.setItem(key, "1");
  } catch {}
  emit();
}

export function resetTourMemory(): void {
  requested = false;
  memory.clear();
  emit();
}

export function useTourActive(userId: string | undefined): boolean {
  return useSyncExternalStore(
    subscribe,
    () => userId !== undefined && (requested || !seen(userId)),
    () => false,
  );
}

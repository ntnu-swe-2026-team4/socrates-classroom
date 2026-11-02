type Listener = (payload: string) => void;

const listeners = new Map<string, Set<Listener>>();

export function publish(activityId: string, event: Record<string, unknown>): void {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const listener of listeners.get(activityId) ?? []) {
    try {
      listener(payload);
    } catch {
      /* 斷線的訂閱者會在 close 時移除 */
    }
  }
}

export function subscribe(activityId: string, listener: Listener): () => void {
  let set = listeners.get(activityId);
  if (!set) {
    set = new Set();
    listeners.set(activityId, set);
  }
  set.add(listener);
  return () => {
    set!.delete(listener);
    if (!set!.size) listeners.delete(activityId);
  };
}

export function subscriberCount(activityId: string): number {
  return listeners.get(activityId)?.size ?? 0;
}

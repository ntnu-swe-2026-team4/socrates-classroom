const EVENT = "socrates:open-account";

export function openAccountSheet() {
  window.dispatchEvent(new Event(EVENT));
}

export function onOpenAccountSheet(listener: () => void): () => void {
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}

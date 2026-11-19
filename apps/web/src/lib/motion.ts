export function onReducedMotionChange(listener: (still: boolean) => void): () => void {
  const mql = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  if (!mql?.addEventListener) return () => {};
  const handler = (event: MediaQueryListEvent) => listener(event.matches);
  mql.addEventListener("change", handler);
  return () => mql.removeEventListener("change", handler);
}

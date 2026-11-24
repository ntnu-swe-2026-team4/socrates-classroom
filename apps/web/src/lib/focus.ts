const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusNextIn(container: HTMLElement): void {
  const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
  if (focusable.length === 0) return;
  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const current = active === null ? -1 : focusable.indexOf(active);
  focusable[current === focusable.length - 1 ? 0 : current + 1]?.focus();
}

export function focusRestoreOnUnmount(): () => void {
  const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  return () => restore?.focus();
}

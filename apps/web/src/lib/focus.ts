const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function focusNextIn(container: HTMLElement): void {
  const focusable = [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
  if (focusable.length === 0) return;
  const current = focusable.indexOf(document.activeElement as HTMLElement);
  focusable[current === focusable.length - 1 ? 0 : current + 1]?.focus();
}

export function focusRestoreOnUnmount(): () => void {
  const restore = document.activeElement as HTMLElement | null;
  return () => restore?.focus();
}

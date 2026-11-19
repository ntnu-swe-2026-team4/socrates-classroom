import { vi } from "vitest";

export function stubElementLayout(): () => void {
  const spy = vi.spyOn(Element.prototype, "getClientRects");
  spy.mockImplementation(() => [{}] as unknown as DOMRectList);
  return () => spy.mockRestore();
}

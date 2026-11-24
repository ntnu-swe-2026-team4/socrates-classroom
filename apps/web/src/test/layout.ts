import { vi } from "vitest";

export function stubElementLayout(): () => void {
  const spy = vi.spyOn(Element.prototype, "getClientRects");
  const rects: DOMRectList = Object.assign([new DOMRect(0, 0, 0, 0)], {
    item: (index: number) => (index === 0 ? new DOMRect(0, 0, 0, 0) : null),
    length: 1,
  });
  spy.mockImplementation(() => rects);
  return () => spy.mockRestore();
}

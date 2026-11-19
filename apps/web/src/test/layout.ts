export function stubElementLayout(): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(Element.prototype, "getClientRects");
  Object.defineProperty(Element.prototype, "getClientRects", {
    value: () => [{}],
    configurable: true,
  });
  return () => {
    if (!descriptor) {
      delete (Element.prototype as { getClientRects?: unknown }).getClientRects;
      return;
    }
    Object.defineProperty(Element.prototype, "getClientRects", descriptor);
  };
}

export function stubElementLayout() {
  Object.defineProperty(Element.prototype, "getClientRects", {
    value: () => [{}],
    configurable: true,
  });
}

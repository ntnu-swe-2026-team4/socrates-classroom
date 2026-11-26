import { useRef, useState } from "react";
import { useDomEvent } from "@/hooks/useSubscription";

export interface SelectionState {
  text: string;
  x: number;
  y: number;
  anchor: "top" | "bottom";
}

const MAX_LEN = 30;
const EDGE_GAP = 12;
const DOCK_ZONE = 96;

export function selectionPopoverClass(selection: SelectionState): string {
  return selection.anchor === "bottom" ? "-translate-y-full" : "";
}

function dockAwayFromNativeToolbar(
  range: DOMRect,
  bounds: DOMRect,
  clampX: (rawX: number) => number,
): Omit<SelectionState, "text"> {
  const x = clampX(bounds.left + bounds.width / 2);
  if (range.bottom > bounds.bottom - DOCK_ZONE) return { x, y: bounds.top + EDGE_GAP, anchor: "top" };
  return { x, y: bounds.bottom - EDGE_GAP, anchor: "bottom" };
}

export function useSelectionPopover(containerRef: React.RefObject<HTMLElement | null>) {
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const pointerType = useRef("mouse");

  const onSelectionChange = () => {
    const s = window.getSelection();
    const host = containerRef.current;
    if (!s || s.isCollapsed || s.rangeCount === 0 || !host || !host.contains(s.anchorNode)) {
      setSelection(null);
      return;
    }
    const text = s.toString().trim();
    if (!text || text.length > MAX_LEN) {
      setSelection(null);
      return;
    }
    const rect = s.getRangeAt(0).getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) {
      setSelection(null);
      return;
    }
    const clampX = (rawX: number) => Math.min(Math.max(rawX, 150), window.innerWidth - 150);
    if (pointerType.current === "mouse") {
      setSelection({ text, x: clampX(rect.left + rect.width / 2), y: rect.top - 8, anchor: "bottom" });
      return;
    }
    setSelection({ text, ...dockAwayFromNativeToolbar(rect, host.getBoundingClientRect(), clampX) });
  };
  const onPointerDown = (event: PointerEvent) => {
    pointerType.current = event.pointerType || "mouse";
  };
  const onScroll = () => setSelection(null);

  useDomEvent(document, "pointerdown", onPointerDown, true);
  useDomEvent(document, "selectionchange", onSelectionChange);
  useDomEvent(document, "pointerup", onSelectionChange);
  useDomEvent(document, "scroll", onScroll, true);

  const clear = () => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  return { selection, clear };
}

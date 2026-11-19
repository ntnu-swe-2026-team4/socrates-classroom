import { useState } from "react";
import { useDomEvent } from "@/hooks/useSubscription";

export interface SelectionState {
  text: string;
  x: number;
  y: number;
}

const MAX_LEN = 30;

export function useSelectionPopover(containerRef: React.RefObject<HTMLElement | null>) {
  const [selection, setSelection] = useState<SelectionState | null>(null);

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
    const rawX = rect.left + rect.width / 2;
    const x = Math.min(Math.max(rawX, 150), window.innerWidth - 150);
    setSelection({ text, x, y: rect.top });
  };
  const onScroll = () => setSelection(null);

  useDomEvent(document, "selectionchange", onSelectionChange);
  useDomEvent(document, "pointerup", onSelectionChange);
  useDomEvent(document, "scroll", onScroll, true);

  const clear = () => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  return { selection, clear };
}

import { useEffect, useState } from "react";

export interface SelectionState {
  text: string;
  x: number;
  y: number;
}

export function useSelectionPopover(containerRef: React.RefObject<HTMLElement | null>) {
  const [selection, setSelection] = useState<SelectionState | null>(null);

  useEffect(() => {
    const onUp = () => {
      const s = window.getSelection();
      if (!s || s.isCollapsed || s.rangeCount === 0) {
        setSelection(null);
        return;
      }
      const text = s.toString().trim();
      if (!text || text.length > 40) {
        setSelection(null);
        return;
      }
      const range = s.getRangeAt(0);
      const host = containerRef.current;
      if (!host?.contains(range.commonAncestorContainer)) {
        setSelection(null);
        return;
      }
      const rect = range.getBoundingClientRect();
      setSelection({ text, x: rect.left + rect.width / 2, y: rect.top });
    };
    const onScroll = () => setSelection(null);
    document.addEventListener("pointerup", onUp);
    for (const el of document.querySelectorAll(".stream-scroll")) el.addEventListener("scroll", onScroll);
    return () => {
      document.removeEventListener("pointerup", onUp);
      for (const el of document.querySelectorAll(".stream-scroll")) el.removeEventListener("scroll", onScroll);
    };
  }, [containerRef]);

  const clear = () => {
    window.getSelection()?.removeAllRanges();
    setSelection(null);
  };

  return { selection, clear };
}

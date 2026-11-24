import { useRef, useState } from "react";
import type { FocusEvent, KeyboardEvent, PointerEvent } from "react";
import { useDomEvent } from "@/hooks/useSubscription";

const DRAG_THRESHOLD = 4;

type PointerHandler = (event: PointerEvent<HTMLButtonElement>) => void;
type KeyHandler = (event: KeyboardEvent<HTMLButtonElement>) => void;
type BlurHandler = (event: FocusEvent<HTMLButtonElement>) => void;

export interface SortableOrderOptions {
  ids: string[];
  save: (ids: string[]) => Promise<void>;
  onError: (message: string) => void;
}

export interface SortHandleProps {
  onPointerDown: PointerHandler;
  onPointerMove: PointerHandler;
  onPointerUp: PointerHandler;
  onPointerCancel: PointerHandler;
  onKeyDown: KeyHandler;
  onBlur: BlurHandler;
}

interface DragRow {
  id: string;
  node: HTMLElement;
}

interface DragSession {
  from: number;
  pointerId: number;
  startY: number;
  active: boolean;
  to: number;
  rows: DragRow[];
}

const sameMembers = (a: string[], b: string[]) => a.length === b.length && a.every((id) => b.includes(id));

const rowOfHandle = (event: { currentTarget: EventTarget & HTMLButtonElement }) =>
  event.currentTarget.closest<HTMLElement>("li[data-sort-id]");

const collectRows = (root: HTMLElement | null): DragRow[] => {
  if (!root) return [];
  return Array.from(root.querySelectorAll<HTMLElement>("li[data-sort-id]")).map((node) => ({
    id: node.dataset.sortId ?? "",
    node,
  }));
};

const liftRow = (node: HTMLElement) => {
  node.style.position = "relative";
  node.style.zIndex = "10";
  node.style.boxShadow = "0 12px 28px rgb(0 0 0 / 0.18)";
};

const releaseRow = (node: HTMLElement) => {
  node.style.transform = "";
  node.style.position = "";
  node.style.zIndex = "";
  node.style.boxShadow = "";
};

/**
 * magpie dragRows geometry: the pressed row follows the pointer as a
 * transform while passed rows shift by one row height; the destination comes
 * from midpoint crossing with endpoint overrides at the clamped top/bottom.
 */
const paint = (drag: DragSession, pointerY: number) => {
  const boxes = drag.rows.map((row) => ({
    node: row.node,
    top: row.node.offsetTop,
    height: row.node.offsetHeight,
  }));
  const first = boxes[0];
  const last = boxes[boxes.length - 1];
  const fromIndex = drag.from;
  const from = boxes[fromIndex];
  if (boxes.length < 2 || first === undefined || last === undefined || from === undefined) return;

  const raw = pointerY - drag.startY;
  const min = first.top - from.top;
  const max = last.top + last.height - from.top - from.height;
  const lift = Math.min(Math.max(raw, min), max);
  let to = fromIndex;
  if (raw <= min) to = 0;
  else if (raw >= max) to = boxes.length - 1;
  else {
    const mid = from.top + lift + from.height / 2;
    let above = boxes[to - 1];
    while (above !== undefined && mid < above.top + above.height / 2) {
      to -= 1;
      above = boxes[to - 1];
    }
    let below = boxes[to + 1];
    while (below !== undefined && mid > below.top + below.height / 2) {
      to += 1;
      below = boxes[to + 1];
    }
  }
  drag.to = to;

  const nextRow = boxes[fromIndex + 1];
  const gapBelow = nextRow === undefined ? 0 : nextRow.top - from.top - from.height;
  const shift = from.height + gapBelow;
  boxes.forEach((box, i) => {
    if (i === fromIndex) {
      box.node.style.transform = `translateY(${lift}px)`;
      return;
    }
    let offset = 0;
    if (to > fromIndex && i > fromIndex && i <= to) offset = -shift;
    else if (to < fromIndex && i >= to && i < fromIndex) offset = shift;
    box.node.style.transform = offset === 0 ? "" : `translateY(${offset}px)`;
  });
};

const release = (drag: DragSession) => {
  for (const row of drag.rows) releaseRow(row.node);
};

/**
 * Shared pointer-capture row sorter ported from magpie's `dragRows`
 * (yetone/magpie, internal/gui/assets/app.js). Commit happens exactly once on
 * pointerup and only when the destination differs from the origin; saves are
 * optimistic, roll back on failure, and a sequence counter keeps an older
 * in-flight save from clobbering a newer move.
 */
export function useSortableOrder({ ids, save, onError }: SortableOrderOptions) {
  const [pending, setPending] = useState<{ base: string[]; next: string[] } | null>(null);
  const session = useRef<DragSession | null>(null);
  const seq = useRef(0);

  const order = pending && sameMembers(pending.base, ids) ? pending.next : ids;

  const commit = (from: number, to: number, source: string[]) => {
    if (to === from || to < 0 || to >= source.length) return;
    const next = [...source];
    next.splice(to, 0, ...next.splice(from, 1));
    setPending({ base: ids, next });
    const mine = ++seq.current;
    save(next)
      .then(() => {
        if (seq.current === mine) setPending(null);
      })
      .catch((error: unknown) => {
        if (seq.current === mine) setPending(null);
        onError(error instanceof Error ? error.message : String(error));
      });
  };

  const cancel = () => {
    const drag = session.current;
    if (!drag) return;
    session.current = null;
    if (drag.active) release(drag);
  };

  useDomEvent(window, "resize", cancel);

  const handleProps: SortHandleProps = {
    onPointerDown: (event) => {
      if (event.button !== undefined && event.button !== 0) return;
      const row = rowOfHandle(event);
      if (!row || order.length < 2) return;
      const id = row.dataset.sortId ?? "";
      const from = order.indexOf(id);
      if (from < 0) return;
      session.current = {
        from,
        pointerId: event.pointerId,
        startY: event.clientY,
        active: false,
        to: from,
        rows: collectRows(row.parentElement),
      };
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // synthetic or inactive pointers have nothing to capture; the drag
        // then only tracks while the pointer stays over the handle
      }
    },
    onPointerMove: (event) => {
      const drag = session.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      if (!drag.active) {
        if (Math.abs(event.clientY - drag.startY) < DRAG_THRESHOLD) return;
        drag.active = true;
        const node = drag.rows[drag.from]?.node;
        if (node) liftRow(node);
      }
      paint(drag, event.clientY);
    },
    onPointerUp: (event) => {
      const drag = session.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      session.current = null;
      if (!drag.active) return;
      release(drag);
      commit(drag.from, drag.to, order);
    },
    onPointerCancel: cancel,
    onBlur: cancel,
    onKeyDown: (event) => {
      if (event.key === "Escape") {
        cancel();
        return;
      }
      if (!event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
      const row = rowOfHandle(event);
      const id = row?.dataset.sortId ?? "";
      const from = order.indexOf(id);
      if (from < 0) return;
      event.preventDefault();
      const delta = event.key === "ArrowUp" ? -1 : 1;
      const to = event.shiftKey ? (delta < 0 ? 0 : order.length - 1) : from + delta;
      commit(from, to, order);
    },
  };

  return {
    order,
    handleProps,
  };
}

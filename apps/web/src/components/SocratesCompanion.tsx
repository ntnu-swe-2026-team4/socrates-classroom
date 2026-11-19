import {
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ChevronLeft, ChevronRight, GripHorizontal, Square, UserRound } from "lucide-react";
import { cn } from "@/components/ui";
import { usePersistentFlag } from "@/hooks/usePersistentFlag";
import { useT } from "@/i18n";
import { attachScene, useCompanion } from "@/lib/companion";
import { createSocratesScene } from "@/lib/socrates/scene";
import { stopSpeech } from "@/lib/speech";
import { createFrameLoop } from "@/lib/frameLoop";

export const COMPANION_DOCK_ATTR = "data-companion-dock";

interface DockRect {
  x: number;
  y: number;
  size: number;
}

const HEIGHT_KEY = "socrates_window_y";
const EDGE_GAP = 8;
const DRAG_SLOP = 4;
const KEY_STEP = 0.05;
const DOCK_SETTLE_FRAMES = 3;
const OPEN_HEIGHT = "calc(2.25rem + 3px + min(196px, 26dvh))";

const unit = (value: number) => Math.min(1, Math.max(0, value));

function readHeight(): number {
  try {
    const value = Number.parseFloat(localStorage.getItem(HEIGHT_KEY) ?? "");
    return Number.isFinite(value) ? unit(value) : 0;
  } catch {
    return 0;
  }
}

export function SocratesWindow({ bottomInset = 0 }: { bottomInset?: number }) {
  const t = useT();
  const { visible } = useCompanion();
  const wide = typeof window === "undefined" || !window.matchMedia?.("(max-width: 767px)").matches;
  const [open, setOpen] = usePersistentFlag("socrates_panel_open", wide);
  const [settled, setSettled] = useState(true);
  const [height, setHeight] = useState(readHeight);
  const rootRef = useRef<HTMLElement>(null);
  const dragged = useRef(false);

  if (!visible) return null;

  const place = (next: number) => setHeight(unit(next));
  const persistHeight = (value: number) => {
    try {
      localStorage.setItem(HEIGHT_KEY, String(value));
    } catch {}
  };

  const startDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const node = rootRef.current;
    const frame = node?.offsetParent?.getBoundingClientRect();
    if (!node || !frame) return;
    const startY = event.clientY;
    const grab = startY - node.getBoundingClientRect().top;
    const full = 39 + Math.min(196, window.innerHeight * 0.26);
    const span = frame.height - bottomInset - EDGE_GAP * 2 - full;
    dragged.current = false;
    let committed = 0;
    const move = (moveEvent: PointerEvent) => {
      if (!dragged.current && Math.abs(moveEvent.clientY - startY) < DRAG_SLOP) return;
      dragged.current = true;
      committed = span > 0 ? (moveEvent.clientY - grab - frame.top - EDGE_GAP) / span : 0;
      place(committed);
    };
    const stop = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      if (dragged.current) persistHeight(committed);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  };

  const nudge = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "ArrowUp" || event.key === "ArrowDown") {
      event.preventDefault();
      const next = unit(height + (event.key === "ArrowUp" ? -KEY_STEP : KEY_STEP));
      place(next);
      persistHeight(next);
    }
  };

  const toggle = () => {
    if (dragged.current) {
      dragged.current = false;
      return;
    }
    setSettled(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true);
    setOpen(!open);
  };

  const label = open ? t("companion_hide") : t("companion_show");
  const Icon = open ? ChevronRight : ChevronLeft;
  return (
    <section
      ref={rootRef}
      data-companion-panel={open ? "open" : "closed"}
      onTransitionEnd={(event) => {
        if (event.target === event.currentTarget) setSettled(true);
      }}
      className={cn(
        "absolute right-0 z-10 w-[min(247px,64vw)] border border-r-0 border-line-strong bg-paper shadow-sm transition-transform duration-200 motion-reduce:transition-none",
        !open && "translate-x-[calc(100%-2.25rem)]",
      )}
      style={{
        top: `calc(${EDGE_GAP}px + ${height} * (100% - ${bottomInset + EDGE_GAP * 2}px - ${OPEN_HEIGHT}))`,
      }}
    >
      <div className="flex h-9 items-stretch">
        <button
          type="button"
          data-companion-toggle
          onPointerDown={startDrag}
          onClick={toggle}
          aria-expanded={open}
          aria-label={label}
          title={label}
          className="flex w-9 shrink-0 cursor-pointer touch-none items-center justify-center border-r border-line text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
        >
          <Icon className="size-4" aria-hidden />
        </button>
        <button
          type="button"
          data-companion-drag
          tabIndex={open ? 0 : -1}
          onPointerDown={startDrag}
          onKeyDown={nudge}
          aria-label={t("companion_move")}
          title={t("companion_move")}
          className="flex min-w-0 flex-1 cursor-ns-resize touch-none items-center gap-1.5 px-2 text-[12.5px] text-ink-soft outline-none transition-colors hover:text-ink focus-visible:bg-paper-deep"
        >
          <span className="min-w-0 flex-1 truncate text-left">{t("dlg_socrates")}</span>
          <GripHorizontal className="size-3.5 shrink-0 text-ink-faint" aria-hidden />
        </button>
      </div>
      {open && (
        <div className="flex h-[min(196px,26dvh)] items-end justify-center overflow-hidden border-t border-line">
          {settled && <div {...{ [COMPANION_DOCK_ATTR]: "" }} className="aspect-square h-full" />}
        </div>
      )}
    </section>
  );
}

function measureDock(): DockRect | null {
  const box = document.querySelector(`[${COMPANION_DOCK_ATTR}]`)?.getBoundingClientRect();
  return box && box.width > 0 ? { x: Math.round(box.left), y: Math.round(box.top), size: Math.round(box.width) } : null;
}

function useDockRect(): DockRect | null {
  const cacheRef = useRef<DockRect | null | undefined>(undefined);
  const read = () => {
    if (cacheRef.current === undefined) cacheRef.current = measureDock();
    return cacheRef.current;
  };
  const subscribe = useCallback((notify: () => void) => {
    const sync = () => {
      const prev = cacheRef.current ?? null;
      const next = measureDock();
      if (prev?.x !== next?.x || prev?.y !== next?.y || prev?.size !== next?.size) {
        cacheRef.current = next;
        notify();
      }
    };
    let settledFrames = 0;
    const loop = createFrameLoop(() => {
      const before = cacheRef.current;
      sync();
      if (cacheRef.current === null) return false;
      settledFrames = cacheRef.current === before ? settledFrames + 1 : 0;
      return settledFrames < DOCK_SETTLE_FRAMES;
    });
    const schedule = loop.wake;
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    window.addEventListener("resize", schedule);
    sync();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      loop.stop();
    };
  }, []);
  return useSyncExternalStore(subscribe, read, () => null);
}

export function SocratesCompanion() {
  const { visible } = useCompanion();
  const dock = useDockRect();
  if (!visible || !dock) return null;
  return <CompanionBody dock={dock} />;
}

function CompanionBody({ dock }: { dock: DockRect }) {
  const t = useT();
  const state = useCompanion();
  const [modelState, setModelState] = useState<"loading" | "ready" | "error">("loading");

  const attachStage = useCallback((stage: HTMLSpanElement | null) => {
    if (!stage) return;
    const canvas = document.createElement("canvas");
    canvas.className = "block size-full";
    stage.prepend(canvas);
    let detach: () => void = () => {};
    let dispose: () => void = () => {};
    try {
      const scene = createSocratesScene(canvas, stage, {
        mini: true,
        onReady: () => setModelState("ready"),
        onError: () => setModelState("error"),
      });
      detach = attachScene(scene);
      dispose = () => scene.dispose();
    } catch {
      canvas.remove();
      setModelState("error");
      return;
    }
    return () => {
      detach();
      dispose();
      canvas.remove();
    };
  }, []);

  return (
    <div
      className="pointer-events-none fixed z-30"
      style={{ left: dock.x, top: dock.y, width: dock.size, height: dock.size }}
    >
      <div
        role="img"
        aria-label={t("dlg_socrates")}
        aria-busy={modelState === "loading"}
        className="relative size-full select-none"
      >
        <span
          ref={attachStage}
          title={t("companion_rotate")}
          className="pointer-events-auto absolute inset-0 block cursor-grab touch-none active:cursor-grabbing"
        />
        {modelState === "loading" && (
          <span className="absolute inset-x-0 bottom-1 text-center text-[11px] text-ink-faint">
            {t("companion_loading")}
          </span>
        )}
        {modelState === "error" && (
          <span className="absolute inset-[18%] flex flex-col items-center justify-center gap-1 rounded-full border border-line-strong bg-card text-center text-[11px] text-ink-faint">
            <UserRound className="size-6 text-ink-soft" aria-hidden />
            {t("companion_error")}
          </span>
        )}
      </div>

      {state.speakingSource && (
        <div className="anim-fade pointer-events-auto absolute bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-line-strong bg-paper py-0.5 pr-0.5 pl-2.5 text-[11.5px] text-ink-soft shadow-sm">
          <span className="size-1.5 shrink-0 rounded-full bg-ember motion-safe:animate-pulse" aria-hidden />
          <span role="status">{t("companion_speaking")}</span>
          <button
            type="button"
            aria-label={t("companion_stop_speaking")}
            title={t("companion_stop_speaking")}
            onClick={() => stopSpeech()}
            className="flex size-5 cursor-pointer items-center justify-center rounded-full text-ink-soft hover:bg-paper-deep hover:text-ink"
          >
            <Square className="size-2.5 fill-current" aria-hidden />
          </button>
        </div>
      )}
    </div>
  );
}

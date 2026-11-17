import { useEffect, useRef, useState } from "react";
import { Minus, Square, UserRound } from "lucide-react";
import { usePersistentFlag } from "@/hooks/usePersistentFlag";
import { useT } from "@/i18n";
import { getCompanion, onExpression, useCompanion } from "@/lib/companion";
import { createSocratesScene } from "@/lib/socrates/scene";
import { stopSpeech } from "@/lib/speech";

export const COMPANION_DOCK_ATTR = "data-companion-dock";

interface DockRect {
  x: number;
  y: number;
  size: number;
}

export function useSocratesTile(): { enabled: boolean; open: boolean; setOpen: (next: boolean) => void } {
  const { visible } = useCompanion();
  const wide = typeof window === "undefined" || !window.matchMedia?.("(max-width: 767px)").matches;
  const [open, setOpen] = usePersistentFlag("socrates_tile_open", wide);
  return { enabled: visible, open, setOpen };
}

export function SocratesTile({ open, setOpen }: { open: boolean; setOpen: (next: boolean) => void }) {
  const t = useT();
  if (!open) {
    return (
      <button
        type="button"
        data-companion-tile="closed"
        onClick={() => setOpen(true)}
        aria-label={t("companion_show")}
        title={t("companion_show")}
        className="absolute top-[4.25rem] right-3 z-10 flex size-10 cursor-pointer items-center justify-center rounded-full border border-line-strong bg-paper text-ink-soft shadow-sm transition-colors hover:text-ink"
      >
        <UserRound className="size-[18px]" aria-hidden />
      </button>
    );
  }
  return (
    <div
      data-companion-tile="open"
      className="absolute top-[4.25rem] right-3 z-10 w-[120px] overflow-hidden rounded-xl border border-line-strong bg-paper shadow-md md:w-[168px]"
    >
      <div className="relative aspect-square bg-paper-deep">
        <div {...{ [COMPANION_DOCK_ATTR]: "" }} className="absolute inset-0" />
      </div>
      <div className="flex items-center gap-1 border-t border-line py-0.5 pr-0.5 pl-2.5">
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-soft">{t("dlg_socrates")}</span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label={t("companion_hide")}
          title={t("companion_hide")}
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-lg text-ink-faint transition-colors hover:bg-paper-deep hover:text-ink"
        >
          <Minus className="size-3.5" aria-hidden />
        </button>
      </div>
    </div>
  );
}

function useDockRect(): DockRect | null {
  const [rect, setRect] = useState<DockRect | null>(null);
  useEffect(() => {
    let frame = 0;
    const measure = () => {
      frame = 0;
      const box = document.querySelector(`[${COMPANION_DOCK_ATTR}]`)?.getBoundingClientRect();
      const next =
        box && box.width > 0 ? { x: Math.round(box.left), y: Math.round(box.top), size: Math.round(box.width) } : null;
      setRect((prev) => (prev?.x === next?.x && prev?.y === next?.y && prev?.size === next?.size ? prev : next));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class"] });
    window.addEventListener("resize", schedule);
    measure();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
    };
  }, []);
  return rect;
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
  const stageRef = useRef<HTMLSpanElement>(null);
  const sceneRef = useRef<ReturnType<typeof createSocratesScene> | null>(null);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const canvas = document.createElement("canvas");
    canvas.className = "block size-full";
    stage.prepend(canvas);
    let scene: ReturnType<typeof createSocratesScene>;
    try {
      scene = createSocratesScene(canvas, stage, {
        mini: true,
        onReady: () => setModelState("ready"),
        onError: () => setModelState("error"),
      });
    } catch {
      canvas.remove();
      setModelState("error");
      return;
    }
    sceneRef.current = scene;
    scene.setSpeaking(getCompanion().speaking);
    return () => {
      scene.dispose();
      sceneRef.current = null;
      canvas.remove();
    };
  }, []);

  useEffect(() => onExpression((name) => sceneRef.current?.setExpression(name, { loop: false })), []);

  useEffect(() => {
    sceneRef.current?.setSpeaking(state.speaking);
  }, [state.speaking]);

  return (
    <div className="fixed z-30" style={{ left: dock.x, top: dock.y, width: dock.size, height: dock.size }}>
      <div
        role="img"
        aria-label={t("dlg_socrates")}
        aria-busy={modelState === "loading"}
        className="pointer-events-none relative size-full select-none"
      >
        <span ref={stageRef} className="absolute inset-0 block" />
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
        <div className="anim-fade absolute bottom-1 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-line-strong bg-paper py-0.5 pr-0.5 pl-2.5 text-[11.5px] text-ink-soft shadow-sm">
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

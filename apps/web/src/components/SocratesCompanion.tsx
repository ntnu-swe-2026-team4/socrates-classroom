import { useEffect, useRef, useState } from "react";
import { ChevronDown, ChevronUp, Square, UserRound } from "lucide-react";
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

export function SocratesPanel() {
  const t = useT();
  const { visible } = useCompanion();
  const [open, setOpen] = usePersistentFlag("socrates_panel_open", true);
  if (!visible) return null;
  const label = open ? t("companion_hide") : t("companion_show");
  const Icon = open ? ChevronDown : ChevronUp;
  return (
    <section
      data-companion-panel={open ? "open" : "closed"}
      className="m-2 shrink-0 border border-line-strong bg-paper"
    >
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={label}
        title={label}
        className="flex h-9 w-full cursor-pointer items-center gap-2 px-2.5 text-[12.5px] text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink"
      >
        <span className="min-w-0 flex-1 truncate text-left">{t("dlg_socrates")}</span>
        <Icon className="size-4 shrink-0" aria-hidden />
      </button>
      {open && (
        <div className="flex h-[min(196px,26dvh)] items-end justify-center overflow-hidden border-t border-line">
          <div {...{ [COMPANION_DOCK_ATTR]: "" }} className="aspect-square h-full" />
        </div>
      )}
    </section>
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
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
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
    <div
      className="pointer-events-none fixed z-[55]"
      style={{ left: dock.x, top: dock.y, width: dock.size, height: dock.size }}
    >
      <div
        role="img"
        aria-label={t("dlg_socrates")}
        aria-busy={modelState === "loading"}
        className="relative size-full select-none"
      >
        <span
          ref={stageRef}
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

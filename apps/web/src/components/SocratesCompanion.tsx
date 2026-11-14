import { useEffect, useRef, useState } from "react";
import { Square, UserRound } from "lucide-react";
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

const BACKDROP = "url(/stage/back.webp)";

export function SocratesDock() {
  return (
    <div aria-hidden className="relative min-h-0 flex-1 overflow-hidden">
      <div
        className="absolute inset-0 bg-ink/15"
        style={{
          maskImage: BACKDROP,
          WebkitMaskImage: BACKDROP,
          maskSize: "cover",
          WebkitMaskSize: "cover",
          maskPosition: "center bottom",
          WebkitMaskPosition: "center bottom",
        }}
      />
      <div className="absolute inset-x-0 bottom-0 h-[16%] bg-gradient-to-t from-card to-transparent" />
      <div className="absolute inset-x-0 bottom-[5%] flex flex-col items-center">
        <div className="relative -mb-[7%] aspect-square w-[min(94%,40dvh)]">
          <span className="absolute -inset-[6%] rounded-full bg-card blur-2xl" />
          <div {...{ [COMPANION_DOCK_ATTR]: "" }} className="absolute inset-0" />
        </div>
        <span className="relative block w-[min(60%,26dvh)]">
          <span className="absolute inset-x-[4%] -bottom-[3%] h-[14%] rounded-[50%] bg-ink/25 blur-md" />
          <img
            src="/stage/pedestal.webp"
            alt=""
            decoding="async"
            className="relative block w-full [[data-theme=dark]_&]:brightness-75"
          />
        </span>
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
    <div className="fixed z-[55]" style={{ left: dock.x, top: dock.y, width: dock.size, height: dock.size }}>
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
        <div className="anim-fade absolute -top-3 left-1/2 flex -translate-x-1/2 items-center gap-1 whitespace-nowrap rounded-full border border-line-strong bg-paper py-0.5 pr-0.5 pl-2.5 text-[11.5px] text-ink-soft shadow-sm">
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

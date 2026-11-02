import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useTheme } from "@/app/theme";
import { useT } from "@/i18n";
import { createSocratesScene } from "@/lib/socrates/scene";

export type SocratesExpression = "Happy" | "Confused" | "Angry";
export type SocratesHandle = {
  setExpression: (name: SocratesExpression | null, options?: { loop?: boolean }) => void;
};

export function SocratesStage({
  ref,
  speaking,
  className,
  mini = false,
  hideStatus = false,
  onReady,
}: {
  ref?: Ref<SocratesHandle>;
  speaking: boolean;
  className?: string;
  mini?: boolean;
  hideStatus?: boolean;
  onReady?: () => void;
}) {
  const t = useT();
  const { theme } = useTheme();
  const box = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createSocratesScene> | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const cv = document.createElement("canvas");
    cv.className = "block size-full";
    box.current?.prepend(cv);
    let s: ReturnType<typeof createSocratesScene>;
    try {
      s = createSocratesScene(cv, box.current, {
        light: theme === "light",
        mini,
        onReady: () => {
          setState("ready");
          onReady?.();
        },
        onError: () => setState("error"),
      });
    } catch {
      cv.remove();
      setState("error");
      return;
    }
    scene.current = s;
    return () => {
      s.dispose();
      scene.current = null;
      cv.remove();
    };
  }, [theme, onReady, mini]);
  useEffect(() => {
    scene.current?.setTheme(theme === "light");
  }, [theme]);
  useEffect(() => {
    scene.current?.setSpeaking(speaking);
  }, [speaking]);
  useImperativeHandle(
    ref,
    () => ({
      setExpression: (name, options) => scene.current?.setExpression(name, options),
    }),
    [],
  );

  return (
    <div ref={box} className={className}>
      {state !== "ready" && !hideStatus && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-faint">
          {state === "loading" ? t("載入模型中…") : t("模型載入失敗")}
        </div>
      )}
    </div>
  );
}

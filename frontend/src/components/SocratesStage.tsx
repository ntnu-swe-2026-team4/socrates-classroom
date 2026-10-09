import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/app/theme";
import { createSocratesScene } from "@/lib/socrates/scene";

/** 3D 蘇格拉底：speaking 為 true 時嘴巴會動；點模型可切換全息效果，左右拖曳旋轉 */
export function SocratesStage({ speaking, className }: { speaking: boolean; className?: string }) {
  const { theme } = useTheme();
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const scene = useRef<ReturnType<typeof createSocratesScene> | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    const s = createSocratesScene(canvas.current, box.current, { light: theme === "light", onReady: () => setState("ready"), onError: () => setState("error") });
    scene.current = s;
    return () => { s.dispose(); scene.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { scene.current?.setTheme(theme === "light"); }, [theme]);
  useEffect(() => { scene.current?.setSpeaking(speaking); }, [speaking]);

  return (
    <div ref={box} className={className}>
      <canvas ref={canvas} className="block size-full" />
      {state !== "ready" && <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-faint">{state === "loading" ? "載入模型中…" : "模型載入失敗"}</div>}
    </div>
  );
}

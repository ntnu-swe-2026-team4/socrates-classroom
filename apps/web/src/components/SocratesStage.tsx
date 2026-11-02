import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { useTheme } from "@/app/theme";
import { useT } from "@/i18n";
import { createSocratesScene } from "@/lib/socrates/scene";

/** 模型內建的表情動畫 */
export type SocratesExpression = "Happy" | "Confused" | "Angry";
export type SocratesHandle = {
  /** 播放表情；loop 時一直播到換表情或傳 null 為止，null 會淡回平常的樣子 */
  setExpression: (name: SocratesExpression | null, options?: { loop?: boolean }) => void;
};

/** 3D 蘇格拉底：speaking 為 true 時嘴巴會動；ref 可以播表情；點模型可切換全息效果，左右拖曳旋轉 */
export function SocratesStage({ ref, speaking, className, mini = false, hideStatus = false, onReady }: { ref?: Ref<SocratesHandle>; speaking: boolean; className?: string; mini?: boolean; hideStatus?: boolean; onReady?: () => void }) {
  const t = useT();
  const { theme } = useTheme();
  const box = useRef<HTMLDivElement>(null);
  const scene = useRef<ReturnType<typeof createSocratesScene> | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    // 沒有 WebGL（被停用、無痕或太舊的裝置）時 three.js 會直接丟錯，這裡接住，只是不顯示雕像
    // 每次都建立新的 canvas：dispose 會釋放 WebGL context，同一個 canvas 不能再拿來重建（開發模式的 StrictMode 會掛載兩次）
    const cv = document.createElement("canvas");
    cv.className = "block size-full";
    box.current?.prepend(cv);
    let s: ReturnType<typeof createSocratesScene>;
    try {
      s = createSocratesScene(cv, box.current, { light: theme === "light", mini, onReady: () => { setState("ready"); onReady?.(); }, onError: () => setState("error") });
    } catch {
      cv.remove();
      setState("error");
      return;
    }
    scene.current = s;
    return () => { s.dispose(); scene.current = null; cv.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { scene.current?.setTheme(theme === "light"); }, [theme]);
  useEffect(() => { scene.current?.setSpeaking(speaking); }, [speaking]);
  useImperativeHandle(ref, () => ({
    setExpression: (name, options) => scene.current?.setExpression(name, options),
  }), []);

  return (
    <div ref={box} className={className}>
      {state !== "ready" && !hideStatus && <div className="absolute inset-0 flex items-center justify-center text-sm text-ink-faint">{state === "loading" ? t("載入模型中…") : t("模型載入失敗")}</div>}
    </div>
  );
}

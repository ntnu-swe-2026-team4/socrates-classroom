import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { useAiSpeaking } from "@/lib/ai-speaking";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

// 三維引擎很大：第一次真的要顯示時才下載，所以不影響首頁與其他頁面的載入速度
const SocratesStage = lazy(() => import("./SocratesStage").then((m) => ({ default: m.SocratesStage })));

/**
 * 資訊欄裡的小蘇格拉底雕像。省效能的做法：
 * 1. 程式碼分割 + 閒置時才開始載入（不跟頁面內容搶資源）；
 * 2. 小尺寸、限制 30 fps；
 * 3. 捲出畫面或分頁在背景時完全不畫；
 * 4. 模型檔只下載一次，換階段時 WebGL 內容會立刻釋放。
 */
export function SocratesBadge({ className, fill = false }: { className?: string; fill?: boolean }) {
  const t = useT();
  const speaking = useAiSpeaking();
  const [armed, setArmed] = useState(fill);
  const [ready, setReady] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const idle = (window as unknown as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
    const h = idle ? idle(() => setArmed(true), { timeout: 800 }) : window.setTimeout(() => setArmed(true), 200);
    return () => { if (idle) (window as unknown as { cancelIdleCallback: (n: number) => void }).cancelIdleCallback(h); else clearTimeout(h); };
  }, []);
  return (
    <div className={cn("flex flex-col items-center gap-2", fill && "h-full min-h-0", className)}>
      <div ref={box} className={cn("relative w-full overflow-hidden", fill ? "min-h-0 flex-1" : "h-60")} title={t("點一下可切換全息效果")}>
        {!ready && <span className="absolute inset-0 flex items-center justify-center font-serif text-3xl text-bronze/70">{t("蘇")}</span>}
        {armed && (
          <Suspense fallback={null}>
            <SocratesStage speaking={speaking} mini hideStatus onReady={() => setReady(true)} className="absolute inset-0" />
          </Suspense>
        )}
      </div>
      <div className="text-center">
        <div className="font-serif text-[13.5px]">{t("蘇格拉底")}</div>
        <div className={cn("text-[11.5px]", speaking ? "text-bronze" : "text-ink-faint")}>{speaking ? t("正在回應…") : t("只提問，不給答案")}</div>
      </div>
    </div>
  );
}

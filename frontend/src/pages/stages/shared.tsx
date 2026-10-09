import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { Member } from "@/api";
import { SocratesBadge } from "@/components/SocratesBadge";
import { useAiSpeaking } from "@/lib/ai-speaking";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";

/* ---------- 左右分割的版面（像 VS Code：拖中間的線調整占比，任一邊可以收成側欄） ---------- */
type Collapsed = "left" | "right" | null;
const RATIO_KEY = "stage-split-ratio";
const COLLAPSED_KEY = "stage-split-collapsed";
const LEFT_VIEW_KEY = "stage-left-view";
const MIN = 0.2, MAX = 0.8, DEFAULT = 0.3;

/** 只是個人的版面偏好，讀寫失敗（無痕模式等）就用預設值 */
function readPref<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : (JSON.parse(v) as T);
  } catch {
    return fallback;
  }
}
function writePref(key: string, v: unknown) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* 存不了就算了 */ }
}

/** 活動進度條：由 ActivityPage 提供，StageLayout 把它放進資訊欄 */
export const StageProgressCtx = createContext<ReactNode>(null);

const iconBtn = "flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-faint hover:bg-bg-2 hover:text-ink";

function PaneHeader({ side, label, header, onCollapse }: { side: "left" | "right"; label: string; header?: ReactNode; onCollapse: () => void }) {
  const t = useT();
  const Icon = side === "left" ? PanelLeftClose : PanelRightClose;
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
      <div className="min-w-0 flex-1">{header ?? <span className="text-[12.5px] text-ink-dim">{label}</span>}</div>
      <button type="button" className={iconBtn} aria-label={t("收起「{label}」", { label })} title={t("收起「{label}」", { label })} onClick={onCollapse}><Icon className="size-4" /></button>
    </div>
  );
}

/** 收起後留下的側欄（窄螢幕上是一條橫列）：點一下展開 */
function CollapsedBar({ side, label, onExpand }: { side: "left" | "right"; label: string; onExpand: () => void }) {
  const t = useT();
  const Icon = side === "left" ? PanelLeftOpen : PanelRightOpen;
  return (
    <button type="button" onClick={onExpand} aria-label={t("展開「{label}」", { label })} title={t("展開「{label}」", { label })}
      className={cn("flex h-10 w-full shrink-0 cursor-pointer items-center gap-2 border-y border-line px-3 text-ink-faint hover:bg-bg-2 hover:text-ink",
        "md:h-full md:flex-col md:border-y-0 md:px-0 md:py-3", side === "left" ? "md:border-r" : "md:border-l")}>
      <Icon className="size-4 shrink-0" />
      <span className="text-[12.5px] tracking-wider md:[writing-mode:vertical-rl]">{label}</span>
    </button>
  );
}

/**
 * 辯論活動的兩欄：左邊資訊、右邊對話。
 * 寬螢幕可以拖中間的線調整占比（雙擊恢復預設）、也可以把任一邊收成側欄；窄螢幕上下排列。
 * 占比與收合狀態存在瀏覽器，所有階段共用。
 */
export function StageLayout({ left, right, leftLabel, rightLabel, leftHeader, rightHeader, mascot = true, modes, mode, onMode }: {
  left: ReactNode; right: ReactNode; leftLabel: string; rightLabel: string; leftHeader?: ReactNode; rightHeader?: ReactNode;
  /** 資訊欄最上方的小蘇格拉底雕像（AI 會說話的階段都放） */
  mascot?: boolean;
  /** 左欄自己的分頁（例如「個人調查」「我的筆記」），會跟「蘇格拉底」排在同一排 */
  modes?: [string, string][]; mode?: string; onMode?: (k: string) => void;
}) {
  const t = useT();
  const progress = useContext(StageProgressCtx);
  const box = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(() => readPref(RATIO_KEY, DEFAULT));
  const [collapsed, setCollapsed] = useState<Collapsed>(() => readPref<Collapsed>(COLLAPSED_KEY, null));
  const [dragging, setDragging] = useState(false);
  const [leftView, setLeftView] = useState<"info" | "model">(() => (readPref<string>(LEFT_VIEW_KEY, "info") === "model" ? "model" : "info"));
  const aiSpeaking = useAiSpeaking();
  const pickView = (v: "info" | "model") => { setLeftView(v); writePref(LEFT_VIEW_KEY, v); };
  const showModel = mascot && leftView === "model";
  // 左欄最上面的分頁：各階段自己的內容（可以有好幾個）＋蘇格拉底，全部放在同一排
  const items: [string, string][] = [...(modes ?? [["info", leftLabel] as [string, string]]), ["model", t("蘇格拉底")]];
  const activeTab = leftView === "model" ? "model" : (mode ?? "info");
  const tabs = (
    <div className="flex w-full min-w-0 gap-0.5 rounded-full bg-bg-2 p-0.5" role="tablist">
      {items.map(([k, n]) => (
        <button key={k} type="button" role="tab" aria-selected={activeTab === k} title={n}
          onClick={() => { if (k === "model") pickView("model"); else { pickView("info"); onMode?.(k); } }}
          className={cn("flex min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px]", activeTab === k ? "bg-bg-1 font-semibold text-ink shadow-sm" : "text-ink-faint hover:text-ink-dim")}>
          <span className="truncate">{n}</span>
          {k === "model" && aiSpeaking && leftView !== "model" && <i className="size-1.5 shrink-0 animate-pulse rounded-full bg-bronze" aria-hidden="true" />}
        </button>
      ))}
    </div>
  );
  const saveRatio = (r: number) => { const v = Math.min(MAX, Math.max(MIN, r)); setRatio(v); writePref(RATIO_KEY, v); };
  const collapse = (c: Collapsed) => { setCollapsed(c); writePref(COLLAPSED_KEY, c); };

  const onMove = (e: React.PointerEvent) => {
    if (!dragging || !box.current) return;
    const r = box.current.getBoundingClientRect();
    saveRatio((e.clientX - r.left) / r.width);
  };

  const leftPane = collapsed === "left"
    ? <CollapsedBar side="left" label={leftLabel} onExpand={() => collapse(null)} />
    : (
      <div className="flex min-h-0 min-w-0 flex-col max-md:shrink-0">
        <PaneHeader side="left" label={leftLabel} header={mascot ? tabs : leftHeader} onCollapse={() => collapse("left")} />
        {progress && <div className="shrink-0 border-b border-line px-5 py-2.5">{progress}</div>}
        {showModel
          ? <div className="flex min-w-0 shrink-0 flex-col px-4 py-3"><SocratesBadge /></div>
          : <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto max-md:overflow-visible">{left}</div>}
      </div>
    );
  const rightPane = collapsed === "right"
    ? <CollapsedBar side="right" label={rightLabel} onExpand={() => collapse(null)} />
    : (
      <div className="flex min-h-0 min-w-0 flex-col max-md:min-h-[60vh]">
        <PaneHeader side="right" label={rightLabel} header={rightHeader} onCollapse={() => collapse("right")} />
        <div className="flex min-h-0 flex-1 flex-col">{right}</div>
      </div>
    );

  const columns = collapsed === "left" ? "40px minmax(0,1fr)" : collapsed === "right" ? "minmax(0,1fr) 40px"
    : `minmax(0,${ratio}fr) 7px minmax(0,${1 - ratio}fr)`;
  return (
    // 窄螢幕：上下排列（不能拖曳，但可以收起）；md 以上：照占比分成左右兩欄
    <div ref={box} className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto md:grid md:overflow-visible md:[grid-template-columns:var(--stage-cols)]", dragging && "cursor-col-resize select-none")}
      style={{ "--stage-cols": columns } as React.CSSProperties}>
      {leftPane}
      {!collapsed && (
        <div role="separator" aria-orientation="vertical" aria-label={t("拖曳調整兩欄的寬度")} aria-valuenow={Math.round(ratio * 100)} aria-valuemin={MIN * 100} aria-valuemax={MAX * 100} tabIndex={0}
          title={t("拖曳調整寬度，雙擊恢復預設")}
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); }}
          onPointerMove={onMove} onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setDragging(false); }}
          onDoubleClick={() => saveRatio(DEFAULT)}
          onKeyDown={(e) => { if (e.key === "ArrowLeft") saveRatio(ratio - 0.02); if (e.key === "ArrowRight") saveRatio(ratio + 0.02); }}
          className="group flex cursor-col-resize justify-center outline-none max-md:hidden">
          <span className={cn("h-full w-px bg-line transition-colors group-hover:w-[3px] group-hover:bg-bronze-dim group-focus-visible:w-[3px] group-focus-visible:bg-bronze", dragging && "w-[3px] bg-bronze")} />
        </div>
      )}
      {rightPane}
    </div>
  );
}

/** 背板上的一個區塊（取代卡片）：區塊之間用細線分隔 */
export const Section = ({ className, children }: { className?: string; children: ReactNode }) => (
  <section className={cn("border-b border-line px-5 py-4 last:border-b-0", className)}>{children}</section>
);

/** 欄位最上方的模式切換（例如：個人調查 / 我的筆記） */
export function ModeTabs<T extends string>({ items, value, onChange }: { items: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="flex w-full min-w-0 max-w-full gap-0.5 rounded-full bg-bg-2 p-0.5 sm:w-fit" role="tablist">
      {items.map(([k, n]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          title={n} className={cn("min-w-0 cursor-pointer truncate rounded-full px-3 py-1 text-[12.5px]", value === k ? "bg-bg-1 font-semibold text-ink shadow-sm" : "text-ink-faint hover:text-ink-dim")}>{n}</button>
      ))}
    </div>
  );
}

export const Bar = ({ value, max = 5, className }: { value: number | null; max?: number; className?: string }) => (
  <span className={cn("block h-1.5 overflow-hidden rounded bg-bg-3", className)}>
    <i className="block h-full rounded bg-bronze" style={{ width: `${value === null ? 0 : (value / max) * 100}%` }} />
  </span>
);

export function MemberChip({ m }: { m: Pick<Member, "name" | "isMe" | "simulated"> }) {
  const t = useT();
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <i className={cn("flex size-6 items-center justify-center rounded-full font-serif text-[11.5px] not-italic", m.isMe ? "bg-bronze text-[#221a0c]" : "bg-bronze-soft text-bronze")}>{m.name[0]}</i>
      {m.name}
      {m.simulated && <em className="rounded-full bg-bg-3 px-1.5 py-px text-[10px] not-italic text-ink-dim" title={t("教室人數不足時，系統補齊的模擬同學")}>{t("模擬")}</em>}
    </span>
  );
}

/** 右欄的對話區：直接放在背板上 */
export const Panel = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn("flex min-h-0 flex-1 flex-col", className)}>{children}</div>
);

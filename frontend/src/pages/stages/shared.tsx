import { useEffect, useRef, useState, type ReactNode } from "react";
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { Member } from "@/api";
import { cn } from "@/lib/utils";

/* ---------- 左右分割的版面（像 VS Code：拖中間的線調整占比，任一邊可以收成側欄） ---------- */
type Collapsed = "left" | "right" | null;
const RATIO_KEY = "stage-split-ratio";
const COLLAPSED_KEY = "stage-split-collapsed";
const MIN = 0.2, MAX = 0.8, DEFAULT = 0.34;

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

function useWide() {
  const query = "(min-width: 768px)";
  const [wide, setWide] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = () => setWide(m.matches);
    m.addEventListener("change", on);
    return () => m.removeEventListener("change", on);
  }, []);
  return wide;
}

const iconBtn = "flex size-7 cursor-pointer items-center justify-center rounded-md text-ink-faint hover:bg-bg-2 hover:text-ink";

function PaneHeader({ side, label, header, onCollapse }: { side: "left" | "right"; label: string; header?: ReactNode; onCollapse: () => void }) {
  const Icon = side === "left" ? PanelLeftClose : PanelRightClose;
  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-3">
      <div className="min-w-0 flex-1">{header ?? <span className="text-[12.5px] text-ink-dim">{label}</span>}</div>
      <button type="button" className={iconBtn} aria-label={`收起「${label}」`} title={`收起「${label}」`} onClick={onCollapse}><Icon className="size-4" /></button>
    </div>
  );
}

/** 收起後留下的窄側欄：點一下展開 */
function CollapsedBar({ side, label, onExpand, horizontal }: { side: "left" | "right"; label: string; onExpand: () => void; horizontal: boolean }) {
  const Icon = side === "left" ? PanelLeftOpen : PanelRightOpen;
  return (
    <button type="button" onClick={onExpand} aria-label={`展開「${label}」`} title={`展開「${label}」`}
      className={cn("flex cursor-pointer items-center gap-2 text-ink-faint hover:bg-bg-2 hover:text-ink", horizontal ? "h-10 w-full border-y border-line px-3 text-[12.5px]" : "h-full w-full flex-col border-line py-3", !horizontal && (side === "left" ? "border-r" : "border-l"))}>
      <Icon className="size-4 shrink-0" />
      <span className={cn("text-[12.5px] tracking-wider", !horizontal && "[writing-mode:vertical-rl]")}>{label}</span>
    </button>
  );
}

/**
 * 辯論活動的兩欄：左邊資訊、右邊對話。
 * 寬螢幕可以拖中間的線調整占比（雙擊恢復預設）、也可以把任一邊收成側欄；窄螢幕上下排列。
 * 占比與收合狀態存在瀏覽器，所有階段共用。
 */
export function StageLayout({ left, right, leftLabel, rightLabel, leftHeader, rightHeader }: {
  left: ReactNode; right: ReactNode; leftLabel: string; rightLabel: string; leftHeader?: ReactNode; rightHeader?: ReactNode;
}) {
  const wide = useWide();
  const box = useRef<HTMLDivElement>(null);
  const [ratio, setRatio] = useState(() => readPref(RATIO_KEY, DEFAULT));
  const [collapsed, setCollapsed] = useState<Collapsed>(() => readPref<Collapsed>(COLLAPSED_KEY, null));
  const [dragging, setDragging] = useState(false);
  const saveRatio = (r: number) => { const v = Math.min(MAX, Math.max(MIN, r)); setRatio(v); writePref(RATIO_KEY, v); };
  const collapse = (c: Collapsed) => { setCollapsed(c); writePref(COLLAPSED_KEY, c); };

  const onMove = (e: React.PointerEvent) => {
    if (!dragging || !box.current) return;
    const r = box.current.getBoundingClientRect();
    saveRatio((e.clientX - r.left) / r.width);
  };

  const leftPane = collapsed === "left"
    ? <CollapsedBar side="left" label={leftLabel} onExpand={() => collapse(null)} horizontal={!wide} />
    : (
      <div className="flex min-h-0 min-w-0 flex-col">
        <PaneHeader side="left" label={leftLabel} header={leftHeader} onCollapse={() => collapse("left")} />
        <div className="no-scrollbar min-h-0 flex-1 overflow-y-auto">{left}</div>
      </div>
    );
  const rightPane = collapsed === "right"
    ? <CollapsedBar side="right" label={rightLabel} onExpand={() => collapse(null)} horizontal={!wide} />
    : (
      <div className="flex min-h-0 min-w-0 flex-col">
        <PaneHeader side="right" label={rightLabel} header={rightHeader} onCollapse={() => collapse("right")} />
        <div className="flex min-h-0 flex-1 flex-col">{right}</div>
      </div>
    );

  if (!wide) return <div className="flex min-h-0 flex-1 flex-col">{leftPane}<div className="flex min-h-[60vh] flex-col">{rightPane}</div></div>;

  const columns = collapsed === "left" ? "40px minmax(0,1fr)" : collapsed === "right" ? "minmax(0,1fr) 40px"
    : `minmax(0,${ratio}fr) 7px minmax(0,${1 - ratio}fr)`;
  return (
    <div ref={box} className={cn("grid min-h-0 flex-1", dragging && "cursor-col-resize select-none")} style={{ gridTemplateColumns: columns }}>
      {leftPane}
      {!collapsed && (
        <div role="separator" aria-orientation="vertical" aria-label="拖曳調整兩欄的寬度" aria-valuenow={Math.round(ratio * 100)} aria-valuemin={MIN * 100} aria-valuemax={MAX * 100} tabIndex={0}
          title="拖曳調整寬度，雙擊恢復預設"
          onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setDragging(true); }}
          onPointerMove={onMove} onPointerUp={(e) => { e.currentTarget.releasePointerCapture(e.pointerId); setDragging(false); }}
          onDoubleClick={() => saveRatio(DEFAULT)}
          onKeyDown={(e) => { if (e.key === "ArrowLeft") saveRatio(ratio - 0.02); if (e.key === "ArrowRight") saveRatio(ratio + 0.02); }}
          className="group flex cursor-col-resize justify-center outline-none">
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
    <div className="inline-flex gap-0.5 rounded-full bg-bg-2 p-0.5" role="tablist">
      {items.map(([k, n]) => (
        <button key={k} type="button" role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={cn("cursor-pointer rounded-full px-3 py-1 text-[12.5px]", value === k ? "bg-bg-1 font-semibold text-ink shadow-sm" : "text-ink-faint hover:text-ink-dim")}>{n}</button>
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
  return (
    <span className="inline-flex items-center gap-1.5 text-[13px]">
      <i className={cn("flex size-6 items-center justify-center rounded-full font-serif text-[11.5px] not-italic", m.isMe ? "bg-bronze text-[#221a0c]" : "bg-bronze-soft text-bronze")}>{m.name[0]}</i>
      {m.name}
      {m.simulated && <em className="rounded-full bg-bg-3 px-1.5 py-px text-[10px] not-italic text-ink-dim" title="教室人數不足時，系統補齊的模擬同學">模擬</em>}
    </span>
  );
}

/** 右欄的對話區：直接放在背板上 */
export const Panel = ({ className, children }: { className?: string; children: ReactNode }) => (
  <div className={cn("flex min-h-0 flex-1 flex-col", className)}>{children}</div>
);

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";
import { api, type LookupResult, type LookupSource, type LookupStatus } from "@/api";
import { Badge } from "@/components/ui/badge";

const MAX_SELECTION = 30;
const STATUS: Record<LookupStatus, [string, "olive" | "neutral" | "wine"]> = {
  ok: ["完成", "olive"],
  insufficient: ["資料不足", "neutral"],
  not_found: ["找不到來源", "neutral"],
  invalid: ["不是名詞", "wine"],
  search_error: ["搜尋失敗", "wine"],
  llm_error: ["整理失敗", "wine"],
};

type View = { input: string; term?: string; sources: LookupSource[]; summary: string; result?: LookupResult; failed?: string };

/** 執行查詢；再查一次或元件卸載時，中止上一次查詢 */
function useLookup() {
  const [view, setView] = useState<View | null>(null);
  const ctl = useRef<AbortController | null>(null);
  useEffect(() => () => ctl.current?.abort(), []);

  const run = useCallback(async (input: string) => {
    ctl.current?.abort();
    const c = new AbortController();
    ctl.current = c;
    const set = (f: (v: View) => View) => setView((v) => (v && ctl.current === c ? f(v) : v));
    setView({ input, sources: [], summary: "" });
    try {
      const result = await api.lookupTerm(input, (e) => {
        if (e.type === "sources") set((v) => ({ ...v, term: e.term, sources: e.sources }));
        else set((v) => ({ ...v, summary: v.summary + e.text }));
      }, c.signal);
      set((v) => ({ ...v, term: result.term, sources: result.sources, summary: result.summary, result }));
    } catch (e) {
      if (!c.signal.aborted) set((v) => ({ ...v, failed: e instanceof Error ? e.message : String(e) }));
    }
  }, []);

  const close = useCallback(() => { ctl.current?.abort(); ctl.current = null; setView(null); }, []);
  return { view, run, close };
}

/** 把解釋中的 [n] 換成連到第 n 個來源的上標連結 */
function CitedText({ text, sources }: { text: string; sources: LookupSource[] }) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(/\[(\d+)\]/g)) {
    const src = sources[Number(m[1]) - 1];
    parts.push(text.slice(last, m.index));
    parts.push(src
      ? <a key={m.index} href={src.url} target="_blank" rel="noreferrer" title={`${src.title}（${src.domain}）`} className="align-super text-[10px] text-bronze hover:underline">[{m[1]}]</a>
      : <span key={m.index} className="align-super text-[10px] text-ink-faint">[{m[1]}]</span>);
    last = m.index + m[0].length;
  }
  parts.push(text.slice(last));
  return <>{parts}</>;
}

function LookupCard({ view, onClose }: { view: View; onClose: () => void }) {
  const { result, failed } = view;
  const running = !result && !failed;
  const [label, tone] = failed ? ["查詢失敗", "wine" as const] : result ? STATUS[result.status] : ["查詢中…", "bronze" as const];
  const error = failed ? { title: "查詢失敗", reason: failed, hint: undefined } : result?.error;
  return (
    <aside aria-label="名詞查詢" className="fixed bottom-4 right-4 z-40 flex max-h-[70vh] w-[min(360px,calc(100vw-2rem))] flex-col rounded-3xl border border-line-strong bg-bg-1 shadow-2xl">
      <div className="flex items-center justify-between gap-2 border-b border-line px-5 py-3">
        <span className="flex min-w-0 items-center gap-2"><Search className="size-3.5 shrink-0 text-ink-faint" /><b className="truncate font-serif text-[15px] font-normal">{view.term ?? view.input}</b></span>
        <span className="flex shrink-0 items-center gap-1.5">
          <Badge tone={tone}>{label}</Badge>
          <button type="button" onClick={onClose} aria-label="關閉" className="cursor-pointer rounded-full p-1 text-ink-faint hover:bg-bg-2 hover:text-ink"><X className="size-4" /></button>
        </span>
      </div>
      <div className="space-y-3 overflow-y-auto px-5 py-4 text-[13.5px]">
        {error && (
          <div className="rounded-2xl bg-wine-soft px-3.5 py-2.5 text-[12.5px] leading-relaxed">
            <b className="text-wine">{error.title}</b>
            <p>{error.reason}</p>
            {error.hint && <p className="text-ink-dim">建議：{error.hint}</p>}
          </div>
        )}
        {result?.status === "insufficient" && <p className="text-ink-dim">白名單網站上的資料不足以解釋這個名詞。</p>}
        {(running || (view.summary && result?.status !== "insufficient")) && (
          <p className="font-serif leading-7">
            {view.summary ? <CitedText text={view.summary} sources={view.sources} /> : <span className="text-ink-faint">{view.term ? "整理中" : "搜尋中"}</span>}
            {running && <span className="ml-0.5 animate-pulse text-bronze">▍</span>}
          </p>
        )}
        {view.sources.length > 0 && (
          <div>
            <small className="mb-1 block text-[11px] text-ink-faint">來源</small>
            <ol className="list-decimal space-y-1 pl-5 text-[12.5px]">
              {view.sources.map((s, i) => (
                <li key={i}><a href={s.url} target="_blank" rel="noreferrer" className="text-ink-dim hover:text-bronze hover:underline">{s.title || s.url}</a> <span className="text-[11px] text-ink-faint">{s.domain}</span></li>
              ))}
            </ol>
          </div>
        )}
      </div>
      <p className="border-t border-line px-5 py-2.5 text-[11px] text-ink-faint">只送出選取的文字，不帶對話內容，也不影響這段對話。</p>
    </aside>
  );
}

/**
 * 包住對話內容：在裡面選取 1–30 字、不跨行的文字時，浮出「查詢」按鈕；按下後在右下角顯示名詞解釋。
 * 查詢是獨立的，只送出選取的文字。className 會加在包住內容的 div 上（通常就是對話的捲動區）。
 */
export function SelectionLookup({ className, children }: { className?: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const [pick, setPick] = useState<{ text: string; x: number; y: number } | null>(null);
  const { view, run, close } = useLookup();

  useEffect(() => {
    const onSelect = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? "";
      if (!sel || sel.rangeCount === 0 || !text || [...text].length > MAX_SELECTION || /\n/.test(text)) return setPick(null);
      const range = sel.getRangeAt(0);
      if (!box.current?.contains(range.commonAncestorContainer)) return setPick(null);
      const r = range.getBoundingClientRect();
      setPick({ text, x: r.left + r.width / 2, y: r.top });
    };
    document.addEventListener("selectionchange", onSelect);
    // 捲動時按鈕跟著選取範圍移動
    document.addEventListener("scroll", onSelect, true);
    return () => { document.removeEventListener("selectionchange", onSelect); document.removeEventListener("scroll", onSelect, true); };
  }, []);

  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view, close]);

  const start = () => {
    if (!pick) return;
    void run(pick.text);
    setPick(null);
    window.getSelection()?.removeAllRanges();
  };

  return (
    <div ref={box} className={className}>
      {children}
      {pick && createPortal(
        <button type="button" style={{ left: pick.x, top: pick.y }}
          // 不讓按鈕搶走焦點，避免選取範圍被清掉
          onMouseDown={(e) => e.preventDefault()} onClick={start}
          className="fixed z-40 inline-flex max-w-[80vw] -translate-x-1/2 -translate-y-[calc(100%+6px)] cursor-pointer items-center gap-1.5 rounded-full bg-bronze px-3 py-1.5 text-xs font-semibold text-[#221a0c] shadow-lg hover:brightness-110">
          <Search className="size-3.5 shrink-0" /><span className="truncate">查詢「{pick.text}」</span>
        </button>,
        document.body,
      )}
      {view && createPortal(<LookupCard view={view} onClose={close} />, document.body)}
    </div>
  );
}

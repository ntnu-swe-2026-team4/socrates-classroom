import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { History, PanelRight, Search, TextSearch } from "lucide-react";
import { api, type TermExplanation } from "@/api";
import { readTermHistory } from "@/api/local";
import { Markdown } from "@/components/Markdown";
import { Spinner, cn } from "@/components/ui";
import { useSelectionPopover } from "@/hooks/useSelectionPopover";
import { useT } from "@/i18n";

export interface TermPanelHandle {
  openTerm(term: string): void;
}

interface StackEntry {
  id: number;
  term: string;
  status: "loading" | "ready" | "error";
  explanation?: TermExplanation;
}

const ROW =
  "flex h-9 w-full items-center gap-2.5 rounded-xl px-2.5 text-left text-[13px] text-ink-soft transition-colors hover:bg-paper-deep hover:text-ink";

export const TermPanel = forwardRef<TermPanelHandle, { open: boolean; onClose: () => void }>(function TermPanel(
  { open, onClose },
  ref,
) {
  const t = useT();
  const queryClient = useQueryClient();
  const [stack, setStack] = useState<StackEntry[]>([]);
  const [showHistory, setShowHistory] = useState(false);
  const entrySeq = useRef(0);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { selection, clear } = useSelectionPopover(bodyRef);
  const history = useQuery({ queryKey: ["termHistory"], queryFn: () => readTermHistory(), enabled: open });

  useImperativeHandle(ref, () => ({
    openTerm(term: string) {
      void lookup(term);
    },
  }));

  async function lookup(term: string, force = false) {
    const trimmed = term.trim().slice(0, 30);
    if (!trimmed) return;
    const existing = force ? -1 : stack.findIndex((entry) => entry.term === trimmed);
    if (existing >= 0) {
      setStack((prev) => prev.slice(0, existing + 1));
      return;
    }
    setStack((prev) => [...prev, { id: ++entrySeq.current, term: trimmed, status: "loading" }]);
    try {
      const explanation = await api.lookupTerm(trimmed);
      setStack((prev) => {
        const next = [...prev];
        const index = next.findLastIndex((entry) => entry.term === trimmed);
        if (index >= 0) next[index] = { ...next[index], status: "ready", explanation };
        return next;
      });
      queryClient.setQueryData(["termHistory"], readTermHistory());
    } catch {
      setStack((prev) => {
        const next = [...prev];
        const index = next.findLastIndex((entry) => entry.term === trimmed);
        if (index >= 0) next[index] = { ...next[index], status: "error" };
        return next;
      });
    }
  }

  const current = stack.length > 0 ? stack[stack.length - 1] : null;
  const historyData = history.data ?? [];

  return (
    <aside
      inert={!open}
      className={cn(
        "flex shrink-0 flex-col overflow-hidden border-line bg-paper transition-[width] duration-200 max-md:fixed max-md:inset-y-0 max-md:right-0 max-md:z-40 max-md:max-w-full max-md:shadow-xl",
        open ? "w-88 border-l" : "w-0 border-l-0",
      )}
      aria-hidden={!open}
    >
      <div className="flex h-full w-88 flex-col">
        <header className="flex items-center gap-2 px-3 pt-3 pb-2">
          <button
            type="button"
            aria-label={t("menu_open")}
            title={t("menu_open")}
            onClick={onClose}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-ink-faint hover:bg-paper-deep hover:text-ink"
          >
            <PanelRight size={18} strokeWidth={1.6} />
          </button>
          <button
            type="button"
            aria-label={t("term_history")}
            title={t("term_history")}
            onClick={() => setShowHistory((v) => !v)}
            className={cn(
              "flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-colors",
              showHistory ? "bg-paper-deep text-ink" : "text-ink-faint hover:bg-paper-deep hover:text-ink",
            )}
          >
            <History size={18} strokeWidth={1.6} />
          </button>
          <span className="min-w-0 flex-1 truncate text-right font-serif text-[15px] font-semibold text-ink">
            {t("term_panel")}
          </span>
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ember-wash text-ember">
            <TextSearch size={16} strokeWidth={1.6} />
          </span>
        </header>

        {stack.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto px-3 pb-2">
            {stack.map((entry, i) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => setStack((prev) => prev.slice(0, i + 1))}
                className={cn(
                  "max-w-44 shrink-0 truncate rounded-full px-2.5 py-0.5 text-[12px] transition-colors",
                  i === stack.length - 1 && entry.status === "loading" && "text-ink-faint",
                  i === stack.length - 1
                    ? "bg-ember-wash font-medium text-ember"
                    : "text-ink-faint hover:bg-paper-deep",
                )}
              >
                {entry.term}
              </button>
            ))}
          </div>
        )}

        <div ref={bodyRef} className="stream-scroll min-h-0 flex-1 overflow-y-auto px-3 pb-3">
          {showHistory && (
            <div>
              <ul className="flex flex-col gap-0.5">
                {historyData.length > 0 ? (
                  historyData.map((query) => (
                    <li key={query.at}>
                      <button
                        type="button"
                        onClick={() => {
                          setShowHistory(false);
                          void lookup(query.term, true);
                        }}
                        className={ROW}
                      >
                        <Search size={14} strokeWidth={1.6} className="shrink-0" />
                        <span className="min-w-0 flex-1 truncate">{query.term}</span>
                        <span className="shrink-0 text-[11px] text-ink-faint">
                          {new Date(query.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </button>
                    </li>
                  ))
                ) : (
                  <p className="px-2.5 text-[12.5px] text-ink-faint">{t("term_no_query")}</p>
                )}
              </ul>
            </div>
          )}

          {!showHistory && current === null && (
            <div className="flex flex-col gap-5">
              <p className="px-2.5 text-[13px] leading-[1.85] text-ink-soft">{t("term_hint")}</p>
              <div>
                <p className="mb-1 px-2.5 text-[11px] font-medium tracking-wider text-ink-faint uppercase">
                  {t("term_history")}
                </p>
                {historyData.length > 0 ? (
                  <ul className="flex flex-col gap-0.5">
                    {historyData.map((query) => (
                      <li key={query.at}>
                        <button type="button" onClick={() => void lookup(query.term, true)} className={ROW}>
                          <Search size={14} strokeWidth={1.6} className="shrink-0" />
                          <span className="min-w-0 flex-1 truncate">{query.term}</span>
                          <span className="shrink-0 text-[11px] text-ink-faint">
                            {new Date(query.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-2.5 text-[12.5px] text-ink-faint">{t("term_no_query")}</p>
                )}
              </div>
            </div>
          )}

          {!showHistory && current?.status === "ready" && current.explanation && (
            <div className="px-1 pb-4">
              <h2 className="mb-3 mt-1 px-1.5 font-serif text-lg font-semibold text-ink">{current.explanation.term}</h2>
              <Markdown>{current.explanation.markdown}</Markdown>
              {stack.length > 1 && (
                <button
                  type="button"
                  onClick={() => setStack((prev) => prev.slice(0, -1))}
                  className="mt-3 ml-1.5 self-start rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-soft hover:border-ember hover:text-ember"
                >
                  {t("term_back_to")}「{stack[stack.length - 2]!.term}」
                </button>
              )}
            </div>
          )}

          {!showHistory && current?.status === "loading" && (
            <div className="flex justify-center py-10">
              <Spinner className="h-5 w-5" />
            </div>
          )}

          {!showHistory && current?.status === "error" && (
            <div className="flex flex-col items-center gap-3 py-10">
              <p className="text-[13px] text-ink-faint">{t("common_error")}</p>
              <button
                type="button"
                onClick={() => void lookup(current.term, true)}
                className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-soft transition-colors hover:border-ember hover:text-ember"
              >
                {t("term_retry")}
              </button>
            </div>
          )}
        </div>

        {selection && (
          <button
            type="button"
            onClick={() => {
              void lookup(selection.text);
              clear();
            }}
            className="fixed z-50 -translate-x-1/2 -translate-y-full rounded-full bg-ink px-3.5 py-1.5 text-[12.5px] text-paper shadow-sm"
            style={{ left: selection.x, top: selection.y - 8 }}
          >
            {t("term_lookup")}「<span className="inline-block max-w-52 truncate align-middle">{selection.text}</span>」
          </button>
        )}
      </div>
    </aside>
  );
});

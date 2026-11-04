import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type TermExplanation } from "@/api";
import { Markdown } from "@/components/Markdown";
import { Spinner, cn } from "@/components/ui";
import { useSelectionPopover } from "@/hooks/useSelectionPopover";
import { useT } from "@/i18n";

export interface TermPanelHandle {
  openTerm(term: string): void;
}

interface StackEntry {
  term: string;
  explanation: TermExplanation | null;
}

export const TermPanel = forwardRef<TermPanelHandle, { open: boolean; onClose: () => void }>(function TermPanel(
  { open, onClose },
  ref,
) {
  const t = useT();
  const queryClient = useQueryClient();
  const [stack, setStack] = useState<StackEntry[]>([]);
  const [loadingTerm, setLoadingTerm] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const { selection, clear } = useSelectionPopover(bodyRef);
  const history = useQuery({ queryKey: ["termHistory"], queryFn: () => api.termHistory(), enabled: open });

  useImperativeHandle(ref, () => ({
    openTerm(term: string) {
      void lookup(term);
    },
  }));

  async function lookup(term: string) {
    const trimmed = term.trim().slice(0, 40);
    if (!trimmed || loadingTerm) return;
    setLoadingTerm(trimmed);
    setStack((prev) => [...prev, { term: trimmed, explanation: null }]);
    try {
      const explanation = await api.lookupTerm(trimmed);
      setStack((prev) => {
        const next = [...prev];
        next[next.length - 1] = { term: trimmed, explanation };
        return next;
      });
      queryClient.setQueryData(["termHistory"], await api.termHistory());
    } finally {
      setLoadingTerm(null);
    }
  }

  const current = stack.length > 0 ? stack[stack.length - 1] : null;

  return (
    <aside
      className={cn(
        "flex shrink-0 flex-col overflow-hidden border-line bg-card transition-[width] duration-200",
        open ? "w-88 border-l" : "w-0 border-l-0",
      )}
      aria-hidden={!open}
    >
      <div className="flex min-w-88 flex-col flex-1">
        <header className="flex items-center justify-between gap-2 border-b border-line/60 px-4 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto">
            {stack.length === 0 ? (
              <span className="text-[13px] font-medium text-ink-faint">{t("term_panel")}</span>
            ) : (
              stack.map((entry, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: breadcrumb 位置即語意（截斷堆疊）
                <button
                  key={`${i}-${entry.term}`}
                  type="button"
                  onClick={() => setStack((prev) => prev.slice(0, i + 1))}
                  className={cn(
                    "shrink-0 rounded-full px-2.5 py-0.5 text-[12px] transition-colors",
                    i === stack.length - 1
                      ? "bg-ember-wash font-medium text-ember"
                      : "text-ink-faint hover:bg-paper-deep",
                  )}
                >
                  {entry.term}
                </button>
              ))
            )}
            {loadingTerm && (
              <span className="shrink-0 rounded-full bg-paper-deep px-2.5 py-0.5 text-[12px] text-ink-faint">
                {loadingTerm}…
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label="close"
            onClick={onClose}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-ink-faint hover:bg-paper-deep hover:text-ink"
          >
            <svg
              viewBox="0 0 16 16"
              aria-hidden
              className="h-4 w-4 fill-none stroke-current stroke-[1.6]"
              strokeLinecap="round"
            >
              <path d="m4 4 8 8M12 4l-8 8" />
            </svg>
          </button>
        </header>

        <div ref={bodyRef} className="stream-scroll flex-1 overflow-y-auto px-4 py-3">
          {current === null && !loadingTerm && (
            <div className="flex flex-col gap-6">
              <p className="text-[13px] leading-[1.85] text-ink-soft">{t("term_hint")}</p>
              <div>
                <p className="mb-2 text-[11px] font-medium tracking-wider text-ink-faint uppercase">
                  {t("term_history")}
                </p>
                {history.data && history.data.length > 0 ? (
                  <ul className="flex flex-col gap-0.5">
                    {history.data.map((query) => (
                      <li key={query.at}>
                        <button
                          type="button"
                          onClick={() => void lookup(query.term)}
                          className="flex w-full items-baseline justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-[13px] text-ink-soft hover:bg-paper-deep hover:text-ink"
                        >
                          <span className="truncate">{query.term}</span>
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

          {current?.explanation && (
            <div className="flex flex-col gap-2 pb-4">
              <h2 className="font-serif text-lg font-semibold text-ink">{current.explanation.term}</h2>
              <Markdown>{current.explanation.markdown}</Markdown>
              {stack.length > 1 && (
                <button
                  type="button"
                  onClick={() => setStack((prev) => prev.slice(0, -1))}
                  className="mt-2 self-start rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-soft hover:border-ember hover:text-ember"
                >
                  {t("term_back_to")}「{stack[stack.length - 2]!.term}」
                </button>
              )}
            </div>
          )}

          {loadingTerm && current?.explanation === null && (
            <div className="flex justify-center py-10">
              <Spinner className="h-5 w-5" />
            </div>
          )}
        </div>
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
          {t("term_lookup")}「{selection.text.slice(0, 16)}」
        </button>
      )}
    </aside>
  );
});

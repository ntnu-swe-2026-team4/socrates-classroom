import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, ChevronsUpDown } from "lucide-react";
import { cn } from "@/components/ui";
import { useI18n } from "@/i18n";
import { DEFAULT_PAGE_SIZE, PAGE_SIZES, pageBounds, pageCount, sortRows, type Sort } from "@/lib/table";

export interface TableState<T> {
  rows: T[];
  total: number;
  sort: Sort | undefined;
  toggleSort: (key: string) => void;
  page: number;
  pages: number;
  size: number;
  setSize: (size: number) => void;
  setPage: (page: number) => void;
}

export function useTable<T>(
  items: readonly T[],
  accessors: Record<string, (row: T) => string | number>,
  initialSort?: Sort,
): TableState<T> {
  const { locale } = useI18n();
  const [sort, setSort] = useState<Sort | undefined>(initialSort);
  const [size, setSizeState] = useState<number>(DEFAULT_PAGE_SIZE);
  const [requested, setPage] = useState(1);
  const collator = useMemo(() => new Intl.Collator(locale, { numeric: true }), [locale]);
  const sorted = useMemo(() => sortRows(items, sort, accessors, collator), [items, sort, accessors, collator]);
  const pages = pageCount(sorted.length, size);
  const page = Math.min(requested, pages);
  return {
    rows: sorted.slice((page - 1) * size, page * size),
    total: sorted.length,
    sort,
    toggleSort: (key) => {
      setSort((current) => ({ key, dir: current?.key === key && current.dir === "asc" ? "desc" : "asc" }));
      setPage(1);
    },
    page,
    pages,
    size,
    setSize: (next) => {
      setSizeState(next);
      setPage(1);
    },
    setPage,
  };
}

export function SortableTh<T>({ column, label, table }: { column: string; label: string; table: TableState<T> }) {
  const { t } = useI18n();
  const active = table.sort?.key === column ? table.sort.dir : undefined;
  const Icon = active === "asc" ? ArrowUp : active === "desc" ? ArrowDown : ChevronsUpDown;
  return (
    <th
      aria-sort={active === "asc" ? "ascending" : active === "desc" ? "descending" : "none"}
      className="px-3 py-2 font-medium"
    >
      <button
        type="button"
        aria-label={t("page_sort_by", { column: label })}
        onClick={() => table.toggleSort(column)}
        className={cn(
          "inline-flex cursor-pointer items-center gap-1 font-medium hover:text-ink",
          active ? "text-ink" : "text-ink-faint",
        )}
      >
        {label}
        <Icon className="size-3.5" aria-hidden />
      </button>
    </th>
  );
}

export function Pagination<T>({ table, capped }: { table: TableState<T>; capped?: { loaded: number; total: number } }) {
  const { t } = useI18n();
  const truncated = capped !== undefined && capped.total > capped.loaded;
  if (table.total <= PAGE_SIZES[0] && !truncated) return null;
  const { from, to } = pageBounds(table.total, table.page, table.size);
  return (
    <div className="border-t border-line px-3 py-2 text-[12.5px] text-ink-faint">
      {truncated && (
        <p role="status" className="mb-2 text-ember-deep">
          {t("page_truncated", { count: capped.loaded, total: capped.total })}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span aria-live="polite">{t("page_range", { from, to, total: table.total })}</span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2">
            {t("page_size")}
            <select
              value={table.size}
              onChange={(event) => table.setSize(Number(event.target.value))}
              className="h-8 cursor-pointer rounded-full border border-line-strong bg-card px-2 text-[12.5px] text-ink-soft"
            >
              {PAGE_SIZES.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-1">
            <button
              type="button"
              aria-label={t("page_prev")}
              disabled={table.page <= 1}
              onClick={() => table.setPage(table.page - 1)}
              className="grid size-8 cursor-pointer place-items-center rounded-full border border-line-strong text-ink-soft hover:text-ink disabled:cursor-default disabled:opacity-40"
            >
              <ChevronLeft className="size-4" aria-hidden />
            </button>
            <button
              type="button"
              aria-label={t("page_next")}
              disabled={table.page >= table.pages}
              onClick={() => table.setPage(table.page + 1)}
              className="grid size-8 cursor-pointer place-items-center rounded-full border border-line-strong text-ink-soft hover:text-ink disabled:cursor-default disabled:opacity-40"
            >
              <ChevronRight className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export const PAGE_SIZES = [10, 25, 50] as const;
export const DEFAULT_PAGE_SIZE = PAGE_SIZES[0];

export type SortDir = "asc" | "desc";
export interface Sort {
  key: string;
  dir: SortDir;
}

export function sortRows<T>(
  rows: readonly T[],
  sort: Sort | undefined,
  accessors: Record<string, (row: T) => string | number>,
  collator: Intl.Collator,
): T[] {
  const read = sort ? accessors[sort.key] : undefined;
  if (!sort || !read) return [...rows];
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const left = read(a);
    const right = read(b);
    const order =
      typeof left === "number" && typeof right === "number"
        ? left - right
        : collator.compare(String(left), String(right));
    return order * sign;
  });
}

export function pageCount(total: number, size: number): number {
  return Math.max(1, Math.ceil(total / size));
}

export function pageBounds(total: number, page: number, size: number): { from: number; to: number } {
  if (total === 0) return { from: 0, to: 0 };
  return { from: (page - 1) * size + 1, to: Math.min(total, page * size) };
}

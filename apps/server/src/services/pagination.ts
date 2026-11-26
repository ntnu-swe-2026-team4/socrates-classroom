import { z } from "zod";
import { fail } from "../http";

const CursorSchema = z.tuple([z.iso.datetime(), z.string().min(1).max(128)]);

export function pageBounds(input: { cursor?: string; limit?: number }) {
  const limit = input.limit ?? 30;
  if (!input.cursor) return { limit, at: null, after: null };
  try {
    const [at, after] = CursorSchema.parse(JSON.parse(atob(input.cursor)));
    return { limit, at, after };
  } catch {
    fail(422, "validation");
  }
}

export function pageOf<Row, Item>(
  rows: Row[],
  limit: number,
  cursorOf: (row: Row) => [string, string],
  itemOf: (row: Row) => Item,
) {
  const last = rows.length > limit ? rows[limit - 1] : undefined;
  return {
    items: rows.slice(0, limit).map(itemOf),
    nextCursor: last ? btoa(JSON.stringify(cursorOf(last))) : null,
  };
}

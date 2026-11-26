import type { Op } from "@earendil-works/chord/delta";
import type {
  ConversationId,
  ConversationView,
  EntryId,
  EntryQuery,
  EntryRecord,
  Page,
  Cursor,
  UserInput,
} from "@earendil-works/pi-durable";
import type { PiOperationResult, PiReceipt } from "agents/harness/pi";

export type ClientMessage =
  | {
      readonly type: "submit";
      readonly id?: string;
      readonly input: UserInput;
      readonly operationId?: string;
    }
  | { readonly type: "abort"; readonly id?: string }
  | { readonly type: "btw"; readonly id?: string; readonly session?: string }
  | { readonly type: "watch"; readonly id?: string; readonly from?: EntryId }
  | {
      readonly type: "entries";
      readonly id: string;
      readonly query: Omit<EntryQuery, "conversationId">;
      readonly limit: number;
    };

export type ServerMessage =
  | { readonly type: "hello"; readonly tools: readonly { name: string; description: string }[] }
  | {
      readonly type: "view";
      readonly view: ConversationView;
    }
  | { readonly type: "ops"; readonly ops: readonly Op[] }
  | {
      readonly type: "result";
      readonly id: string;
      readonly result:
        | PiReceipt
        | PiOperationResult
        | Page<EntryRecord, Cursor>
        | { readonly session: string }
        | boolean
        | null;
    }
  | { readonly type: "error"; readonly id?: string; readonly message: string; readonly code?: string };

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

export function isEntryId(value: unknown): value is EntryId {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function entryIdOf(value: number): EntryId {
  if (!isEntryId(value)) throw new Error(`invalid entry id: ${value}`);
  return value;
}

export function conversationIdOf(value: string): ConversationId {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`invalid conversation id: ${value}`);
  return parsed as ConversationId;
}

function optionalEntryId(value: unknown): EntryId | undefined {
  return isEntryId(value) ? value : undefined;
}

export function parseClientMessage(raw: string): ClientMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const kind = Reflect.get(parsed, "type");
  const id = readString(Reflect.get(parsed, "id"));
  switch (kind) {
    case "submit": {
      const input = Reflect.get(parsed, "input");
      if (typeof input !== "string") return null;
      return {
        type: "submit",
        id,
        input,
        operationId: readString(Reflect.get(parsed, "operationId")),
      };
    }
    case "abort":
      return { type: "abort", id };
    case "btw":
      return { type: "btw", id, session: readString(Reflect.get(parsed, "session")) };
    case "watch":
      return { type: "watch", id, from: optionalEntryId(Reflect.get(parsed, "from")) };
    case "entries": {
      const query = Reflect.get(parsed, "query");
      const limit = readNumber(Reflect.get(parsed, "limit"));
      if (id === undefined || limit === undefined || typeof query !== "object" || query === null) {
        return null;
      }
      const order = readString(Reflect.get(query, "order"));
      if (order !== undefined && order !== "ascending" && order !== "descending") return null;
      return {
        type: "entries",
        id,
        limit,
        query: {
          minEntryId: optionalEntryId(Reflect.get(query, "minEntryId")),
          maxEntryId: optionalEntryId(Reflect.get(query, "maxEntryId")),
          order,
        },
      };
    }
    default:
      return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(source: Record<string, unknown>, key: string): string | undefined {
  const value = source[key];
  return typeof value === "string" ? value : undefined;
}

export function parseServerMessage(raw: string): ServerMessage | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  switch (parsed.type) {
    case "hello":
      return Array.isArray(parsed.tools)
        ? {
            type: "hello",
            tools: parsed.tools.map((tool) => ({ name: String(tool.name), description: String(tool.description) })),
          }
        : null;
    case "view":
      if (!isRecord(parsed.view) || !Array.isArray(parsed.view.entries)) return null;
      // same-origin payload — shallow contract check; the deep ConversationView is pi-durable's own serialization
      return { type: "view", view: parsed.view } as unknown as ServerMessage;
    case "ops":
      if (!Array.isArray(parsed.ops)) return null;
      // same-origin payload — array shape checked; Op internals are chord's own serialization
      return { type: "ops", ops: parsed.ops } as unknown as ServerMessage;
    case "result":
      return typeof parsed.id === "string"
        ? ({ type: "result", id: parsed.id, result: parsed.result } as unknown as ServerMessage)
        : null;
    case "error":
      return typeof parsed.message === "string"
        ? {
            type: "error",
            id: optionalString(parsed, "id"),
            message: parsed.message,
            code: optionalString(parsed, "code"),
          }
        : null;
    default:
      return null;
  }
}

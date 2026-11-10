import type { Op } from "@earendil-works/chord/delta";
import type {
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
      readonly result: PiReceipt | PiOperationResult | Page<EntryRecord, Cursor> | boolean | null;
    }
  | { readonly type: "error"; readonly id?: string; readonly message: string; readonly code?: string };

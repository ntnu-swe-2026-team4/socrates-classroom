import type { ClientMessage, ServerMessage } from "@server/ws/protocol";
import type { ConversationId, ConversationView, EntryId, EntryRecord, JsonObject } from "@earendil-works/pi-durable";
import type { Op } from "@earendil-works/chord/delta";

// Web tests cannot import the server's runtime id minters (dist/types carries
// declarations only), so fixtures mint the branded ids locally.
export const entryIdOf = (value: number): EntryId => value as EntryId;
export const conversationIdOf = (value: string): ConversationId => Number(value) as ConversationId;

export function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`missing: ${what}`);
  return value;
}

// A shared-instance constructor: `new Ctor()` yields `instance` every time.
export function singletonCtor<I extends object, T>(instance: I): new () => T {
  return new Proxy(instance.constructor, {
    construct: () => instance,
  }) as new () => T;
}

// Vendor DOM interfaces (MediaStream, …) have no constructible shape in jsdom;
// fake streams mint a structural object once, at this seam.
export function fakeStream(trackStop: () => void): MediaStream {
  const track = { stop: trackStop } as unknown as MediaStreamTrack;
  return { getTracks: () => [track] } as unknown as MediaStream;
}

// Client frames come back as parsed JSON with a verified discriminant; the
// per-variant payload is the submitter's own contract, re-checked by the hook.
export function clientFrames(sent: readonly string[]): ClientMessage[] {
  const frames: ClientMessage[] = [];
  for (const raw of sent) {
    let frame: unknown;
    try {
      frame = JSON.parse(raw);
    } catch {
      continue;
    }
    if (typeof frame !== "object" || frame === null) continue;
    const type: unknown = Reflect.get(frame, "type");
    const id: unknown = Reflect.get(frame, "id");
    if (type === "abort" && (id === undefined || typeof id === "string")) {
      frames.push({ type: "abort", ...(typeof id === "string" ? { id } : {}) });
    } else if (type === "btw" && (id === undefined || typeof id === "string")) {
      frames.push({ type: "btw", ...(typeof id === "string" ? { id } : {}) });
    } else if (type === "submit" && typeof Reflect.get(frame, "input") !== "undefined") {
      frames.push(frame as ClientMessage);
    } else if (type === "watch" || type === "entries") {
      frames.push(frame as ClientMessage);
    }
  }
  return frames;
}

export function entryFixture(fields: {
  id: number;
  kind: string;
  data?: Record<string, unknown>;
  text?: string;
}): EntryRecord {
  const base: EntryRecord = {
    id: entryIdOf(fields.id),
    conversationId: conversationIdOf("1"),
    kind: fields.kind,
  };
  if (fields.text !== undefined) {
    return { ...base, model: [{ role: "user", content: fields.text, timestamp: 0 }] };
  }
  if (fields.data !== undefined) return { ...base, data: JSON.parse(JSON.stringify(fields.data)) };
  return base;
}

export function viewOf(entries: readonly EntryRecord[], before?: number): ConversationView {
  return {
    conversation: { id: conversationIdOf("1") },
    entries,
    docs: {},
    ...(before !== undefined ? { before: entryIdOf(before) } : {}),
  };
}

export function viewFrame(entries: readonly EntryRecord[], before?: number): ServerMessage {
  return { type: "view", view: viewOf(entries, before) };
}

export function opsFrame(entries: readonly EntryRecord[], docs: JsonObject = {}): ServerMessage {
  const reset: Op = [
    "r",
    {
      conversation: { id: conversationIdOf("1") },
      entries: JSON.parse(JSON.stringify(entries)),
      docs,
    },
  ];
  return { type: "ops", ops: [reset] };
}

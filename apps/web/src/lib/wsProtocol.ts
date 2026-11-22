import type { ServerMessage } from "@server/ws/protocol";

type ViewPayload = Extract<ServerMessage, { type: "view" }>["view"];
type OpsPayload = Extract<ServerMessage, { type: "ops" }>["ops"];
type ResultPayload = Extract<ServerMessage, { type: "result" }>["result"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
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
      // same-origin Worker payload — shallow contract check; the deep ConversationView is pi-durable's own serialization
      return { type: "view", view: parsed.view as unknown as ViewPayload };
    case "ops":
      if (!Array.isArray(parsed.ops)) return null;
      // same-origin Worker payload — array shape checked; Op internals are chord's own serialization
      return { type: "ops", ops: parsed.ops as unknown as OpsPayload };
    case "result":
      return typeof parsed.id === "string"
        ? { type: "result", id: parsed.id, result: parsed.result as ResultPayload }
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

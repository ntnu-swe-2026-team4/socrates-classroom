import type {
  ConversationView,
  ConversationWatch,
  ConversationWindow,
  EntryId,
  EntryQuery,
  RegistryReader,
  WatchEnd,
} from "@earendil-works/pi-durable";
import type { Connection, ConnectionContext } from "agents/lifecycle";
import type { WebSocketMessage, WebSocketsOptions } from "agents/websockets";
import { type PiHarness, type PiReceipt, type PiSession, type PiSubmitOptions, ROOT_SESSION } from "agents/harness/pi";
import type { UserInput } from "@earendil-works/pi-durable";
import { DialogueInputSchema } from "@socrates/shared";
import type { ClientMessage, ServerMessage } from "./protocol";

export type SubmitRoute = (handle: PiSession, input: UserInput, options: PiSubmitOptions) => Promise<PiReceipt>;

const OPEN = 1;

function resumeAfter(view: ConversationView): ConversationWindow {
  const newest = view.entries.at(-1)?.id ?? view.before;
  return newest === undefined ? {} : { from: (newest + 1) as EntryId };
}

function isEntryId(value: unknown): value is EntryId {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== OPEN) return;
  try {
    socket.send(JSON.stringify(message));
  } catch {
    // The socket closed between the state check and the send.
  }
}

/**
 * Watches live in memory, so the host calls `reattach()` from its `onStart`
 * for sockets that outlived the isolate.
 */
export class ChatSockets {
  readonly #harness: PiHarness;
  readonly #registry: RegistryReader;
  readonly #getWebSockets: (tag?: string) => WebSocket[];
  readonly #authorize?: (request: Request) => Promise<boolean>;
  readonly #submitRoute?: SubmitRoute;
  readonly #watches = new Map<WebSocket, ConversationWatch>();
  readonly #authorized = new Set<WebSocket>();

  constructor(
    harness: PiHarness,
    registry: RegistryReader,
    getWebSockets: (tag?: string) => WebSocket[],
    authorize?: (request: Request) => Promise<boolean>,
    submitRoute?: SubmitRoute,
  ) {
    this.#harness = harness;
    this.#registry = registry;
    this.#getWebSockets = getWebSockets;
    this.#authorize = authorize;
    this.#submitRoute = submitRoute;
  }

  options(): WebSocketsOptions {
    return {
      handlers: {
        onConnect: (connection, ctx) => this.#onConnect(connection, ctx),
        onMessage: (connection, message) => this.#onMessage(connection, message),
        onClose: (connection) => this.#unwatch(connection),
        onError: (connection) => this.#unwatch(connection),
      },
    };
  }

  async reattach(): Promise<void> {
    for (const socket of this.#getWebSockets()) {
      this.#authorized.add(socket);
      await this.#watchOrClose(socket);
    }
  }

  notifyRunFailure(): void {
    for (const socket of this.#getWebSockets()) {
      send(socket, { type: "error", message: "The model run failed", code: "llm_unavailable" });
    }
  }

  async #onConnect(connection: Connection, ctx: ConnectionContext): Promise<void> {
    if (this.#authorize && !(await this.#authorize(ctx.request))) {
      try {
        connection.close(1008, "unauthorized");
      } catch {
        // Already closed.
      }
      return;
    }
    this.#authorized.add(connection);
    send(connection, {
      type: "hello",
      tools: this.#registry
        .snapshot()
        .tools()
        .map(({ tool }) => ({ name: tool.name, description: tool.description })),
    });
  }

  async #watch(socket: WebSocket, window: ConversationWindow = {}): Promise<void> {
    const watch = await this.#harness.session(ROOT_SESSION).watch(window);
    if (socket.readyState !== OPEN) {
      await watch.stop();
      return;
    }
    const previous = this.#watches.get(socket);
    this.#watches.set(socket, watch);
    void previous?.stop();
    let last = watch.value;
    send(socket, { type: "view", view: last });
    watch.start(async (call) => {
      if (call.kind !== "value") return;
      if (socket.readyState !== OPEN) {
        void this.#unwatch(socket);
        return;
      }
      last = call.value;
      send(socket, { type: "ops", ops: call.ops });
    });
    void watch.closed.then((end) => this.#ended(socket, watch, end, last));
  }

  async #ended(socket: WebSocket, watch: ConversationWatch, end: WatchEnd, last: ConversationView): Promise<void> {
    if (end.kind === "stopped" || end.kind === "aborted") return;
    if (this.#watches.get(socket) !== watch) return;
    this.#watches.delete(socket);
    if (socket.readyState !== OPEN) return;
    await this.#watchOrClose(socket, resumeAfter(last));
  }

  async #watchOrClose(socket: WebSocket, window: ConversationWindow = {}): Promise<void> {
    try {
      await this.#watch(socket, window);
    } catch (error) {
      console.warn("chat watch lost", error);
      try {
        socket.close(1011, "Lost the session watch");
      } catch {
        // Already closed.
      }
    }
  }

  async #unwatch(socket: WebSocket): Promise<void> {
    this.#authorized.delete(socket);
    const watch = this.#watches.get(socket);
    if (!watch) return;
    this.#watches.delete(socket);
    await watch.stop();
  }

  async #onMessage(connection: Connection, raw: WebSocketMessage): Promise<void> {
    if (typeof raw !== "string") return;
    if (this.#authorize && !this.#authorized.has(connection)) {
      try {
        connection.close(1008, "unauthorized");
      } catch {
        // Already closed.
      }
      return;
    }
    let message: ClientMessage;
    try {
      message = JSON.parse(raw) as ClientMessage;
    } catch {
      send(connection, { type: "error", message: "Malformed JSON" });
      return;
    }
    try {
      const result = await this.#dispatch(connection, message);
      if (message.id !== undefined) {
        send(connection, { type: "result", id: message.id, result });
      }
    } catch (error) {
      const name = error instanceof Error ? error.name : "Error";
      const piError = name !== "Error";
      send(connection, {
        type: "error",
        ...(message.id === undefined ? {} : { id: message.id }),
        message: piError && error instanceof Error ? error.message : "Request failed",
        ...(piError ? { code: name } : {}),
      });
    }
  }

  async #dispatch(socket: WebSocket, message: ClientMessage) {
    const handle = this.#harness.session(ROOT_SESSION);
    switch (message.type) {
      case "submit": {
        if (typeof message.input !== "string") throw new Error("Invalid input");
        const input = DialogueInputSchema.parse({ text: message.input });
        return this.#submitRoute
          ? await this.#submitRoute(handle, input.text, {
              ...(message.operationId ? { operationId: message.operationId } : {}),
              whenBusy: "reject",
            })
          : await handle.submit(input.text, {
              ...(message.operationId ? { operationId: message.operationId } : {}),
              whenBusy: "reject",
            });
      }
      case "abort":
        return await handle.abort();
      case "watch": {
        if (message.from !== undefined && !isEntryId(message.from)) throw new Error("Invalid from");
        await this.#watchOrClose(socket, message.from === undefined ? {} : { from: message.from });
        return null;
      }
      case "entries": {
        if (!Number.isSafeInteger(message.limit) || message.limit < 1) throw new Error("Invalid limit");
        const query = entryQuery(message.query);
        return await handle.entries(query, Math.min(message.limit, 100));
      }
      default:
        throw new Error(`Unknown message type ${(message as { type: string }).type}`);
    }
  }
}

function entryQuery(query: unknown): Omit<EntryQuery, "conversationId"> {
  const { minEntryId, maxEntryId, order } = (query ?? {}) as Record<string, unknown>;
  if (minEntryId !== undefined && !isEntryId(minEntryId)) throw new Error("Invalid minEntryId");
  if (maxEntryId !== undefined && !isEntryId(maxEntryId)) throw new Error("Invalid maxEntryId");
  if (order !== undefined && order !== "ascending" && order !== "descending") throw new Error("Invalid order");
  return {
    ...(minEntryId === undefined ? {} : { minEntryId }),
    ...(maxEntryId === undefined ? {} : { maxEntryId }),
    ...(order === undefined ? {} : { order }),
  };
}

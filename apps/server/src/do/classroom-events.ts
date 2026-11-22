import { DurableObject } from "cloudflare:workers";
import { ApiError, type ClassroomEvent, type ClassroomEventResource } from "@socrates/shared";
import { SESSION_COOKIE, cookieValue, lookupSession } from "../auth";
import { all } from "../db/d1";
import type { Env } from "../env";
import { classroomAccess } from "../services/members";

interface ConnectionIdentity {
  userId: string;
  version: number;
  expiresAt: number;
}

export class ClassroomEvents extends DurableObject<Env> {
  async fetch(request: Request): Promise<Response> {
    const origin = new URL(request.url).origin;
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response(null, { status: 426 });
    if (request.headers.get("Origin") !== origin) return new Response(null, { status: 403 });

    const lookup = await lookupSession(this.env, cookieValue(request.headers.get("Cookie") ?? "", SESSION_COOKIE));
    if (lookup.kind !== "ok") return new Response(null, { status: lookup.kind === "disabled" ? 403 : 401 });
    const classroomId = this.ctx.id.name;
    if (!classroomId) return new Response(null, { status: 404 });
    const { user, version, expiresAt } = lookup.session;
    try {
      await classroomAccess(this.env.DB, classroomId, user);
    } catch (error) {
      if (error instanceof ApiError) return new Response(null, { status: error.status });
      throw error;
    }

    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server, [user.id]);
    server.serializeAttachment({ userId: user.id, version, expiresAt } satisfies ConnectionIdentity);
    server.send(JSON.stringify({ type: "ready" } satisfies ClassroomEvent));
    return new Response(null, { status: 101, webSocket: client });
  }

  async publish(resource: ClassroomEventResource, removedUserId?: string): Promise<void> {
    if (removedUserId) {
      for (const socket of this.ctx.getWebSockets(removedUserId)) socket.close(1008, "Classroom access revoked");
    }
    const sockets = this.ctx.getWebSockets();
    if (!sockets.length) return;

    const connections = sockets.map((socket) => ({
      socket,
      identity: socket.deserializeAttachment() as ConnectionIdentity | null,
    }));
    const userIds = [...new Set(connections.flatMap(({ identity }) => (identity ? [identity.userId] : [])))];
    const authorized = await all<{ id: string; session_version: number }>(
      this.env.DB,
      `SELECT u.id, u.session_version
       FROM json_each($users) ids JOIN users u ON u.id = ids.value
       JOIN classrooms c ON c.id = $cid
       WHERE u.disabled_at IS NULL AND (c.teacher_id = u.id OR EXISTS (
         SELECT 1 FROM members m WHERE m.classroom_id = c.id AND m.user_id = u.id
       ))`,
      { cid: this.ctx.id.name, users: JSON.stringify(userIds) },
    );
    const versions = new Map(authorized.map((user) => [user.id, user.session_version]));
    const now = Date.now();
    const event = JSON.stringify({ type: "classroom.changed", resource } satisfies ClassroomEvent);
    for (const { socket, identity } of connections) {
      if (socket.readyState !== WebSocket.OPEN) continue;
      if (!identity || identity.expiresAt <= now || versions.get(identity.userId) !== identity.version) {
        socket.close(1008, "Classroom access revoked");
        continue;
      }
      socket.send(event);
    }
  }

  webSocketMessage(socket: WebSocket): void {
    socket.close(1008, "Classroom events are server-to-client");
  }
}

export async function publishClassroom(
  env: Env,
  classroomId: string,
  resource: ClassroomEventResource,
  removedUserId?: string,
) {
  try {
    await env.ClassroomEvents.getByName(classroomId).publish(resource, removedUserId);
  } catch (error) {
    console.warn("classroom event delivery failed", error);
  }
}

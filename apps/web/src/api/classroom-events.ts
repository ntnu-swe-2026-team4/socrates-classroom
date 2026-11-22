import type { QueryClient } from "@tanstack/react-query";
import type { ClassroomEvent, ClassroomEventResource } from "@socrates/shared";
import {
  classroomActivitiesOptions,
  classroomAnnouncementsOptions,
  classroomMembersOptions,
  classroomPostsOptions,
  classroomsOptions,
} from "./queries";

const optionsFor = {
  activities: classroomActivitiesOptions,
  announcements: classroomAnnouncementsOptions,
  members: classroomMembersOptions,
  posts: classroomPostsOptions,
} satisfies Record<ClassroomEventResource, (id: string) => { queryKey: readonly unknown[] }>;

export function subscribeToClassroom(client: QueryClient, id: string) {
  const url = new URL(`/api/classrooms/${encodeURIComponent(id)}/events`, window.location.origin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  let socket: WebSocket;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let closed = false;

  const refreshSummary = () => client.invalidateQueries({ queryKey: classroomsOptions.queryKey });

  function connect() {
    socket = new WebSocket(url.toString());
    socket.addEventListener("message", (message) => {
      let event: Partial<ClassroomEvent> | null;
      try {
        if (typeof message.data !== "string") return;
        event = JSON.parse(message.data) as Partial<ClassroomEvent> | null;
      } catch {
        return;
      }
      if (event?.type === "ready") {
        attempts = 0;
        void refreshSummary();
        for (const options of Object.values(optionsFor))
          void client.invalidateQueries({ queryKey: options(id).queryKey });
      } else if (event?.type === "classroom.changed" && event.resource && Object.hasOwn(optionsFor, event.resource)) {
        void client.invalidateQueries({ queryKey: optionsFor[event.resource](id).queryKey });
        if (event.resource === "members" || event.resource === "activities") void refreshSummary();
      }
    });
    socket.addEventListener("close", (event) => {
      if (closed) return;
      if (event.code === 1008) {
        void refreshSummary();
      } else {
        reconnect = setTimeout(connect, Math.min(30_000, 1000 * 2 ** attempts));
        attempts += 1;
      }
    });
  }

  connect();
  return () => {
    closed = true;
    clearTimeout(reconnect);
    socket.close();
  };
}

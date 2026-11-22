import { z } from "zod";

export const ClassroomContentInputSchema = z.object({ body: z.string().trim().min(1).max(4000) });

export const ClassroomPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

export const ClassroomInviteCreateSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("classroom"), activityId: z.undefined().optional() }),
  z.object({ scope: z.literal("activity_guest"), activityId: z.string().min(1).max(128) }),
  z.object({ scope: z.literal("classroom_activity"), activityId: z.string().min(1).max(128) }),
]);

export type ClassroomInviteScope = z.infer<typeof ClassroomInviteCreateSchema>["scope"];

export type ClassroomEventResource = "announcements" | "posts" | "members" | "activities";

export type ClassroomEvent = { type: "ready" } | { type: "classroom.changed"; resource: ClassroomEventResource };

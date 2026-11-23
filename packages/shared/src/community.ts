import { z } from "zod";

export const ClassroomContentInputSchema = z.object({ body: z.string().trim().min(1).max(4000) });

export const ClassroomPageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).max(512).optional(),
});

const CalendarDateTimeSchema = z.iso.datetime({ offset: true });

const CalendarEventFieldsSchema = z.object({
  title: z.string().trim().min(1).max(120),
  startsAt: CalendarDateTimeSchema,
  endsAt: CalendarDateTimeSchema.nullable(),
  note: z.string().trim().max(1000),
});

export const CalendarEventCreateInputSchema = CalendarEventFieldsSchema.extend({
  endsAt: CalendarDateTimeSchema.nullable().optional(),
  note: z.string().trim().max(1000).optional(),
  topicId: z.string().min(1).optional(),
}).refine((event) => event.endsAt == null || Date.parse(event.endsAt) > Date.parse(event.startsAt));

export const CalendarEventUpdateInputSchema = CalendarEventFieldsSchema.partial().refine(
  (input) => Object.keys(input).length > 0,
);

export const CalendarEventPageQuerySchema = z
  .object({
    from: CalendarDateTimeSchema,
    to: CalendarDateTimeSchema,
    limit: z.coerce.number().int().min(1).max(100).optional(),
    cursor: z.string().min(1).max(512).optional(),
  })
  .refine((query) => {
    const duration = Date.parse(query.to) - Date.parse(query.from);
    return duration > 0 && duration <= 62 * 24 * 60 * 60 * 1000;
  });

export const CalendarEventSchema = CalendarEventFieldsSchema.extend({
  id: z.string(),
  classroomId: z.string(),
  topicId: z.string().nullable(),
  activity: z.object({ id: z.string(), finishedAt: CalendarDateTimeSchema.nullable() }).nullable(),
  createdAt: CalendarDateTimeSchema,
  updatedAt: CalendarDateTimeSchema,
});

export type CalendarEvent = z.infer<typeof CalendarEventSchema>;

export const ClassroomInviteCreateSchema = z.discriminatedUnion("scope", [
  z.object({ scope: z.literal("classroom"), activityId: z.undefined().optional() }),
  z.object({ scope: z.literal("activity_guest"), activityId: z.string().min(1).max(128) }),
  z.object({ scope: z.literal("classroom_activity"), activityId: z.string().min(1).max(128) }),
]);

export type ClassroomInviteScope = z.infer<typeof ClassroomInviteCreateSchema>["scope"];

export type ClassroomEventResource = "announcements" | "posts" | "members" | "activities" | "calendar";

export type ClassroomEvent = { type: "ready" } | { type: "classroom.changed"; resource: ClassroomEventResource };

import { Hono } from "hono";
import { z } from "zod";
import {
  CalendarEventCreateInputSchema,
  CalendarEventPageQuerySchema,
  CalendarEventUpdateInputSchema,
  type CalendarEvent,
} from "@socrates/shared";
import { all, one, run } from "../db/d1";
import { publishClassroom } from "../do/classroom-events";
import { fail, guardUser, newId, nowIso, requireUser, validateJson, validateQuery, type AppEnv } from "../http";
import { classroomAccess } from "../services/members";

interface CalendarEventRow {
  id: string;
  classroom_id: string;
  title: string;
  starts_at: string;
  ends_at: string | null;
  note: string;
  created_at: string;
  updated_at: string;
}

const CalendarCursorSchema = z.tuple([
  z.iso.datetime(),
  z.iso.datetime(),
  z.iso.datetime(),
  z.string().min(1).max(128),
]);
const columns = "id, classroom_id, title, starts_at, ends_at, note, created_at, updated_at";

function calendarEventOf(row: CalendarEventRow): CalendarEvent {
  return {
    id: row.id,
    classroomId: row.classroom_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    note: row.note,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function decodeCursor(cursor: string): unknown {
  try {
    return JSON.parse(atob(cursor));
  } catch {
    fail(422, "validation");
  }
}

function cursorBounds(cursor: string | undefined, from: string, to: string) {
  if (!cursor) return { lastStart: null, lastId: null };
  const parsed = CalendarCursorSchema.safeParse(decodeCursor(cursor));
  if (!parsed.success) fail(422, "validation");
  const [cursorFrom, cursorTo, lastStart, lastId] = parsed.data;
  if (cursorFrom !== from || cursorTo !== to) fail(422, "validation");
  return { lastStart, lastId };
}

async function requireTeacher(db: D1Database, classroomId: string, user: { id: string }) {
  const access = await classroomAccess(db, classroomId, user);
  if (!access.isTeacher) fail(403, "forbidden");
  return access.classroom;
}

export function classroomCalendarRoutes() {
  return new Hono<AppEnv>()
    .get("/classrooms/:id/calendar-events", guardUser(), validateQuery(CalendarEventPageQuerySchema), async (c) => {
      const classroomId = c.req.param("id");
      await classroomAccess(c.env.DB, classroomId, requireUser(c));
      const query = c.req.valid("query");
      const from = new Date(query.from).toISOString();
      const to = new Date(query.to).toISOString();
      const { lastStart, lastId } = cursorBounds(query.cursor, from, to);
      const limit = query.limit ?? 100;
      const rows = await all<CalendarEventRow>(
        c.env.DB,
        `SELECT ${columns} FROM classroom_calendar_events
         WHERE classroom_id = $cid AND starts_at < $to
           AND ((ends_at IS NULL AND starts_at >= $from) OR ends_at > $from)
           AND ($lastStart IS NULL OR (starts_at, id) > ($lastStart, $lastId))
         ORDER BY starts_at, id LIMIT $limit`,
        { cid: classroomId, from, to, lastStart, lastId, limit: limit + 1 },
      );
      const last = rows.length > limit ? rows[limit - 1] : undefined;
      return c.json({
        items: rows.slice(0, limit).map(calendarEventOf),
        nextCursor: last ? btoa(JSON.stringify([from, to, last.starts_at, last.id])) : null,
      });
    })
    .post("/classrooms/:id/calendar-events", guardUser(), validateJson(CalendarEventCreateInputSchema), async (c) => {
      const classroomId = c.req.param("id");
      await requireTeacher(c.env.DB, classroomId, requireUser(c));
      const input = c.req.valid("json");
      const at = nowIso();
      const row: CalendarEventRow = {
        id: newId("cal_"),
        classroom_id: classroomId,
        title: input.title,
        starts_at: new Date(input.startsAt).toISOString(),
        ends_at: input.endsAt ? new Date(input.endsAt).toISOString() : null,
        note: input.note ?? "",
        created_at: at,
        updated_at: at,
      };
      await run(
        c.env.DB,
        `INSERT INTO classroom_calendar_events (${columns})
         VALUES ($id, $cid, $title, $startsAt, $endsAt, $note, $createdAt, $updatedAt)`,
        {
          id: row.id,
          cid: row.classroom_id,
          title: row.title,
          startsAt: row.starts_at,
          endsAt: row.ends_at,
          note: row.note,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      );
      await publishClassroom(c.env, classroomId, "calendar");
      return c.json(calendarEventOf(row), 201);
    })
    .patch(
      "/classrooms/:id/calendar-events/:eventId",
      guardUser(),
      validateJson(CalendarEventUpdateInputSchema),
      async (c) => {
        const classroomId = c.req.param("id");
        await requireTeacher(c.env.DB, classroomId, requireUser(c));
        const eventId = c.req.param("eventId");
        const existing = await one<CalendarEventRow>(
          c.env.DB,
          `SELECT ${columns} FROM classroom_calendar_events WHERE classroom_id = $cid AND id = $id`,
          { cid: classroomId, id: eventId },
        );
        if (!existing) fail(404, "not_found");
        const input = c.req.valid("json");
        const row: CalendarEventRow = {
          ...existing,
          title: input.title ?? existing.title,
          starts_at: input.startsAt ? new Date(input.startsAt).toISOString() : existing.starts_at,
          ends_at:
            input.endsAt === undefined ? existing.ends_at : input.endsAt ? new Date(input.endsAt).toISOString() : null,
          note: input.note ?? existing.note,
          updated_at: nowIso(),
        };
        if (row.ends_at && row.ends_at <= row.starts_at) fail(422, "validation");
        await run(
          c.env.DB,
          `UPDATE classroom_calendar_events SET title = $title, starts_at = $startsAt, ends_at = $endsAt,
           note = $note, updated_at = $updatedAt WHERE classroom_id = $cid AND id = $id`,
          {
            id: eventId,
            cid: classroomId,
            title: row.title,
            startsAt: row.starts_at,
            endsAt: row.ends_at,
            note: row.note,
            updatedAt: row.updated_at,
          },
        );
        await publishClassroom(c.env, classroomId, "calendar");
        return c.json(calendarEventOf(row));
      },
    )
    .delete("/classrooms/:id/calendar-events/:eventId", guardUser(), async (c) => {
      const classroomId = c.req.param("id");
      await requireTeacher(c.env.DB, classroomId, requireUser(c));
      const deleted = await run(
        c.env.DB,
        "DELETE FROM classroom_calendar_events WHERE classroom_id = $cid AND id = $id",
        { cid: classroomId, id: c.req.param("eventId") },
      );
      if (!deleted.meta.changes) fail(404, "not_found");
      await publishClassroom(c.env, classroomId, "calendar");
      return c.body(null, 204);
    });
}

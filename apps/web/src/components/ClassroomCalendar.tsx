import type { CalendarEvent } from "@socrates/shared";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/api";
import { classroomCalendarOptions, classroomCalendarScopeOptions } from "@/api/queries";
import { EmptyPanel, PanelState } from "@/components/ClassroomCommunity";
import { Button, Card, ConfirmDialog, Field, FormDialog, Input, cn } from "@/components/ui";
import { useI18n, useT } from "@/i18n";
import { dayKey, eventsByDay, localDateTime, monthDays, shiftDay, weekStart } from "@/lib/calendar";

const MONDAY = new Date(2024, 0, 1);
const WEEKDAYS = Array.from({ length: 7 }, (_, index) => new Date(2024, 0, MONDAY.getDate() + index));
const FIELD =
  "w-full rounded-lg border border-line-strong bg-paper px-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink";

export function ClassroomCalendar({ id, teacher }: { id: string; teacher: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const client = useQueryClient();
  const today = new Date();
  const [view, setView] = useState<"month" | "week">("month");
  const [selected, setSelected] = useState(dayKey(today));
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<CalendarEvent | null>(null);
  const [removing, setRemoving] = useState<CalendarEvent | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(selected);
  const [time, setTime] = useState("09:00");
  const [end, setEnd] = useState("");
  const [note, setNote] = useState("");
  const selectedDate = new Date(`${selected}T00:00`);
  const year = selectedDate.getFullYear();
  const month = selectedDate.getMonth();
  const weekly = view === "week";
  const rangeStart = weekly ? weekStart(selectedDate) : new Date(year, month, 1);
  const rangeEnd = weekly ? shiftDay(rangeStart, 7) : new Date(year, month + 1, 1);
  const events = useQuery(classroomCalendarOptions(id, rangeStart, rangeEnd));
  const refresh = () => client.invalidateQueries({ queryKey: classroomCalendarScopeOptions(id).queryKey });
  const localStart = `${date}T${time}`;
  const originalStart = editing ? localDateTime(editing.startsAt) : "";
  const originalEnd = editing?.endsAt ? localDateTime(editing.endsAt) : "";
  const startMillis = editing && localStart === originalStart ? Date.parse(editing.startsAt) : Date.parse(localStart);
  const endMillis = editing?.endsAt && end === originalEnd ? Date.parse(editing.endsAt) : Date.parse(end);
  const badEnd = Boolean(end && !(endMillis > startMillis));
  const changed =
    !editing ||
    title.trim() !== editing.title ||
    note.trim() !== editing.note ||
    localStart !== originalStart ||
    end !== originalEnd;
  const save = useMutation({
    mutationFn: () => {
      if (editing) {
        return api.classroom.updateCalendarEvent(id, editing.id, {
          ...(title.trim() !== editing.title && { title: title.trim() }),
          ...(note.trim() !== editing.note && { note: note.trim() }),
          ...(localStart !== originalStart && { startsAt: new Date(startMillis).toISOString() }),
          ...(end !== originalEnd && { endsAt: end ? new Date(endMillis).toISOString() : null }),
        });
      }
      return api.classroom.createCalendarEvent(id, {
        title: title.trim(),
        startsAt: new Date(startMillis).toISOString(),
        ...(end && { endsAt: new Date(endMillis).toISOString() }),
        note: note.trim(),
      });
    },
    onSuccess: async (event) => {
      await refresh();
      setSelected(dayKey(new Date(event.startsAt)));
      setEditorOpen(false);
    },
  });
  const remove = useMutation({
    mutationFn: (event: CalendarEvent) => api.classroom.deleteCalendarEvent(id, event.id),
    onSuccess: async () => {
      await refresh();
      setRemoving(null);
    },
  });

  const visibleDays = weekly ? WEEKDAYS.map((_, index) => shiftDay(rangeStart, index)) : monthDays(year, month);
  const days = eventsByDay(
    events.data ?? [],
    weekly ? visibleDays : visibleDays.filter((day) => day.getMonth() === month),
  );
  const periodLabel = weekly
    ? new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).formatRange(rangeStart, shiftDay(rangeEnd, -1))
    : rangeStart.toLocaleDateString(locale, { year: "numeric", month: "long" });
  const selectedEvents = days.get(selected) ?? [];
  const shift = (step: number) => {
    const next = weekly ? shiftDay(selectedDate, step * 7) : new Date(year, month + step, 1);
    setSelected(dayKey(next));
  };
  const openEditor = (event: CalendarEvent | null) => {
    save.reset();
    setEditing(event);
    setTitle(event?.title ?? "");
    setNote(event?.note ?? "");
    const start = event ? localDateTime(event.startsAt) : `${selected}T09:00`;
    setDate(start.slice(0, 10));
    setTime(start.slice(11));
    setEnd(event?.endsAt ? localDateTime(event.endsAt) : "");
    setEditorOpen(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-label={t(weekly ? "calendar_prev_week" : "calendar_prev")}
          onClick={() => shift(-1)}
        >
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <h3 aria-live="polite" className="min-w-0 flex-1 text-center font-serif text-lg text-ink">
          {periodLabel}
        </h3>
        <Button
          variant="outline"
          size="sm"
          aria-label={t(weekly ? "calendar_next_week" : "calendar_next")}
          onClick={() => shift(1)}
        >
          <ChevronRight className="size-4" aria-hidden />
        </Button>
        <Button variant="outline" size="sm" onClick={() => setSelected(dayKey(today))}>
          {t("calendar_today")}
        </Button>
        <div className="flex gap-1">
          <Button
            variant={weekly ? "outline" : "primary"}
            size="sm"
            aria-pressed={!weekly}
            onClick={() => setView("month")}
          >
            {t("calendar_month")}
          </Button>
          <Button
            variant={weekly ? "primary" : "outline"}
            size="sm"
            aria-pressed={weekly}
            onClick={() => setView("week")}
          >
            {t("calendar_week")}
          </Button>
        </div>
        {teacher && (
          <Button size="sm" onClick={() => openEditor(null)}>
            <Plus className="size-4" aria-hidden />
            {t("calendar_add")}
          </Button>
        )}
      </div>

      {events.isPending || events.isError ? (
        <PanelState pending={events.isPending} error={events.isError} retry={() => void events.refetch()} />
      ) : (
        <>
          <Card className="overflow-hidden p-0">
            <div className="grid grid-cols-7 border-b border-line bg-paper-deep text-center text-xs text-ink-soft">
              {WEEKDAYS.map((weekday) => (
                <span key={weekday.getDay()} className="py-2">
                  {weekday.toLocaleDateString(locale, { weekday: "short" })}
                </span>
              ))}
            </div>
            <div className="-mr-px -mb-px grid grid-cols-7">
              {visibleDays.map((day) => {
                const key = dayKey(day);
                if (!weekly && day.getMonth() !== month) {
                  return <span key={key} className="min-h-14 border-r border-b border-line sm:min-h-24" />;
                }
                const list = days.get(key) ?? [];
                return (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={selected === key}
                    aria-label={`${day.toLocaleDateString(locale, { dateStyle: "long" })} · ${t("calendar_count", { n: list.length })}`}
                    onClick={() => setSelected(key)}
                    className={cn(
                      "flex min-h-14 min-w-0 cursor-pointer flex-col gap-1 border-r border-b border-line p-1.5 text-left outline-none hover:bg-paper-deep focus-visible:ring-2 focus-visible:ring-ember/60 focus-visible:ring-inset sm:min-h-24 sm:p-2",
                      selected === key && "bg-paper-deep",
                    )}
                  >
                    <span
                      className={cn(
                        "flex size-6 items-center justify-center rounded-full text-xs text-ink",
                        key === dayKey(today) && "bg-ink font-semibold text-paper",
                      )}
                    >
                      {day.getDate()}
                    </span>
                    {list.slice(0, 2).map((event) => (
                      <span
                        key={event.id}
                        className="w-full truncate rounded-sm bg-ember-wash px-1 text-[11.5px] leading-5 text-ink max-sm:hidden"
                      >
                        {event.title}
                      </span>
                    ))}
                    {list.length > 2 && (
                      <span className="text-[11px] text-ink-faint max-sm:hidden">+{list.length - 2}</span>
                    )}
                    {list.length > 0 && <span aria-hidden className="size-1.5 rounded-full bg-ink sm:hidden" />}
                  </button>
                );
              })}
            </div>
          </Card>

          <section aria-live="polite">
            <h3 className="mb-2 font-serif text-[15.5px] text-ink">
              {selectedDate.toLocaleDateString(locale, { dateStyle: "full" })}
            </h3>
            {selectedEvents.length === 0 ? (
              <EmptyPanel>{t("calendar_day_empty")}</EmptyPanel>
            ) : (
              <ul className="space-y-2">
                {selectedEvents.map((event) => (
                  <li key={event.id}>
                    <Card className="flex items-start gap-3 p-4">
                      <time dateTime={event.startsAt} className="shrink-0 pt-0.5 text-xs text-ink-soft tabular-nums">
                        {new Date(event.startsAt).toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}
                      </time>
                      <div className="min-w-0 flex-1">
                        <p className="break-words text-sm font-medium text-ink">{event.title}</p>
                        {event.note && (
                          <p className="mt-1 break-words text-[13px] leading-relaxed whitespace-pre-line text-ink-soft">
                            {event.note}
                          </p>
                        )}
                      </div>
                      {teacher && (
                        <div className="flex flex-wrap gap-1">
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`${t("calendar_edit")} · ${event.title}`}
                            onClick={() => openEditor(event)}
                          >
                            <Pencil className="size-4" aria-hidden />
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            aria-label={`${t("room_delete")} · ${event.title}`}
                            onClick={() => {
                              remove.reset();
                              setRemoving(event);
                            }}
                          >
                            <Trash2 className="size-4" aria-hidden />
                          </Button>
                        </div>
                      )}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <FormDialog
        open={editorOpen}
        title={t(editing ? "calendar_edit_event" : "calendar_add")}
        submitLabel={t("common_save")}
        cancelLabel={t("common_cancel")}
        canSubmit={Boolean(title.trim() && Number.isFinite(startMillis) && !badEnd && changed)}
        submitting={save.isPending}
        onSubmit={() => save.mutate()}
        onCancel={() => {
          if (!save.isPending) setEditorOpen(false);
        }}
      >
        <Field label={t("calendar_event_title")}>
          <Input value={title} maxLength={120} required onChange={(event) => setTitle(event.target.value)} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t("calendar_event_date")}>
            <Input type="date" value={date} required onChange={(event) => setDate(event.target.value)} />
          </Field>
          <Field label={t("calendar_event_time")}>
            <Input type="time" value={time} required onChange={(event) => setTime(event.target.value)} />
          </Field>
        </div>
        <Field label={t("calendar_event_end")}>
          <Input
            type="datetime-local"
            value={end}
            onChange={(event) => setEnd(event.target.value)}
            aria-invalid={badEnd}
          />
        </Field>
        {badEnd && (
          <p role="alert" className="text-sm text-flag">
            {t("calendar_invalid_end")}
          </p>
        )}
        <Field label={t("calendar_event_note")}>
          <textarea
            value={note}
            rows={3}
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
            className={cn(FIELD, "resize-y py-2")}
          />
        </Field>
        {save.isError && (
          <p role="alert" className="text-sm text-flag">
            {t("common_error")}
          </p>
        )}
      </FormDialog>

      <ConfirmDialog
        open={removing !== null}
        title={t("calendar_delete_confirm")}
        body={
          <>
            {removing?.title}
            {remove.isError && (
              <p role="alert" className="text-sm text-flag">
                {t("common_error")}
              </p>
            )}
          </>
        }
        confirmLabel={t("room_delete")}
        cancelLabel={t("common_cancel")}
        danger
        onConfirm={() => {
          if (removing && !remove.isPending) remove.mutate(removing);
        }}
        onCancel={() => {
          if (!remove.isPending) setRemoving(null);
        }}
      />
    </div>
  );
}

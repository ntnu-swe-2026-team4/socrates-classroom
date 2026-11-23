import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Trash2 } from "lucide-react";
import { classroomCalendarOptions } from "@/api/queries";
import { EmptyPanel, PanelState } from "@/components/ClassroomCommunity";
import { Button, Card, ConfirmDialog, Field, FormDialog, Input, cn } from "@/components/ui";
import { useI18n, useT } from "@/i18n";
import { dayKey, eventsByDay, mockCalendar, monthDays, type CalendarEvent } from "@/lib/calendar";

const MONDAY = new Date(2024, 0, 1);
const WEEKDAYS = Array.from({ length: 7 }, (_, index) => new Date(2024, 0, MONDAY.getDate() + index));
const FIELD =
  "w-full rounded-lg border border-line-strong bg-paper px-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-ink";

export function ClassroomCalendar({ id, teacher }: { id: string; teacher: boolean }) {
  const t = useT();
  const { locale } = useI18n();
  const client = useQueryClient();
  const today = new Date();
  const [cursor, setCursor] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selected, setSelected] = useState(dayKey(today));
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<CalendarEvent | null>(null);
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(selected);
  const [time, setTime] = useState("09:00");
  const [note, setNote] = useState("");
  const options = classroomCalendarOptions(id);
  const events = useQuery(options);
  const refresh = () => client.invalidateQueries({ queryKey: options.queryKey });
  const create = useMutation({
    mutationFn: () =>
      mockCalendar.create(id, {
        title: title.trim(),
        startsAt: new Date(`${date}T${time}`).toISOString(),
        note: note.trim(),
      }),
    onSuccess: async (event) => {
      await refresh();
      const start = new Date(event.startsAt);
      setCursor({ year: start.getFullYear(), month: start.getMonth() });
      setSelected(dayKey(start));
      setAdding(false);
    },
  });
  const remove = useMutation({
    mutationFn: (event: CalendarEvent) => mockCalendar.remove(id, event.id),
    onSuccess: async () => {
      await refresh();
      setRemoving(null);
    },
  });

  if (events.isPending || events.isError) {
    return <PanelState pending={events.isPending} error={events.isError} retry={() => void events.refetch()} />;
  }

  const days = eventsByDay(events.data);
  const monthLabel = new Date(cursor.year, cursor.month, 1).toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
  });
  const selectedDate = new Date(`${selected}T00:00`);
  const selectedEvents = days.get(selected) ?? [];
  const shift = (step: number) => {
    const next = new Date(cursor.year, cursor.month + step, 1);
    setCursor({ year: next.getFullYear(), month: next.getMonth() });
  };
  const openAdd = () => {
    setTitle("");
    setNote("");
    setDate(selected);
    setTime("09:00");
    setAdding(true);
  };

  return (
    <div className="space-y-4">
      <p className="rounded-lg border border-dashed border-line-strong px-3 py-2 text-[12.5px] leading-relaxed text-ink-soft">
        {t("calendar_mock_notice")}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" aria-label={t("calendar_prev")} onClick={() => shift(-1)}>
          <ChevronLeft className="size-4" aria-hidden />
        </Button>
        <h3 aria-live="polite" className="min-w-0 flex-1 text-center font-serif text-lg text-ink">
          {monthLabel}
        </h3>
        <Button variant="outline" size="sm" aria-label={t("calendar_next")} onClick={() => shift(1)}>
          <ChevronRight className="size-4" aria-hidden />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setCursor({ year: today.getFullYear(), month: today.getMonth() });
            setSelected(dayKey(today));
          }}
        >
          {t("calendar_today")}
        </Button>
        {teacher && (
          <Button size="sm" onClick={openAdd}>
            <Plus className="size-4" aria-hidden />
            {t("calendar_add")}
          </Button>
        )}
      </div>

      <Card className="overflow-hidden p-0">
        <div className="grid grid-cols-7 border-b border-line bg-paper-deep text-center text-xs text-ink-soft">
          {WEEKDAYS.map((weekday) => (
            <span key={weekday.getDay()} className="py-2">
              {weekday.toLocaleDateString(locale, { weekday: "short" })}
            </span>
          ))}
        </div>
        <div className="-mr-px -mb-px grid grid-cols-7">
          {monthDays(cursor.year, cursor.month).map((day) => {
            const key = dayKey(day);
            if (day.getMonth() !== cursor.month) {
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
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`${t("room_delete")} · ${event.title}`}
                      onClick={() => setRemoving(event)}
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </Button>
                  )}
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>

      <FormDialog
        open={adding}
        title={t("calendar_add")}
        submitLabel={t("common_save")}
        cancelLabel={t("common_cancel")}
        canSubmit={Boolean(title.trim() && date && time)}
        submitting={create.isPending}
        onSubmit={() => create.mutate()}
        onCancel={() => setAdding(false)}
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
        <Field label={t("calendar_event_note")}>
          <textarea
            value={note}
            rows={3}
            maxLength={1000}
            onChange={(event) => setNote(event.target.value)}
            className={cn(FIELD, "resize-y py-2")}
          />
        </Field>
      </FormDialog>

      <ConfirmDialog
        open={removing !== null}
        title={t("calendar_delete_confirm")}
        body={removing?.title}
        confirmLabel={t("room_delete")}
        cancelLabel={t("common_cancel")}
        danger
        onConfirm={() => removing && remove.mutate(removing)}
        onCancel={() => setRemoving(null)}
      />
    </div>
  );
}

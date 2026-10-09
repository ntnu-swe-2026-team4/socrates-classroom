import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight, Pencil, Plus, Trash2 } from "lucide-react";
import { useCalendar, useDeleteCalendarEvent, useSaveCalendarEvent } from "@/api/queries";
import type { CalendarEvent } from "@/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { cn, fromLocalInput, toLocalInput } from "@/lib/utils";
import { currentLang, useT } from "@/i18n";

const KIND: Record<CalendarEvent["kind"], { name: string; dot: string }> = {
  topic_due: { name: "辯論截止", dot: "bg-wine" },
  stage_deadline: { name: "辯論階段截止", dot: "bg-bronze" },
  announcement: { name: "公告", dot: "bg-olive" },
  custom: { name: "行程", dot: "bg-ink-dim" },
};
/** 星期標題（日～六）；非中文時用該語言的縮寫 */
function weekdayLabels(): string[] {
  const lang = currentLang();
  if (lang === "zh-TW") return ["日", "一", "二", "三", "四", "五", "六"];
  const f = new Intl.DateTimeFormat(lang, { weekday: "narrow" });
  return Array.from({ length: 7 }, (_, i) => f.format(new Date(2023, 0, 1 + i)));
}
function monthTitle(d: Date): string {
  const lang = currentLang();
  if (lang === "zh-TW") return `${d.getFullYear()} 年 ${d.getMonth() + 1} 月`;
  const s = new Intl.DateTimeFormat(lang, { month: "long", year: "numeric" }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const pad = (n: number) => String(n).padStart(2, "0");

/** 新增 / 編輯自訂行程（老師與助教） */
function EventDialog({ classroomId, event, defaultAt, open, onOpenChange }: {
  classroomId: string; event: CalendarEvent | null; defaultAt: string; open: boolean; onOpenChange: (v: boolean) => void;
}) {
  const t = useT();
  const save = useSaveCalendarEvent(classroomId, event?.id);
  const [title, setTitle] = useState("");
  const [at, setAt] = useState("");
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => {
    if (!open) return;
    setTitle(event?.title ?? ""); setAt(toLocalInput(event?.at ?? defaultAt)); setNote(event?.note ?? ""); setErr(""); save.reset();
    // 只在開啟時帶入目前的值
  }, [open]);
  function submit() {
    if (!title.trim()) return setErr(t("請填寫行程名稱。"));
    const iso = fromLocalInput(at);
    if (!iso) return setErr(t("請選擇日期與時間。"));
    setErr("");
    save.mutate({ title: title.trim(), at: iso, note: note.trim() }, { onSuccess: () => onOpenChange(false) });
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{event ? t("編輯行程") : t("新增行程")}</DialogTitle>
        <DialogDescription>{t("學生會在教室行事曆看到這個行程。")}</DialogDescription>
        <div className="space-y-4 text-sm">
          <label className="block"><span className="mb-1 block text-xs text-ink-dim">{t("行程名稱")}</span><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("例如：期中討論課")} /></label>
          <label className="block"><span className="mb-1 block text-xs text-ink-dim">{t("日期與時間")}</span><Input type="datetime-local" className="w-auto" value={at} onChange={(e) => setAt(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-xs text-ink-dim">{t("備註（選填）")}</span><Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("地點、要準備的東西……")} /></label>
          {(err || save.error) && <p className="text-[12.5px] text-wine">{err || save.error?.message}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t("取消")}</Button>
            <Button onClick={submit} disabled={save.isPending}>{event ? t("儲存") : t("新增")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** 教室的月曆：辯論截止日、公告、辯論階段截止時間（由後端整理），加上老師 / 助教自己加的行程 */
export function CalendarCard({ classroomId, editable = false }: { classroomId: string; editable?: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [picked, setPicked] = useState<string | null>(null);
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const { data: events = [] } = useCalendar(classroomId, month, next);
  const [editing, setEditing] = useState<CalendarEvent | "new" | null>(null);
  const remove = useDeleteCalendarEvent();

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) { const k = dayKey(new Date(e.at)); m.set(k, [...(m.get(k) ?? []), e]); }
    return m;
  }, [events]);
  const cells = [...Array(month.getDay()).fill(null), ...Array.from({ length: new Date(next.getTime() - 1).getDate() }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  const list = picked ? byDay.get(picked) ?? [] : events;

  /** 新增時的預設時間：選了某一天就用那天 09:00，否則用今天（或該月 1 號）的下一個整點 */
  const defaultAt = () => {
    const [y, m, d] = picked ? picked.split("-").map(Number) : [today.getFullYear(), today.getMonth(), today.getMonth() === month.getMonth() && today.getFullYear() === month.getFullYear() ? today.getDate() : 1];
    return new Date(y, m, d, 9, 0).toISOString();
  };
  const open = (e: CalendarEvent) => {
    if (e.kind === "custom") return;
    if (e.kind === "announcement") navigate({ to: "/classrooms/$classroomId", params: { classroomId: e.classroomId }, search: { tab: "announcements" } });
    else if (e.kind === "stage_deadline" && e.activityId) navigate({ to: "/classrooms/$classroomId/activities/$activityId", params: { classroomId: e.classroomId, activityId: e.activityId } });
    else if (e.topicId) navigate({ to: "/classrooms/$classroomId/debates/$debateId", params: { classroomId: e.classroomId, debateId: e.topicId } });
  };
  const shift = (d: number) => { setMonth(new Date(month.getFullYear(), month.getMonth() + d, 1)); setPicked(null); };

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-3">
          <span className="text-xs tracking-wider text-ink-faint">{t("行事曆")}</span>
          {editable && <Button variant="outline" size="sm" onClick={() => setEditing("new")}><Plus className="size-3.5" />{t("新增行程")}</Button>}
        </span>
        <span className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-7" aria-label={t("上個月")} onClick={() => shift(-1)}><ChevronLeft className="size-4" /></Button>
          <b className="min-w-24 text-center font-serif text-[14px] font-medium">{monthTitle(month)}</b>
          <Button variant="ghost" size="icon" className="size-7" aria-label={t("下個月")} onClick={() => shift(1)}><ChevronRight className="size-4" /></Button>
        </span>
      </div>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-7 gap-y-1 text-center text-[12px]">
          {weekdayLabels().map((w, i) => <span key={i} className="pb-1 text-[11px] text-ink-faint">{w}</span>)}
          {cells.map((d, i) => {
            if (!d) return <span key={`blank-${i}`} />;
            const k = dayKey(d);
            const evs = byDay.get(k) ?? [];
            const isToday = k === dayKey(today);
            return (
              <button key={k} type="button" disabled={!evs.length && !editable} onClick={() => setPicked(picked === k ? null : k)}
                className={cn("flex flex-col items-center gap-0.5 rounded-lg py-1", evs.length || editable ? "cursor-pointer hover:bg-bg-2" : "cursor-default text-ink-faint", picked === k && "bg-bronze-soft")}>
                <span className={cn("flex size-6 items-center justify-center rounded-full", isToday && "bg-bronze font-semibold text-[#221a0c]")}>{d.getDate()}</span>
                <span className="flex h-1.5 gap-0.5">{evs.slice(0, 3).map((e) => <i key={e.id} className={cn("size-1.5 rounded-full", KIND[e.kind].dot)} />)}</span>
              </button>
            );
          })}
        </div>
        <div className="min-w-0">
          {picked && <button type="button" onClick={() => setPicked(null)} className="mb-1.5 cursor-pointer text-xs text-bronze hover:underline">{t("← 顯示整個月")}</button>}
          <ul className="space-y-1">
            {list.map((e) => {
              const d = new Date(e.at);
              return (
                <li key={e.id} className="group flex items-start gap-1 rounded-lg hover:bg-bg-2">
                  <button type="button" onClick={() => open(e)} className={cn("flex min-w-0 flex-1 items-start gap-2.5 rounded-lg px-2 py-1.5 text-left", e.kind === "custom" ? "cursor-default" : "cursor-pointer")}>
                    <i className={cn("mt-1.5 size-2 shrink-0 rounded-full", KIND[e.kind].dot)} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px]">{e.title}</span>
                      <span className="block text-[11.5px] text-ink-faint">{d.getMonth() + 1}/{d.getDate()} {pad(d.getHours())}:{pad(d.getMinutes())} · {t(KIND[e.kind].name)}</span>
                      {e.note && <span className="mt-0.5 block whitespace-pre-line text-[12px] text-ink-dim">{e.note}</span>}
                    </span>
                  </button>
                  {editable && e.kind === "custom" && (
                    <span className="flex shrink-0 gap-0.5 pt-1 pr-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 max-md:opacity-100">
                      <Button variant="ghost" size="icon" className="size-7" aria-label={t("編輯 {title}", { title: e.title })} onClick={() => setEditing(e)}><Pencil className="size-3.5" /></Button>
                      <Button variant="danger" size="icon" className="size-7" aria-label={t("刪除 {title}", { title: e.title })} disabled={remove.isPending} onClick={() => remove.mutate(e.id)}><Trash2 className="size-3.5" /></Button>
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {!list.length && <p className="px-2 text-sm text-ink-faint">{t("這個月沒有行程。")}</p>}
        </div>
      </div>
      {remove.error && <p className="mt-2 text-[12.5px] text-wine">{remove.error.message}</p>}
      {editable && <EventDialog classroomId={classroomId} event={editing === "new" ? null : editing} defaultAt={defaultAt()} open={editing !== null} onOpenChange={(v) => !v && setEditing(null)} />}
    </Card>
  );
}

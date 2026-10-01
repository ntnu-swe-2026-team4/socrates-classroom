import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useCalendar } from "@/api/queries";
import type { CalendarEvent } from "@/api";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const KIND: Record<CalendarEvent["kind"], { name: string; dot: string }> = {
  topic_due: { name: "議題截止", dot: "bg-wine" },
  stage_deadline: { name: "辯論階段截止", dot: "bg-bronze" },
  announcement: { name: "公告", dot: "bg-olive" },
};
const WEEK = ["日", "一", "二", "三", "四", "五", "六"];
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const pad = (n: number) => String(n).padStart(2, "0");

/** 教室的月曆：議題截止日、公告、辯論階段截止時間（由後端從既有資料整理） */
export function CalendarCard({ classroomId }: { classroomId: string }) {
  const navigate = useNavigate();
  const today = new Date();
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1));
  const [picked, setPicked] = useState<string | null>(null);
  const next = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const { data: events = [] } = useCalendar(classroomId, month, next);

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of events) { const k = dayKey(new Date(e.at)); m.set(k, [...(m.get(k) ?? []), e]); }
    return m;
  }, [events]);
  const cells = [...Array(month.getDay()).fill(null), ...Array.from({ length: new Date(next.getTime() - 1).getDate() }, (_, i) => new Date(month.getFullYear(), month.getMonth(), i + 1))];
  const list = picked ? byDay.get(picked) ?? [] : events;

  const open = (e: CalendarEvent) => {
    if (e.kind === "announcement") navigate({ to: "/classrooms/$classroomId", params: { classroomId: e.classroomId }, search: { tab: "announcements" } });
    else if (e.kind === "stage_deadline" && e.activityId) navigate({ to: "/classrooms/$classroomId/activities/$activityId", params: { classroomId: e.classroomId, activityId: e.activityId } });
    else if (e.topicId) navigate({ to: "/classrooms/$classroomId/topics/$topicId", params: { classroomId: e.classroomId, topicId: e.topicId } });
  };
  const shift = (d: number) => { setMonth(new Date(month.getFullYear(), month.getMonth() + d, 1)); setPicked(null); };

  return (
    <Card>
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs tracking-wider text-ink-faint">行事曆</span>
        <span className="flex items-center gap-1">
          <Button variant="ghost" size="icon" className="size-7" aria-label="上個月" onClick={() => shift(-1)}><ChevronLeft className="size-4" /></Button>
          <b className="w-24 text-center font-serif text-[14px] font-medium">{month.getFullYear()} 年 {month.getMonth() + 1} 月</b>
          <Button variant="ghost" size="icon" className="size-7" aria-label="下個月" onClick={() => shift(1)}><ChevronRight className="size-4" /></Button>
        </span>
      </div>
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="grid grid-cols-7 gap-y-1 text-center text-[12px]">
          {WEEK.map((w) => <span key={w} className="pb-1 text-[11px] text-ink-faint">{w}</span>)}
          {cells.map((d, i) => {
            if (!d) return <span key={`blank-${i}`} />;
            const k = dayKey(d);
            const evs = byDay.get(k) ?? [];
            const isToday = k === dayKey(today);
            return (
              <button key={k} type="button" disabled={!evs.length} onClick={() => setPicked(picked === k ? null : k)}
                className={cn("flex flex-col items-center gap-0.5 rounded-lg py-1", evs.length ? "cursor-pointer hover:bg-bg-2" : "cursor-default text-ink-faint", picked === k && "bg-bronze-soft")}>
                <span className={cn("flex size-6 items-center justify-center rounded-full", isToday && "bg-bronze font-semibold text-[#221a0c]")}>{d.getDate()}</span>
                <span className="flex h-1.5 gap-0.5">{evs.slice(0, 3).map((e) => <i key={e.id} className={cn("size-1.5 rounded-full", KIND[e.kind].dot)} />)}</span>
              </button>
            );
          })}
        </div>
        <div className="min-w-0">
          {picked && <button type="button" onClick={() => setPicked(null)} className="mb-1.5 cursor-pointer text-xs text-bronze hover:underline">← 顯示整個月</button>}
          <ul className="space-y-1">
            {list.map((e) => {
              const d = new Date(e.at);
              return (
                <li key={e.id}>
                  <button type="button" onClick={() => open(e)} className="flex w-full cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 text-left hover:bg-bg-2">
                    <i className={cn("mt-1.5 size-2 shrink-0 rounded-full", KIND[e.kind].dot)} />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px]">{e.title}</span>
                      <span className="block text-[11.5px] text-ink-faint">{d.getMonth() + 1}/{d.getDate()} {pad(d.getHours())}:{pad(d.getMinutes())} · {KIND[e.kind].name}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!list.length && <p className="px-2 text-sm text-ink-faint">這個月沒有行程。</p>}
        </div>
      </div>
    </Card>
  );
}

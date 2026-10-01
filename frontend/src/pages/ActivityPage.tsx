import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { api, type Activity, type Stage } from "@/api";
import { useActivity, useActivityEvents, useAdvanceActivity, useMe } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { STAGE_NAME } from "./ClassroomPage";
import { DebateStage } from "./stages/DebateStage";
import { IndividualStage } from "./stages/IndividualStage";
import { ResultsStage } from "./stages/ResultsStage";
import { TeamStage } from "./stages/TeamStage";

const ORDER: Stage[] = ["individual", "team", "debate", "done"];
const LABELS = ["個人調查", "團隊提純", "辯論比賽", "結束"];

/** 橫向的進度：設定 → 個人調查 → 團隊提純 → 辯論比賽 → 結束（點已經過的階段可以回頭看） */
function Flow({ a, teacher, seeing, onSee }: { a: Activity; teacher: boolean; seeing: Stage; onSee: (s: Stage) => void }) {
  const advance = useAdvanceActivity(a.id);
  const cur = ORDER.indexOf(a.stage);
  const next = ORDER[cur + 1];
  const canAdvance = teacher || !!api.dev; // 學生的「示範推進」只有示範用的假後端才有
  return (
    <div className="shrink-0 rounded-3xl border border-line bg-bg-1 p-3">
      <div className="grid grid-cols-5 text-[11px]">
        {["設定", ...LABELS].map((n, i) => {
          const idx = i - 1;
          const state = idx < cur ? "done" : idx === cur ? "now" : "todo";
          const clickable = idx >= 0 && idx <= cur;
          return (
            <button key={n} type="button" disabled={!clickable} onClick={() => onSee(ORDER[idx])}
              className={cn("relative flex flex-col items-center gap-1.5 disabled:cursor-default", clickable && "cursor-pointer", state === "todo" ? "text-ink-faint" : "text-ink")}>
              {i > 0 && <span className={cn("absolute right-1/2 top-[11px] h-0.5 w-full", idx <= cur ? "bg-olive" : "bg-bg-3")} />}
              <span className={cn("relative z-10 flex size-6 items-center justify-center rounded-full border font-serif text-[11.5px]",
                state === "done" && "border-olive bg-olive text-[#1b1d22]", state === "now" && "border-bronze bg-bronze font-bold text-[#221a0c] ring-4 ring-bronze-soft", state === "todo" && "border-line-strong bg-bg-1",
                idx >= 0 && ORDER[idx] === seeing && state !== "now" && "ring-2 ring-bg-3")}>
                {idx < cur || i === 0 ? "✓" : i}
              </span>
              <b className={cn("font-medium", idx >= 0 && ORDER[idx] === seeing && "text-ink")}>{n}</b>
            </button>
          );
        })}
      </div>
      {next && canAdvance && (
        teacher
          ? <Button className="mt-3 w-full" size="sm" onClick={() => advance.mutate()} disabled={advance.isPending}>{a.stage === "debate" ? "結束活動並結算" : `進入「${STAGE_NAME[next]}」`} →</Button>
          : <button type="button" onClick={() => advance.mutate()} disabled={advance.isPending} className="mt-3 w-full cursor-pointer rounded-xl border border-dashed border-line-strong px-3 py-2 text-xs text-ink-dim hover:border-bronze hover:text-bronze">示範：讓老師推進 →<span className="block text-[11px] text-ink-faint">正式使用由老師推進</span></button>
      )}
    </div>
  );
}

export function ActivityPage() {
  const { classroomId, activityId } = useParams({ from: "/_app/classrooms/$classroomId/activities/$activityId" });
  const { data: me } = useMe();
  const { data: a } = useActivity(activityId);
  const [seeing, setSeeing] = useState<Stage | null>(null);
  useActivityEvents(activityId);
  if (!a) return null;
  const teacher = me?.role === "teacher";
  const view = seeing && ORDER.indexOf(seeing) <= ORDER.indexOf(a.stage) ? seeing : a.stage;
  const past = view !== a.stage;
  const flow = <Flow a={a} teacher={teacher} seeing={view} onSee={(s) => setSeeing(s === a.stage ? null : s)} />;

  return (
    <div className="flex h-full flex-col gap-3 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" size="sm" asChild>
          {a.topicId
            ? <Link to="/classrooms/$classroomId/topics/$topicId" params={{ classroomId, topicId: a.topicId }}><ArrowLeft className="size-3.5" />議題</Link>
            : <Link to="/classrooms/$classroomId" params={{ classroomId }} search={{ tab: "topics" }}><ArrowLeft className="size-3.5" />教室</Link>}
        </Button>
        <div className="min-w-0 flex-1"><span className="text-xs text-bronze">辯論 · {a.title}</span><h2 className="font-serif text-[19px] leading-tight">{a.statement}</h2></div>
        <div className="flex flex-wrap gap-1.5">{a.axes.map((x) => <Badge key={x.key}>{x.left} ⟷ {x.right}</Badge>)}</div>
      </div>
      {view === "individual" && <IndividualStage a={a} teacher={teacher} flow={flow} view={past ? "past" : "current"} />}
      {view === "team" && <TeamStage a={a} teacher={teacher} flow={flow} over={past || a.stage !== "team"} />}
      {view === "debate" && <DebateStage a={a} teacher={teacher} flow={flow} over={past || a.stage !== "debate"} />}
      {view === "done" && <ResultsStage a={a} teacher={teacher} flow={flow} />}
    </div>
  );
}

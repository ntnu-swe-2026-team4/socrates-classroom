import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { Stage } from "@/api";
import { useActivity, useActivityEvents, useMe } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { ProgressStrip, STAGE_ORDER, StageStatus } from "./StageControls";
import { DebateStage } from "./stages/DebateStage";
import { IndividualStage } from "./stages/IndividualStage";
import { ResultsStage } from "./stages/ResultsStage";
import { TeamStage } from "./stages/TeamStage";

/**
 * 辯論活動：上方標題列（右上角是目前階段與控制）、中間左右兩欄、最下方是進度色條。
 * 點色條上已經過的段落可以回顧之前的階段。
 */
export function ActivityPage() {
  const { classroomId, activityId } = useParams({ from: "/_app/classrooms/$classroomId/activities/$activityId" });
  const { data: me } = useMe();
  const { data: a } = useActivity(activityId);
  const [seeing, setSeeing] = useState<Stage | null>(null);
  useActivityEvents(activityId);
  if (!a) return null;
  const teacher = me?.role === "teacher";
  const view = seeing && STAGE_ORDER.indexOf(seeing) <= STAGE_ORDER.indexOf(a.stage) ? seeing : a.stage;
  const past = view !== a.stage;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <Button variant="outline" size="sm" asChild>
          {a.topicId
            ? <Link to="/classrooms/$classroomId/topics/$topicId" params={{ classroomId, topicId: a.topicId }}><ArrowLeft className="size-3.5" />議題</Link>
            : <Link to="/classrooms/$classroomId" params={{ classroomId }} search={{ tab: "topics" }}><ArrowLeft className="size-3.5" />教室</Link>}
        </Button>
        <h2 className="min-w-0 flex-1 truncate font-serif text-[19px] leading-tight" title={a.statement}>{a.statement}</h2>
        <StageStatus a={a} teacher={teacher} seeing={view} onBackToNow={() => setSeeing(null)} />
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        {view === "individual" && <IndividualStage a={a} teacher={teacher} view={past ? "past" : "current"} />}
        {view === "team" && <TeamStage a={a} teacher={teacher} over={past || a.stage !== "team"} />}
        {view === "debate" && <DebateStage a={a} teacher={teacher} over={past || a.stage !== "debate"} />}
        {view === "done" && <ResultsStage a={a} teacher={teacher} />}
      </div>
      <div className="px-4 py-1"><ProgressStrip a={a} seeing={view} onSee={(s) => setSeeing(s === a.stage ? null : s)} /></div>
    </div>
  );
}

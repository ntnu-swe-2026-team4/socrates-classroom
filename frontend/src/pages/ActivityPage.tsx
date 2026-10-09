import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import type { Stage } from "@/api";
import { useActivity, useActivityEvents, useMe } from "@/api/queries";
import { useT } from "@/i18n";
import { Button } from "@/components/ui/button";
import { StageProgressCtx } from "./stages/shared";
import { ProgressStrip, STAGE_ORDER, StageStatus } from "./StageControls";
import { DebateStage } from "./stages/DebateStage";
import { IndividualStage } from "./stages/IndividualStage";
import { ResultsStage } from "./stages/ResultsStage";
import { TeamStage } from "./stages/TeamStage";

/**
 * 辯論的活動頁：上方標題列（右上角是目前階段與控制）、中間左右兩欄、最下方是進度色條。
 * 辯論是四階段（點色條上已經過的段落可以回顧）。
 */
export function ActivityPage() {
  const { classroomId, activityId } = useParams({ from: "/_app/classrooms/$classroomId/activities/$activityId" });
  const t = useT();
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
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-1.5">
        <Button variant="ghost" size="icon" className="size-8" asChild>
          {a.topicId
            ? <Link to="/classrooms/$classroomId/debates/$debateId" params={{ classroomId, debateId: a.topicId }} aria-label={t("回辯論")} title={t("回辯論")}><ArrowLeft className="size-4" /></Link>
            : <Link to="/classrooms/$classroomId" params={{ classroomId }} search={{ tab: "debates" }} aria-label={t("回教室")} title={t("回教室")}><ArrowLeft className="size-4" /></Link>}
        </Button>
        <h2 className="min-w-0 flex-1 truncate font-serif text-[15px] leading-tight text-ink-dim" title={a.statement}>{a.statement}</h2>
        <StageStatus a={a} teacher={teacher} seeing={view} onBackToNow={() => setSeeing(null)} />
      </div>
      <StageProgressCtx.Provider value={<ProgressStrip a={a} seeing={view} onSee={(s) => setSeeing(s === a.stage ? null : s)} />}>
      <div className="flex min-h-0 flex-1 flex-col">
        {view === "individual" && <IndividualStage a={a} teacher={teacher} view={past ? "past" : "current"} />}
        {view === "team" && <TeamStage a={a} teacher={teacher} over={past || a.stage !== "team"} />}
        {view === "debate" && <DebateStage a={a} teacher={teacher} over={past || a.stage !== "debate"} />}
        {view === "done" && <ResultsStage a={a} teacher={teacher} />}
      </div>
      </StageProgressCtx.Provider>
    </div>
  );
}

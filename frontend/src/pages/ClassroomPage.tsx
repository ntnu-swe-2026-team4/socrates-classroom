import { useState } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, Paperclip, Pencil, Plus, X } from "lucide-react";
import { api } from "@/api";
import { keys, useActivities, useClassroom, useClassroomMembers, useMe, useTopics } from "@/api/queries";
import type { Activity, Classroom, ClassroomTopic, Stage, TopicType } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn, formatDateTime } from "@/lib/utils";
import { AnnouncementsTab } from "./Announcements";
import { ImportMembersButton, JoinSettingsCard, PendingApplications } from "./ClassroomAdmin";
import { CalendarCard } from "./CalendarCard";
import { ClassroomFormDialog } from "./ClassroomFormDialog";
import { DiscussionBoard } from "./Discussion";
import { TopicFormDialog } from "./TopicFormDialog";

export const CLASSROOM_TABS = ["home", "announcements", "topics", "discussion", "members"] as const;
export type ClassroomTab = (typeof CLASSROOM_TABS)[number];
const TAB_NAME: Record<ClassroomTab, string> = { home: "首頁", announcements: "公告", topics: "議題", discussion: "討論", members: "成員" };

export const STAGE_NAME: Record<Stage, string> = { individual: "個人調查", team: "團隊提純", debate: "辯論比賽", done: "已結束" };
const STAGE_ORDER: Stage[] = ["individual", "team", "debate", "done"];
export const TOPIC_TYPE: Record<TopicType, { name: string; tone: "olive" | "bronze" }> = { individual: { name: "個人", tone: "olive" }, group: { name: "團體", tone: "bronze" } };

/** 截止時間；已過期顯示紅色 */
export function DueLabel({ at }: { at: string | null }) {
  if (!at) return null;
  const over = new Date(at).getTime() < Date.now();
  return <span className={cn("inline-flex items-center gap-1 text-[11.5px]", over ? "text-wine" : "text-ink-faint")}><CalendarClock className="size-3.5" />{over ? "已截止 " : "截止 "}{formatDateTime(at)}</span>;
}

/** 團體議題的辯論進度條 */
export function StageBar({ stage }: { stage: Stage }) {
  return <div className="flex gap-1">{STAGE_ORDER.map((s, i) => <b key={s} className={cn("h-1 flex-1 rounded-full bg-bg-3", STAGE_ORDER.indexOf(stage) > i && "bg-bronze-dim", stage === s && "bg-bronze")} />)}</div>;
}

function TopicCard({ t, activity }: { t: ClassroomTopic; activity?: Activity }) {
  return (
    <Link to="/classrooms/$classroomId/topics/$topicId" params={{ classroomId: t.classroomId, topicId: t.id }}>
      <Card className="flex h-full flex-col transition-colors hover:border-bronze-dim">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5"><Badge tone={TOPIC_TYPE[t.type].tone}>{TOPIC_TYPE[t.type].name}</Badge>{activity && <span className="text-[11px] text-ink-faint">{STAGE_NAME[activity.stage]}</span>}</span>
          {t.resources.length > 0 && <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint"><Paperclip className="size-3" />{t.resources.length}</span>}
        </div>
        <h3 className="mt-3 font-serif text-[15.5px] leading-snug">{t.title}</h3>
        {t.description && <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-dim">{t.description}</p>}
        <div className="mt-auto space-y-2 pt-3">
          {activity && <StageBar stage={activity.stage} />}
          <DueLabel at={t.dueAt} />
        </div>
      </Card>
    </Link>
  );
}

function TopicGrid({ topics, activities }: { topics: ClassroomTopic[]; activities: Activity[] }) {
  return <div className="grid gap-4 sm:grid-cols-2">{topics.map((t) => <TopicCard key={t.id} t={t} activity={activities.find((a) => a.id === t.activityId)} />)}</div>;
}

function TopicsTab({ classroomId, teacher, topics, activities }: { classroomId: string; teacher: boolean; topics: ClassroomTopic[]; activities: Activity[] }) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState<TopicType | "all">("all");
  const navigate = useNavigate();
  const shown = filter === "all" ? topics : topics.filter((t) => t.type === filter);
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="inline-flex gap-1 text-[12.5px]">
          {([["all", "全部"], ["individual", "個人"], ["group", "團體"]] as const).map(([k, n]) => (
            <button key={k} type="button" onClick={() => setFilter(k)} className={cn("cursor-pointer rounded-full border px-3 py-1", filter === k ? "border-bronze-dim text-bronze" : "border-line text-ink-dim hover:text-ink")}>{n}</button>
          ))}
        </div>
        {teacher && <Button onClick={() => setOpen(true)}><Plus className="size-4" />新增議題</Button>}
      </div>
      <TopicGrid topics={shown} activities={activities} />
      {!shown.length && <p className="text-sm text-ink-faint">{topics.length ? "沒有這個類型的議題。" : teacher ? "還沒有議題。按右上「新增議題」，設定第一個議題吧。" : "老師還沒有新增任何議題。"}</p>}
      {teacher && <TopicFormDialog classroomId={classroomId} open={open} onOpenChange={setOpen}
        onSaved={(t) => navigate({ to: "/classrooms/$classroomId/topics/$topicId", params: { classroomId, topicId: t.id } })} />}
    </>
  );
}

function MembersTab({ classroomId, teacher }: { classroomId: string; teacher: boolean }) {
  const qc = useQueryClient();
  const { data: members = [] } = useClassroomMembers(classroomId);
  const [name, setName] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: keys.classroomMembers(classroomId) }); qc.invalidateQueries({ queryKey: keys.classrooms }); qc.invalidateQueries({ queryKey: keys.classroom(classroomId) }); };
  const add = useMutation({ mutationFn: () => api.addClassroomMember(classroomId, name.trim()), onSuccess: () => { setName(""); refresh(); } });
  return (
    <div className="space-y-4">
      {teacher && (
        <>
          <PendingApplications classroomId={classroomId} />
          <JoinSettingsCard classroomId={classroomId} />
          <div className="flex flex-wrap gap-2.5">
            <Input className="min-w-48 flex-1" placeholder="輸入帳號或姓名，新增成員…" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && add.mutate()} />
            <Button className="h-10" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>新增成員</Button>
            <ImportMembersButton classroomId={classroomId} />
          </div>
        </>
      )}
      <Card className="p-2">
        <div className="grid grid-cols-[1.4fr_.7fr_1fr_1.2fr_2rem] items-center gap-3 px-3 py-2.5 text-[11.5px] text-ink-faint max-md:grid-cols-[1fr_auto]">
          <span>姓名</span><span className="max-md:hidden">狀態</span><span className="max-md:hidden">最近一次對話</span><span className="max-md:hidden">完成度</span><span />
        </div>
        {members.map((m) => (
          <div key={m.id} className="grid grid-cols-[1.4fr_.7fr_1fr_1.2fr_2rem] items-center gap-3 border-t border-line px-3 py-3 text-[13px] max-md:grid-cols-[1fr_auto]">
            <span className="flex items-center gap-2.5"><i className="flex size-7 items-center justify-center rounded-full bg-bronze-soft font-serif text-xs not-italic text-bronze">{m.name[0]}</i>{m.name}</span>
            <span className={cn("max-md:hidden", m.online ? "text-olive" : "text-ink-faint")}>{m.online ? "● 在線" : "○ 離線"}</span>
            <span className="text-ink-dim max-md:hidden">{m.lastActive}</span>
            <span className="flex items-center gap-2 max-md:hidden"><span className="h-1.5 w-20 overflow-hidden rounded bg-bg-3"><i className="block h-full bg-bronze" style={{ width: `${m.progress}%` }} /></span>{m.progress}%</span>
            {teacher ? <button type="button" aria-label={`移除 ${m.name}`} onClick={() => api.removeClassroomMember(classroomId, m.id).then(refresh)} className="cursor-pointer text-ink-faint hover:text-wine"><X className="size-4" /></button> : <span />}
          </div>
        ))}
        {!members.length && <p className="px-3 py-4 text-sm text-ink-faint">還沒有任何成員。</p>}
      </Card>
    </div>
  );
}

/** 教室首頁：簡介與行事曆 */
function HomeTab({ classroom, teacher, onEdit }: { classroom: Classroom; teacher: boolean; onEdit: () => void }) {
  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-2 text-xs tracking-wider text-ink-faint">教室簡介</div>
        {classroom.description
          ? <p className="whitespace-pre-line text-[14px] leading-relaxed">{classroom.description}</p>
          : <p className="text-sm text-ink-faint">{teacher ? <>還沒有簡介。<button type="button" onClick={onEdit} className="cursor-pointer text-bronze hover:underline">補上簡介</button>，讓學生知道這堂課要討論什麼。</> : "老師還沒有寫教室簡介。"}</p>}
        <p className="mt-3 text-xs text-ink-faint">授課老師：{classroom.teacherName}</p>
      </Card>
      <CalendarCard classroomId={classroom.id} />
    </div>
  );
}

export function ClassroomPage() {
  const { classroomId } = useParams({ from: "/_app/classrooms/$classroomId" });
  const { tab = "home" } = useSearch({ from: "/_app/classrooms/$classroomId" });
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: classroom } = useClassroom(classroomId);
  const { data: topics = [] } = useTopics(classroomId);
  const { data: activities = [] } = useActivities(classroomId);
  const [editing, setEditing] = useState(false);
  const teacher = me?.role === "teacher";
  const setTab = (t: ClassroomTab) => navigate({ to: "/classrooms/$classroomId", params: { classroomId }, search: { tab: t }, replace: true });
  return (
    <div className="mx-auto max-w-4xl p-8">
      <Link to="/classrooms" className="inline-flex items-center gap-1.5 rounded-full border border-line-strong bg-bg-2 px-3.5 py-1.5 text-[13px] text-ink-dim hover:text-ink"><ArrowLeft className="size-3.5" />回教室列表</Link>
      <div className="mb-5 mt-4 flex items-start justify-between gap-4">
        <div><h2 className="font-serif text-2xl">{classroom?.name}</h2><p className="text-sm text-ink-faint">{classroom?.studentCount} 位學生</p></div>
        {teacher && classroom && <Button variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="size-3.5" />編輯教室</Button>}
      </div>
      <div className="no-scrollbar mb-5 inline-flex max-w-full gap-1 overflow-x-auto rounded-full border border-line bg-bg-1 p-1">
        {CLASSROOM_TABS.map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn("shrink-0 cursor-pointer rounded-full px-5 py-1.5 text-[13px]", tab === k ? "bg-bronze font-semibold text-[#221a0c]" : "text-ink-dim")}>{TAB_NAME[k]}</button>
        ))}
      </div>
      {classroom && <ClassroomFormDialog classroom={classroom} open={editing} onOpenChange={setEditing} />}
      {tab === "home" && classroom && <HomeTab classroom={classroom} teacher={teacher} onEdit={() => setEditing(true)} />}
      {tab === "announcements" && <AnnouncementsTab classroomId={classroomId} teacher={teacher} />}
      {tab === "topics" && <TopicsTab classroomId={classroomId} teacher={teacher} topics={topics} activities={activities} />}
      {tab === "discussion" && <DiscussionBoard classroomId={classroomId} topicId={null} />}
      {tab === "members" && <MembersTab classroomId={classroomId} teacher={teacher} />}
    </div>
  );
}

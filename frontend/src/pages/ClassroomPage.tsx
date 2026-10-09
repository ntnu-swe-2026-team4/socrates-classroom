import { useState } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CalendarClock, Paperclip, Pencil, Plus, Search, X } from "lucide-react";
import { api } from "@/api";
import { keys, useActivities, useClassroom, useClassroomMembers, useMe, useSetMemberRole, useTopics } from "@/api/queries";
import type { Activity, Classroom, ClassroomTopic, Stage } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn, formatDateTime } from "@/lib/utils";
import { tr, useT } from "@/i18n";
import { AnnouncementsTab } from "./Announcements";
import { ImportMembersButton, JoinSettingsCard, PendingApplications } from "./ClassroomAdmin";
import { CalendarCard } from "./CalendarCard";
import { ClassroomFormDialog } from "./ClassroomFormDialog";
import { DiscussionBoard } from "./Discussion";
import { DebateFormDialog } from "./DebateFormDialog";

export const CLASSROOM_TABS = ["home", "announcements", "debates", "discussion", "members"] as const;
export type ClassroomTab = (typeof CLASSROOM_TABS)[number];
const TAB_NAME: Record<ClassroomTab, string> = { home: "首頁", announcements: "公告", debates: "辯論", discussion: "討論", members: "成員" };

export const STAGE_NAME: Record<Stage, string> = { individual: "個人調查", team: "團隊提純", debate: "辯論比賽", done: "已結束" };
const STAGE_ORDER: Stage[] = ["individual", "team", "debate", "done"];

/** 截止時間；已過期顯示紅色 */
export function DueLabel({ at }: { at: string | null }) {
  const t = useT();
  if (!at) return null;
  const over = new Date(at).getTime() < Date.now();
  return <span className={cn("inline-flex items-center gap-1 text-[11.5px]", over ? "text-wine" : "text-ink-faint")}><CalendarClock className="size-3.5" />{over ? t("已截止") : t("截止")} {formatDateTime(at)}</span>;
}

/** 團體辯論的進度條 */
export function StageBar({ stage }: { stage: Stage }) {
  return <div className="flex gap-1">{STAGE_ORDER.map((s, i) => <b key={s} className={cn("h-1 flex-1 rounded-full bg-bg-3", STAGE_ORDER.indexOf(stage) > i && "bg-bronze-dim", stage === s && "bg-bronze")} />)}</div>;
}

function DebateCard({ t, activity }: { t: ClassroomTopic; activity?: Activity }) {
  return (
    <Link to="/classrooms/$classroomId/debates/$debateId" params={{ classroomId: t.classroomId, debateId: t.id }}>
      <Card className="flex h-full flex-col transition-colors hover:border-bronze-dim">
        <div className="flex items-center justify-between gap-2">
          {activity ? <Badge tone={activity.stage === "done" ? "neutral" : "bronze"}>{tr(STAGE_NAME[activity.stage])}</Badge> : <span />}
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

function DebateGrid({ topics, activities }: { topics: ClassroomTopic[]; activities: Activity[] }) {
  return <div className="grid gap-4 sm:grid-cols-2">{topics.map((t) => <DebateCard key={t.id} t={t} activity={activities.find((a) => a.id === t.activityId)} />)}</div>;
}

const STAGE_FILTERS: [Stage | "all", string][] = [["all", "全部"], ["individual", "個人調查"], ["team", "團隊提純"], ["debate", "辯論比賽"], ["done", "已結束"]];
const WEEK_MS = 7 * 864e5;

/** 辯論列表：用標題搜尋、依階段篩選，還可以只看一週內截止的 */
function DebatesTab({ classroomId, canCreate, topics, activities }: { classroomId: string; canCreate: boolean; topics: ClassroomTopic[]; activities: Activity[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [stage, setStage] = useState<Stage | "all">("all");
  const [soon, setSoon] = useState(false);
  const navigate = useNavigate();
  const stageOf = (tp: ClassroomTopic) => activities.find((a) => a.id === tp.activityId)?.stage;
  const now = Date.now();
  const shown = topics.filter((tp) =>
    (!q.trim() || tp.title.toLowerCase().includes(q.trim().toLowerCase())) &&
    (stage === "all" || stageOf(tp) === stage) &&
    (!soon || (tp.dueAt && new Date(tp.dueAt).getTime() >= now && new Date(tp.dueAt).getTime() - now <= WEEK_MS)));
  const chip = (on: boolean) => cn("cursor-pointer rounded-full border px-3 py-1", on ? "border-bronze-dim text-bronze" : "border-line text-ink-dim hover:text-ink");
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative w-56 max-sm:w-full">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-ink-faint" />
          <Input className="h-9 pl-9 text-[13px]" placeholder={t("搜尋辯論標題…")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-1.5 text-[12.5px]" role="group" aria-label={t("依階段篩選")}>
          {STAGE_FILTERS.map(([k, n]) => <button key={k} type="button" aria-pressed={stage === k} onClick={() => setStage(k)} className={chip(stage === k)}>{t(n)}</button>)}
          <span aria-hidden="true" className="mx-1 w-px bg-line" />
          <button type="button" aria-pressed={soon} onClick={() => setSoon((v) => !v)} className={chip(soon)}>{t("一週內截止")}</button>
        </div>
        {canCreate && <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}><Plus className="size-4" />{t("新增辯論")}</Button>}
      </div>
      <DebateGrid topics={shown} activities={activities} />
      {!shown.length && <p className="text-sm text-ink-faint">{topics.length ? t("沒有符合條件的辯論。") : canCreate ? t("還沒有辯論。按右上「新增辯論」，設定第一場辯論吧。") : t("老師還沒有新增任何辯論。")}</p>}
      {canCreate && <DebateFormDialog classroomId={classroomId} open={open} onOpenChange={setOpen}
        onSaved={(tp) => navigate({ to: "/classrooms/$classroomId/debates/$debateId", params: { classroomId, debateId: tp.id } })} />}
    </>
  );
}

function MembersTab({ classroomId, teacher }: { classroomId: string; teacher: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const setRole = useSetMemberRole(classroomId);
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
            <Input className="min-w-48 flex-1" placeholder={t("輸入帳號或姓名，新增成員…")} value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && add.mutate()} />
            <Button className="h-10" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>{t("新增成員")}</Button>
            <ImportMembersButton classroomId={classroomId} />
          </div>
        </>
      )}
      <Card className="p-2">
        <div className="grid grid-cols-[1.4fr_.7fr_1fr_1.2fr_auto] items-center gap-3 px-3 py-2.5 text-[11.5px] text-ink-faint max-md:grid-cols-[1fr_auto]">
          <span>{t("姓名 / 身分")}</span><span className="max-md:hidden">{t("狀態")}</span><span className="max-md:hidden">{t("最近一次對話")}</span><span className="max-md:hidden">{t("完成度")}</span><span />
        </div>
        {members.map((m) => (
          <div key={m.id} className="grid grid-cols-[1.4fr_.7fr_1fr_1.2fr_auto] items-center gap-3 border-t border-line px-3 py-3 text-[13px] max-md:grid-cols-[1fr_auto]">
            <span className="flex items-center gap-2.5"><i className="flex size-7 items-center justify-center rounded-full bg-bronze-soft font-serif text-xs not-italic text-bronze">{m.name[0]}</i>{m.name}{m.role === "assistant" && <Badge tone="bronze">{t("助教")}</Badge>}</span>
            <span className={cn("max-md:hidden", m.online ? "text-olive" : "text-ink-faint")}>{m.online ? t("● 在線") : t("○ 離線")}</span>
            <span className="text-ink-dim max-md:hidden">{m.lastActive}</span>
            <span className="flex items-center gap-2 max-md:hidden"><span className="h-1.5 w-20 overflow-hidden rounded bg-bg-3"><i className="block h-full bg-bronze" style={{ width: `${m.progress}%` }} /></span>{m.progress}%</span>
            {teacher ? (
              <span className="flex items-center justify-end gap-2">
                <Button variant="outline" size="sm" disabled={setRole.isPending} title={m.role === "assistant" ? t("取消助教，改回一般學生") : t("設為助教：可以發公告、編輯行事曆、上傳資料")}
                  onClick={() => setRole.mutate({ memberId: m.id, role: m.role === "assistant" ? "student" : "assistant" })}>{m.role === "assistant" ? t("改回學生") : t("設為助教")}</Button>
                <button type="button" aria-label={t("移除 {name}", { name: m.name })} onClick={() => api.removeClassroomMember(classroomId, m.id).then(refresh)} className="cursor-pointer text-ink-faint hover:text-wine"><X className="size-4" /></button>
              </span>
            ) : <span />}
          </div>
        ))}
        {setRole.error && <p className="px-3 pb-2 text-[12.5px] text-wine">{setRole.error.message}</p>}
        {!members.length && <p className="px-3 py-4 text-sm text-ink-faint">{t("還沒有任何成員。")}</p>}
      </Card>
    </div>
  );
}

/** 教室首頁：簡介與行事曆 */
function HomeTab({ classroom, teacher, staff, onEdit, debateCount, ongoing }: { classroom: Classroom; teacher: boolean; staff: boolean; onEdit: () => void; debateCount: number; ongoing: number }) {
  const t = useT();
  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-2 text-xs tracking-wider text-ink-faint">{t("教室簡介")}</div>
        {classroom.description
          ? <p className="whitespace-pre-line text-[14px] leading-relaxed">{classroom.description}</p>
          : <p className="text-sm text-ink-faint">{teacher ? <>{t("還沒有簡介。")}<button type="button" onClick={onEdit} className="cursor-pointer text-bronze hover:underline">{t("補上簡介")}</button>{t("，讓學生知道這堂課要討論什麼。")}</> : t("老師還沒有寫教室簡介。")}</p>}
        <p className="mt-3 text-xs text-ink-faint">{t("授課老師：{name}", { name: classroom.teacherName })}</p>
      </Card>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <div className="text-xs tracking-wider text-ink-faint">{t("學生人數")}</div>
          <div className="mt-1 font-serif text-3xl">{classroom.studentCount}</div>
        </Card>
        <Card>
          <div className="text-xs tracking-wider text-ink-faint">{t("辯論#n")}</div>
          <div className="mt-1 flex items-baseline gap-3">
            <span className="font-serif text-3xl">{debateCount}</span>
            <span className="text-xs text-ink-faint">{t("進行中 {n}", { n: ongoing })}</span>
          </div>
        </Card>
      </div>
      <CalendarCard classroomId={classroom.id} editable={staff} />
    </div>
  );
}

export function ClassroomPage() {
  const t = useT();
  const { classroomId } = useParams({ from: "/_app/classrooms/$classroomId" });
  const { tab = "home" } = useSearch({ from: "/_app/classrooms/$classroomId" });
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: classroom } = useClassroom(classroomId);
  const { data: topics = [] } = useTopics(classroomId);
  const { data: activities = [] } = useActivities(classroomId);
  const [editing, setEditing] = useState(false);
  const teacher = me?.role === "teacher";
  const staff = teacher || classroom?.myRole === "assistant";
  const setTab = (t: ClassroomTab) => navigate({ to: "/classrooms/$classroomId", params: { classroomId }, search: { tab: t }, replace: true });
  return (
    <div className="flex min-h-full flex-col">
      {/* 緊湊的標題列：返回、教室名稱、分頁都在同一排，下面用線和內容分開 */}
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-x-4 gap-y-1 min-h-[96px] border-b border-line bg-bg/95 px-6 backdrop-blur">
        <Link to="/classrooms" aria-label={t("回教室列表")} title={t("回教室列表")} className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-dim hover:bg-bg-2 hover:text-ink"><ArrowLeft className="size-4" /></Link>
        <div className="flex min-w-0 items-baseline gap-2.5">
          <h2 className="truncate font-serif text-[17px] leading-tight">{classroom?.name}</h2>
          {classroom?.myRole === "assistant" && <span className="shrink-0 text-xs text-ink-faint">{t("你是助教")}</span>}
        </div>
        <nav className="no-scrollbar ml-auto flex max-w-full items-end gap-1 self-stretch overflow-x-auto" aria-label={t("教室分頁")}>
          {CLASSROOM_TABS.map((k) => (
            <button key={k} type="button" aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)}
              className={cn("relative shrink-0 cursor-pointer px-3.5 pt-2 pb-3 text-[13px]", tab === k ? "font-semibold text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-bronze" : "text-ink-faint hover:text-ink-dim")}>{t(TAB_NAME[k])}</button>
          ))}
        </nav>
        {teacher && classroom && <Button variant="ghost" size="icon" className="size-8" aria-label={t("編輯教室")} title={t("編輯教室")} onClick={() => setEditing(true)}><Pencil className="size-3.5" /></Button>}
      </header>
      <div className="mx-auto w-full max-w-5xl flex-1 px-6 py-5">
        {classroom && <ClassroomFormDialog classroom={classroom} open={editing} onOpenChange={setEditing} />}
        {tab === "home" && classroom && <HomeTab classroom={classroom} teacher={teacher} staff={staff} onEdit={() => setEditing(true)} debateCount={topics.length} ongoing={activities.filter((x) => x.stage !== "done").length} />}
        {tab === "announcements" && <AnnouncementsTab classroomId={classroomId} staff={staff} />}
        {tab === "debates" && <DebatesTab classroomId={classroomId} canCreate={teacher} topics={topics} activities={activities} />}
        {tab === "discussion" && <DiscussionBoard classroomId={classroomId} topicId={null} />}
        {tab === "members" && <MembersTab classroomId={classroomId} teacher={teacher} />}
      </div>
    </div>
  );
}

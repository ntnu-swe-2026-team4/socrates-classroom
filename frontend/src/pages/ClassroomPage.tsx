import { useState } from "react";
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Pencil, Plus, X } from "lucide-react";
import { api } from "@/api";
import { keys, useActivities, useClassroom, useClassroomMembers, useCreateActivity, useMe } from "@/api/queries";
import type { Activity, AnswerMode, Classroom, Stage } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { ClassroomFormDialog } from "./ClassroomFormDialog";

export const CLASSROOM_TABS = ["home", "members", "debate"] as const;
export type ClassroomTab = (typeof CLASSROOM_TABS)[number];
const TAB_NAME: Record<ClassroomTab, string> = { home: "首頁", members: "成員", debate: "辯論" };

export const STAGE_NAME: Record<Stage, string> = { individual: "個人調查", team: "團隊提純", debate: "辯論比賽", done: "已結束" };
const STAGE_TONE: Record<Stage, "bronze" | "olive" | "wine" | "neutral"> = { individual: "bronze", team: "olive", debate: "wine", done: "neutral" };
const MODE_NAME: Record<AnswerMode, string> = { text: "文字", voice: "語音", both: "文字或語音" };

function ActivityCard({ a }: { a: Activity }) {
  const order: Stage[] = ["individual", "team", "debate", "done"];
  return (
    <Link to="/classrooms/$classroomId/activities/$activityId" params={{ classroomId: a.classroomId, activityId: a.id }}>
      <Card className="h-full transition-colors hover:border-bronze-dim">
        <div className="flex items-center justify-between"><Badge tone={STAGE_TONE[a.stage]}>{STAGE_NAME[a.stage]}</Badge><span className="text-[11px] text-ink-faint">{MODE_NAME[a.answerMode]}回答</span></div>
        <h3 className="mt-3 font-serif text-[15.5px] leading-snug">{a.statement}</h3>
        <div className="mt-2 space-y-0.5 text-[11.5px] text-ink-dim">{a.axes.map((x) => <div key={x.key}>{x.left} ⟷ {x.right}</div>)}</div>
        <div className="mt-3 flex gap-1">{order.map((s, i) => <b key={s} className={cn("h-1 flex-1 rounded-full bg-bg-3", order.indexOf(a.stage) > i && "bg-bronze-dim", a.stage === s && "bg-bronze")} />)}</div>
        <p className="mt-2 text-xs text-ink-faint">{a.title} · {a.memberCount} 位成員</p>
      </Card>
    </Link>
  );
}

function CreateDialog({ classroomId, open, onOpenChange }: { classroomId: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  const create = useCreateActivity(classroomId);
  const [statement, setStatement] = useState("");
  const [title, setTitle] = useState("");
  const [mode, setMode] = useState<AnswerMode>("both");
  const [size, setSize] = useState(3);
  const [axes, setAxes] = useState([{ name: "", left: "", right: "" }, { name: "", left: "", right: "" }]);
  const [err, setErr] = useState("");

  function submit() {
    const clean = axes.filter((x) => x.name.trim() && x.left.trim() && x.right.trim());
    if (!statement.trim()) return setErr("請填寫議題。");
    if (!clean.length) return setErr("至少要有一條完整的價值軸（名稱與兩端都要填）。");
    create.mutate(
      { title: title.trim() || "辯論", statement: statement.trim(), answerMode: mode, groupSize: size, axes: clean },
      { onSuccess: () => { onOpenChange(false); setStatement(""); setErr(""); } },
    );
  }
  const seg = (items: [string, string][], val: string, set: (v: string) => void) => (
    <div className="inline-flex gap-0.5 rounded-full border border-line-strong bg-bg-2 p-0.5">
      {items.map(([v, n]) => <button key={v} type="button" onClick={() => set(v)} className={cn("cursor-pointer rounded-full px-4 py-1.5 text-[13px]", val === v ? "bg-bronze font-semibold text-[#221a0c]" : "text-ink-dim")}>{n}</button>)}
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle>新增辯論</DialogTitle>
        <DialogDescription>同學會先各自跟 AI 對話，AI 依價值軸推估每個人的立場座標。</DialogDescription>
        <div className="space-y-4 text-sm">
          <label className="block"><span className="mb-1 block text-xs text-ink-dim">活動名稱</span><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="第 2 場辯論" /></label>
          <label className="block"><span className="mb-1 block text-xs text-ink-dim">議題</span><Input value={statement} onChange={(e) => setStatement(e.target.value)} placeholder="例如：正義是否只是強者的利益？" /></label>
          <div><span className="mb-1 block text-xs text-ink-dim">回答方式</span>{seg([["text", "文字"], ["voice", "語音"], ["both", "文字或語音"]], mode, (v) => setMode(v as AnswerMode))}</div>
          <div>
            <span className="mb-1 block text-xs text-ink-dim">價值軸（1–3 條）</span>
            <div className="space-y-2">
              {axes.map((x, i) => (
                <div key={i} className="grid grid-cols-[1.1fr_1fr_auto_1fr_auto] items-center gap-2">
                  <Input className="h-9" placeholder="軸名稱" value={x.name} onChange={(e) => setAxes(axes.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)))} />
                  <Input className="h-9" placeholder="偏左（−1）" value={x.left} onChange={(e) => setAxes(axes.map((y, j) => (j === i ? { ...y, left: e.target.value } : y)))} />
                  <span className="text-ink-faint">⟷</span>
                  <Input className="h-9" placeholder="偏右（+1）" value={x.right} onChange={(e) => setAxes(axes.map((y, j) => (j === i ? { ...y, right: e.target.value } : y)))} />
                  {axes.length > 1 ? <button type="button" aria-label="移除" onClick={() => setAxes(axes.filter((_, j) => j !== i))} className="cursor-pointer text-ink-faint"><X className="size-4" /></button> : <span />}
                </div>
              ))}
            </div>
            {axes.length < 3 && <Button variant="outline" size="sm" className="mt-2" onClick={() => setAxes([...axes, { name: "", left: "", right: "" }])}><Plus className="size-3.5" />加一條軸</Button>}
          </div>
          <div><span className="mb-1 block text-xs text-ink-dim">組別人數</span>{seg([["3", "3 人"], ["4", "4 人"], ["5", "5 人"]], String(size), (v) => setSize(Number(v)))}</div>
          {err && <p className="text-[12.5px] text-wine">{err}</p>}
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button><Button onClick={submit} disabled={create.isPending}>建立辯論</Button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MembersTab({ classroomId, teacher }: { classroomId: string; teacher: boolean }) {
  const qc = useQueryClient();
  const { data: members = [] } = useClassroomMembers(classroomId);
  const [name, setName] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: keys.classroomMembers(classroomId) }); qc.invalidateQueries({ queryKey: keys.classrooms }); qc.invalidateQueries({ queryKey: keys.classroom(classroomId) }); };
  const add = useMutation({ mutationFn: () => api.addClassroomMember(classroomId, name.trim()), onSuccess: () => { setName(""); refresh(); } });
  return (
    <div>
      {teacher && (
        <div className="mb-4 flex gap-2.5">
          <Input placeholder="輸入帳號或姓名，新增成員…" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Enter" && name.trim() && add.mutate()} />
          <Button className="h-10" disabled={!name.trim() || add.isPending} onClick={() => add.mutate()}>新增成員</Button>
        </div>
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

function HomeTab({ classroom, activities, teacher, onEdit, onSeeAll }: {
  classroom: Classroom; activities: Activity[]; teacher: boolean; onEdit: () => void; onSeeAll: () => void;
}) {
  const recent = [...activities].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 2);
  const live = activities.filter((a) => a.stage !== "done").length;
  return (
    <div className="space-y-6">
      <Card>
        <div className="mb-2 text-xs tracking-wider text-ink-faint">教室簡介</div>
        {classroom.description
          ? <p className="whitespace-pre-line text-[14px] leading-relaxed">{classroom.description}</p>
          : <p className="text-sm text-ink-faint">{teacher ? <>還沒有簡介。<button type="button" onClick={onEdit} className="cursor-pointer text-bronze hover:underline">補上簡介</button>，讓學生知道這堂課要討論什麼。</> : "老師還沒有寫教室簡介。"}</p>}
        <p className="mt-3 text-xs text-ink-faint">授課老師：{classroom.teacherName}</p>
      </Card>
      <div className="grid grid-cols-3 gap-3">
        {([["學生", classroom.studentCount], ["辯論", activities.length], ["進行中", live]] as const).map(([n, v]) => (
          <Card key={n} className="py-4 text-center"><b className="block font-serif text-2xl">{v}</b><span className="text-xs text-ink-faint">{n}</span></Card>
        ))}
      </div>
      <div>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs tracking-wider text-ink-faint">最近的辯論</span>
          {activities.length > recent.length && <button type="button" onClick={onSeeAll} className="cursor-pointer text-xs text-bronze hover:underline">查看全部 →</button>}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">{recent.map((a) => <ActivityCard key={a.id} a={a} />)}</div>
        {!recent.length && <p className="text-sm text-ink-faint">{teacher ? "還沒有辯論，到「辯論」分頁新增第一場。" : "老師還沒有開始任何辯論。"}</p>}
      </div>
    </div>
  );
}

export function ClassroomPage() {
  const { classroomId } = useParams({ from: "/_app/classrooms/$classroomId" });
  const { tab = "home" } = useSearch({ from: "/_app/classrooms/$classroomId" });
  const navigate = useNavigate();
  const { data: me } = useMe();
  const { data: classroom } = useClassroom(classroomId);
  const { data: activities = [] } = useActivities(classroomId);
  const [open, setOpen] = useState(false);
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
      <div className="mb-5 inline-flex gap-1 rounded-full border border-line bg-bg-1 p-1">
        {CLASSROOM_TABS.map((k) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={cn("cursor-pointer rounded-full px-5 py-1.5 text-[13px]", tab === k ? "bg-bronze font-semibold text-[#221a0c]" : "text-ink-dim")}>{TAB_NAME[k]}</button>
        ))}
      </div>
      {classroom && <ClassroomFormDialog classroom={classroom} open={editing} onOpenChange={setEditing} />}
      {tab === "home" ? (classroom && <HomeTab classroom={classroom} activities={activities} teacher={teacher} onEdit={() => setEditing(true)} onSeeAll={() => setTab("debate")} />) : tab === "members" ? <MembersTab classroomId={classroomId} teacher={teacher} /> : (
        <>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
            <p className="max-w-[56ch] text-[13px] leading-relaxed text-ink-dim">設定議題與價值軸，讓同學先各自跟 AI 對話，再依立場分組、辯論。</p>
            {teacher && <Button onClick={() => setOpen(true)}><Plus className="size-4" />新增辯論</Button>}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">{activities.map((a) => <ActivityCard key={a.id} a={a} />)}</div>
          {!activities.length && <p className="text-sm text-ink-faint">{teacher ? "還沒有辯論。按右上「新增辯論」，設定第一個議題吧。" : "老師還沒有開始任何辯論。"}</p>}
          <CreateDialog classroomId={classroomId} open={open} onOpenChange={setOpen} />
        </>
      )}
    </div>
  );
}

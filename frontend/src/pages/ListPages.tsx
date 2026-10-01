import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { KeyRound, Mail, Plus } from "lucide-react";
import { useArchives, useClassrooms, useMe, useUpdateArchive } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClassroomFormDialog } from "./ClassroomFormDialog";
import { InvitesDialog, JoinDialog } from "./JoinClassroom";

export function SummaryPage() {
  const { data: archives = [] } = useArchives();
  const update = useUpdateArchive();
  const items = archives.filter((a) => a.inSummary);
  return (
    <div className="mx-auto max-w-3xl p-8">
      <p className="text-xs text-bronze">從「議題」加進來的對話</p>
      <h2 className="mb-1 font-serif text-2xl">論點總結</h2>
      <p className="mb-6 text-sm text-ink-dim">整理你的核心主張、支持理由，以及過程中立場如何被檢驗與修正。</p>
      {items.map((a) => (
        <Card key={a.id} className="mb-3">
          <div className="flex items-center justify-between">
            <h3 className="font-serif text-base">{a.title}</h3>
            <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: a.id, inSummary: false })}>移除</Button>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink-dim">{a.snippet}（共 {a.rounds} 輪對話，{a.date}）</p>
        </Card>
      ))}
      {!items.length && <Card className="py-14 text-center text-sm text-ink-faint">尚未加入任何對話記錄。<br />先到「議題」頁，把想整理的對話加進來。</Card>}
    </div>
  );
}

export function BankPage() {
  const { kind } = useParams({ from: "/_app/bank/$kind" });
  const { data: archives = [] } = useArchives();
  const items = archives.filter((a) => a.bank === kind);
  return (
    <div className="mx-auto max-w-3xl p-8">
      <p className="text-xs text-bronze">{kind === "private" ? "只有你看得到" : "大家都看得到"}</p>
      <h2 className="mb-6 font-serif text-2xl">{kind === "private" ? "私人題庫" : "公開題庫"}</h2>
      {items.map((a) => (
        <Card key={a.id} className="mb-3"><h3 className="font-serif text-base">{a.title}</h3><p className="mt-1 text-sm text-ink-dim">{a.snippet}</p></Card>
      ))}
      {!items.length && <Card className="py-14 text-center text-sm text-ink-faint">這裡還沒有題目。到「議題」把對話加進題庫。</Card>}
    </div>
  );
}

export function ClassroomsPage() {
  const { data: me } = useMe();
  const { data: classrooms = [] } = useClassrooms();
  const teacher = me?.role === "teacher";
  const list = teacher ? classrooms : classrooms.filter((c) => c.joined);
  const inviteCount = teacher ? 0 : classrooms.filter((c) => !c.joined).length;
  const [open, setOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [inviting, setInviting] = useState(false);

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl">我的教室</h2>
          <p className="mt-1 max-w-[52ch] text-sm leading-relaxed text-ink-dim">{teacher ? "建立教室、邀請學生加入，之後可以在教室裡管理成員、發起辯論。" : "用老師給的邀請碼加入，或到左側「探索」找開放加入的課程。"}</p>
        </div>
        {teacher ? <Button onClick={() => setOpen(true)}><Plus className="size-4" />新增教室</Button> : (
          <span className="flex gap-2">
            <Button variant="outline" onClick={() => setInviting(true)}><Mail className="size-4" />待處理邀請{inviteCount > 0 && <span className="rounded-full bg-bronze px-1.5 text-[11px] font-semibold text-[#221a0c]">{inviteCount}</span>}</Button>
            <Button onClick={() => setJoining(true)}><KeyRound className="size-4" />用邀請碼加入</Button>
          </span>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        {list.map((c) => (
          <Link key={c.id} to="/classrooms/$classroomId" params={{ classroomId: c.id }}>
            <Card className="h-full transition-colors hover:border-bronze-dim">
              <h3 className="font-serif text-lg">{c.name}</h3>
              {c.description && <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-dim">{c.description}</p>}
              <p className="mt-1 text-sm text-ink-faint">{c.teacherName} · {c.studentCount} 位學生</p>
            </Card>
          </Link>
        ))}
      </div>
      {!list.length && <p className="text-sm text-ink-faint">{teacher ? "還沒有建立任何教室，按上面「新增教室」開始吧。" : "目前還沒有加入任何教室。"}</p>}

      {teacher ? <ClassroomFormDialog open={open} onOpenChange={setOpen} /> : (
        <>
          <JoinDialog open={joining} onOpenChange={setJoining} />
          <InvitesDialog open={inviting} onOpenChange={setInviting} />
        </>
      )}
    </div>
  );
}

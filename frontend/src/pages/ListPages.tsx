import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { KeyRound, Plus } from "lucide-react";
import { api } from "@/api";
import { keys, useArchives, useClassrooms, useMe, useUpdateArchive } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ClassroomFormDialog } from "./ClassroomFormDialog";
import { DiscoverClassrooms, JoinDialog, MyApplications } from "./JoinClassroom";

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
  const qc = useQueryClient();
  const teacher = me?.role === "teacher";
  const list = teacher ? classrooms : classrooms.filter((c) => c.joined);
  const invites = teacher ? [] : classrooms.filter((c) => !c.joined);
  const [open, setOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const refresh = () => { qc.invalidateQueries({ queryKey: keys.classrooms }); qc.invalidateQueries({ queryKey: ["discover"] }); };

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h2 className="font-serif text-2xl">我的教室</h2>
          <p className="mt-1 max-w-[52ch] text-sm leading-relaxed text-ink-dim">{teacher ? "建立教室、邀請學生加入，之後可以在教室裡管理成員、發起辯論。" : "用老師給的邀請碼加入教室，或在下方「探索教室」找開放加入的教室。"}</p>
        </div>
        {teacher ? <Button onClick={() => setOpen(true)}><Plus className="size-4" />新增教室</Button> : <Button onClick={() => setJoining(true)}><KeyRound className="size-4" />用邀請碼加入</Button>}
      </div>

      {!teacher && <MyApplications />}

      {invites.length > 0 && (
        <div className="mb-6">
          <div className="mb-2 text-xs tracking-wider text-ink-faint">待處理邀請</div>
          {invites.map((c) => (
            <Card key={c.id} className="mb-2 flex items-center justify-between gap-3 py-3.5">
              <span><b className="font-serif">{c.name}</b><small className="block text-xs text-ink-faint">{c.teacherName} 邀請你加入</small></span>
              <span className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => api.declineInvite(c.id).then(refresh)}>拒絕</Button>
                <Button size="sm" onClick={() => api.acceptInvite(c.id).then(refresh)}>接受</Button>
              </span>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {list.map((c) => (
          <Link key={c.id} to="/classrooms/$classroomId" params={{ classroomId: c.id }}>
            <Card className="h-full transition-colors hover:border-bronze-dim">
              <h3 className="font-serif text-lg">{c.name}</h3>
              {c.description && <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-dim">{c.description}</p>}
              <p className="mt-1 text-sm text-ink-faint">{c.studentCount} 位學生 · {c.debateCount} 場辯論</p>
              <Badge tone="bronze" className="mt-3">進入教室</Badge>
            </Card>
          </Link>
        ))}
      </div>
      {!list.length && <p className="text-sm text-ink-faint">{teacher ? "還沒有建立任何教室，按上面「新增教室」開始吧。" : "目前還沒有加入任何教室。"}</p>}

      {!teacher && (
        <div className="mt-10">
          <DiscoverClassrooms />
          <JoinDialog open={joining} onOpenChange={setJoining} />
        </div>
      )}

      <ClassroomFormDialog open={open} onOpenChange={setOpen} />
    </div>
  );
}

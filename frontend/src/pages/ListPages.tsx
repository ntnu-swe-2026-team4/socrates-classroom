import { useT } from "@/i18n";
import { useState } from "react";
import { Link, useParams } from "@tanstack/react-router";
import { Compass, KeyRound, Mail, Plus, Search } from "lucide-react";
import { useArchives, useClassrooms, useMe, useUpdateArchive } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ClassroomFormDialog } from "./ClassroomFormDialog";
import { DiscoverClassrooms, InvitesDialog, JoinDialog, MyApplications } from "./JoinClassroom";

export function SummaryPage() {
  const t = useT();
  const { data: archives = [] } = useArchives();
  const update = useUpdateArchive();
  const items = archives.filter((a) => a.inSummary);
  return (
    <div className="mx-auto max-w-3xl p-8">
      <p className="text-xs text-bronze">{t("從「議題」加進來的對話")}</p>
      <h2 className="mb-1 font-serif text-2xl">{t("論點總結")}</h2>
      <p className="mb-6 text-sm text-ink-dim">{t("整理你的核心主張、支持理由，以及過程中立場如何被檢驗與修正。")}</p>
      {items.map((a) => (
        <Card key={a.id} className="mb-3">
          <div className="flex items-center justify-between">
            <h3 className="font-serif text-base">{a.title}</h3>
            <Button variant="ghost" size="sm" onClick={() => update.mutate({ id: a.id, inSummary: false })}>{t("移除")}</Button>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink-dim">{a.snippet}{t("（共 {n} 輪對話，{date}）", { n: a.rounds, date: a.date })}</p>
        </Card>
      ))}
      {!items.length && <Card className="py-14 text-center text-sm text-ink-faint">{t("尚未加入任何對話記錄。")}<br />{t("先到「議題」頁，把想整理的對話加進來。")}</Card>}
    </div>
  );
}

export function BankPage() {
  const t = useT();
  const { kind } = useParams({ from: "/_app/bank/$kind" });
  const { data: archives = [] } = useArchives();
  const items = archives.filter((a) => a.bank === kind);
  return (
    <div className="mx-auto max-w-3xl p-8">
      <p className="text-xs text-bronze">{kind === "private" ? t("只有你看得到") : t("大家都看得到")}</p>
      <h2 className="mb-6 font-serif text-2xl">{kind === "private" ? t("私人題庫") : t("公開題庫")}</h2>
      {items.map((a) => (
        <Card key={a.id} className="mb-3"><h3 className="font-serif text-base">{a.title}</h3><p className="mt-1 text-sm text-ink-dim">{a.snippet}</p></Card>
      ))}
      {!items.length && <Card className="py-14 text-center text-sm text-ink-faint">{t("這裡還沒有題目。到「議題」把對話加進題庫。")}</Card>}
    </div>
  );
}

export function ClassroomsPage() {
  const t = useT();
  const { data: me } = useMe();
  const { data: classrooms = [] } = useClassrooms();
  const teacher = me?.role === "teacher";
  const list = teacher ? classrooms : classrooms.filter((c) => c.joined);
  const inviteCount = teacher ? 0 : classrooms.filter((c) => !c.joined).length;
  const [open, setOpen] = useState(false);
  const [joining, setJoining] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [exploring, setExploring] = useState(false);
  const [q, setQ] = useState("");
  const kw = q.trim().toLowerCase();
  const shown = kw ? list.filter((c) => [c.name, c.description, c.teacherName].some((x) => x?.toLowerCase().includes(kw))) : list;

  return (
    <div className="mx-auto max-w-4xl p-8">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-5">
        <div>
          <h2 className="font-serif text-2xl">{t("我的教室")}</h2>
          <p className="mt-1 max-w-[52ch] text-sm leading-relaxed text-ink-dim">{teacher ? t("建立教室、邀請學生加入，之後可以在教室裡管理成員、發起辯論。") : t("處理老師的邀請、用邀請碼加入，或到「探索教室」找開放加入的課程。")}</p>
        </div>
        {teacher ? <Button onClick={() => setOpen(true)}><Plus className="size-4" />{t("新增教室")}</Button> : (
          <span className="flex flex-wrap gap-2">
            <Button variant="outline" onClick={() => setInviting(true)}><Mail className="size-4" />{t("待處理邀請")}{inviteCount > 0 && <span className="rounded-full bg-bronze px-1.5 text-[11px] font-semibold text-[#221a0c]">{inviteCount}</span>}</Button>
            <Button variant="outline" onClick={() => setJoining(true)}><KeyRound className="size-4" />{t("用邀請碼加入")}</Button>
            <Button variant={exploring ? "default" : "outline"} aria-pressed={exploring} onClick={() => { setExploring((v) => !v); setQ(""); }}><Compass className="size-4" />{t("探索教室")}</Button>
          </span>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm text-ink-dim">{exploring ? t("探索教室") : t("已加入的教室")}</h3>
        <span className="relative block w-72 max-w-full">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-faint" />
          <Input className="h-9 pl-9" placeholder={exploring ? t("搜尋教室、老師…") : t("搜尋我的教室…")} value={q} onChange={(e) => setQ(e.target.value)} />
        </span>
      </div>

      {exploring && !teacher ? (
        <>
          <p className="mb-4 text-[12.5px] text-ink-faint">{t("老師開放加入的課程都在這裡；需要審核的課程，送出申請後會出現在「我的申請」。")}</p>
          <MyApplications />
          <DiscoverClassrooms q={q} />
        </>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {shown.map((c) => (
              <Link key={c.id} to="/classrooms/$classroomId" params={{ classroomId: c.id }}>
                <Card className="h-full transition-colors hover:border-bronze-dim">
                  <h3 className="font-serif text-lg">{c.name}</h3>
                  {c.description && <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-dim">{c.description}</p>}
                  <p className="mt-1 text-sm text-ink-faint">{c.teacherName} · {t("{n} 位學生", { n: c.studentCount })}</p>
                </Card>
              </Link>
            ))}
          </div>
          {!shown.length && <p className="text-sm text-ink-faint">{kw ? t("找不到符合的教室。") : teacher ? t("還沒有建立任何教室，按上面「新增教室」開始吧。") : t("目前還沒有加入任何教室。")}</p>}
        </>
      )}

      {teacher ? <ClassroomFormDialog open={open} onOpenChange={setOpen} /> : (
        <>
          <JoinDialog open={joining} onOpenChange={setJoining} />
          <InvitesDialog open={inviting} onOpenChange={setInviting} />
        </>
      )}
    </div>
  );
}

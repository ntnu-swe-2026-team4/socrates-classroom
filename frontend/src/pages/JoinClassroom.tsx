import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { api } from "@/api";
import { keys, useCancelApplication, useClassrooms, useDiscoverClassrooms, useJoinClassroom, useMe, useMyApplications } from "@/api/queries";
import type { ApplicationStatus, ClassroomPreview, JoinQuestion } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { cn, formatDateTime } from "@/lib/utils";

const APP_STATUS: Record<ApplicationStatus, { name: string; tone: "bronze" | "olive" | "wine" }> = {
  pending: { name: "審核中", tone: "bronze" }, approved: { name: "已通過", tone: "olive" }, rejected: { name: "未通過", tone: "wine" },
};

function QuestionField({ q, value, onChange }: { q: JoinQuestion; value: string; onChange: (v: string) => void }) {
  const label = <span className="mb-1 block text-xs text-ink-dim">{q.prompt}{q.required && <span className="text-wine"> *</span>}</span>;
  if (q.kind === "choice") {
    return (
      <fieldset>
        <legend>{label}</legend>
        <div className="flex flex-wrap gap-1.5">
          {q.options?.map((o) => (
            <button key={o} type="button" onClick={() => onChange(o)}
              className={cn("cursor-pointer rounded-full border px-3.5 py-1.5 text-[13px]", value === o ? "border-bronze bg-bronze-soft text-bronze" : "border-line-strong text-ink-dim hover:text-ink")}>{o}</button>
          ))}
        </div>
      </fieldset>
    );
  }
  return <label className="block">{label}{q.kind === "paragraph" ? <Textarea rows={3} value={value} onChange={(e) => onChange(e.target.value)} /> : <Input value={value} onChange={(e) => onChange(e.target.value)} />}</label>;
}

/**
 * 加入教室：沒帶 classroom 時先輸入邀請碼；找到教室後顯示簡介，
 * 需要審核就填問卷送出申請，不需要就直接加入並進入教室。
 */
export function JoinDialog({ classroom, open, onOpenChange }: { classroom?: ClassroomPreview; open: boolean; onOpenChange: (v: boolean) => void }) {
  const navigate = useNavigate();
  const join = useJoinClassroom();
  const [code, setCode] = useState("");
  const [found, setFound] = useState<ClassroomPreview | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sent, setSent] = useState(false);
  const lookup = useMutation({ mutationFn: () => api.lookupJoinCode(code), onSuccess: setFound });

  useEffect(() => {
    if (!open) return;
    setCode(""); setFound(classroom ?? null); setAnswers({}); setSent(false);
    lookup.reset(); join.reset();
    // 只在開啟時重設
  }, [open]);

  const c = found;
  const usedCode = classroom ? undefined : code;
  const goIn = (id: string) => { onOpenChange(false); navigate({ to: "/classrooms/$classroomId", params: { classroomId: id } }); };
  const submit = () => {
    if (!c) return;
    join.mutate({ classroomId: c.id, input: { code: usedCode, answers: c.requireApproval ? answers : undefined } }, {
      onSuccess: (r) => (r.status === "joined" ? goIn(r.classroom.id) : setSent(true)),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        {!c ? (
          <>
            <DialogTitle>用邀請碼加入教室</DialogTitle>
            <DialogDescription>向老師索取 6 碼的邀請碼。</DialogDescription>
            <div className="flex gap-2">
              <Input autoFocus className="font-mono text-lg tracking-[0.3em] uppercase" maxLength={6} placeholder="ABC123" value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ""))} onKeyDown={(e) => e.key === "Enter" && code.length === 6 && lookup.mutate()} />
              <Button className="h-10" disabled={code.length !== 6 || lookup.isPending} onClick={() => lookup.mutate()}>查詢</Button>
            </div>
            {lookup.error && <p className="mt-2 text-[12.5px] text-wine">{lookup.error.message}</p>}
          </>
        ) : sent ? (
          <>
            <DialogTitle>已送出申請</DialogTitle>
            <DialogDescription>老師審核後，「{c.name}」就會出現在你的教室列表。審核結果可以在「我的申請」查看。</DialogDescription>
            <div className="flex justify-end"><Button onClick={() => onOpenChange(false)}>好</Button></div>
          </>
        ) : (
          <>
            <DialogTitle>{c.name}</DialogTitle>
            <DialogDescription>{c.teacherName} · {c.studentCount} 位學生{c.requireApproval && " · 需要老師審核"}</DialogDescription>
            {c.description && <p className="mb-4 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-dim">{c.description}</p>}
            {c.joined ? (
              <div className="flex items-center justify-between gap-3"><p className="text-sm text-ink-dim">你已經是這個教室的成員。</p><Button onClick={() => goIn(c.id)}>進入教室</Button></div>
            ) : c.myApplication === "pending" ? (
              <p className="text-sm text-ink-dim">你已經送出申請，正在等老師審核。</p>
            ) : (
              <div className="space-y-4 text-sm">
                {c.requireApproval && c.questionnaire.length > 0 && (
                  <div className="space-y-3 rounded-2xl border border-line p-4">
                    <p className="text-xs text-ink-faint">申請問卷（老師會看到你的回答）</p>
                    {c.questionnaire.map((q) => <QuestionField key={q.id} q={q} value={answers[q.id] ?? ""} onChange={(v) => setAnswers({ ...answers, [q.id]: v })} />)}
                  </div>
                )}
                {c.myApplication === "rejected" && <p className="text-[12.5px] text-ink-faint">你上次的申請沒有通過，可以重新申請。</p>}
                {join.error && <p className="text-[12.5px] text-wine">{join.error.message}</p>}
                <div className="flex justify-end gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
                  <Button disabled={join.isPending} onClick={submit}>{c.requireApproval ? "送出申請" : "加入教室"}</Button>
                </div>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** 學生的「探索教室」：老師開放探索的教室，可以直接加入或申請 */
export function DiscoverClassrooms() {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ClassroomPreview | null>(null);
  const { data: list = [], isFetching } = useDiscoverClassrooms(query);
  useEffect(() => { const t = setTimeout(() => setQuery(q.trim()), 300); return () => clearTimeout(t); }, [q]);
  const shown = list.filter((c) => !c.joined);
  return (
    <section>
      <div className="mb-4">
        <span className="relative block w-72 max-w-full">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-faint" />
          <Input className="h-9 pl-9" placeholder="搜尋教室、老師…" value={q} onChange={(e) => setQ(e.target.value)} />
        </span>
      </div>
      <div className={cn("grid gap-4 sm:grid-cols-2", isFetching && "opacity-70")}>
        {shown.map((c) => (
          <Card key={c.id} className="flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <h4 className="font-serif text-[15.5px]">{c.name}</h4>
              {c.myApplication && <Badge tone={APP_STATUS[c.myApplication].tone}>{APP_STATUS[c.myApplication].name}</Badge>}
            </div>
            <p className="mt-0.5 text-xs text-ink-faint">{c.teacherName} · {c.studentCount} 位學生</p>
            {c.description && <p className="mt-2 line-clamp-2 text-[12.5px] leading-relaxed text-ink-dim">{c.description}</p>}
            <div className="mt-auto pt-3">
              <Button size="sm" variant={c.requireApproval ? "outline" : "default"} disabled={c.myApplication === "pending"} onClick={() => setPicked(c)}>
                {c.myApplication === "pending" ? "等待審核" : c.requireApproval ? "申請加入" : "加入"}
              </Button>
            </div>
          </Card>
        ))}
      </div>
      {!shown.length && <p className="text-sm text-ink-faint">{list.length ? "符合的教室你都已經加入了。" : query ? "找不到符合的教室。" : "目前沒有開放探索的教室。"}</p>}
      <JoinDialog classroom={picked ?? undefined} open={!!picked} onOpenChange={(v) => !v && setPicked(null)} />
    </section>
  );
}

/** 學生的加入申請（審核中可取消；未通過時顯示老師的附註） */
export function MyApplications() {
  const { data: list = [] } = useMyApplications();
  const cancel = useCancelApplication();
  const shown = list.filter((a) => a.status !== "approved");
  if (!shown.length) return null;
  return (
    <div className="mb-6">
      <div className="mb-2 text-xs tracking-wider text-ink-faint">我的申請</div>
      {shown.map((a) => (
        <Card key={a.id} className="mb-2 flex flex-wrap items-center justify-between gap-3 py-3.5">
          <span className="min-w-0">
            <span className="flex items-center gap-2"><b className="font-serif">{a.classroomName}</b><Badge tone={APP_STATUS[a.status].tone}>{APP_STATUS[a.status].name}</Badge></span>
            <small className="block text-xs text-ink-faint">申請於 {formatDateTime(a.createdAt)}{a.note && <> · 老師附註：{a.note}</>}</small>
          </span>
          {a.status === "pending" && <Button variant="outline" size="sm" disabled={cancel.isPending} onClick={() => cancel.mutate(a.id)}>取消申請</Button>}
        </Card>
      ))}
      {cancel.error && <p className="text-[12.5px] text-wine">{cancel.error.message}</p>}
    </div>
  );
}

/** 學生的「探索課程」頁（側欄）：自己的申請狀態 + 開放探索的教室 */
export function ExplorePage() {
  const { data: me } = useMe();
  return (
    <div className="mx-auto max-w-4xl p-8">
      <h2 className="font-serif text-2xl">探索課程</h2>
      <p className="mb-6 mt-1 text-sm text-ink-dim">老師開放加入的課程都在這裡；需要審核的課程，送出申請後會出現在「我的申請」。</p>
      {me?.role === "teacher" ? <p className="text-sm text-ink-faint">這個頁面是給學生找課程用的。</p> : <><MyApplications /><DiscoverClassrooms /></>}
    </div>
  );
}

/** 學生的待處理邀請（從「教室」頁的按鈕打開） */
export function InvitesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const qc = useQueryClient();
  const { data: classrooms = [] } = useClassrooms();
  const invites = classrooms.filter((c) => !c.joined);
  const respond = useMutation({
    mutationFn: (v: { id: string; accept: boolean }) => (v.accept ? api.acceptInvite(v.id).then(() => undefined) : api.declineInvite(v.id)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: keys.classrooms }); qc.invalidateQueries({ queryKey: ["discover"] }); },
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogTitle>待處理邀請</DialogTitle>
        <DialogDescription>老師邀請你加入的課程。接受後會出現在你的教室列表。</DialogDescription>
        <div className="space-y-2">
          {invites.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line px-4 py-3">
              <span className="min-w-0"><b className="font-serif">{c.name}</b><small className="block text-xs text-ink-faint">{c.teacherName} 邀請你加入</small></span>
              <span className="flex gap-2">
                <Button variant="outline" size="sm" disabled={respond.isPending} onClick={() => respond.mutate({ id: c.id, accept: false })}>拒絕</Button>
                <Button size="sm" disabled={respond.isPending} onClick={() => respond.mutate({ id: c.id, accept: true })}>接受</Button>
              </span>
            </div>
          ))}
          {!invites.length && <p className="text-sm text-ink-faint">目前沒有待處理的邀請。</p>}
          {respond.error && <p className="text-[12.5px] text-wine">{respond.error.message}</p>}
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { MessagesSquare, Plus, Search, Users } from "lucide-react";
import type { DiscussionTask, DiscussionTaskInput } from "@/api";
import { useDiscussions, useSaveDiscussion } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input, Textarea } from "@/components/ui/input";
import { cn, fromLocalInput, toLocalInput } from "@/lib/utils";
import { useT } from "@/i18n";
import { DueLabel } from "./ClassroomPage";
import { SESSION_NAME, SESSION_TONE } from "./DiscussionTaskPage";

const ROUND_CHOICES = [8, 12, 20];

/** 新增（不帶 discussion）或編輯多人討論的題目 */
export function DiscussionFormDialog({ classroomId, discussion, open, onOpenChange, onSaved }: {
  classroomId: string;
  discussion?: DiscussionTask;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved?: (d: DiscussionTask) => void;
}) {
  const t = useT();
  const save = useSaveDiscussion(classroomId, discussion?.id);
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [hint, setHint] = useState("");
  const [due, setDue] = useState("");
  const [rounds, setRounds] = useState(12);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setTitle(discussion?.title ?? "");
    setPrompt(discussion?.prompt ?? "");
    setHint(discussion?.conclusionHint ?? "");
    setDue(toLocalInput(discussion?.dueAt ?? null));
    setRounds(discussion?.maxRounds ?? 12);
    setErr("");
    save.reset();
    // 只在開啟時帶入目前的值
  }, [open]);

  function submit() {
    if (!title.trim()) return setErr(t("請填寫討論題目。"));
    setErr("");
    const input: DiscussionTaskInput = { title: title.trim(), prompt: prompt.trim(), conclusionHint: hint.trim(), dueAt: fromLocalInput(due), maxRounds: rounds };
    save.mutate(input, { onSuccess: (saved) => { onOpenChange(false); onSaved?.(saved); } });
  }

  const editing = !!discussion;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogTitle>{editing ? t("編輯討論") : t("新增多人討論")}</DialogTitle>
        <DialogDescription>{t("出一個統一的題目，每位同學各自跟 AI 蘇格拉底對話並寫下結論；你看得到每個人的討論成果。")}</DialogDescription>
        <div className="space-y-4 text-sm">
          <label className="block"><span className="mb-1 block text-xs text-ink-dim">{t("討論題目")}</span>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder={t("例如：AI 可以替老師打成績嗎？")} /></label>
          <label className="block"><span className="mb-1 block text-xs text-ink-dim">{t("題目說明（選填）")}</span>
            <Textarea rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder={t("背景、要思考的方向、閱讀材料的重點……同學進入討論時看得到。")} /></label>
          <label className="block"><span className="mb-1 block text-xs text-ink-dim">{t("結論要求（選填）")}</span>
            <Textarea rows={2} value={hint} onChange={(e) => setHint(e.target.value)} placeholder={t("例如：請寫出你的主張、最主要的理由，以及你怎麼回應最強的反對意見。")} /></label>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
            <label className="block">
              <span className="mb-1 block text-xs text-ink-dim">{t("截止時間（選填）")}</span>
              <span className="flex items-center gap-2">
                <Input type="datetime-local" className="w-auto" value={due} onChange={(e) => setDue(e.target.value)} />
                {due && <button type="button" onClick={() => setDue("")} className="cursor-pointer text-xs text-ink-faint hover:text-ink">{t("清除")}</button>}
              </span>
            </label>
            <div>
              <span className="mb-1 block text-xs text-ink-dim">{t("每人對話輪數上限")}</span>
              <div className="inline-flex gap-0.5 rounded-full border border-line-strong bg-bg-2 p-0.5">
                {ROUND_CHOICES.map((n) => (
                  <button key={n} type="button" onClick={() => setRounds(n)}
                    className={cn("cursor-pointer rounded-full px-4 py-1.5 text-[13px]", rounds === n ? "bg-bronze font-semibold text-[#221a0c]" : "text-ink-dim")}>{t("{n} 輪", { n })}</button>
                ))}
              </div>
            </div>
          </div>
          {(err || save.error) && <p className="text-[12.5px] text-wine">{err || save.error?.message}</p>}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{t("取消")}</Button>
            <Button onClick={submit} disabled={save.isPending}>{editing ? t("儲存") : t("建立討論")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DiscussionCard({ d, staff }: { d: DiscussionTask; staff: boolean }) {
  const t = useT();
  const pct = d.stats.total ? Math.round((d.stats.submitted / d.stats.total) * 100) : 0;
  return (
    <Link to="/classrooms/$classroomId/discussions/$discussionId" params={{ classroomId: d.classroomId, discussionId: d.id }}>
      <Card className="flex h-full flex-col transition-colors hover:border-bronze-dim">
        <div className="flex items-center justify-between gap-2">
          {d.status === "closed" ? <Badge tone="neutral">{t("已結束")}</Badge> : <Badge tone="bronze">{t("進行中")}</Badge>}
          {staff
            ? <span className="inline-flex items-center gap-1 text-[11px] text-ink-faint"><Users className="size-3" />{d.stats.submitted}/{d.stats.total}</span>
            : d.myStatus && <Badge tone={SESSION_TONE[d.myStatus]}>{t(SESSION_NAME[d.myStatus])}</Badge>}
        </div>
        <h3 className="mt-3 font-serif text-[15.5px] leading-snug">{d.title}</h3>
        {d.prompt && <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-ink-dim">{d.prompt}</p>}
        <div className="mt-auto space-y-2 pt-3">
          {staff && (
            <>
              <span className="block h-1 overflow-hidden rounded-full bg-bg-3"><i className="block h-full rounded-full bg-bronze" style={{ width: `${pct}%` }} /></span>
              <p className="text-[11.5px] text-ink-faint">{t("已送出結論 {n} / {total} 人", { n: d.stats.submitted, total: d.stats.total })}</p>
            </>
          )}
          <DueLabel at={d.dueAt} />
        </div>
      </Card>
    </Link>
  );
}

/**
 * 教室的「多人討論」分頁：老師出的題目都列在這裡。
 * 老師與助教看到全班的完成人數，學生看到自己的狀態。
 */
export function DiscussionTasksTab({ classroomId, staff }: { classroomId: string; staff: boolean }) {
  const t = useT();
  const navigate = useNavigate();
  const { data: list = [] } = useDiscussions(classroomId);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [onlyOpen, setOnlyOpen] = useState(false);
  const kw = q.trim().toLowerCase();
  const shown = list.filter((d) => (!kw || d.title.toLowerCase().includes(kw)) && (!onlyOpen || d.status === "open"));

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="relative w-56 max-sm:w-full">
          <Search className="pointer-events-none absolute top-1/2 left-3.5 size-3.5 -translate-y-1/2 text-ink-faint" />
          <Input className="h-9 pl-9 text-[13px]" placeholder={t("搜尋討論題目…")} value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        <button type="button" aria-pressed={onlyOpen} onClick={() => setOnlyOpen((v) => !v)}
          className={cn("cursor-pointer rounded-full border px-3 py-1 text-[12.5px]", onlyOpen ? "border-bronze-dim text-bronze" : "border-line text-ink-dim hover:text-ink")}>{t("只看進行中")}</button>
        {staff && <Button size="sm" className="ml-auto" onClick={() => setOpen(true)}><Plus className="size-4" />{t("新增討論")}</Button>}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">{shown.map((d) => <DiscussionCard key={d.id} d={d} staff={staff} />)}</div>
      {!shown.length && (
        <Card className="py-12 text-center">
          <MessagesSquare className="mx-auto mb-3 size-6 text-ink-faint" />
          <p className="text-sm text-ink-faint">
            {list.length ? t("沒有符合條件的討論。")
              : staff ? t("還沒有討論。按右上「新增討論」出一個題目，同學就可以各自跟 AI 對話了。")
              : t("老師還沒有出討論題目。")}
          </p>
        </Card>
      )}
      {staff && <DiscussionFormDialog classroomId={classroomId} open={open} onOpenChange={setOpen}
        onSaved={(d) => navigate({ to: "/classrooms/$classroomId/discussions/$discussionId", params: { classroomId, discussionId: d.id } })} />}
    </>
  );
}

import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, Lock, LockOpen, Pencil, Send, Trash2, Users } from "lucide-react";
import { api } from "@/api";
import type { Coverage, DialogueMessage, DiscussionSession, DiscussionSessionStatus, DiscussionTask } from "@/api";
import {
  keys, useDeleteDiscussion, useDiscussion, useDiscussionSession, useDiscussionSessions,
  useIsStaff, useMe, useSetDiscussionStatus, useSubmitConclusion,
} from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { useT } from "@/i18n";
import { speakAi, stopAiSpeech } from "@/lib/ai-speaking";
import { cn, formatDateTime } from "@/lib/utils";
import { DueLabel } from "./ClassroomPage";
import { DiscussionFormDialog } from "./DiscussionTasks";
import { Panel, Section, StageLayout } from "./stages/shared";

const COV: [keyof Coverage, string][] = [["claim", "主張"], ["reason", "理由"], ["evidence", "證據或例子"], ["counter", "反例的回應"]];
export const SESSION_NAME: Record<DiscussionSessionStatus, string> = { submitted: "已送出結論", talking: "對話中", todo: "未開始" };
export const SESSION_TONE: Record<DiscussionSessionStatus, "olive" | "bronze" | "neutral"> = { submitted: "olive", talking: "bronze", todo: "neutral" };

function CoverageChips({ coverage }: { coverage?: Coverage }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      {COV.map(([k, n]) => (
        <span key={k} className={cn("rounded-full border px-3 py-1 text-[11.5px]", coverage?.[k] ? "border-olive-soft bg-olive-soft text-olive" : "border-line text-ink-faint")}>
          {coverage?.[k] ? "✓ " : ""}{t(n)}
        </span>
      ))}
    </div>
  );
}

/**
 * 一則訊息的泡泡（學生自己的對話與老師回看同學的對話共用）。
 * speaker = 說話的學生（老師回看時用同學的名字，學生看自己的對話時是「我」）
 */
function Bubble({ role, text, speaker }: { role: "user" | "assistant"; text: string; speaker?: string }) {
  const t = useT();
  return (
    <div className={cn("flex items-start gap-3", role === "user" && "flex-row-reverse")}>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-bg-2 font-serif text-sm text-bronze">
        {role === "user" ? (speaker?.[0] ?? t("我")) : t("蘇")}
      </span>
      <p className={cn("max-w-[80%] rounded-2xl border border-line px-4 py-2.5 font-serif text-[14.5px] leading-7 whitespace-pre-line", role === "user" ? "bg-bronze-soft" : "bg-bg-2")}>{text}</p>
    </div>
  );
}

/* ---------------- 學生：跟蘇格拉底對話 ---------------- */
function StudentChat({ d, readOnly }: { d: DiscussionTask; readOnly: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: session } = useDiscussionSession(d.id);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  const messages: DialogueMessage[] = session?.messages ?? [];
  const rounds = session?.rounds ?? 0;
  const full = rounds >= d.maxRounds;

  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages, pending, mine]);
  useEffect(() => stopAiSpeech, []);

  async function send() {
    const msg = text.trim();
    if (!msg || pending !== null) return;
    setText(""); setMine(msg); setPending(""); setError("");
    try {
      const reply = await api.sendDiscussionMessage(d.id, msg, (c) => setPending((p) => (p ?? "") + c));
      speakAi(reply.text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null); setMine(null);
      qc.invalidateQueries({ queryKey: keys.discussionSession(d.id, "me") });
      qc.invalidateQueries({ queryKey: keys.discussion(d.id) });
    }
  }

  return (
    <Panel>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        <Bubble role="assistant" text={t("老師出的題目是「{title}」。先不用急著下結論——你現在怎麼想？", { title: d.title })} />
        {messages.map((m) => <Bubble key={m.id} role={m.role} text={m.text} />)}
        {mine && <Bubble role="user" text={mine} />}
        {pending !== null && <Bubble role="assistant" text={pending || "…"} />}
        {error && <p className="text-[12.5px] text-wine">{error}</p>}
        <div ref={end} />
      </div>
      {readOnly ? (
        <p className="border-t border-line px-5 py-3 text-[12.5px] text-ink-faint">{t("這個討論已經結束，只能回看對話。")}</p>
      ) : full ? (
        <p className="border-t border-line px-5 py-3 text-[12.5px] text-ink-faint">{t("已經聊滿 {n} 輪了，到左欄寫下你的結論吧。", { n: d.maxRounds })}</p>
      ) : (
        <div className="flex items-end gap-2 border-t border-line p-3">
          <Textarea rows={1} value={text} placeholder={t("輸入你的想法…")} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <Button size="icon" onClick={() => void send()} disabled={pending !== null} aria-label={t("送出")}><Send className="size-4" /></Button>
        </div>
      )}
    </Panel>
  );
}

/** 學生的左欄：題目說明、進度、自己的結論 */
function StudentInfo({ d, readOnly }: { d: DiscussionTask; readOnly: boolean }) {
  const t = useT();
  const { data: session } = useDiscussionSession(d.id);
  const submit = useSubmitConclusion(d.id);
  const [draft, setDraft] = useState<string | null>(null);
  const conclusion = session?.conclusion ?? null;
  const rounds = session?.rounds ?? 0;
  const editing = draft !== null;

  return (
    <>
      <Section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <Badge tone={SESSION_TONE[session?.status ?? "todo"]}>{t(SESSION_NAME[session?.status ?? "todo"])}</Badge>
          <span className="text-[12px] text-ink-faint">{t("已對話 {n} / {max} 輪", { n: rounds, max: d.maxRounds })}</span>
        </div>
        {d.prompt && <p className="mb-3 whitespace-pre-line text-[13.5px] leading-relaxed text-ink-dim">{d.prompt}</p>}
        <CoverageChips coverage={session?.coverage} />
      </Section>
      <Section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="font-serif text-[15px]">{t("我的結論")}</h3>
          {conclusion && !readOnly && !editing && <Button variant="ghost" size="sm" onClick={() => setDraft(conclusion)}>{t("修改")}</Button>}
        </div>
        {d.conclusionHint && !conclusion && <p className="mb-3 whitespace-pre-line text-[12px] leading-relaxed text-ink-faint">{d.conclusionHint}</p>}
        {editing ? (
          <div className="space-y-3">
            <Textarea rows={6} value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={t("寫下你的主張、理由，以及你怎麼回應反對意見…")} />
            {submit.error && <p className="text-[12.5px] text-wine">{submit.error.message}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={() => setDraft(null)}>{t("取消")}</Button>
              <Button size="sm" disabled={submit.isPending || !draft.trim()} onClick={() => submit.mutate(draft, { onSuccess: () => setDraft(null) })}>{t("送出結論")}</Button>
            </div>
          </div>
        ) : conclusion ? (
          <>
            <p className="whitespace-pre-line font-serif text-[14px] leading-relaxed">{conclusion}</p>
            {session?.submittedAt && <p className="mt-2 text-[11.5px] text-ink-faint">{t("送出於 {at}", { at: formatDateTime(session.submittedAt) })}</p>}
            {!readOnly && <Button variant="outline" size="sm" className="mt-3" disabled={submit.isPending} onClick={() => submit.mutate(null)}>{t("收回結論，繼續討論")}</Button>}
          </>
        ) : readOnly ? (
          <p className="text-[12.5px] text-ink-faint">{t("這個討論結束前你沒有送出結論。")}</p>
        ) : rounds > 0 ? (
          <Button size="sm" onClick={() => setDraft("")}>{t("寫下我的結論")}</Button>
        ) : (
          <p className="text-[12.5px] leading-relaxed text-ink-faint">{t("先在右邊跟蘇格拉底聊你的想法。")}<b className="text-ink">{t("AI 只提問、不給答案")}</b>{t("；聊過之後再回來寫結論，老師看得到你的結論與整段對話。")}</p>
        )}
      </Section>
    </>
  );
}

/* ---------------- 老師：全班的討論成果 ---------------- */
/** 點某位同學後，從右邊拉出他的完整對話 */
function SessionSheet({ d, row, onClose }: { d: DiscussionTask; row: DiscussionSession | null; onClose: () => void }) {
  const t = useT();
  const { data: detail, error } = useDiscussionSession(d.id, row?.studentId ?? "me", !!row);
  return (
    <Sheet open={!!row} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="max-w-xl">
        {row && (
          <>
            <div className="mb-1 text-xs text-bronze">{t("討論成果")}</div>
            <SheetTitle className="font-serif text-xl font-normal">{row.studentName}</SheetTitle>
            <div className="mt-2 mb-4 flex flex-wrap items-center gap-2">
              <Badge tone={SESSION_TONE[row.status]}>{t(SESSION_NAME[row.status])}</Badge>
              <span className="text-[12px] text-ink-faint">{t("{n} 輪", { n: row.rounds })}</span>
              {row.lastActiveAt && <span className="text-[12px] text-ink-faint">· {formatDateTime(row.lastActiveAt)}</span>}
            </div>
            <CoverageChips coverage={row.coverage} />
            <section className="mt-5">
              <h4 className="mb-2 text-xs tracking-wider text-ink-faint">{t("結論")}</h4>
              {row.conclusion
                ? <p className="whitespace-pre-line rounded-2xl border border-line bg-bg-2 p-4 font-serif text-[14px] leading-relaxed">{row.conclusion}</p>
                : <p className="text-[13px] text-ink-faint">{t("還沒有送出結論。")}</p>}
            </section>
            <section className="mt-5">
              <h4 className="mb-3 text-xs tracking-wider text-ink-faint">{t("與蘇格拉底的對話")}</h4>
              <div className="space-y-3">
                {detail?.messages.map((m) => <Bubble key={m.id} role={m.role} text={m.text} speaker={row.isMe ? undefined : row.studentName} />)}
                {detail && !detail.messages.length && <p className="text-[13px] text-ink-faint">{t("這位同學還沒有開始對話。")}</p>}
                {error && <p className="text-[13px] text-wine">{error.message}</p>}
                {!detail && !error && <p className="text-[13px] text-ink-faint">{t("載入中…")}</p>}
              </div>
            </section>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

const FILTERS: [DiscussionSessionStatus | "all", string][] = [["all", "全部"], ["submitted", "已送出結論"], ["talking", "對話中"], ["todo", "未開始"]];

function TeacherResults({ d, teacher }: { d: DiscussionTask; teacher: boolean }) {
  const t = useT();
  const { data: sessions = [] } = useDiscussionSessions(d.id);
  const [filter, setFilter] = useState<DiscussionSessionStatus | "all">("all");
  const [open, setOpen] = useState<DiscussionSession | null>(null);
  const shown = filter === "all" ? sessions : sessions.filter((s) => s.status === filter);
  const pct = (n: number) => (d.stats.total ? Math.round((n / d.stats.total) * 100) : 0);
  const chip = (on: boolean) => cn("cursor-pointer rounded-full border px-3 py-1 text-[12.5px]", on ? "border-bronze-dim text-bronze" : "border-line text-ink-dim hover:text-ink");

  const left = (
    <>
      <Section>
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-faint">{t("每位同學各自跟 AI 蘇格拉底對話（AI 只提問、不給答案），再寫下自己的結論。你看得到每個人的結論與整段對話。")}</p>
        {d.prompt && <p className="whitespace-pre-line text-[13.5px] leading-relaxed text-ink-dim">{d.prompt}</p>}
      </Section>
      <Section>
        <h3 className="mb-3 font-serif text-[15px]">{t("全班進度")}</h3>
        <div className="space-y-2.5 text-[13px]">
          {([["已送出結論", d.stats.submitted], ["已開始對話", d.stats.started]] as [string, number][]).map(([name, n]) => (
            <div key={name}>
              <div className="mb-1 flex items-center justify-between gap-2"><span className="text-ink-dim">{t(name)}</span><em className="not-italic text-ink-faint">{n} / {d.stats.total}</em></div>
              <span className="block h-2 overflow-hidden rounded bg-bg-3"><i className="block h-full bg-bronze transition-[width] duration-500" style={{ width: `${pct(n)}%` }} /></span>
            </div>
          ))}
          <p className="pt-1 text-[12px] text-ink-faint">{t("平均對話 {n} 輪（上限 {max}）", { n: d.stats.avgRounds, max: d.maxRounds })}</p>
        </div>
      </Section>
      {d.conclusionHint && (
        <Section>
          <h3 className="mb-2 font-serif text-[15px]">{t("結論要求")}</h3>
          <p className="whitespace-pre-line text-[13px] leading-relaxed text-ink-dim">{d.conclusionHint}</p>
        </Section>
      )}
    </>
  );

  const right = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap gap-1.5 border-b border-line px-5 py-3" role="group" aria-label={t("依狀態篩選")}>
        {FILTERS.map(([k, n]) => <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)} className={chip(filter === k)}>{t(n)}</button>)}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-5">
        {shown.map((s) => (
          <button key={s.id} type="button" onClick={() => setOpen(s)}
            className="grid w-full cursor-pointer grid-cols-[1.2fr_auto_3.2em_2fr] items-center gap-3 border-b border-line py-3 text-left text-[13px] hover:bg-bg-2 max-md:grid-cols-[1fr_auto]">
            <span className="flex min-w-0 items-center gap-2">
              <i className="flex size-6 shrink-0 items-center justify-center rounded-full bg-bronze-soft font-serif text-[11.5px] not-italic text-bronze">{s.studentName[0]}</i>
              <span className="truncate">{s.studentName}</span>
              {/* 老師沒有自己的討論；示範資料裡的「你」是學生模式用的那個帳號 */}
              {s.isMe && <em className="shrink-0 rounded-full bg-bg-3 px-2 py-0.5 text-[10px] not-italic text-ink-dim">{teacher ? t("學生模式的你") : t("你")}</em>}
            </span>
            <Badge tone={SESSION_TONE[s.status]}>{t(SESSION_NAME[s.status])}</Badge>
            <span className="text-xs text-ink-faint max-md:hidden">{t("{n} 輪", { n: s.rounds })}</span>
            <span className="truncate text-xs text-ink-dim max-md:hidden">{s.conclusion ?? "—"}</span>
          </button>
        ))}
        {!shown.length && <p className="py-6 text-sm text-ink-faint">{sessions.length ? t("沒有符合條件的同學。") : t("這個教室還沒有學生。")}</p>}
      </div>
    </div>
  );

  return (
    <>
      <StageLayout leftLabel={t("題目與進度")} left={left} rightLabel={t("討論成果")} right={right} mascot={false} />
      <SessionSheet d={d} row={open} onClose={() => setOpen(null)} />
    </>
  );
}

/* ---------------- 頁面 ---------------- */
function DeleteDialog({ d, open, onOpenChange }: { d: DiscussionTask; open: boolean; onOpenChange: (v: boolean) => void }) {
  const t = useT();
  const navigate = useNavigate();
  const del = useDeleteDiscussion(d.classroomId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle>{t("刪除討論？")}</DialogTitle>
        <DialogDescription>{t("「{title}」會被永久刪除，連同全班同學的對話與結論，無法復原。", { title: d.title })}</DialogDescription>
        {del.error && <p className="mb-3 text-[12.5px] text-wine">{del.error.message}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("取消")}</Button>
          <Button variant="danger" disabled={del.isPending}
            onClick={() => del.mutate(d.id, { onSuccess: () => navigate({ to: "/classrooms/$classroomId", params: { classroomId: d.classroomId }, search: { tab: "discussions" } }) })}>
            <Trash2 className="size-4" />{t("刪除")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * 多人討論：老師出一個統一的題目，每位同學各自跟 AI 蘇格拉底對話並寫下結論；
 * 老師（與助教）在同一頁看全班的討論成果，點某位同學可以看他的完整對話。
 */
export function DiscussionTaskPage() {
  const t = useT();
  const { classroomId, discussionId } = useParams({ from: "/_app/classrooms/$classroomId/discussions/$discussionId" });
  const { data: me } = useMe();
  const { data: d, error } = useDiscussion(discussionId);
  const staff = useIsStaff(classroomId);
  const setStatus = useSetDiscussionStatus(classroomId, discussionId);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const teacher = me?.role === "teacher";

  const back = (
    <Link to="/classrooms/$classroomId" params={{ classroomId }} search={{ tab: "discussions" }} aria-label={t("回討論列表")} title={t("回討論列表")}
      className="flex size-8 shrink-0 items-center justify-center rounded-full text-ink-dim hover:bg-bg-2 hover:text-ink"><ArrowLeft className="size-4" /></Link>
  );
  if (error) return <div className="mx-auto max-w-3xl p-8">{back}<p className="mt-6 text-sm text-ink-faint">{error.message}</p></div>;
  if (!d) return null;
  const closed = d.status === "closed";

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 min-h-topbar border-b border-line px-4 py-1.5">
        {back}
        <h2 className="min-w-0 flex-1 truncate font-serif text-[16px] leading-tight" title={d.title}>{d.title}</h2>
        {closed && <Badge tone="neutral">{t("已結束")}</Badge>}
        <DueLabel at={d.dueAt} />
        {staff && (
          <span className="flex items-center gap-1">
            <span className="hidden items-center gap-1 text-[12.5px] text-ink-faint sm:flex"><Users className="size-3.5" />{d.stats.submitted}/{d.stats.total}</span>
            <Button variant="outline" size="sm" disabled={setStatus.isPending} title={closed ? t("重新開放，同學可以繼續對話") : t("結束討論，同學只能回看")}
              onClick={() => setStatus.mutate(closed ? "open" : "closed")}>
              {closed ? <LockOpen className="size-3.5" /> : <Lock className="size-3.5" />}{closed ? t("重新開放") : t("結束討論")}
            </Button>
            <Button variant="ghost" size="icon" className="size-8" aria-label={t("編輯討論")} title={t("編輯討論")} onClick={() => setEditing(true)}><Pencil className="size-3.5" /></Button>
            {teacher && <Button variant="danger" size="icon" className="size-8" aria-label={t("刪除討論")} title={t("刪除討論")} onClick={() => setDeleting(true)}><Trash2 className="size-3.5" /></Button>}
          </span>
        )}
        {!staff && d.myStatus === "submitted" && <span className="flex items-center gap-1 text-[12.5px] text-olive"><Check className="size-3.5" />{t("已送出結論")}</span>}
      </header>
      {setStatus.error && <p className="border-b border-line px-5 py-2 text-[12.5px] text-wine">{setStatus.error.message}</p>}
      <div className="flex min-h-0 flex-1 flex-col">
        {staff
          ? <TeacherResults d={d} teacher={teacher} />
          : <StageLayout leftLabel={t("題目與我的結論")} left={<StudentInfo d={d} readOnly={closed} />} rightLabel={t("與蘇格拉底對話")} right={<StudentChat d={d} readOnly={closed} />} />}
      </div>
      {staff && (
        <>
          <DiscussionFormDialog classroomId={classroomId} discussion={d} open={editing} onOpenChange={setEditing} />
          <DeleteDialog d={d} open={deleting} onOpenChange={setDeleting} />
        </>
      )}
    </div>
  );
}

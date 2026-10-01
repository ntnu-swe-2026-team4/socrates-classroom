import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Activity, type Group, type GroupArgument, type Vote } from "@/api";
import { keys, useArguments, useGroupMessages, useGroups, useMembers, useStar } from "@/api/queries";
import { StarMap } from "@/components/star/StarMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { STATUS_NAME, groupColor, tally } from "@/lib/debate";
import { cn } from "@/lib/utils";
import { NotesCard } from "./NotesCard";
import { MemberChip, Panel, StageLayout } from "./shared";

const VOTES: [Vote, string][] = [["endorse", "贊成"], ["revise", "需要修改"], ["oppose", "反對"]];
const VOTE_ON: Record<Vote, string> = { endorse: "border-olive bg-olive text-[#1b1d22]", revise: "border-bronze bg-bronze text-[#221a0c]", oppose: "border-wine bg-wine text-white" };

function ArgCard({ arg, kids, group, myId, canVote, onVote }: { arg: GroupArgument; kids: GroupArgument[]; group: Group; myId?: string; canVote: boolean; onVote: (v: Vote) => void }) {
  const t = tally(arg, group.memberIds);
  const w = (n: number) => (t.total ? (n / t.total) * 100 : 0);
  const mine = myId ? arg.votes[myId] : undefined;
  return (
    <div className={cn("mb-2.5 rounded-2xl border bg-bg-2 p-3.5", arg.status === "contested" ? "border-wine" : "border-line", arg.status === "dropped" && "opacity-55")}>
      <div className="mb-1.5 flex items-center gap-2">
        <Badge tone={arg.status === "active" ? "olive" : arg.status === "revised" ? "bronze" : arg.status === "contested" ? "wine" : "neutral"}>{STATUS_NAME[arg.status]}</Badge>
        {arg.countered && <span className="text-[10.5px] text-ink-faint">已被丟過反例</span>}
      </div>
      <p className="font-serif text-[14.5px] leading-relaxed">{arg.text}</p>
      {kids.map((k) => <p key={k.id} className="mt-1 border-l-2 border-line-strong pl-2.5 text-[12.5px] leading-relaxed text-ink-dim"><em className="mr-2 text-[10.5px] not-italic text-ink-faint">{k.kind === "reason" ? "理由" : "證據"}</em>{k.text}</p>)}
      <div className="mt-2.5 space-y-1">
        <span className="flex h-1.5 overflow-hidden rounded bg-bg-3"><i className="bg-olive" style={{ width: `${w(t.endorse)}%` }} /><i className="bg-bronze" style={{ width: `${w(t.revise)}%` }} /><i className="bg-wine" style={{ width: `${w(t.oppose)}%` }} /></span>
        <small className="text-[11px] text-ink-faint">贊成 {t.endorse} · 修改 {t.revise} · 反對 {t.oppose}</small>
      </div>
      {canVote && <div className="mt-2.5 flex gap-1.5">{VOTES.map(([v, n]) => <button key={v} type="button" onClick={() => onVote(v)} className={cn("flex-1 cursor-pointer rounded-full border py-1 text-xs", mine === v ? VOTE_ON[v] : "border-line-strong text-ink-dim hover:border-bronze-dim")}>{n}</button>)}</div>}
    </div>
  );
}

export function TeamStage({ a, teacher, flow, over }: { a: Activity; teacher: boolean; flow: ReactNode; over: boolean }) {
  const qc = useQueryClient();
  const { data: members = [] } = useMembers(a.id);
  const { data: groups = [] } = useGroups(a.id);
  const { data: star } = useStar(a.id, "team", teacher);
  const me = members.find((m) => m.isMe);
  const mineGroup = me ? groups.find((g) => g.memberIds.includes(me.id)) : undefined;
  const [pick, setPick] = useState<string | null>(null);
  const g = groups.find((x) => x.id === pick) ?? (!teacher ? mineGroup : undefined) ?? groups[0];
  const gi = g ? groups.findIndex((x) => x.id === g.id) : 0;
  const canAct = !!g && !!mineGroup && g.id === mineGroup.id && !teacher && !over;

  const { data: messages = [] } = useGroupMessages(g?.id);
  const { data: args = [] } = useArguments(g?.id);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const [argsOpen, setArgsOpen] = useState(true);
  const feedEnd = useRef<HTMLDivElement>(null);
  useEffect(() => { feedEnd.current?.scrollIntoView({ block: "end" }); }, [messages.length, g?.id]);

  const refresh = () => {
    if (!g) return;
    for (const k of [keys.groupMessages(g.id), keys.arguments(g.id), keys.star(a.id), keys.groups(a.id)]) qc.invalidateQueries({ queryKey: k });
  };
  const wrap = <T,>(fn: () => Promise<T>) => async () => { setErr(""); try { await fn(); refresh(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } };

  const send = useMutation({ mutationFn: () => api.postGroupMessage(g!.id, text.trim()), onSuccess: () => { setText(""); refresh(); } });
  const nameOf = (id?: string) => members.find((m) => m.id === id);

  const claims = args.filter((x) => x.kind === "claim");
  const contested = claims.find((c) => c.status === "contested");
  const dissent = contested && g ? g.memberIds.filter((id) => contested.votes[id] && contested.votes[id] !== "endorse") : [];
  const canSplit = !!g && !!contested && dissent.length >= 2 && g.memberIds.length - dissent.length >= 2;

  if (!g) return <StageLayout flow={flow} left={<Card className="p-4 text-sm text-ink-faint">還沒有分組。</Card>} right={null} />;

  const left = (
    <>
      <Card className="p-4">
        {teacher && (
          <div className="mb-3 flex flex-wrap gap-2">
            {groups.map((x, i) => (
              <button key={x.id} type="button" onClick={() => setPick(x.id)} className={cn("inline-flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1 text-xs", x.id === g.id ? "border-bronze bg-bg-2 text-ink" : "border-line-strong bg-bg-2 text-ink-dim")}>
                <i className="size-2 rounded-full" style={{ background: groupColor(i) }} />{x.label}
              </button>
            ))}
          </div>
        )}
        <CardTitle className="mb-2 flex items-center gap-2"><i className="size-2.5 rounded-full" style={{ background: groupColor(gi) }} />{g.label}{canAct && <Badge tone="olive">你的組別</Badge>}{g.formedBy === "split" && <Badge tone="bronze">分裂而成</Badge>}</CardTitle>
        <div className="flex flex-wrap gap-x-4 gap-y-2">{g.memberIds.map((id) => { const m = nameOf(id); return m ? <MemberChip key={id} m={m} /> : null; })}</div>
        {teacher && !over && <RegroupRow a={a} onDone={() => { setPick(null); qc.invalidateQueries({ queryKey: keys.groups(a.id) }); qc.invalidateQueries({ queryKey: keys.star(a.id) }); }} />}
      </Card>
      {teacher ? (
        <Card className="p-4">
          <CardTitle className="flex items-center justify-between">立場星圖 <span className="font-sans text-xs font-normal text-ink-faint">顏色 = 組別 · 只有老師看得到</span></CardTitle>
          {star && <StarMap data={star} compact />}
          <div className="mt-2.5 flex flex-wrap gap-x-3.5 gap-y-1 text-xs text-ink-dim">{groups.map((x, i) => <span key={x.id}><i className="mr-1.5 inline-block size-2.5 rounded-full align-middle" style={{ background: groupColor(i) }} />{x.label}</span>)}</div>
        </Card>
      ) : <NotesCard a={a} readOnly={over} />}
    </>
  );

  const right = (
    <Panel>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
        <div className="font-serif text-[14.5px]">組內討論 <span className="font-sans text-xs text-ink-faint">· {g.label}</span></div>
        {canAct && (
          <div className="flex items-center gap-2 text-xs text-ink-faint">AI
            <Button variant="outline" size="sm" disabled={claims.length > 0} onClick={wrap(() => api.summarizeGroup(g.id))}>Σ {claims.length ? "已整理論點" : "整理論點"}</Button>
            <Button variant="outline" size="sm" onClick={wrap(() => api.counterexample(g.id))}>Σ 丟反例</Button>
          </div>
        )}
      </div>
      <details open={argsOpen} onToggle={(e) => setArgsOpen(e.currentTarget.open)} className="border-b border-line">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 px-5 py-2.5 text-[13px]">組內論點 <em className="rounded-full bg-bg-3 px-2.5 text-[11px] not-italic text-ink-dim">{claims.length || "尚未整理"}</em><span className="text-xs text-ink-faint">{claims.length ? "投票決定保留、修改或放棄" : "請 AI 整理論點後出現"}</span></summary>
        <div className="max-h-[min(300px,38vh)] overflow-y-auto px-5 pb-3.5">
          {claims.map((c) => <ArgCard key={c.id} arg={c} kids={args.filter((k) => k.parentId === c.id)} group={g} myId={me?.id} canVote={canAct} onVote={(v) => void wrap(() => api.vote(c.id, v))()} />)}
          {canSplit && (
            <div className="rounded-2xl border border-dashed border-wine bg-wine-soft p-3.5 text-[12.5px]"><b>組內出現分歧</b>
              <p className="my-1.5 leading-relaxed text-ink-dim">對「{contested!.text}」，有 {dissent.length} 位組員不同意。與其硬湊成一個立場，也可以讓不同意的人另組，各自把論點練強。</p>
              {(canAct || (teacher && !over)) && <Button size="sm" onClick={wrap(() => api.splitGroup(g.id))}>分裂成兩組</Button>}
            </div>
          )}
        </div>
      </details>
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {messages.map((m) => {
          if (m.kind === "system") return <p key={m.id} className="text-center text-[11.5px] text-ink-faint">{m.text}</p>;
          const ai = m.kind !== "chat";
          const who = nameOf(m.authorId);
          const mine = who?.isMe;
          return (
            <div key={m.id} className={cn("flex gap-2.5", mine && "flex-row-reverse")}>
              <span className={cn("flex size-7 shrink-0 items-center justify-center rounded-full font-serif text-xs", ai ? "border border-olive bg-olive-soft text-olive" : "bg-bg-3 text-ink-dim")}>{ai ? "Σ" : who?.name[0] ?? "?"}</span>
              <div className={cn("max-w-[82%] rounded-2xl border px-3.5 py-2", ai ? "border-olive-soft bg-olive-soft/50" : mine ? "border-line bg-bronze-soft" : "border-line bg-bg-2")}>
                <small className="mb-0.5 block text-[10.5px] text-ink-faint">{ai ? (m.kind === "ai_summary" ? "AI · 整理論點" : "AI · 反例") : mine ? "你" : who?.name}</small>
                <p className="whitespace-pre-line font-serif text-[13.5px] leading-relaxed">{m.text}</p>
              </div>
            </div>
          );
        })}
        {err && <p className="text-[12.5px] text-wine">{err}</p>}
        <div ref={feedEnd} />
      </div>
      {canAct ? (
        <div className="flex items-end gap-2 border-t border-line p-3">
          <Textarea rows={1} value={text} maxLength={300} placeholder="說說你的想法，或回應組員…" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && text.trim()) { e.preventDefault(); send.mutate(); } }} />
          <Button onClick={() => text.trim() && send.mutate()} disabled={send.isPending}>送出</Button>
        </div>
      ) : <p className="border-t border-line px-5 py-3 text-xs text-ink-faint">{over ? "此階段已結束。" : teacher ? "老師觀察中：看得到這組的討論，但不會加入發言。" : "這是其他組別的討論。"}</p>}
    </Panel>
  );
  return <StageLayout flow={flow} left={left} right={right} />;
}

function RegroupRow({ a, onDone }: { a: Activity; onDone: () => void }) {
  const [size, setSize] = useState(a.groupSize);
  return (
    <div className="mt-3 flex items-center gap-2.5 text-xs text-ink-dim">
      目標人數
      <select value={size} onChange={(e) => setSize(Number(e.target.value))} className="rounded-lg border border-line-strong bg-bg-2 px-2 py-1 text-ink">{[3, 4, 5].map((n) => <option key={n}>{n}</option>)}</select>
      <Button variant="outline" size="sm" onClick={async () => { if (confirm("重新分組會清掉各組目前的討論與投票。確定嗎？")) { await api.regroup(a.id, size); onDone(); } }}>重新分組</Button>
    </div>
  );
}

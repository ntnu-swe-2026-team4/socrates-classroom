import { useEffect, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, Send } from "lucide-react";
import { api, type Activity, type ArgumentSummary, type Coverage } from "@/api";
import { keys, useConfirmPosition, useDialogue, useMembers, useNoteActions, useNotes, usePositions, useProgress, useStar } from "@/api/queries";
import { StarMap } from "@/components/star/StarMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { NotesCard } from "./NotesCard";
import { MemberChip, Panel, StageLayout } from "./shared";

const COV: [keyof Coverage, string][] = [["claim", "主張"], ["reason", "理由"], ["evidence", "證據或例子"], ["counter", "反例的回應"]];
const SUMMARY_LABEL: Record<keyof ArgumentSummary, string> = { claim: "我的主張", reason: "我的理由", evidence: "證據或例子" };

/** 右側：跟蘇格拉底的對話（回覆用串流一段一段出現） */
function ChatPanel({ a, readOnly }: { a: Activity; readOnly: boolean }) {
  const qc = useQueryClient();
  const { data: messages = [] } = useDialogue(a.id);
  const { data: notes = [] } = useNotes(a.id);
  const { create, remove } = useNoteActions(a.id);
  const [text, setText] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [mine, setMine] = useState<string | null>(null);
  const [error, setError] = useState("");
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ block: "end" }); }, [messages, pending, mine]);

  async function send() {
    const t = text.trim();
    if (!t || pending !== null) return;
    setText(""); setMine(t); setPending(""); setError("");
    try {
      await api.sendDialogue(a.id, t, (c) => setPending((p) => (p ?? "") + c));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPending(null); setMine(null);
      qc.invalidateQueries({ queryKey: keys.dialogue(a.id) });
      qc.invalidateQueries({ queryKey: keys.progress(a.id) });
    }
  }

  /** 已存的訊息可以標註成筆記，再按一次取消 */
  const toggleMark = (id: string, body: string) => {
    const note = notes.find((n) => n.sourceMessageId === id);
    if (note) remove.mutate(note.id);
    else create.mutate({ kind: "highlight", sourceMessageId: id, text: body });
  };
  const bubble = (role: "user" | "assistant", body: string, key: string, savedId?: string) => {
    const marked = !!savedId && notes.some((n) => n.sourceMessageId === savedId);
    return (
      <div key={key} className={cn("group flex items-start gap-3", role === "user" && "flex-row-reverse")}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-bg-2 font-serif text-sm text-bronze">{role === "user" ? "我" : "Σ"}</span>
        <p className={cn("max-w-[80%] rounded-2xl border px-4 py-2.5 font-serif text-[14.5px] leading-7", role === "user" ? "bg-bronze-soft" : "bg-bg-2", marked ? "border-bronze-dim" : "border-line")}>{body}</p>
        {savedId && !readOnly && (
          <button type="button" onClick={() => toggleMark(savedId, body)} aria-label={marked ? "取消標註" : "標註成筆記"} title={marked ? "取消標註" : "標註成筆記"}
            className={cn("mt-2 cursor-pointer text-ink-faint transition-opacity hover:text-bronze", marked ? "text-bronze" : "opacity-0 group-hover:opacity-100 focus:opacity-100")}>
            {marked ? <BookmarkCheck className="size-4" /> : <Bookmark className="size-4" />}
          </button>
        )}
      </div>
    );
  };
  return (
    <Panel>
      <div className="border-b border-line px-5 py-3 font-serif text-sm">與蘇格拉底對話</div>
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {bubble("assistant", `這場辯論的議題是「${a.statement}」。先不用急著下結論——你現在怎麼想？`, "opener")}
        {messages.map((m) => bubble(m.role, m.text, m.id, m.id))}
        {mine && bubble("user", mine, "mine")}
        {pending !== null && bubble("assistant", pending || "…", "pending")}
        {error && <p className="text-[12.5px] text-wine">{error}</p>}
        <div ref={end} />
      </div>
      {!readOnly && (
        <div className="flex items-end gap-2 border-t border-line p-3">
          <Textarea rows={1} value={text} placeholder="輸入你的想法…" onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <Button size="icon" onClick={() => void send()} disabled={pending !== null} aria-label="送出"><Send className="size-4" /></Button>
        </div>
      )}
    </Panel>
  );
}

function PositionDialog({ a, open, onOpenChange }: { a: Activity; open: boolean; onOpenChange: (v: boolean) => void }) {
  const confirm = useConfirmPosition(a.id);
  const { data: draft } = useQuery({ queryKey: ["draft", a.id, open], queryFn: () => api.draftPosition(a.id), enabled: open });
  const [form, setForm] = useState<ArgumentSummary | null>(null);
  const cur = form ?? draft?.summary ?? null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) setForm(null); onOpenChange(v); }}>
      <DialogContent>
        <DialogTitle>整理我的想法</DialogTitle>
        <DialogDescription>AI 依你的對話整理了論點，請改成你真正的想法再確認。你在各條價值軸上的位置會由 AI 估算，活動結束後才會公開。</DialogDescription>
        {cur ? (
          <div className="space-y-4">
            {(Object.keys(SUMMARY_LABEL) as (keyof ArgumentSummary)[]).map((k) => (
              <label key={k} className="block"><span className="mb-1 block text-xs text-ink-dim">{SUMMARY_LABEL[k]}</span>
                <Textarea rows={2} value={cur[k]} onChange={(e) => setForm({ ...cur, [k]: e.target.value })} /></label>
            ))}
            {confirm.error && <p className="text-[12.5px] text-wine">{confirm.error.message}</p>}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>先不整理</Button>
              <Button disabled={confirm.isPending || !cur.claim.trim()} onClick={() => confirm.mutate(cur, { onSuccess: () => { setForm(null); onOpenChange(false); } })}>確認送出</Button>
            </div>
          </div>
        ) : <p className="text-sm text-ink-faint">整理中…</p>}
      </DialogContent>
    </Dialog>
  );
}

function SummaryReadout({ summary }: { summary: ArgumentSummary }) {
  return (
    <div className="space-y-3">
      {(Object.keys(SUMMARY_LABEL) as (keyof ArgumentSummary)[]).map((k) => (
        <div key={k}><small className="text-[11px] text-ink-faint">{SUMMARY_LABEL[k]}</small><p className="font-serif text-sm leading-relaxed">{summary[k] || "—"}</p></div>
      ))}
    </div>
  );
}

export function IndividualStage({ a, teacher, flow, view }: { a: Activity; teacher: boolean; flow: ReactNode; view: "current" | "past" }) {
  const { data: progress } = useProgress(a.id);
  const { data: positions = [] } = usePositions(a.id);
  const [dlg, setDlg] = useState(false);
  const qc = useQueryClient();
  const over = view === "past";
  const mine = positions.find((p) => p.confirmed);

  if (teacher) return <TeacherIndividual a={a} flow={flow} />;

  const left = (
    <Card className="p-4">
      <CardTitle className="flex items-center gap-2">個人調查 <Badge tone={mine ? "olive" : progress?.rounds ? "bronze" : "neutral"}>{mine ? "已確認" : progress?.rounds ? "對話中" : "尚未開始"}</Badge></CardTitle>
      <p className="mb-3 text-[12.5px] leading-relaxed text-ink-faint">右邊跟蘇格拉底聊。<b className="text-ink">AI 只提問、不給答案</b>，追問到你把想法講清楚，再整理成論點總結。</p>
      {mine ? <SummaryReadout summary={mine.summary} /> : (
        <>
          <div className="flex flex-wrap gap-1.5">
            {COV.map(([k, n]) => <span key={k} className={cn("rounded-full border px-3 py-1 text-[11.5px]", progress?.coverage[k] ? "border-olive-soft bg-olive-soft text-olive" : "border-line text-ink-faint")}>{progress?.coverage[k] ? "✓ " : ""}{n}</span>)}
          </div>
          <p className="my-3 text-[12.5px] text-ink-faint">已對話 <b>{progress?.rounds ?? 0}</b> / {progress?.maxRounds ?? 20} 輪{progress?.readyToSummarize ? "" : "（至少聊 2 輪才能整理）"}</p>
        </>
      )}
      {!over && <Button className="mt-2" size="sm" disabled={!mine && !progress?.readyToSummarize} onClick={() => setDlg(true)}>{mine ? "修改論點" : "整理我的想法"}</Button>}
      {!mine && progress?.readyToSummarize && !over && <p className="mt-2 text-[12px] text-olive">蘇格拉底覺得你已經說得差不多了，可以整理想法了。</p>}
      <p className="mt-3 text-[11.5px] text-ink-faint">你和同學的立場座標，在活動結束後才會公開。</p>
      <PositionDialog a={a} open={dlg} onOpenChange={(v) => { setDlg(v); if (!v) qc.invalidateQueries({ queryKey: keys.positions(a.id) }); }} />
    </Card>
  );
  return <StageLayout flow={flow} left={<>{left}<NotesCard a={a} readOnly={over} /></>} right={<ChatPanel a={a} readOnly={over} />} />;
}

function TeacherIndividual({ a, flow }: { a: Activity; flow: ReactNode }) {
  const qc = useQueryClient();
  const { data: members = [] } = useMembers(a.id);
  const { data: star } = useStar(a.id, "individual");
  const confirmed = members.filter((m) => m.individual?.status === "confirmed").length;
  const pending = members.some((m) => m.simulated && m.individual?.status !== "confirmed");

  const left = (
    <>
      <Card className="p-4">
        <CardTitle>個人調查</CardTitle>
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-faint">每位同學獨立跟 AI 對話；AI 只提問。完成後每人產出<b className="text-ink">座標</b>與<b className="text-ink">論點總結</b>。</p>
        <div className="grid grid-cols-[4em_1fr_auto] items-center gap-3 text-[13px]"><span>已確認</span><span className="h-2 overflow-hidden rounded bg-bg-3"><i className="block h-full bg-bronze" style={{ width: `${members.length ? (confirmed / members.length) * 100 : 0}%` }} /></span><em className="not-italic text-ink-faint">{confirmed} / {members.length}</em></div>
        {api.dev && pending && <Button variant="outline" size="sm" className="mt-3" onClick={async () => { await api.dev!.simulateIndividual(a.id); qc.invalidateQueries({ queryKey: keys.members(a.id) }); qc.invalidateQueries({ queryKey: keys.star(a.id) }); }}>模擬同學完成調查</Button>}
      </Card>
      <Card className="p-4">
        <CardTitle className="flex items-center justify-between">立場星圖 <span className="font-sans text-xs font-normal text-ink-faint">只有老師看得到</span></CardTitle>
        {star && star.agents.length ? <StarMap data={star} compact /> : <p className="text-[12.5px] text-ink-faint">還沒有人確認座標。同學確認後，這裡會出現每個人的位置。</p>}
      </Card>
    </>
  );
  const right = (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <Card>
        <CardTitle>成員進度</CardTitle>
        {members.map((m) => {
          const st = m.individual?.status ?? "todo";
          return (
            <div key={m.id} className="grid grid-cols-[1.3fr_auto_3.5em_1.6fr] items-center gap-3 border-t border-line py-3 text-[13px] first:border-t-0 max-md:grid-cols-[1fr_auto]">
              <span><MemberChip m={m} />{m.id === "you" && <em className="ml-2 rounded-full bg-bg-3 px-2 py-0.5 text-[10px] not-italic text-ink-dim">學生模式的你</em>}</span>
              <Badge tone={st === "confirmed" ? "olive" : st === "talking" ? "bronze" : "neutral"}>{{ confirmed: "已確認", talking: "對話中", todo: "未開始" }[st]}</Badge>
              <span className="text-xs text-ink-faint max-md:hidden">{m.individual?.rounds ?? 0} 輪</span>
              <span className="truncate text-xs text-ink-dim max-md:hidden">{m.individual?.claim ?? "—"}</span>
            </div>
          );
        })}
      </Card>
    </div>
  );
  return <StageLayout flow={flow} left={left} right={right} />;
}

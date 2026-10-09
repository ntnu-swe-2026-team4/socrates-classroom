import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, Send } from "lucide-react";
import { api, type Activity, type ArgumentSummary, type Coverage } from "@/api";
import { keys, useConfirmPosition, useDialogue, useMembers, useNoteActions, useNotes, usePositions, useProgress, useSetCompleted, useStar } from "@/api/queries";
import { StarMap } from "@/components/star/StarMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { NotesPanel } from "./NotesPanel";
import { MemberChip, ModeTabs, Panel, Section, StageLayout } from "./shared";

const COV: [keyof Coverage, string][] = [["claim", "主張"], ["reason", "理由"], ["evidence", "證據或例子"], ["counter", "反例的回應"]];
const SUMMARY_LABEL: Record<keyof ArgumentSummary, string> = { claim: "我的主張", reason: "我的理由", evidence: "證據或例子" };
const SUMMARY_KEYS = Object.keys(SUMMARY_LABEL) as (keyof ArgumentSummary)[];
const SURVEY_NAME = { debate: "個人調查", individual: "個人思辨" } as const;
const STATUS_NAME = { done: "已完成", confirmed: "已確認", talking: "對話中", todo: "未開始" } as const;
const STATUS_TONE = { done: "olive", confirmed: "olive", talking: "bronze", todo: "neutral" } as const;

function CoverageChips({ coverage }: { coverage?: Coverage }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {COV.map(([k, n]) => <span key={k} className={cn("rounded-full border px-3 py-1 text-[11.5px]", coverage?.[k] ? "border-olive-soft bg-olive-soft text-olive" : "border-line text-ink-faint")}>{coverage?.[k] ? "✓ " : ""}{n}</span>)}
    </div>
  );
}

/** 右側：跟蘇格拉底的對話（回覆用串流一段一段出現；每句話可以標註成筆記） */
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
      <div className="flex-1 space-y-4 overflow-y-auto p-5">
        {bubble("assistant", `${a.kind === "individual" ? "這次要思考的是" : "這場辯論的主題是"}「${a.statement}」。先不用急著下結論——你現在怎麼想？`, "opener")}
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

/** 直接在欄位裡整理 / 修改論點（不另開視窗）；沒有確認過時，先帶入 AI 依對話整理的草稿 */
function SummaryEditor({ a, initial, onDone }: { a: Activity; initial?: ArgumentSummary; onDone: () => void }) {
  const confirm = useConfirmPosition(a.id);
  const { data: draft } = useQuery({ queryKey: ["draft", a.id], queryFn: () => api.draftPosition(a.id), enabled: !initial, staleTime: 0 });
  const [form, setForm] = useState<ArgumentSummary | null>(null);
  const cur = form ?? initial ?? draft?.summary ?? null;
  if (!cur) return <p className="text-sm text-ink-faint">AI 整理中…</p>;
  return (
    <div className="space-y-3">
      {!initial && <p className="text-[12px] leading-relaxed text-ink-faint">AI 依你的對話整理了論點，請改成你真正的想法再確認。</p>}
      {SUMMARY_KEYS.map((k) => (
        <label key={k} className="block"><span className="mb-1 block text-xs text-ink-dim">{SUMMARY_LABEL[k]}</span>
          <Textarea rows={2} value={cur[k]} onChange={(e) => setForm({ ...cur, [k]: e.target.value })} /></label>
      ))}
      {confirm.error && <p className="text-[12.5px] text-wine">{confirm.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>取消</Button>
        <Button size="sm" disabled={confirm.isPending || !cur.claim.trim()} onClick={() => confirm.mutate(cur, { onSuccess: onDone })}>確認</Button>
      </div>
    </div>
  );
}

/** 左欄「個人調查」模式：進度、整理 / 修改論點 */
function Investigation({ a, over }: { a: Activity; over: boolean }) {
  const { data: progress } = useProgress(a.id);
  const { data: positions = [] } = usePositions(a.id);
  const complete = useSetCompleted(a.id);
  const [editing, setEditing] = useState(false);
  const mine = positions.find((p) => p.confirmed);
  const status = mine ? "已確認" : progress?.rounds ? "對話中" : "尚未開始";

  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex items-center gap-2"><Badge tone={mine ? "olive" : progress?.rounds ? "bronze" : "neutral"}>{status}</Badge><span className="text-[12px] text-ink-faint">已對話 {progress?.rounds ?? 0} / {progress?.maxRounds ?? 20} 輪</span></div>
      {editing ? <SummaryEditor a={a} initial={mine?.summary} onDone={() => setEditing(false)} /> : mine ? (
        <div className="space-y-3">
          {SUMMARY_KEYS.map((k) => <div key={k}><small className="text-[11px] text-ink-faint">{SUMMARY_LABEL[k]}</small><p className="font-serif text-sm leading-relaxed">{mine.summary[k] || "—"}</p></div>)}
          {!over && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>修改論點</Button>
              {a.kind === "individual" && <Button size="sm" disabled={complete.isPending} onClick={() => complete.mutate(true)}>完成，查看結算 →</Button>}
            </div>
          )}
          {complete.error && <p className="text-[12.5px] text-wine">{complete.error.message}</p>}
        </div>
      ) : (
        <>
          <p className="text-[12.5px] leading-relaxed text-ink-faint">跟蘇格拉底聊你的想法。<b className="text-ink">AI 只提問、不給答案</b>，追問到你把想法講清楚，再整理成論點。</p>
          <CoverageChips coverage={progress?.coverage} />
          {!over && (progress?.readyToSummarize
            ? <><p className="text-[12px] text-olive">蘇格拉底覺得你已經說得差不多了，可以整理想法了。</p><Button size="sm" onClick={() => setEditing(true)}>整理我的想法</Button></>
            : <p className="text-[12px] text-ink-faint">至少聊 2 輪才能整理。</p>)}
        </>
      )}
      {a.kind === "debate" && <p className="text-[11.5px] text-ink-faint">你和同學的立場座標，在活動結束後才會公開。</p>}
    </div>
  );
}

/** 個人思辨的結算：論點、四個面向、輪數、筆記，右欄是對話紀錄；可以重新開啟回去繼續 */
function IndividualResult({ a }: { a: Activity }) {
  const { data: progress } = useProgress(a.id);
  const { data: positions = [] } = usePositions(a.id);
  const reopen = useSetCompleted(a.id);
  const [mode, setMode] = useState<"result" | "notes">("result");
  const mine = positions.find((p) => p.confirmed);
  const result = (
    <div className="space-y-5 px-5 py-4">
      <div className="flex items-center gap-2"><Badge tone="olive">已完成</Badge><span className="text-[12px] text-ink-faint">對話 {progress?.rounds ?? 0} 輪</span></div>
      {mine && SUMMARY_KEYS.map((k) => <div key={k}><small className="text-[11px] text-ink-faint">{SUMMARY_LABEL[k]}</small><p className="font-serif text-[15px] leading-relaxed">{mine.summary[k] || "—"}</p></div>)}
      <div><small className="mb-1.5 block text-[11px] text-ink-faint">對話中出現的面向</small><CoverageChips coverage={progress?.coverage} /></div>
      <div className="border-t border-line pt-4">
        <p className="mb-2 text-[12px] text-ink-faint">想再想清楚一點？重新開啟後可以繼續對話、修改論點，再重新完成。</p>
        <Button variant="outline" size="sm" disabled={reopen.isPending} onClick={() => reopen.mutate(false)}>回去繼續思辨</Button>
        {reopen.error && <p className="mt-1.5 text-[12.5px] text-wine">{reopen.error.message}</p>}
      </div>
    </div>
  );
  return (
    <StageLayout
      leftLabel={mode === "result" ? "結算" : "我的筆記"}
      leftHeader={<ModeTabs items={[["result", "結算"], ["notes", "我的筆記"]]} value={mode} onChange={setMode} />}
      left={mode === "result" ? result : <NotesPanel a={a} readOnly />}
      rightLabel="對話紀錄" right={<ChatPanel a={a} readOnly />} />
  );
}

export function IndividualStage({ a, teacher, view }: { a: Activity; teacher: boolean; view: "current" | "past" }) {
  const [mode, setMode] = useState<"survey" | "notes">("survey");
  const { data: members = [] } = useMembers(a.id, !teacher);
  const over = view === "past";
  if (teacher) return <TeacherIndividual a={a} />;
  if (a.kind === "individual" && members.find((m) => m.isMe)?.individual?.status === "done") return <IndividualResult a={a} />;
  return (
    <StageLayout
      leftLabel={mode === "survey" ? SURVEY_NAME[a.kind] : "我的筆記"}
      leftHeader={<ModeTabs items={[["survey", SURVEY_NAME[a.kind]], ["notes", "我的筆記"]]} value={mode} onChange={setMode} />}
      left={mode === "survey" ? <Investigation a={a} over={over} /> : <NotesPanel a={a} readOnly={over} />}
      rightLabel="與蘇格拉底對話" right={<ChatPanel a={a} readOnly={over} />} />
  );
}

function TeacherIndividual({ a }: { a: Activity }) {
  const qc = useQueryClient();
  const { data: members = [] } = useMembers(a.id);
  const { data: star } = useStar(a.id, "individual", a.kind === "debate");
  const solo = a.kind === "individual";
  const finished = members.filter((m) => m.individual?.status === (solo ? "done" : "confirmed")).length;
  const pending = members.some((m) => m.simulated && m.individual?.status !== "confirmed");

  const left = (
    <>
      <Section>
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-faint">{solo ? <>每位同學各自跟 AI 對話、整理<b className="text-ink">論點</b>，按「完成」後看到自己的結算。</> : <>每位同學獨立跟 AI 對話；AI 只提問。完成後每人產出<b className="text-ink">座標</b>與<b className="text-ink">論點總結</b>。</>}</p>
        <div className="grid grid-cols-[4em_1fr_auto] items-center gap-3 text-[13px]"><span>{solo ? "已完成" : "已確認"}</span><span className="h-2 overflow-hidden rounded bg-bg-3"><i className="block h-full bg-bronze" style={{ width: `${members.length ? (finished / members.length) * 100 : 0}%` }} /></span><em className="not-italic text-ink-faint">{finished} / {members.length}</em></div>
        {api.dev && pending && <Button variant="outline" size="sm" className="mt-3" onClick={async () => { await api.dev!.simulateIndividual(a.id); qc.invalidateQueries({ queryKey: keys.members(a.id) }); qc.invalidateQueries({ queryKey: keys.star(a.id) }); }}>模擬同學完成調查</Button>}
      </Section>
      {!solo && <Section>
        <CardTitle className="flex items-center justify-between">立場星圖 <span className="font-sans text-xs font-normal text-ink-faint">只有老師看得到</span></CardTitle>
        {star && star.agents.length ? <StarMap data={star} compact /> : <p className="text-[12.5px] text-ink-faint">還沒有人確認論點。同學確認後，這裡會出現每個人的位置。</p>}
      </Section>}
    </>
  );
  const right = (
    <div className="min-h-0 flex-1 overflow-y-auto px-5">
      {members.map((m) => {
        const st = m.individual?.status ?? "todo";
        return (
          <div key={m.id} className="grid grid-cols-[1.3fr_auto_3.5em_1.6fr] items-center gap-3 border-b border-line py-3 text-[13px] max-md:grid-cols-[1fr_auto]">
            <span><MemberChip m={m} />{m.id === "you" && <em className="ml-2 rounded-full bg-bg-3 px-2 py-0.5 text-[10px] not-italic text-ink-dim">學生模式的你</em>}</span>
            <Badge tone={STATUS_TONE[st]}>{STATUS_NAME[st]}</Badge>
            <span className="text-xs text-ink-faint max-md:hidden">{m.individual?.rounds ?? 0} 輪</span>
            <span className="truncate text-xs text-ink-dim max-md:hidden">{m.individual?.claim ?? "—"}</span>
          </div>
        );
      })}
    </div>
  );
  return <StageLayout leftLabel={SURVEY_NAME[a.kind]} left={left} rightLabel="成員進度" right={right} />;
}

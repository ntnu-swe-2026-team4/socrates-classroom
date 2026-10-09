import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bookmark, BookmarkCheck, Send } from "lucide-react";
import { api, type Activity, type ArgumentSummary, type Coverage } from "@/api";
import { keys, useConfirmPosition, useDialogue, useMembers, useNoteActions, useNotes, usePositions, useProgress, useStar } from "@/api/queries";
import { StarMap } from "@/components/star/StarMap";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { useT } from "@/i18n";
import { speakAi, stopAiSpeech } from "@/lib/ai-speaking";
import { cn } from "@/lib/utils";
import { NotesPanel } from "./NotesPanel";
import { MemberChip, Panel, Section, StageLayout } from "./shared";

const COV: [keyof Coverage, string][] = [["claim", "主張"], ["reason", "理由"], ["evidence", "證據或例子"], ["counter", "反例的回應"]];
const SUMMARY_LABEL: Record<keyof ArgumentSummary, string> = { claim: "我的主張", reason: "我的理由", evidence: "證據或例子" };
const SUMMARY_KEYS = Object.keys(SUMMARY_LABEL) as (keyof ArgumentSummary)[];
const SURVEY_NAME = "個人調查";
const STATUS_NAME = { done: "已完成", confirmed: "已確認", talking: "對話中", todo: "未開始" } as const;
const STATUS_TONE = { done: "olive", confirmed: "olive", talking: "bronze", todo: "neutral" } as const;

function CoverageChips({ coverage }: { coverage?: Coverage }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      {COV.map(([k, n]) => <span key={k} className={cn("rounded-full border px-3 py-1 text-[11.5px]", coverage?.[k] ? "border-olive-soft bg-olive-soft text-olive" : "border-line text-ink-faint")}>{coverage?.[k] ? "✓ " : ""}{t(n)}</span>)}
    </div>
  );
}

/** 右側：跟蘇格拉底的對話（回覆用串流一段一段出現；每句話可以標註成筆記） */
function ChatPanel({ a, readOnly }: { a: Activity; readOnly: boolean }) {
  const t = useT();
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
  // 回覆完成後用語音念出來（跟單人對話一樣），資訊欄的蘇格拉底跟著動嘴巴
  useEffect(() => stopAiSpeech, []);

  async function send() {
    const msg = text.trim();
    if (!msg || pending !== null) return;
    setText(""); setMine(msg); setPending(""); setError("");
    try {
      const reply = await api.sendDialogue(a.id, msg, (c) => setPending((p) => (p ?? "") + c));
      speakAi(reply.text);
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
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-line-strong bg-bg-2 font-serif text-sm text-bronze">{role === "user" ? t("我") : t("蘇")}</span>
        <p className={cn("max-w-[80%] rounded-2xl border px-4 py-2.5 font-serif text-[14.5px] leading-7", role === "user" ? "bg-bronze-soft" : "bg-bg-2", marked ? "border-bronze-dim" : "border-line")}>{body}</p>
        {savedId && !readOnly && (
          <button type="button" onClick={() => toggleMark(savedId, body)} aria-label={marked ? t("取消標註") : t("標註成筆記")} title={marked ? t("取消標註") : t("標註成筆記")}
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
        {bubble("assistant", t("這場辯論的主題是「{statement}」。先不用急著下結論——你現在怎麼想？", { statement: a.statement }), "opener")}
        {messages.map((m) => bubble(m.role, m.text, m.id, m.id))}
        {mine && bubble("user", mine, "mine")}
        {pending !== null && bubble("assistant", pending || "…", "pending")}
        {error && <p className="text-[12.5px] text-wine">{error}</p>}
        <div ref={end} />
      </div>
      {!readOnly && (
        <div className="flex items-end gap-2 border-t border-line p-3">
          <Textarea rows={1} value={text} placeholder={t("輸入你的想法…")} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <Button size="icon" onClick={() => void send()} disabled={pending !== null} aria-label={t("送出")}><Send className="size-4" /></Button>
        </div>
      )}
    </Panel>
  );
}

/** 直接在欄位裡整理 / 修改論點（不另開視窗）；沒有確認過時，先帶入 AI 依對話整理的草稿 */
function SummaryEditor({ a, initial, onDone }: { a: Activity; initial?: ArgumentSummary; onDone: () => void }) {
  const t = useT();
  const confirm = useConfirmPosition(a.id);
  const { data: draft } = useQuery({ queryKey: ["draft", a.id], queryFn: () => api.draftPosition(a.id), enabled: !initial, staleTime: 0 });
  const [form, setForm] = useState<ArgumentSummary | null>(null);
  const cur = form ?? initial ?? draft?.summary ?? null;
  if (!cur) return <p className="text-sm text-ink-faint">{t("AI 整理中…")}</p>;
  return (
    <div className="space-y-3">
      {!initial && <p className="text-[12px] leading-relaxed text-ink-faint">{t("AI 依你的對話整理了論點，請改成你真正的想法再確認。")}</p>}
      {SUMMARY_KEYS.map((k) => (
        <label key={k} className="block"><span className="mb-1 block text-xs text-ink-dim">{t(SUMMARY_LABEL[k])}</span>
          <Textarea rows={2} value={cur[k]} onChange={(e) => setForm({ ...cur, [k]: e.target.value })} /></label>
      ))}
      {confirm.error && <p className="text-[12.5px] text-wine">{confirm.error.message}</p>}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onDone}>{t("取消")}</Button>
        <Button size="sm" disabled={confirm.isPending || !cur.claim.trim()} onClick={() => confirm.mutate(cur, { onSuccess: onDone })}>{t("確認")}</Button>
      </div>
    </div>
  );
}

/** 左欄「個人調查」模式：進度、整理 / 修改論點 */
function Investigation({ a, over }: { a: Activity; over: boolean }) {
  const t = useT();
  const { data: progress } = useProgress(a.id);
  const { data: positions = [] } = usePositions(a.id);
  const [editing, setEditing] = useState(false);
  const mine = positions.find((p) => p.confirmed);
  const status = mine ? t("已確認") : progress?.rounds ? t("對話中") : t("尚未開始");

  return (
    <div className="space-y-4 px-5 py-4">
      <div className="flex items-center gap-2"><Badge tone={mine ? "olive" : progress?.rounds ? "bronze" : "neutral"}>{status}</Badge><span className="text-[12px] text-ink-faint">{t("已對話 {n} / {max} 輪", { n: progress?.rounds ?? 0, max: progress?.maxRounds ?? 20 })}</span></div>
      {editing ? <SummaryEditor a={a} initial={mine?.summary} onDone={() => setEditing(false)} /> : mine ? (
        <div className="space-y-3">
          {SUMMARY_KEYS.map((k) => <div key={k}><small className="text-[11px] text-ink-faint">{t(SUMMARY_LABEL[k])}</small><p className="font-serif text-sm leading-relaxed">{mine.summary[k] || "—"}</p></div>)}
          {!over && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>{t("修改論點")}</Button>
            </div>
          )}
        </div>
      ) : (
        <>
          <p className="text-[12.5px] leading-relaxed text-ink-faint">{t("跟蘇格拉底聊你的想法。")}<b className="text-ink">{t("AI 只提問、不給答案")}</b>{t("，追問到你把想法講清楚，再整理成論點。")}</p>
          <CoverageChips coverage={progress?.coverage} />
          {!over && (progress?.readyToSummarize
            ? <><p className="text-[12px] text-olive">{t("蘇格拉底覺得你已經說得差不多了，可以整理想法了。")}</p><Button size="sm" onClick={() => setEditing(true)}>{t("整理我的想法")}</Button></>
            : <p className="text-[12px] text-ink-faint">{t("至少聊 2 輪才能整理。")}</p>)}
        </>
      )}
      <p className="text-[11.5px] text-ink-faint">{t("你和同學的立場座標，在活動結束後才會公開。")}</p>
    </div>
  );
}

export function IndividualStage({ a, teacher, view }: { a: Activity; teacher: boolean; view: "current" | "past" }) {
  const t = useT();
  const [mode, setMode] = useState<"survey" | "notes">("survey");
  const over = view === "past";
  if (teacher) return <TeacherIndividual a={a} />;
  return (
    <StageLayout
      leftLabel={mode === "survey" ? t(SURVEY_NAME) : t("我的筆記")}
      modes={[["survey", t(SURVEY_NAME)], ["notes", t("我的筆記")]]} mode={mode} onMode={(k) => setMode(k as typeof mode)}
      left={mode === "survey" ? <Investigation a={a} over={over} /> : <NotesPanel a={a} readOnly={over} />}
      rightLabel={t("與蘇格拉底對話")} right={<ChatPanel a={a} readOnly={over} />} />
  );
}

function TeacherIndividual({ a }: { a: Activity }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: members = [] } = useMembers(a.id);
  const { data: star } = useStar(a.id, "individual");
  const finished = members.filter((m) => m.individual?.status === "confirmed").length;
  const pending = members.some((m) => m.simulated && m.individual?.status !== "confirmed");

  const left = (
    <>
      <Section>
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-faint">{t("每位同學獨立跟 AI 對話；AI 只提問。完成後每人產出")}<b className="text-ink">{t("座標")}</b>{t("與")}<b className="text-ink">{t("論點總結")}</b>{t("。")}</p>
        <div className="grid grid-cols-[4em_1fr_auto] items-center gap-3 text-[13px]"><span>{t("已確認")}</span><span className="h-2 overflow-hidden rounded bg-bg-3"><i className="block h-full bg-bronze" style={{ width: `${members.length ? (finished / members.length) * 100 : 0}%` }} /></span><em className="not-italic text-ink-faint">{finished} / {members.length}</em></div>
        {api.dev && pending && <Button variant="outline" size="sm" className="mt-3" onClick={async () => { await api.dev!.simulateIndividual(a.id); qc.invalidateQueries({ queryKey: keys.members(a.id) }); qc.invalidateQueries({ queryKey: keys.star(a.id) }); }}>{t("模擬同學完成調查")}</Button>}
      </Section>
      <Section>
        <CardTitle className="flex items-center justify-between">{t("立場星圖")} <span className="font-sans text-xs font-normal text-ink-faint">{t("只有老師看得到")}</span></CardTitle>
        {star && star.agents.length ? <StarMap data={star} compact /> : <p className="text-[12.5px] text-ink-faint">{t("還沒有人確認論點。同學確認後，這裡會出現每個人的位置。")}</p>}
      </Section>
    </>
  );
  const right = (
    <div className="min-h-0 flex-1 overflow-y-auto px-5">
      {members.map((m) => {
        const st = m.individual?.status ?? "todo";
        return (
          <div key={m.id} className="grid grid-cols-[1.3fr_auto_3.5em_1.6fr] items-center gap-3 border-b border-line py-3 text-[13px] max-md:grid-cols-[1fr_auto]">
            <span><MemberChip m={m} />{m.id === "you" && <em className="ml-2 rounded-full bg-bg-3 px-2 py-0.5 text-[10px] not-italic text-ink-dim">{t("學生模式的你")}</em>}</span>
            <Badge tone={STATUS_TONE[st]}>{t(STATUS_NAME[st])}</Badge>
            <span className="text-xs text-ink-faint max-md:hidden">{t("{n} 輪", { n: m.individual?.rounds ?? 0 })}</span>
            <span className="truncate text-xs text-ink-dim max-md:hidden">{m.individual?.claim ?? "—"}</span>
          </div>
        );
      })}
    </div>
  );
  return <StageLayout leftLabel={t(SURVEY_NAME)} left={left} rightLabel={t("成員進度")} right={right} />;
}

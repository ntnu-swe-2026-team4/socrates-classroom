import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type Activity, type Group, type Judgment, type Room, type Side, type Turn } from "@/api";
import { keys, useArguments, useGroups, useMembers, useRooms, useTurns } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/input";
import { CRITERIA, PHASES, PHASE_NAME, ROLE_NAME, SIDE_NAME, VERIFY_NAME, avgScores, fmt, groupColor } from "@/lib/debate";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { speakAi, stopAiSpeech } from "@/lib/ai-speaking";
import { Bar, Panel, Section, StageLayout } from "./shared";

function useCountdown(deadline?: string) {
  const [left, setLeft] = useState(0);
  useEffect(() => {
    if (!deadline) return;
    const tick = () => setLeft(Math.max(0, Math.ceil((new Date(deadline).getTime() - Date.now()) / 1000)));
    tick();
    const t = setInterval(tick, 500);
    return () => clearInterval(t);
  }, [deadline]);
  return left;
}

function TurnBubble({ t, j, group, name, teacher, onOverride }: { t: Turn; j?: Judgment; group?: Group; name: string; teacher: boolean; onOverride: (score: number | null) => void }) {
  const tl = useT();
  const side = t.side as Side;
  const eff = (k: (typeof CRITERIA)[number]["key"]) => (j ? (j.scores[k] === null ? null : j.teacherScore ?? j.scores[k]) : null);
  return (
    <div className={cn("flex", side === "b" && "justify-end")}>
      <div className={cn("max-w-[88%] rounded-2xl border border-line bg-bg-2 px-3.5 py-2.5", side === "a" ? "rounded-tl-sm border-l-[3px]" : "rounded-tr-sm border-r-[3px]")}
        style={{ [side === "a" ? "borderLeftColor" : "borderRightColor"]: "var(--bronze)" }}>
        <div className="mb-0.5 flex items-baseline gap-2.5 text-xs"><b>{name}</b><span className="text-[11px] text-ink-faint">{group?.label} · {t.phase ? tl(PHASE_NAME[t.phase]) : ""}</span></div>
        <p className="font-serif text-[13.5px] leading-relaxed">{t.text}</p>
        {j && (
          <details className="mt-2 text-[11.5px]">
            <summary className="flex cursor-pointer list-none flex-wrap items-center gap-1.5">
              {CRITERIA.map((c) => <span key={c.key} className="rounded-full bg-bg-3 px-2 py-px text-ink-dim">{tl(c.name)} <b className="text-ink">{eff(c.key) ?? "—"}</b></span>)}
              <span className={cn("rounded-full px-2 py-px", j.verifiability === "sourced" ? "bg-olive-soft text-olive" : j.verifiability === "checkable" ? "bg-bronze-soft text-bronze" : "bg-bg-3 text-ink-faint")}>{tl(VERIFY_NAME[j.verifiability])}</span>
            </summary>
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-ink-dim">{CRITERIA.filter((c) => j.notes[c.key]).map((c) => <li key={c.key}><b className="mr-2 font-medium text-ink-faint">{tl(c.name)}</b>{j.notes[c.key]}</li>)}</ul>
            {teacher && (
              <label className="mt-2 flex items-center gap-2 text-ink-dim">{tl("老師覆寫整體分")}
                <select value={j.teacherScore ?? ""} onChange={(e) => onOverride(e.target.value === "" ? null : Number(e.target.value))} className="rounded-lg border border-line-strong bg-bg-2 px-2 py-0.5 text-ink">
                  <option value="">{tl("沿用 AI")}</option>{[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            )}
          </details>
        )}
      </div>
    </div>
  );
}

export function DebateStage({ a, teacher, over }: { a: Activity; teacher: boolean; over: boolean }) {
  const t = useT();
  const qc = useQueryClient();
  const { data: members = [] } = useMembers(a.id);
  const { data: groups = [] } = useGroups(a.id);
  const { data: rooms = [] } = useRooms(a.id);
  const me = members.find((m) => m.isMe);
  const myGroup = me ? groups.find((g) => g.memberIds.includes(me.id)) : undefined;
  const mineRoom = myGroup ? rooms.find((r) => r.groupA === myGroup.id || r.groupB === myGroup.id) : undefined;
  const [pick, setPick] = useState<string | null>(null);
  const room: Room | undefined = rooms.find((r) => r.id === pick) ?? (!teacher ? mineRoom : undefined) ?? rooms[0];
  const { data: tj } = useTurns(room?.id);
  const ga = groups.find((g) => g.id === room?.groupA), gb = groups.find((g) => g.id === room?.groupB);
  const mySide: Side | null = !teacher && myGroup && room ? (myGroup.id === room.groupA ? "a" : myGroup.id === room.groupB ? "b" : null) : null;
  const { data: myArgs = [] } = useArguments(mySide ? myGroup?.id : undefined);
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  const feedEnd = useRef<HTMLDivElement>(null);
  const turns = tj?.turns ?? [], judgments = tj?.judgments ?? [];
  useEffect(() => { feedEnd.current?.scrollIntoView({ block: "end" }); }, [turns.length, room?.id]);
  // 有新的發言（AI 主持人、AI 辯手或裁判）時，小蘇格拉底動一下嘴巴
  const lastTurn = turns.at(-1);
  const spokenTurn = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    // 新的 AI 發言（主持人或模擬同學）用語音念出來；進入頁面時已經存在的不念，自己的發言也不念
    const ai = lastTurn && (lastTurn.side === "moderator" || members.find((m) => m.id === lastTurn.memberId)?.simulated);
    if (spokenTurn.current !== undefined && lastTurn && lastTurn.id !== spokenTurn.current && ai && !over && Date.now() - Date.parse(lastTurn.at) < 15000) speakAi(lastTurn.text);
    spokenTurn.current = lastTurn?.id ?? null;
  }, [lastTurn?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => stopAiSpeech, []);

  const myTurn = !!room?.turn && !!me && room.turn.memberId === me.id && !teacher && !over;
  const left0 = useCountdown(myTurn ? room!.turn!.deadline : undefined);
  const speaker = (id?: string) => members.find((m) => m.id === id);
  const invalidate = () => { qc.invalidateQueries({ queryKey: keys.rooms(a.id) }); if (room) qc.invalidateQueries({ queryKey: keys.turns(room.id) }); };

  const post = useMutation({
    mutationFn: () => api.postTurn(room!.id, text.trim()),
    onSuccess: () => { setText(""); setErr(""); invalidate(); },
    onError: (e) => setErr(e instanceof Error ? e.message : String(e)),
  });

  const sideAvg = (side: Side) => avgScores(judgments.filter((j) => j.side === side));
  const phaseIdx = room && room.phase !== "ended" ? PHASES.indexOf(room.phase) : PHASES.length;
  const unfinished = rooms.filter((r) => r.status !== "finished").length;
  const lastMod = [...turns].reverse().find((t) => t.side === "moderator");
  const bye = groups.find((g) => !rooms.some((r) => r.groupA === g.id || r.groupB === g.id));

  const judgeSide = (side: Side, g?: Group) => {
    const s = sideAvg(side);
    return (
      <div className="border-t-[3px] border-bronze pt-2" style={{ borderTopColor: groupColor(g ? groups.indexOf(g) : 0) }}>
        <div className="mb-2 flex items-center text-xs">{t(SIDE_NAME[side])}<b className="ml-auto font-serif text-lg">{fmt(s.overall)}</b></div>
        {CRITERIA.map((c) => <div key={c.key} className="mt-1.5 grid grid-cols-[3.2em_1fr_1.8em] items-center gap-1.5 text-[11.5px] text-ink-dim" title={t(c.hint)}><span>{t(c.name)}</span><Bar value={s[c.key]} /><em className="text-right not-italic text-ink-faint">{fmt(s[c.key])}</em></div>)}
      </div>
    );
  };
  const argList = (g?: Group) => g && (
    <div className="mb-2"><b className="flex items-center gap-2 text-[12.5px]"><i className="size-2.5 rounded-full" style={{ background: groupColor(groups.indexOf(g)) }} />{g.label}</b></div>
  );

  if (!room || !ga || !gb) return <StageLayout leftLabel={t("場次")} left={<p className="px-5 py-4 text-sm text-ink-faint">{t("還沒有場次。")}</p>} rightLabel={t("比賽")} right={null} />;

  const left = (
    <>
      <Section>
        <div className="mb-2.5 flex items-center justify-between"><CardTitle className="mb-0">{t("場次")}</CardTitle>
          {api.dev && teacher && !over && unfinished > 0 && <Button variant="outline" size="sm" onClick={async () => { await api.dev!.simulateAllRooms(a.id); invalidate(); }}>{t("模擬全部")}</Button>}</div>
        <div className="flex flex-col gap-1.5">
          {rooms.map((r) => {
            const x = groups.find((g) => g.id === r.groupA), y = groups.find((g) => g.id === r.groupB);
            return (
              <button key={r.id} type="button" onClick={() => setPick(r.id)} className={cn("flex cursor-pointer items-center justify-between rounded-xl border px-3 py-2 text-left text-[13px]", r.id === room.id ? "border-bronze bg-bronze-soft" : "border-line bg-bg-2")}>
                <span className="flex items-center gap-1.5"><i className="size-2 rounded-full" style={{ background: groupColor(groups.indexOf(x!)) }} />{x?.label}<em className="mx-1 text-[11px] not-italic text-ink-faint">vs</em><i className="size-2 rounded-full" style={{ background: groupColor(groups.indexOf(y!)) }} />{y?.label}</span>
                <span className="text-[11px] text-ink-faint">{t({ scheduled: "未開始", live: "進行中", finished: "已結束" }[r.status])}{mineRoom?.id === r.id && !teacher ? t(" · 你") : ""}</span>
              </button>
            );
          })}
        </div>
        {bye && <p className="mt-2 text-xs text-ink-faint">{t("{label}本輪輪空，擔任觀察組。", { label: bye.label })}</p>}
      </Section>
      <Section>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
          {([["a", ga], ["b", gb]] as const).map(([side, g], i) => (
            <div key={side} className={cn("contents")}>
              {i === 1 && <span className="font-serif text-[18px] tracking-widest text-bronze">VS</span>}
              <div className={cn("rounded-xl border border-line border-t-[3px] p-2.5", mySide === side ? "bg-bg-2" : "bg-bg-1")} style={{ borderTopColor: groupColor(groups.indexOf(g)) }}>
                <small className="text-[11px] text-ink-faint">{t(SIDE_NAME[side])}{mySide === side ? t(" · 你") : ""}</small><b className="block font-serif text-sm">{g.label}</b><span className="text-[11.5px] text-ink-dim">{t("{n} 人", { n: g.memberIds.length || "—" })}</span>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-1.5 text-[11.5px]">
          {PHASES.map((p, i) => <span key={p} className={cn("rounded-full border px-2.5 py-0.5", room.status === "finished" || i < phaseIdx ? "border-olive-soft text-olive" : i === phaseIdx && room.status === "live" ? "border-bronze bg-bronze font-bold text-[#221a0c]" : "border-line text-ink-faint")}>{t(PHASE_NAME[p])}</span>)}
        </div>
      </Section>
      <Section>
        <CardTitle>{t("AI 裁判")} <span className="font-sans text-xs font-normal text-ink-faint">{t("只評論證品質")}</span></CardTitle>
        <div className="grid grid-cols-2 gap-2.5">{judgeSide("a", ga)}{judgeSide("b", gb)}</div>
        <p className="mt-3 text-[11.5px] leading-relaxed text-ink-faint">{t("分數由後端的 AI 裁判產生，只看證據、推理、回應、表達，不判斷立場，也不查證事實。")}</p>
      </Section>
      <Section>
        <CardTitle>{mySide ? t("我方論點") : t("雙方論點")}</CardTitle>
        {mySide ? (
          <div className="space-y-1.5">{argList(myGroup)}{myArgs.filter((x) => x.kind === "claim" && x.status !== "dropped").map((c) => <p key={c.id} className="border-l-2 border-line-strong pl-2.5 font-serif text-[12.5px] leading-relaxed text-ink-dim">{c.text}</p>)}</div>
        ) : <p className="text-xs text-ink-faint">{t("雙方的論點可在階段 2 的各組頁面查看。")}</p>}
      </Section>
    </>
  );

  const right = (
    <Panel>
      <div className="flex items-start gap-3 border-b border-line bg-olive-soft/30 px-5 py-3">
        <span className="flex size-[30px] shrink-0 items-center justify-center rounded-full border border-olive bg-olive-soft font-serif text-olive">{t("主")}</span>
        <div><small className="text-[10.5px] text-olive">{t("AI 主持人")}</small><p className="font-serif text-[13.5px] leading-relaxed">{lastMod?.text ?? t("等待開場。")}</p></div>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {turns.map((tn) => {
          if (tn.side === "moderator") return <p key={tn.id} className="flex items-start gap-2 px-1 text-xs leading-relaxed text-ink-faint"><b className="shrink-0 font-medium text-olive">{t("主持")}</b>{tn.text}</p>;
          const g = tn.side === "a" ? ga : gb;
          const s = speaker(tn.memberId);
          return <TurnBubble key={tn.id} t={tn} j={judgments.find((x) => x.turnId === tn.id)} group={g} name={s?.isMe ? t("你") : s?.name ?? "?"} teacher={teacher}
            onOverride={(score) => { void api.overrideJudgment(judgments.find((x) => x.turnId === tn.id)!.id, score).then(invalidate); }} />;
        })}
        {!turns.length && <p className="py-5 text-center text-sm text-ink-faint">{t("比賽還沒開始。")}</p>}
        <div ref={feedEnd} />
      </div>
      {room.status === "scheduled" && (
        <div className="m-3.5 mt-0 space-y-2 rounded-xl bg-bg-2 p-3.5 text-[13px] text-ink-dim">
          <p>{mySide && !teacher && !over ? t("你們的比賽還沒開始。準備好了就請主持人開場。") : t("這場比賽還沒開始。")}</p>
          <div className="flex gap-2">
            {mySide && !teacher && !over && <Button onClick={async () => { await api.startRoom(room.id); invalidate(); }}>{t("開始比賽")}</Button>}
            {api.dev && !over && (teacher || mySide) && <Button variant="outline" onClick={async () => { await api.dev!.simulateRoom(room.id); invalidate(); }}>{teacher ? t("模擬本場") : t("跳過，讓 AI 模擬完這場")}</Button>}
          </div>
        </div>
      )}
      {room.status === "live" && myTurn && (
        <div className="m-3.5 mt-0 rounded-2xl border border-bronze bg-bronze-soft p-3.5">
          <div className="mb-2.5 flex flex-wrap justify-between gap-2 text-[12.5px]">
            <span><b>{t("輪到你了")}</b> · {(mySide === "a" ? ga : gb).label}（{t(SIDE_NAME[room.turn!.side])}）· {t(PHASE_NAME[room.phase as keyof typeof PHASE_NAME])}{ROLE_NAME[room.turn!.role] ? "・" + t(ROLE_NAME[room.turn!.role]) : ""}</span>
            <span className={cn("font-bold tabular-nums", left0 <= 10 ? "text-wine" : "text-bronze")}>{t("剩 {time}", { time: `${Math.floor(left0 / 60)}:${String(left0 % 60).padStart(2, "0")}` })}</span>
          </div>
          <Textarea rows={3} maxLength={500} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("寫下你這一輪要說的話：主張、理由，最好再附一個例子或出處…")} />
          {err && <p className="mt-1 text-[12.5px] text-wine">{err}</p>}
          <div className="mt-2.5 flex justify-end"><Button disabled={!text.trim() || post.isPending} onClick={() => post.mutate()}>{t("送出發言")}</Button></div>
        </div>
      )}
      {room.status === "live" && !myTurn && room.turn && (
        <div className="m-3.5 mt-0 flex items-center gap-3 rounded-xl bg-bg-2 p-3 text-[13px] text-ink-dim">
          <span className="inline-flex gap-1">{[0, 1, 2].map((i) => <i key={i} className="size-1.5 animate-pulse rounded-full bg-bronze" style={{ animationDelay: `${i * 0.2}s` }} />)}</span>
          {t("輪到 {name}（{group}・{side}）發言…", { name: speaker(room.turn.memberId)?.isMe ? t("你（示範）") : speaker(room.turn.memberId)?.name ?? "?", group: (room.turn.side === "a" ? ga : gb).label, side: t(SIDE_NAME[room.turn.side]) })}
          {api.dev && teacher && !over && <Button variant="outline" size="sm" className="ml-auto" onClick={async () => { await api.dev!.simulateRoom(room.id); invalidate(); }}>{t("模擬完這場")}</Button>}
        </div>
      )}
      {room.status === "finished" && <div className="m-3.5 mt-0 rounded-xl bg-bg-2 p-3 text-[13px] text-ink-dim">{t("這場比賽已結束。")}{teacher && !over && rooms.every((r) => r.status === "finished") ? t("全部場次結束，可以「結束活動並結算」。") : ""}</div>}
    </Panel>
  );
  return <StageLayout leftLabel={t("場次與裁判")} left={left} rightLabel={t("比賽")} right={right} />;
}



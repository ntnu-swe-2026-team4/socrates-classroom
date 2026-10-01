import { useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { api, type Activity, type Group, type Judgment, type Room, type Turn } from "@/api";
import { keys, useArguments, useGroups, useMembers, usePositions, useRooms, useScores, useStar } from "@/api/queries";
import { StarMap } from "@/components/star/StarMap";
import { Badge } from "@/components/ui/badge";
import { CardTitle } from "@/components/ui/card";
import { CRITERIA, PHASE_NAME, SIDE_NAME, STATUS_NAME, avgScores, fmt, groupColor } from "@/lib/debate";
import { cn } from "@/lib/utils";
import { Bar, ModeTabs, Section, StageLayout } from "./shared";

type RoomData = { room: Room; turns: Turn[]; judgments: Judgment[] };
const eff = (j: Judgment) => avgScores([j]).overall;

function GroupSummaries({ a, groups, myId }: { a: Activity; groups: Group[]; myId?: string }) {
  return (
    <Section>
      <CardTitle>論點總結 <span className="font-sans text-xs font-normal text-ink-faint">各組在階段 2 練出來的主張，以及支持它的理由與證據</span></CardTitle>
      <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">{groups.map((g, i) => <GroupSummary key={g.id} groupId={g.id} label={g.label} count={g.memberIds.length} color={groupColor(i)} mine={!!myId && g.memberIds.includes(myId)} />)}</div>
      <span className="hidden">{a.id}</span>
    </Section>
  );
}
function GroupSummary({ groupId, label, count, color, mine }: { groupId: string; label: string; count: number; color: string; mine: boolean }) {
  const { data: args = [] } = useArguments(groupId);
  return (
    <div className={cn("rounded-2xl border border-line border-t-[3px] p-3.5", mine ? "bg-bg-2" : "bg-bg-1")} style={{ borderTopColor: color }}>
      <div className="mb-2.5 flex items-center gap-2 text-sm"><i className="size-2.5 rounded-full" style={{ background: color }} /><b className="font-serif">{label}</b><span className="ml-auto text-[11px] text-ink-faint">{count || ""}{count ? " 人" : ""}{mine ? " · 你的組別" : ""}</span></div>
      {args.filter((x) => x.kind === "claim").map((c) => (
        <div key={c.id} className={cn("mb-3", c.status === "dropped" && "opacity-50")}>
          <Badge tone={c.status === "active" ? "olive" : c.status === "revised" ? "bronze" : c.status === "contested" ? "wine" : "neutral"}>{STATUS_NAME[c.status]}</Badge>
          <p className="mt-1 font-serif text-[13.5px] leading-relaxed">{c.text}</p>
          {args.filter((k) => k.parentId === c.id).map((k) => <p key={k.id} className="mt-1 border-l-2 border-line-strong pl-2.5 text-[12.5px] text-ink-dim"><em className="mr-2 text-[10px] not-italic text-ink-faint">{k.kind === "reason" ? "理由" : "證據"}</em>{k.text}</p>)}
        </div>
      ))}
    </div>
  );
}

export function ResultsStage({ a, teacher }: { a: Activity; teacher: boolean }) {
  const qc = useQueryClient();
  const { data: members = [] } = useMembers(a.id);
  const { data: groups = [] } = useGroups(a.id);
  const { data: rooms = [] } = useRooms(a.id);
  const { data: scores = [] } = useScores(a.id);
  const { data: star } = useStar(a.id, "done");
  const { data: positions = [] } = usePositions(a.id);
  const roomData = useQueries({ queries: rooms.map((r) => ({ queryKey: keys.turns(r.id), queryFn: () => api.listTurns(r.id) })) })
    .map((q, i): RoomData => ({ room: rooms[i], turns: q.data?.turns ?? [], judgments: q.data?.judgments ?? [] }));
  const me = members.find((m) => m.isMe);
  const myGroup = me ? groups.find((g) => g.memberIds.includes(me.id)) : undefined;
  const tabs: [string, string][] = teacher ? [["star", "立場星圖"], ["class", "班級報告"], ["student", "學生報告"], ["score", "計分"], ["dash", "儀表板"]] : [["star", "立場星圖"], ["student", "我的報告"], ["score", "我的分數"]];
  const [tab, setTab] = useState("star");
  const [sid, setSid] = useState<string | null>(null);
  const allJ = roomData.flatMap((r) => r.judgments);
  const groupIdx = (id: string) => groups.findIndex((g) => g.id === id);
  const refresh = () => { for (const r of rooms) qc.invalidateQueries({ queryKey: keys.turns(r.id) }); qc.invalidateQueries({ queryKey: keys.scores(a.id) }); };
  const myRow = scores.find((s) => s.memberId === me?.id);

  const left = teacher ? (
    <Section>
      <CardTitle>活動結束</CardTitle>
      <div className="grid grid-cols-2 gap-2">
        {[[members.length, "成員"], [groups.length, "組別"], [rooms.length, "場次"], [fmt(avgScores(allJ).overall), "平均論證分"]].map(([v, n]) => <div key={String(n)} className="rounded-xl border border-line bg-bg-2 p-2.5"><b className="block font-serif text-xl font-medium text-bronze">{v}</b><span className="text-[11.5px] text-ink-faint">{n}</span></div>)}
      </div>
      <p className="mt-3 text-[12.5px] text-ink-faint">計分看<b className="text-ink-dim">過程與論證品質</b>，不看立場是否「正確」。</p>
    </Section>
  ) : (
    <Section>
      <CardTitle>你的結果</CardTitle>
      <div className="mb-2 flex items-baseline gap-2"><b className="font-serif text-4xl font-medium text-bronze">{myRow?.total ?? "—"}</b><span className="text-xs text-ink-faint">總分</span></div>
      {myRow && <div className="flex gap-3.5 text-[12.5px] text-ink-dim"><span>個人 <b className="text-ink">{myRow.individual}</b></span><span>團隊 <b className="text-ink">{myRow.team}</b></span><span>辯論 <b className="text-ink">{myRow.debate}</b></span></div>}
      {myGroup && <p className="mt-2 text-xs text-ink-faint"><i className="mr-1.5 inline-block size-2.5 rounded-full align-middle" style={{ background: groupColor(groupIdx(myGroup.id)) }} />{myGroup.label}</p>}
      <p className="mt-2 text-[12.5px] text-ink-faint">計分看<b className="text-ink-dim">過程與論證品質</b>，不看立場是否「正確」。</p>
    </Section>
  );

  /* ---- 各分頁 ---- */
  const starTab = (
    <div>
      <Section>
        <p className="text-xs text-bronze">立場星圖</p><h3 className="mb-1 font-serif text-xl">這場辯論裡，大家的立場</h3>
        <p className="mb-3 text-[12.5px] leading-relaxed text-ink-dim">每一點是一位同學，圓環標記的是你，顏色是辯論時的組別。拖動下方時間軸，看立場從個人調查到團隊提純之後的變化（第二步為依組內投票推估的示範值）。</p>
        {star && <StarMap data={star} />}
      </Section>
      <GroupSummaries a={a} groups={groups} myId={me?.id} />
    </div>
  );

  const roomSideAvg = (rd: RoomData, side: "a" | "b") => avgScores(rd.judgments.filter((j) => j.side === side));
  const sorted = [...allJ].sort((x, y) => (eff(y) ?? 0) - (eff(x) ?? 0));
  const review = [...sorted.slice(0, 4), ...sorted.slice(-4)].filter((j, i, arr) => arr.indexOf(j) === i);
  const turnOf = (j: Judgment) => roomData.flatMap((r) => r.turns).find((t) => t.id === j.turnId);
  const classTab = (
    <div>
      <Section>
        <CardTitle>各場辯論的論證品質</CardTitle>
        {roomData.map((rd) => (
          <div key={rd.room.id} className="mb-4 last:mb-0">
            <div className="mb-2 font-serif text-[13px]">{groups.find((g) => g.id === rd.room.groupA)?.label} <em className="mx-1.5 text-[11px] not-italic text-ink-faint">vs</em> {groups.find((g) => g.id === rd.room.groupB)?.label}</div>
            <div className="grid grid-cols-2 gap-4">
              {(["a", "b"] as const).map((side) => {
                const s = roomSideAvg(rd, side);
                return (
                  <div key={side} className="border-t-[3px] pt-2" style={{ borderTopColor: groupColor(groupIdx(side === "a" ? rd.room.groupA : rd.room.groupB)) }}>
                    <div className="mb-1 flex text-xs">{SIDE_NAME[side]}<b className="ml-auto font-serif text-lg">{fmt(s.overall)}</b></div>
                    {CRITERIA.map((c) => <div key={c.key} className="mt-1.5 grid grid-cols-[3.6em_1fr_2em] items-center gap-1.5 text-[11.5px] text-ink-dim"><span>{c.name}</span><Bar value={s[c.key]} /><em className="text-right not-italic text-ink-faint">{fmt(s[c.key])}</em></div>)}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </Section>
      <Section>
        <CardTitle>評分複核 <span className="font-sans text-xs font-normal text-ink-faint">最高與最低的發言。老師可以覆寫，計分以覆寫值為準</span></CardTitle>
        {review.map((j) => {
          const t = turnOf(j);
          const who = members.find((m) => m.id === j.memberId);
          if (!t) return null;
          return (
            <div key={j.id} className="border-t border-line py-3 first:border-t-0">
              <div className="flex items-baseline gap-2.5 text-[12.5px]"><b>{who?.name}</b><span className="text-[11.5px] text-ink-faint">{PHASE_NAME[j.phase]}</span><span className="ml-auto font-serif text-base text-bronze">{fmt(eff(j))}</span></div>
              <p className="my-1.5 font-serif text-[13px] leading-relaxed">{t.text}</p>
              <small className="block text-[11.5px] leading-relaxed text-ink-faint">{CRITERIA.filter((c) => j.notes[c.key]).map((c) => `${c.name}：${j.notes[c.key]}`).join(" · ")}</small>
              <label className="mt-2 flex items-center gap-2 text-xs text-ink-dim">覆寫整體分
                <select value={j.teacherScore ?? ""} onChange={(e) => { void api.overrideJudgment(j.id, e.target.value === "" ? null : Number(e.target.value)).then(refresh); }} className="rounded-lg border border-line-strong bg-bg-2 px-2 py-0.5 text-ink">
                  <option value="">沿用 AI</option>{[0, 1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                </select>
              </label>
            </div>
          );
        })}
        {!review.length && <p className="text-sm text-ink-faint">沒有可複核的發言。</p>}
      </Section>
    </div>
  );

  const who = teacher ? members.find((m) => m.id === (sid ?? members[0]?.id)) : me;
  const pos = positions.find((p) => p.memberId === who?.id);
  const coords = pos?.coords ?? null;
  const grp = groups.find((g) => g.memberIds.includes(who?.id ?? ""));
  const myJ = allJ.filter((j) => j.memberId === who?.id);
  const avg = avgScores(myJ);
  const weakest = CRITERIA.filter((c) => avg[c.key] !== null).sort((x, y) => avg[x.key]! - avg[y.key]!)[0];
  const TIPS = { evidence: "下次發言時，多補一個具體的例子或資料出處，讓別人可以查核。", reasoning: "試著把「因為…所以…」講完整，讓從證據到結論的每一步都看得見。", rebuttal: "先引用對方剛才說的重點，再說明你為什麼不同意，而不是只重複自己的立場。", clarity: "每一則發言把重點收斂成 2–3 句，比較容易被聽懂。" };
  const studentTab = (
    <div>
      {teacher && <Section><label className="flex items-center gap-2.5 text-[13px] text-ink-dim">查看學生 <select value={who?.id} onChange={(e) => setSid(e.target.value)} className="rounded-lg border border-line-strong bg-bg-2 px-2 py-1 text-ink">{members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.id === "you" ? "（學生模式的你）" : ""}</option>)}</select></label></Section>}
      <div className="grid gap-4 lg:grid-cols-[1.25fr_1fr]">
        <div>
          <Section><CardTitle>{who?.isMe ? "我" : who?.name}的座標與論點</CardTitle>
            {pos && who ? (
              <div className="space-y-2.5">
                {coords && star?.axes.map((ax, i) => <div key={ax.key} className="grid grid-cols-[5em_1fr_3em] items-center gap-2 text-[13px]"><b className="text-bronze">{ax.name}</b><span className="flex justify-between text-[11px] text-ink-faint"><span>{ax.left}</span><span>{ax.right}</span></span><span className="text-right text-xs text-ink-dim">{coords[i] >= 0 ? "+" : "−"}{Math.abs(coords[i]).toFixed(2)}</span></div>)}
                {(["claim", "reason", "evidence"] as const).map((k) => <div key={k}><small className="text-[11px] text-ink-faint">{{ claim: "主張", reason: "理由", evidence: "證據或例子" }[k]}</small><p className="font-serif text-sm leading-relaxed">{pos.summary[k] || "—"}</p></div>)}
                {!pos.confirmed && <p className="text-xs text-ink-faint">這份座標是 AI 依對話估計的，本人沒有確認。</p>}
              </div>
            ) : <p className="text-sm text-ink-faint">沒有紀錄。</p>}
          </Section>
          <Section><CardTitle>辯論發言</CardTitle>
            {myJ.map((j) => { const t = turnOf(j); return t && (
              <div key={j.id} className="border-t border-line py-2.5 first:border-t-0"><div className="flex text-xs"><span className="text-ink-faint">{PHASE_NAME[j.phase]}</span><b className="ml-auto font-serif text-base text-bronze">{fmt(eff(j))}</b></div>
                <p className="my-1 font-serif text-[13px] leading-relaxed">{t.text}</p>
                <small className="text-[11.5px] leading-relaxed text-ink-faint">{CRITERIA.map((c) => `${c.name} ${(j.scores[c.key] === null ? "—" : j.teacherScore ?? j.scores[c.key])}`).join(" · ")}</small></div>); })}
            {!myJ.length && <p className="text-sm text-ink-faint">這位同學沒有上場發言。</p>}
          </Section>
        </div>
        <div>
          <Section><CardTitle>組別</CardTitle>{grp ? <p className="text-sm"><i className="mr-1.5 inline-block size-2.5 rounded-full align-middle" style={{ background: groupColor(groupIdx(grp.id)) }} /><b>{grp.label}</b></p> : <p className="text-sm text-ink-faint">觀察員</p>}</Section>
          <Section><CardTitle>給下一次的建議</CardTitle><p className="text-sm leading-relaxed">{weakest ? TIPS[weakest.key] : "這次沒有上場發言。下一次可以主動接下一則發言，練習把想法講給別人聽。"}</p></Section>
        </div>
      </div>
    </div>
  );

  const scoreTab = (
    <Section>
      <CardTitle>計分</CardTitle>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] border-collapse text-[13px]">
          <thead><tr className="text-left text-[11.5px] text-ink-faint">{["成員", "個人", "團隊", "辯論", "老師調整", "總分"].map((h) => <th key={h} className="border-b border-line-strong p-2.5 font-medium">{h}</th>)}</tr></thead>
          <tbody>
            {scores.map((s) => (
              <tr key={s.memberId} className={s.memberId === me?.id ? "bg-bronze-soft" : ""}>
                <td className="border-b border-line p-2.5">{s.memberName}</td><td className="border-b border-line p-2.5">{s.individual}</td><td className="border-b border-line p-2.5">{s.team}</td><td className="border-b border-line p-2.5">{s.debate}</td>
                <td className="border-b border-line p-2.5">{teacher ? <input type="number" min={-20} max={20} defaultValue={s.adjust} onBlur={(e) => { void api.adjustScore(a.id, s.memberId, Number(e.target.value) || 0).then(refresh); }} className="w-16 rounded-lg border border-line-strong bg-bg-2 px-2 py-1" /> : s.adjust}</td>
                <td className="border-b border-line p-2.5"><b className="font-serif text-[15px] text-bronze">{s.total}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="mt-4 list-disc space-y-1 pl-5 text-xs leading-relaxed text-ink-faint">
        <li><b className="text-ink-dim">個人</b>：完成調查並確認座標、論點總結的完整度</li>
        <li><b className="text-ink-dim">團隊</b>：組內發言與投票的參與、組內論點被保留</li>
        <li><b className="text-ink-dim">辯論</b>：自己發言的論證品質（證據、推理、回應、表達）；沒上場的人用該方平均打八折</li>
        <li>沒有任何一項看立場是否「正確」。權重由後端設定。</li>
      </ul>
    </Section>
  );

  const dashTab = (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section><CardTitle>各階段完成度</CardTitle>
        {[["個人調查", members.filter((m) => m.individual?.status === "confirmed").length, members.length], ["分組", groups.reduce((n, g) => n + g.memberIds.length, 0), members.length], ["辯論賽", rooms.filter((r) => r.status === "finished").length, rooms.length]].map(([n, x, y]) => (
          <div key={String(n)} className="grid grid-cols-[6em_1fr_auto] items-center gap-3 py-2 text-[13px]"><span>{n}</span><span className="h-2 overflow-hidden rounded bg-bg-3"><i className="block h-full bg-bronze" style={{ width: `${Number(y) ? (Number(x) / Number(y)) * 100 : 0}%` }} /></span><em className="not-italic text-xs text-ink-faint">{x} / {y}</em></div>
        ))}
      </Section>
      <Section><CardTitle>需要留意</CardTitle>
        <p className="text-sm">{allJ.length ? `${allJ.filter((j) => j.verifiability === "unverified").length} / ${allJ.length} 則發言沒有提供例子或出處。` : "沒有發言。"}</p>
        <p className="mt-2 text-xs text-ink-faint">裁判無法查證事實，只標記「有沒有提供出處或例子」。模型用量與花費等資訊，等後端提供後再顯示。</p>
      </Section>
    </div>
  );

  const body = { star: starTab, class: classTab, student: studentTab, score: scoreTab, dash: dashTab }[tab];
  const right = <div className="min-h-0 flex-1 overflow-y-auto">{body}</div>;
  return (
    <StageLayout leftLabel={teacher ? "活動總覽" : "你的結果"} left={left}
      rightLabel={tabs.find(([k]) => k === tab)?.[1] ?? "報告"} rightHeader={<div className="no-scrollbar overflow-x-auto"><ModeTabs items={tabs} value={tab} onChange={setTab} /></div>} right={right} />
  );
}

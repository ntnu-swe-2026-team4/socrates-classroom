import { useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQueries } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { api, type Stage } from "@/api";
import { keys, useArchives, useClassrooms, useMe } from "@/api/queries";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { STAGE_NAME } from "./ClassroomPage";

const QUOTES: [string, string][] = [["未經審視的人生，不值得活。", "蘇格拉底"], ["我唯一知道的，就是我一無所知。", "蘇格拉底"]];
const SUGGESTIONS = ["努力就一定會有回報嗎？", "自由的界線在哪裡？", "朋友犯錯，我該不該檢舉？"];
const TONE: Record<Stage, "bronze" | "olive" | "wine" | "neutral"> = { individual: "bronze", team: "olive", debate: "wine", done: "neutral" };

function greeting() {
  const h = new Date().getHours();
  return h < 5 ? "夜深了" : h < 11 ? "早安" : h < 14 ? "午安" : h < 18 ? "午後好" : "晚安";
}

export function HomePage() {
  const { data: me } = useMe();
  const { data: archives = [] } = useArchives();
  const { data: classrooms = [] } = useClassrooms();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const teacher = me?.role === "teacher";

  const mine = teacher ? classrooms : classrooms.filter((c) => c.joined);
  const invites = teacher ? [] : classrooms.filter((c) => !c.joined);
  const students = classrooms.reduce((n, c) => n + c.studentCount, 0);
  const summaryCount = archives.filter((a) => a.inSummary).length;
  const last = archives[0];
  const quote = QUOTES[new Date().getDate() % QUOTES.length];
  const chips = [...archives.slice(0, 2).map((a) => a.title), ...SUGGESTIONS].slice(0, 4);

  // 老師：各教室的平均完成度；學生：已加入教室裡的辯論
  const memberQs = useQueries({ queries: (teacher ? mine : []).map((c) => ({ queryKey: keys.classroomMembers(c.id), queryFn: () => api.listClassroomMembers(c.id) })) });
  const activityQs = useQueries({ queries: (teacher ? [] : mine).map((c) => ({ queryKey: keys.activities(c.id), queryFn: () => api.listActivities(c.id) })) });
  const debates = mine.flatMap((c, i) => (activityQs[i]?.data ?? []).map((d) => ({ c, d })));

  async function ask(title: string) {
    const t = title.trim();
    if (!t) return;
    const a = await api.createArchive(t);
    navigate({ to: "/dialogue", search: { topic: a.id } });
  }

  const stats = [
    { to: "/topics" as const, num: archives.length, label: "完成的對話", sub: "存在「議題」" },
    { to: "/summary" as const, num: summaryCount, label: "論點總結", sub: summaryCount ? "點開看整理" : "尚未加入" },
    { to: "/classrooms" as const, num: mine.length, label: teacher ? "我的教室" : "已加入的教室", sub: teacher ? `共 ${students} 位學生` : invites.length ? `${invites.length} 個待處理邀請` : "" },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-8">
      <Card className="grid gap-8 bg-gradient-to-br from-bronze-soft to-transparent p-8 md:grid-cols-[1fr_260px]">
        <div>
          <p className="text-xs text-bronze">{greeting()}，{me?.name}</p>
          <h2 className="mt-1 font-serif text-3xl">今天，想追問什麼問題？</h2>
          <div className="mt-4 flex gap-2.5">
            <Input placeholder="輸入一個你想想清楚的問題，按 Enter 開始…" maxLength={120} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && void ask(q)} />
            <Button className="h-10" onClick={() => void ask(q)}>開始對話</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {chips.map((t) => <button key={t} type="button" onClick={() => void ask(t)} className="cursor-pointer rounded-full border border-line-strong px-4 py-1.5 text-[13px] text-ink-dim hover:border-bronze hover:text-ink">{t}</button>)}
          </div>
        </div>
        <blockquote className="flex flex-col justify-center gap-3 border-line pl-8 max-md:hidden md:border-l">
          <span className="flex size-9 items-center justify-center rounded-full border border-bronze font-serif text-bronze">Σ</span>
          <p className="font-serif text-lg leading-relaxed">「{quote[0]}」</p>
          <cite className="text-xs not-italic text-ink-faint">— {quote[1]}</cite>
        </blockquote>
      </Card>

      {last && (
        <Link to="/dialogue" search={{ topic: last.id }} className="block">
          <Card className="flex items-center gap-4 py-4 transition-colors hover:border-bronze-dim">
            <span className="flex size-11 items-center justify-center rounded-full bg-bronze-soft text-bronze"><MessageSquare className="size-5" /></span>
            <span className="min-w-0 flex-1"><small className="block text-xs text-ink-faint">接續上次的對話</small><b className="block truncate font-serif text-base font-medium">{last.title}</b><em className="text-xs not-italic text-ink-faint">{last.rounds} 輪 · {last.date}</em></span>
            <span className="text-sm text-bronze">繼續 →</span>
          </Card>
        </Link>
      )}

      <section className="grid gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <Link key={s.label} to={s.to}>
            <Card className="h-full transition-colors hover:border-bronze-dim">
              <b className="block font-serif text-4xl font-medium text-bronze">{s.num}</b>
              <span className="mt-1 block text-sm">{s.label}</span>
              <span className="text-xs text-ink-faint">{s.sub}</span>
            </Card>
          </Link>
        ))}
      </section>

      <section className="grid gap-5 md:grid-cols-2">
        <Card>
          <div className="mb-2 flex items-center justify-between"><h3 className="font-serif text-[15.5px]">最近的議題</h3><Link to="/topics" className="text-xs text-bronze">全部議題 →</Link></div>
          {archives.map((a) => (
            <Link key={a.id} to="/topics" className="flex items-center justify-between border-t border-line py-3 first:border-t-0">
              <span><span className="block text-sm">{a.title}</span><span className="text-xs text-ink-faint">{a.date} · {a.rounds} 輪對話</span></span>
              <span className="text-ink-faint">›</span>
            </Link>
          ))}
        </Card>

        <Card>
          <div className="mb-2 flex items-center justify-between"><h3 className="font-serif text-[15.5px]">{teacher ? "教室概況" : "教室動態"}</h3><Link to="/classrooms" className="text-xs text-bronze">{teacher ? "全部教室 →" : "前往教室 →"}</Link></div>
          {teacher ? (
            <>
              {mine.map((c, i) => {
                const ms = memberQs[i]?.data ?? [];
                const avg = ms.length ? Math.round(ms.reduce((s, m) => s + m.progress, 0) / ms.length) : 0;
                return (
                  <Link key={c.id} to="/classrooms/$classroomId" params={{ classroomId: c.id }} className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0">
                    <span><span className="block text-sm">{c.name}</span><span className="text-xs text-ink-faint">{c.studentCount} 位學生 · {c.debateCount} 場辯論</span></span>
                    <span className="flex items-center gap-2 text-xs text-ink-dim"><span className="h-1.5 w-20 overflow-hidden rounded bg-bg-3"><i className="block h-full bg-bronze" style={{ width: `${avg}%` }} /></span>{avg}%</span>
                  </Link>
                );
              })}
              {!mine.length && <p className="text-sm text-ink-faint">還沒有教室。到「教室」頁建立第一個吧。</p>}
            </>
          ) : (
            <>
              {invites.map((c) => (
                <Link key={c.id} to="/classrooms" className="flex items-center justify-between border-t border-line py-3 first:border-t-0">
                  <span><span className="block text-sm">{c.name}</span><span className="text-xs text-ink-faint">{c.teacherName} 邀請你加入</span></span><Badge tone="bronze">邀請</Badge>
                </Link>
              ))}
              {debates.map(({ c, d }) => (
                <Link key={d.id} to="/classrooms/$classroomId/activities/$activityId" params={{ classroomId: c.id, activityId: d.id }} className="flex items-center justify-between gap-3 border-t border-line py-3 first:border-t-0">
                  <span><span className="block text-sm">{d.statement}</span><span className="text-xs text-ink-faint">{c.name} · 辯論</span></span><Badge tone={TONE[d.stage]}>{STAGE_NAME[d.stage]}</Badge>
                </Link>
              ))}
              {!invites.length && !debates.length && <p className="text-sm text-ink-faint">老師發起辯論後，會出現在這裡。</p>}
            </>
          )}
        </Card>
      </section>
    </div>
  );
}

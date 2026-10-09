import { useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ArrowRight, FileCheck2, Globe, Lock } from "lucide-react";
import { useArchives, useUpdateArchive } from "@/api/queries";
import type { Archive, BankKind } from "@/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" aria-pressed={on} onClick={onClick}
      className={cn("inline-flex cursor-pointer items-center gap-2 rounded-full border px-5 py-2.5 text-[13.5px] transition-colors",
        on ? "border-bronze bg-bronze font-semibold text-[#221a0c]" : "border-line-strong bg-bg-2 text-ink-dim hover:border-bronze-dim hover:text-ink")}>
      {children}
    </button>
  );
}

export function TopicsPage() {
  const { data: archives = [] } = useArchives();
  const update = useUpdateArchive();
  const navigate = useNavigate();
  const [q, setQ] = useState("");
  const [picked, setPicked] = useState<string | null>(null);

  const list = useMemo(() => archives.filter((a) => (a.title + a.snippet).toLowerCase().includes(q.trim().toLowerCase())), [archives, q]);
  const sel: Archive | undefined = list.find((a) => a.id === picked) ?? list[0];

  const setBank = (a: Archive, kind: BankKind) => update.mutate({ id: a.id, bank: a.bank === kind ? null : kind });

  return (
    <div className="grid h-full grid-cols-[minmax(300px,360px)_1fr] max-md:grid-cols-1">
      <aside className="flex min-h-0 flex-col border-r border-line bg-bg-1">
        <div className="border-b border-line p-4"><Input placeholder="搜尋議題標題或內容…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <div className="flex-1 space-y-1 overflow-y-auto p-2.5">
          {list.map((a, i) => (
            <button key={a.id} type="button" onClick={() => setPicked(a.id)}
              className={cn("flex w-full cursor-pointer items-start gap-3 rounded-xl border p-3 text-left", sel?.id === a.id ? "border-bronze-dim bg-bronze-soft" : "border-transparent hover:bg-bg-2")}>
              <span className="mt-0.5 rounded-full bg-bg-2 px-2 py-0.5 font-serif text-[11px] text-ink-faint">#{i + 1}</span>
              <span className="min-w-0 flex-1"><b className="line-clamp-2 font-serif text-[14.5px] font-medium">{a.title}</b><small className="text-[11.5px] text-ink-faint">{a.date} · {a.rounds} 輪</small></span>
              <span className="flex gap-1">{a.bank && <Badge>{a.bank === "private" ? "私" : "公"}</Badge>}{a.inSummary && <Badge>總</Badge>}</span>
            </button>
          ))}
          {!list.length && <p className="p-3 text-sm text-ink-faint">沒有符合的議題。</p>}
        </div>
      </aside>
      <section className="overflow-y-auto p-9">
        {sel ? (
          <article className="mx-auto max-w-2xl rounded-3xl border border-line bg-bg-1 p-8">
            <div className="flex items-start justify-between gap-5">
              <div>
                <h3 className="font-serif text-2xl leading-snug">{sel.title}</h3>
                <div className="mt-3 flex gap-2"><Badge>{sel.date}</Badge><Badge>{sel.rounds} 輪對話</Badge>{sel.activityId && <Badge tone="olive">辯論活動</Badge>}</div>
              </div>
              <Button size="sm" onClick={() => navigate(sel.activityId ? { to: "/classrooms" } : { to: "/dialogue", search: { topic: sel.id } })}>繼續對話 <ArrowRight className="size-3.5" /></Button>
            </div>
            <p className="my-6 border-l-2 border-bronze-dim pl-4 font-serif text-[15.5px] leading-8 text-ink-dim">{sel.snippet}</p>
            <div className="mb-2.5 text-xs tracking-wider text-ink-faint">歸類到</div>
            <div className="flex flex-wrap gap-2.5">
              <Chip on={sel.bank === "private"} onClick={() => setBank(sel, "private")}><Lock className="size-4" />私人</Chip>
              <Chip on={sel.bank === "public"} onClick={() => setBank(sel, "public")}><Globe className="size-4" />公開</Chip>
              <Chip on={sel.inSummary} onClick={() => update.mutate({ id: sel.id, inSummary: !sel.inSummary })}><FileCheck2 className="size-4" />論點總結</Chip>
            </div>
            <p className="mt-3.5 text-xs leading-relaxed text-ink-faint">私人與公開題庫只能擇一；論點總結是另外獨立的，加入後會出現在「論點總結」頁。</p>
          </article>
        ) : <p className="text-ink-faint">從左邊選一個議題。</p>}
      </section>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Hourglass } from "lucide-react";
import type { Activity } from "@/api";
import { useActivityControls, useMembers, useSetReady } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MINUTES = [5, 10, 15, 20, 30];

function useNow(active: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

/** 階段倒數：到時間只提醒，由老師決定何時推進 */
function Countdown({ deadline }: { deadline: string }) {
  const now = useNow(true);
  const left = Math.max(0, new Date(deadline).getTime() - now);
  const mm = Math.floor(left / 60000);
  const ss = Math.floor((left % 60000) / 1000);
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-[13px]", left === 0 ? "text-wine" : left < 60000 ? "text-bronze" : "text-ink")}>
      <Hourglass className="size-3.5" />{left === 0 ? "時間到" : `${mm}:${String(ss).padStart(2, "0")}`}
    </span>
  );
}

/**
 * 進度列下方的控制：
 * 老師 — 限時、看幾個人準備好了、直接結束活動；學生 — 看倒數、回報「我準備好了」。
 */
export function StageControls({ a, teacher }: { a: Activity; teacher: boolean }) {
  const { data: members = [] } = useMembers(a.id);
  const { finish, deadline } = useActivityControls(a.id);
  const setReady = useSetReady(a.id);
  const [confirmFinish, setConfirmFinish] = useState(false);
  if (a.stage === "done") return null;

  const askReady = a.stage === "individual" || a.stage === "team";
  const readyCount = members.filter((m) => m.ready).length;
  const me = members.find((m) => m.isMe);
  const error = finish.error ?? deadline.error ?? setReady.error;

  return (
    <div className="mt-3 space-y-2 border-t border-line pt-3 text-[12.5px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {a.stageDeadline ? <Countdown deadline={a.stageDeadline} /> : <span className="text-ink-faint">這個階段不限時</span>}
        {teacher && (a.stageDeadline
          ? <button type="button" onClick={() => deadline.mutate(null)} className="cursor-pointer text-xs text-ink-faint hover:text-ink">取消限時</button>
          : (
            <select value="" disabled={deadline.isPending} aria-label="設定這個階段的時間限制"
              onChange={(e) => e.target.value && deadline.mutate(new Date(Date.now() + Number(e.target.value) * 60000).toISOString())}
              className="h-7 cursor-pointer rounded-full border border-line-strong bg-bg-2 px-2.5 text-xs text-ink-dim outline-none focus:border-bronze">
              <option value="">限時…</option>
              {MINUTES.map((m) => <option key={m} value={m}>{m} 分鐘</option>)}
            </select>
          ))}
      </div>
      {askReady && (teacher
        ? <p className="text-ink-dim">已準備好 <b className="text-ink">{readyCount}</b> / {members.length} 人</p>
        : me && (
          <Button size="sm" variant={me.ready ? "outline" : "default"} className="w-full" disabled={setReady.isPending} onClick={() => setReady.mutate(!me.ready)}>
            {me.ready ? "已回報準備好了（按這裡取消）" : "我準備好了"}
          </Button>
        ))}
      {teacher && a.stage !== "debate" && (confirmFinish ? (
        <div className="rounded-xl bg-wine-soft px-3 py-2.5">
          <p className="mb-2 text-wine">直接結束活動？會跳過剩下的階段，用目前的資料結算成績。</p>
          <span className="flex gap-2"><Button size="sm" variant="danger" className="bg-bg-1" disabled={finish.isPending} onClick={() => finish.mutate(undefined, { onSuccess: () => setConfirmFinish(false) })}>確定結束</Button><Button size="sm" variant="ghost" onClick={() => setConfirmFinish(false)}>取消</Button></span>
        </div>
      ) : <button type="button" onClick={() => setConfirmFinish(true)} className="cursor-pointer text-xs text-ink-faint hover:text-wine">直接結束活動…</button>)}
      {error && <p className="text-wine">{error.message}</p>}
    </div>
  );
}

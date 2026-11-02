import { useEffect, useRef, useState } from "react";
import { Hourglass, MoreHorizontal } from "lucide-react";
import { api, type Activity, type Stage } from "@/api";
import { useActivityControls, useAdvanceActivity, useMembers, useSetReady } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import { STAGE_NAME } from "./ClassroomPage";

export const STAGE_ORDER: Stage[] = ["individual", "team", "debate", "done"];
const MINUTES = [5, 10, 15, 20, 30];

/** 階段倒數：到時間只提醒，由老師決定何時推進 */
function Countdown({ deadline }: { deadline: string }) {
  const t = useT();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(id); }, []);
  const left = Math.max(0, new Date(deadline).getTime() - now);
  const mm = Math.floor(left / 60000), ss = Math.floor((left % 60000) / 1000);
  return (
    <span title={t("這個階段的剩餘時間")} className={cn("inline-flex items-center gap-1 font-mono text-[13px]", left === 0 ? "text-wine" : left < 60000 ? "text-bronze" : "text-ink-dim")}>
      <Hourglass className="size-3.5" />{left === 0 ? t("時間到") : `${mm}:${String(ss).padStart(2, "0")}`}
    </span>
  );
}

/** 老師的「⋯」選單：限時、取消限時、直接結束活動 */
function TeacherMenu({ a }: { a: Activity }) {
  const t = useT();
  const { finish, deadline } = useActivityControls(a.id);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) { setOpen(false); setConfirming(false); } };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const item = "block w-full cursor-pointer rounded-lg px-3 py-1.5 text-left text-[13px] text-ink-dim hover:bg-bg-2 hover:text-ink";
  const error = finish.error ?? deadline.error;
  return (
    <div ref={box} className="relative">
      <Button variant="ghost" size="icon" className="size-8" aria-label={t("更多活動設定")} aria-expanded={open} onClick={() => setOpen((v) => !v)}><MoreHorizontal className="size-4" /></Button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-1 w-56 rounded-2xl border border-line-strong bg-bg-1 p-1.5 shadow-xl">
          {a.stageDeadline
            ? <button type="button" className={item} onClick={() => deadline.mutate(null, { onSuccess: () => setOpen(false) })}>{t("取消這個階段的限時")}</button>
            : (
              <>
                <p className="px-3 pt-1 pb-0.5 text-[11px] text-ink-faint">{t("這個階段限時")}</p>
                <div className="flex flex-wrap gap-1 px-2 pb-1.5">
                  {MINUTES.map((m) => <button key={m} type="button" className="cursor-pointer rounded-full border border-line-strong px-2.5 py-0.5 text-xs text-ink-dim hover:border-bronze hover:text-bronze"
                    onClick={() => deadline.mutate(new Date(Date.now() + m * 60000).toISOString(), { onSuccess: () => setOpen(false) })}>{t("{n} 分", { n: m })}</button>)}
                </div>
              </>
            )}
          <div className="my-1 h-px bg-line" />
          {confirming ? (
            <div className="px-3 py-1.5 text-[12.5px]">
              <p className="mb-2 text-wine">{t("跳過剩下的階段，用目前的資料結算成績？")}</p>
              <span className="flex gap-1.5"><Button size="sm" variant="danger" disabled={finish.isPending} onClick={() => finish.mutate(undefined, { onSuccess: () => { setOpen(false); setConfirming(false); } })}>{t("確定結束")}</Button><Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>{t("取消")}</Button></span>
            </div>
          ) : <button type="button" className={cn(item, "text-wine hover:text-wine")} onClick={() => setConfirming(true)}>{t("直接結束活動…")}</button>}
          {error && <p className="px-3 py-1 text-[12px] text-wine">{error.message}</p>}
        </div>
      )}
    </div>
  );
}

/**
 * 標題列右上角：目前階段（或正在回顧的階段）、倒數、準備狀態、推進。
 * 老師的限時與直接結束收在「⋯」選單裡。
 */
export function StageStatus({ a, teacher, seeing, onBackToNow }: { a: Activity; teacher: boolean; seeing: Stage; onBackToNow: () => void }) {
  const t = useT();
  const { data: members = [] } = useMembers(a.id);
  const advance = useAdvanceActivity(a.id);
  const setReady = useSetReady(a.id);
  const cur = STAGE_ORDER.indexOf(a.stage);
  const next = STAGE_ORDER[cur + 1];
  const past = seeing !== a.stage;
  const live = a.stage !== "done";
  const askReady = a.stage === "individual" || a.stage === "team";
  const me = members.find((m) => m.isMe);
  const readyCount = members.filter((m) => m.ready).length;
  const error = advance.error ?? setReady.error;

  return (
    <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-1.5">
      {past
        ? <span className="text-[13px] text-ink-dim">{t("回顧：{stage}", { stage: t(STAGE_NAME[seeing]) })} <button type="button" onClick={onBackToNow} className="ml-1 cursor-pointer text-bronze hover:underline">{t("回到目前")}</button></span>
        : <span className="text-[13px] font-semibold text-bronze">{live ? t("階段 {n} · {stage}", { n: cur + 1, stage: t(STAGE_NAME[a.stage]) }) : t("活動已結束")}</span>}
      {live && a.stageDeadline && <Countdown deadline={a.stageDeadline} />}
      {live && askReady && (teacher
        ? <span className="text-[12.5px] text-ink-faint" title={t("回報「準備」的人數")}>{t("已準備")} <b className="text-ink">{readyCount}</b>/{members.length}</span>
        : me && <Button size="sm" variant={me.ready ? "outline" : "default"} disabled={setReady.isPending} onClick={() => setReady.mutate(!me.ready)}>{me.ready ? t("✓ 已準備") : t("準備")}</Button>)}
      {next && teacher && <Button size="sm" disabled={advance.isPending} onClick={() => advance.mutate()}>{a.stage === "debate" ? t("結束並結算") : t("進入{stage}", { stage: t(STAGE_NAME[next]) })} →</Button>}
      {next && !teacher && api.dev && <Button size="sm" variant="ghost" disabled={advance.isPending} title={t("示範用：正式使用由老師推進")} onClick={() => advance.mutate()}>{t("示範推進")} →</Button>}
      {teacher && live && <TeacherMenu a={a} />}
      {error && <p className="w-full text-right text-[12px] text-wine">{error.message}</p>}
    </div>
  );
}

/** 資訊欄裡的進度色條：依階段往前填色；點已經過的那一段可以回顧 */
export function ProgressStrip({ a, seeing, onSee }: { a: Activity; seeing: Stage; onSee: (s: Stage) => void }) {
  const t = useT();
  const cur = STAGE_ORDER.indexOf(a.stage);
  return (
    <div>
      <div className="mb-1 flex items-center justify-between gap-2 text-[11.5px] text-ink-faint">
        <span className="min-w-0 truncate">{t("階段 {n}", { n: cur + 1 })} · {t(STAGE_NAME[a.stage])}</span>
        <span className="shrink-0">{cur + 1}/{STAGE_ORDER.length}</span>
      </div>
      <DebateStrip a={a} seeing={seeing} onSee={onSee} />
    </div>
  );
}

function DebateStrip({ a, seeing, onSee }: { a: Activity; seeing: Stage; onSee: (s: Stage) => void }) {
  const t = useT();
  const cur = STAGE_ORDER.indexOf(a.stage);
  return (
    <div className="group relative flex h-4 shrink-0 items-center" role="progressbar" aria-label={t("活動進度")} aria-valuemin={1} aria-valuemax={4} aria-valuenow={cur + 1} aria-valuetext={t(STAGE_NAME[a.stage])}>
      <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-bg-3 transition-[height] group-hover:h-2.5">
        <i className="absolute inset-y-0 left-0 rounded-full bg-bronze transition-[width] duration-500" style={{ width: `${((cur + 1) / STAGE_ORDER.length) * 100}%` }} />
        {seeing !== a.stage && <i className="absolute inset-y-0 bg-white/35" style={{ left: `${(STAGE_ORDER.indexOf(seeing) / STAGE_ORDER.length) * 100}%`, width: `${100 / STAGE_ORDER.length}%` }} />}
      </div>
      {/* 點擊區比色條高，比較好點 */}
      <div className="absolute inset-0 grid grid-cols-4">
        {STAGE_ORDER.map((s, i) => (
          <button key={s} type="button" disabled={i > cur} onClick={() => onSee(s)} title={i <= cur ? t("回顧：{stage}", { stage: t(STAGE_NAME[s]) }) : t(STAGE_NAME[s])} aria-label={t(STAGE_NAME[s])}
            className={cn("h-full disabled:cursor-default", i <= cur && "cursor-pointer")} />
        ))}
      </div>
    </div>
  );
}

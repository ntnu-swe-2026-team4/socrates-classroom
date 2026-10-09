import { useEffect, useMemo, useRef, useState } from "react";
import { Maximize2, Pause, Play, RotateCcw, ChevronLeft, ChevronRight } from "lucide-react";
import type { StarData } from "@/api";
import { useTheme } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { createConstellation } from "@/lib/star/constellation";
import { alignClusters, AXIS_COLORS, CLUSTER_PALETTE, kmeans, labelCluster } from "@/lib/star/data";
import { cn } from "@/lib/utils";

const SLOTS = ["x", "y", "z"] as const;
type Slot = (typeof SLOTS)[number];
type AxisMap = Record<Slot, string | null>;

/** 立場星圖：compact = 只有 3D 畫面（放在左側資訊欄），可以按「放大」；完整版有量軸、時間軸、分群。 */
export function StarMap({ data, compact = false, className }: { data: StarData; compact?: boolean; className?: string }) {
  const { theme } = useTheme();
  const mountRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<any>(null);
  const prevCluster = useRef<any>(null);
  const [big, setBig] = useState(false);

  const keys = data.axes.map((a) => a.key);
  const [checked, setChecked] = useState<string[]>(keys.slice(0, 3));
  const [axisMap, setAxisMap] = useState<AxisMap>({ x: keys[0] ?? null, y: keys[1] ?? null, z: keys[2] ?? null });
  const [step, setStep] = useState(data.initialStep);
  const [playing, setPlaying] = useState(false);
  const [showTraj, setShowTraj] = useState(false);
  const [clusterOn, setClusterOn] = useState(!!data.groups);
  const [k, setK] = useState(4);
  const [cur, setCur] = useState<any>(null);

  const steps = data.agents[0]?.history.length ? data.agents[0].history.length - 1 : 0;
  const activeSlots = SLOTS.filter((s) => axisMap[s] && checked.includes(axisMap[s]!));
  const dim = activeSlots.length;

  const engineAgents = useMemo(
    () => data.agents.map((a) => ({ id: a.id, me: a.me, history: a.history.map((h) => Object.fromEntries(data.axes.map((ax, i) => [ax.key, h[i] ?? 0]))) })),
    [data],
  );
  const axisDefs = useMemo(
    () => Object.fromEntries(data.axes.map((a, i) => [a.key, { name: a.name, left: a.left, right: a.right, color: AXIS_COLORS[i % AXIS_COLORS.length] }])),
    [data],
  );

  // 建立 / 銷毀 three.js 場景
  useEffect(() => {
    const engine = createConstellation(mountRef.current, { light: theme === "light" });
    engineRef.current = engine;
    return () => { engine.dispose(); engineRef.current = null; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { engineRef.current?.setTheme(theme === "light"); }, [theme]);

  // 換資料：重置量軸與時間軸
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    const ks = data.axes.map((a) => a.key);
    const map: AxisMap = { x: ks[0] ?? null, y: ks[1] ?? null, z: ks[2] ?? null };
    setChecked(ks.slice(0, 3)); setAxisMap(map); setStep(data.initialStep); setClusterOn(!!data.groups); setPlaying(false);
    prevCluster.current = null;
    e.setAgents(engineAgents);
    e.setAxes(axisDefs, map);
    e.setActive(SLOTS.filter((s) => map[s]), { instant: true });
    e.setStep(data.initialStep);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  useEffect(() => { engineRef.current?.setStep(step); }, [step]);
  useEffect(() => { engineRef.current?.setTrajectories(showTraj); }, [showTraj]);
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    e.setAxes(axisDefs, axisMap);
    e.setActive(activeSlots);
    prevCluster.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [axisMap, checked]);

  // 分群：辯論分組直接用實際組別；否則跑 k-means
  useEffect(() => {
    const e = engineRef.current;
    if (!e) return;
    if (!clusterOn || dim === 0) { setCur(null); e.setCluster(null); return; }
    const pts = e.coordsAt(step);
    let next: any;
    if (data.groups) {
      const n = data.groups.labels.length;
      const centroids = Array.from({ length: n }, (_, g) => {
        const m = pts.filter((_: any, i: number) => data.groups!.assignments[i] === g);
        return [0, 1, 2].map((d) => (m.length ? m.reduce((s: number, p: number[]) => s + p[d], 0) / m.length : 0));
      });
      next = { assignments: data.groups.assignments, centroids, palette: CLUSTER_PALETTE };
    } else {
      const res = alignClusters(prevCluster.current, kmeans(pts, k, { seed: 42 + k * 17 }));
      prevCluster.current = res;
      next = { ...res, palette: CLUSTER_PALETTE };
    }
    e.setCluster(next);
    setCur(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clusterOn, k, step, axisMap, checked, data]);

  // 播放
  useEffect(() => {
    if (!playing) return;
    const t = setInterval(() => setStep((s) => { if (s >= steps) { setPlaying(false); return s; } return s + 1; }), 900);
    return () => clearInterval(t);
  }, [playing, steps]);

  function toggleAxis(key: string) {
    setPlaying(false);
    if (checked.includes(key)) return setChecked(checked.filter((c) => c !== key));
    if (checked.length === 3) {
      const oldest = checked[0];
      const slot = SLOTS.find((s) => axisMap[s] === oldest)!;
      setAxisMap({ ...axisMap, [slot]: key });
      return setChecked([...checked.slice(1), key]);
    }
    if (!Object.values(axisMap).includes(key)) {
      const slot = SLOTS.find((s) => !checked.includes(axisMap[s] as string))!;
      setAxisMap({ ...axisMap, [slot]: key });
    }
    setChecked([...checked, key]);
  }

  const me = data.agents.find((a) => a.me);
  const meVals = me ? me.history[Math.min(step, me.history.length - 1)] : null;
  const clusterLabel = (c: number[]) => {
    const axes = activeSlots.map((s) => data.axes.find((a) => a.key === axisMap[s])!);
    return labelCluster(c, axes, activeSlots.map((s) => SLOTS.indexOf(s)));
  };

  const canvas = (
    <div className={cn("relative overflow-hidden rounded-2xl border border-line bg-[radial-gradient(ellipse_60%_55%_at_50%_50%,var(--bronze-soft),transparent_75%)]", compact ? "h-72" : "h-[clamp(340px,54vh,560px)]")}>
      <div ref={mountRef} className="absolute inset-0 [&_canvas]:size-full [&_canvas]:cursor-grab" />
      <span className="pointer-events-none absolute bottom-2 right-3 rounded-full bg-bg-1/80 px-3 py-1 text-[11px] text-ink-dim">拖曳旋轉 · 滾輪縮放</span>
      {compact && (
        <button type="button" onClick={() => setBig(true)} className="absolute right-2 top-2 flex cursor-pointer items-center gap-1 rounded-full border border-line-strong bg-bg-1 px-3 py-1 text-[11.5px] text-ink-dim hover:border-bronze hover:text-ink">
          <Maximize2 className="size-3" />放大
        </button>
      )}
    </div>
  );

  if (compact) {
    return (
      <div className={className}>
        {canvas}
        <Dialog open={big} onOpenChange={setBig}>
          <DialogContent className="max-w-6xl">
            <DialogTitle>立場星圖</DialogTitle>
            {big && <StarMap data={data} />}
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className={cn("grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]", className)}>
      <div className="min-w-0">
        {canvas}
        {data.hasTimeline && (
          <div className="mt-3 rounded-2xl border border-line bg-bg-2 p-4">
            <div className="flex items-center gap-3">
              <Button size="icon" onClick={() => { if (step >= steps) setStep(0); setPlaying(!playing); }} aria-label={playing ? "暫停" : "播放"}>{playing ? <Pause className="size-4" /> : <Play className="size-4" />}</Button>
              <div className="min-w-0 flex-1"><b className="block font-serif text-base font-medium">{data.stepLabels[step]}</b><span className="text-[11.5px] text-ink-faint">第 {step + 1} / {steps + 1} 步 · {data.stepNotes[step]}</span></div>
              <Button variant="outline" size="icon" disabled={step <= 0} onClick={() => { setPlaying(false); setStep(step - 1); }} aria-label="上一步"><ChevronLeft className="size-4" /></Button>
              <Button variant="outline" size="icon" disabled={step >= steps} onClick={() => { setPlaying(false); setStep(step + 1); }} aria-label="下一步"><ChevronRight className="size-4" /></Button>
              <Button variant="outline" size="icon" onClick={() => { setPlaying(false); setStep(0); }} aria-label="回到第一步"><RotateCcw className="size-4" /></Button>
            </div>
            <div className="relative mx-2 mt-4 h-8" role="slider" aria-valuemin={0} aria-valuemax={steps} aria-valuenow={step}>
              <span className="absolute inset-x-0 top-2.5 h-[3px] rounded bg-bg-3"><i className="block h-full rounded bg-bronze transition-all" style={{ width: `${steps ? (step / steps) * 100 : 0}%` }} /></span>
              {Array.from({ length: steps + 1 }, (_, i) => (
                <button key={i} type="button" aria-label={data.stepLabels[i]} onClick={() => { setPlaying(false); setStep(i); }}
                  style={{ left: `${steps ? (i / steps) * 100 : 0}%` }}
                  className={cn("absolute top-1 size-3 -translate-x-1/2 cursor-pointer rounded-full border-2", i < step ? "border-bronze bg-bronze" : i === step ? "size-5 -translate-y-1 border-[3px] border-bronze bg-bg-1 ring-4 ring-bronze-soft" : "border-bg-3 bg-bg-2")} />
              ))}
            </div>
            <div className="mx-2 mt-1 flex justify-between text-[10.5px] text-ink-faint"><span>{data.stepLabels[0]}</span><span>{data.stepLabels[steps]}</span></div>
          </div>
        )}
        {cur && (
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {cur.centroids.map((c: number[], i: number) => {
              const count = cur.assignments.filter((a: number) => a === i).length;
              if (!count) return null;
              const mine = me && cur.assignments[data.agents.indexOf(me)] === i;
              return (
                <div key={i} className="rounded-xl border border-line bg-bg-1 p-3 text-[12.5px]" style={{ borderTop: `3px solid ${CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]}` }}>
                  <b className="font-serif text-sm">{data.groups ? data.groups.labels[i] : `第 ${["I", "II", "III", "IV", "V", "VI"][i]} 群`}</b>
                  {mine && <em className="ml-2 rounded-full bg-bronze px-2 py-0.5 text-[10px] not-italic text-[#221a0c]">你在這{data.groups ? "組" : "群"}</em>}
                  <div className="mt-1 text-ink-faint">{count} 人 · {Math.round((count / cur.assignments.length) * 100)}%</div>
                  <div className="text-ink-dim">偏 {clusterLabel(c)}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <aside className="space-y-3">
        <div className="rounded-2xl border border-line bg-bg-2 p-3">
          <div className="mb-2 text-xs text-ink-faint">量軸（勾 1 條是量表、2 條是平面、3 條是立體）</div>
          {data.axes.map((ax, i) => {
            const on = checked.includes(ax.key);
            const color = AXIS_COLORS[i % AXIS_COLORS.length];
            const v = meVals ? meVals[i] : 0;
            return (
              <button key={ax.key} type="button" onClick={() => toggleAxis(ax.key)} aria-pressed={on}
                className={cn("mb-2 w-full cursor-pointer rounded-xl border p-2.5 text-left last:mb-0", on ? "bg-bg-1" : "border-line opacity-60")} style={on ? { borderColor: color } : undefined}>
                <div className="flex items-center gap-2 text-[13px]"><span className="flex size-4 items-center justify-center rounded border text-[10px]" style={{ borderColor: color, background: on ? color : "transparent", color: "#1b1d22" }}>{on ? "✓" : ""}</span><b style={{ color }}>{ax.name}</b>{me && <span className="ml-auto text-[11px] text-ink-faint">你 {v >= 0 ? "+" : "−"}{Math.abs(v).toFixed(2)}</span>}</div>
                <div className="mt-1 flex justify-between text-[11px] text-ink-faint"><span>{ax.left}</span><span>{ax.right}</span></div>
              </button>
            );
          })}
        </div>
        <div className="rounded-2xl border border-line bg-bg-2 p-3 text-[13px]">
          <label className="flex cursor-pointer items-center justify-between py-1.5"><span>顯示軌跡</span><input type="checkbox" checked={showTraj} disabled={!data.hasTimeline} onChange={(e) => setShowTraj(e.target.checked)} /></label>
          <label className="flex cursor-pointer items-center justify-between py-1.5"><span>{data.groups ? "依辯論分組著色" : "依立場分群"}</span><input type="checkbox" checked={clusterOn} onChange={(e) => setClusterOn(e.target.checked)} /></label>
          {!data.groups && (
            <div className="flex items-center justify-between py-1.5"><span className="text-ink-dim">分群數</span>
              <div className="inline-flex gap-0.5 rounded-full bg-bg-3 p-0.5">{[2, 3, 4, 5, 6].map((n) => <button key={n} type="button" disabled={!clusterOn} onClick={() => setK(n)} className={cn("h-6 min-w-7 cursor-pointer rounded-full text-xs disabled:opacity-50", k === n ? "bg-bronze font-bold text-[#221a0c]" : "text-ink-dim")}>{n}</button>)}</div>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

import { type KeyboardEvent, type PointerEvent as ReactPointerEvent, useId, useMemo, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import { Segmented, cn } from "@/components/ui";
import { useMediaQuery, useOnUnmount } from "@/hooks/useSubscription";
import { useT } from "@/i18n";
import { createFrameLoop } from "@/lib/frameLoop";
import {
  type ClusterMode,
  DEFAULT_PITCH,
  DEFAULT_YAW,
  MAX_AXES,
  MAX_PITCH,
  type StanceAxis,
  type StanceLayout,
  type Vec3,
  clusterStudents,
  coordOf,
  easeInOutCubic,
  isComplete,
  isVisible,
  mixLayout,
  placeIn,
  project,
  stanceStudents,
  targetLayout,
  togglePicked,
} from "@/lib/stance";

const DURATION = 900;
const DEFAULT_PICKED = 2;
const LABELLED_LIMIT = 14;
const LABELLED_LIMIT_NARROW = 8;
const KEY_TURN = 0.12;
const DRAG_TURN = 0.008;
const WIDE = { width: 640, height: 480, flat: 140, cube: 112, step: 15, radius: 6, chars: 12 };
const NARROW = { width: 360, height: 340, flat: 84, cube: 78, step: 12, radius: 5, chars: 6 };
const CLUSTER_FILL = ["fill-stance-1", "fill-stance-2", "fill-stance-3", "fill-stance-4", "fill-stance-5"];
const CLUSTER_STROKE = ["stroke-stance-1", "stroke-stance-2", "stroke-stance-3", "stroke-stance-4", "stroke-stance-5"];
const CLUSTER_MODES: ClusterMode[] = ["off", "auto", "2", "3", "4"];

const PANEL = "rounded-2xl border border-line bg-card";
const DIVIDER = "border-t border-line";
const TILE = "cursor-pointer rounded-xl border px-3.5 py-2.5 text-left transition-colors";
const CONTROL = "rounded-md border border-line-strong bg-paper";
const LABEL = "text-[12px] font-medium tracking-wide text-ink-faint";
const NOTE = "mt-2 text-[12.5px] leading-relaxed text-ink-faint";

interface Tween {
  from: StanceLayout;
  to: StanceLayout;
  start: number;
}

const progress = (tween: Tween, now: number) => Math.min(1, Math.max(0, (now - tween.start) / DURATION));
const shorten = (text: string, chars: number) => (text.length > chars ? `${text.slice(0, chars)}…` : text);

function labelLean(offset: readonly [number, number], axes: number): readonly [number, number] {
  if (axes === 1) return [1, 0];
  const length = Math.hypot(offset[0], offset[1]);
  return length < 0.01 ? [0, -1] : [offset[0] / length, offset[1] / length];
}

function polygon(sides: number, radius: number, turn: number): string {
  return Array.from({ length: sides }, (_, index) => {
    const angle = turn + (index / sides) * Math.PI * 2;
    return `${(Math.cos(angle) * radius).toFixed(2)},${(Math.sin(angle) * radius).toFixed(2)}`;
  }).join(" ");
}

function Marker({ shape, radius, className }: { shape: number; radius: number; className?: string }) {
  if (shape === 1) return <polygon points={polygon(4, radius * 1.2, Math.PI / 4)} className={className} />;
  if (shape === 2) return <polygon points={polygon(3, radius * 1.35, -Math.PI / 2)} className={className} />;
  if (shape === 3) return <polygon points={polygon(4, radius * 1.3, 0)} className={className} />;
  if (shape === 4) return <polygon points={polygon(5, radius * 1.25, -Math.PI / 2)} className={className} />;
  return <circle r={radius} className={className} />;
}

export function StanceConstellation({ axes }: { axes: readonly StanceAxis[] }) {
  const t = useT();
  const titleId = useId();
  const narrow = useMediaQuery("(max-width: 640px)");
  const still = useMediaQuery("(prefers-reduced-motion: reduce)");
  const size = narrow ? NARROW : WIDE;
  const students = useMemo(() => stanceStudents(axes), [axes]);
  const [picked, setPicked] = useState(() => axes.slice(0, DEFAULT_PICKED).map((axis) => axis.name));
  const [tween, setTween] = useState<Tween>(() => {
    const layout = targetLayout(
      axes.slice(0, DEFAULT_PICKED).map((axis) => axis.name),
      stanceStudents(axes),
      1,
    );
    return { from: layout, to: layout, start: -DURATION };
  });
  const [now, setNow] = useState(0);
  const [orbit, setOrbit] = useState({ yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH });
  const [mode, setMode] = useState<ClusterMode>("auto");
  const [selected, setSelected] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const endAt = useRef(0);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [loop] = useState(() =>
    createFrameLoop((time) => {
      setNow(time);
      return time < endAt.current;
    }),
  );
  useOnUnmount(() => loop.stop());

  const clusters = useMemo(() => clusterStudents(students, picked, mode), [students, picked, mode]);
  const layout = still ? tween.to : mixLayout(tween.from, tween.to, easeInOutCubic(progress(tween, now)));
  const spatial = picked.length === MAX_AXES;
  const unit = size.flat + (size.cube - size.flat) * layout.orbit;
  const point = (vector: Vec3) => project(vector, orbit.yaw, orbit.pitch, layout.orbit, unit);

  const toggleAxis = (name: string) => {
    const next = togglePicked(picked, name);
    const time = performance.now();
    const current = mixLayout(tween.from, tween.to, easeInOutCubic(progress(tween, time)));
    setPicked(next);
    setTween({ from: current, to: targetLayout(next, students, 1), start: time });
    setNow(time);
    endAt.current = time + DURATION;
    loop.wake();
  };

  const turn = (yaw: number, pitch: number) =>
    setOrbit((value) => ({
      yaw: value.yaw + yaw,
      pitch: Math.min(MAX_PITCH, Math.max(-MAX_PITCH, value.pitch + pitch)),
    }));

  const startDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!spatial) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY };
  };
  const moveDrag = (event: ReactPointerEvent<SVGSVGElement>) => {
    const last = drag.current;
    if (!last) return;
    turn((event.clientX - last.x) * DRAG_TURN, (event.clientY - last.y) * DRAG_TURN);
    drag.current = { x: event.clientX, y: event.clientY };
  };
  const endDrag = () => {
    drag.current = null;
  };
  const turnByKey = (event: KeyboardEvent<SVGSVGElement>) => {
    if (!spatial) return;
    const step: Record<string, [number, number]> = {
      ArrowLeft: [-KEY_TURN, 0],
      ArrowRight: [KEY_TURN, 0],
      ArrowUp: [0, -KEY_TURN],
      ArrowDown: [0, KEY_TURN],
    };
    const delta = step[event.key];
    if (!delta) return;
    event.preventDefault();
    turn(delta[0], delta[1]);
  };

  const names = Object.keys(layout.basis);
  const corners = Array.from({ length: 2 ** names.length }, (_, mask) => {
    const coords: Record<string, number> = {};
    names.forEach((name, bit) => {
      coords[name] = mask & (1 << bit) ? 1 : -1;
    });
    return point(placeIn(layout, coords));
  });
  const edges: [number, number][] = [];
  for (let mask = 0; mask < corners.length; mask += 1) {
    for (let bit = 0; bit < names.length; bit += 1) {
      if (!(mask & (1 << bit))) edges.push([mask, mask | (1 << bit)]);
    }
  }

  const axisByName = new Map(axes.map((axis) => [axis.name, axis]));
  const shown = students
    .filter((student) => isVisible(student, picked))
    .map((student) => {
      const coords: Record<string, number> = {};
      for (const name of names) coords[name] = coordOf(student.at[name]);
      const at = point(placeIn(layout, coords));
      const offset = layout.offsets[student.id] ?? [0, 0];
      return {
        student,
        x: at.x + offset[0] * size.step,
        y: at.y + offset[1] * size.step,
        lean: labelLean(offset, picked.length),
        depth: at.depth,
        scale: at.scale,
        complete: isComplete(student, picked),
        cluster: clusters.status === "ok" ? clusters.labels[student.id] : undefined,
      };
    })
    .sort((a, b) => a.depth - b.depth);
  const order = students.filter((student) => isVisible(student, picked)).map((student) => student.id);
  const tabStop = cursor !== null && order.includes(cursor) ? cursor : (order[0] ?? null);
  const pointKey = (event: KeyboardEvent<SVGGElement>, id: string) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      setSelected(id === selected ? null : id);
      return;
    }
    const move =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (move === 0) return;
    event.preventDefault();
    event.stopPropagation();
    const next = order[(order.indexOf(id) + move + order.length) % order.length];
    const nodes = event.currentTarget.ownerSVGElement?.querySelectorAll<SVGGElement>("[data-stance-point]") ?? [];
    for (const node of nodes) {
      if (node.dataset.stancePoint === next) node.focus();
    }
  };
  const labelled = shown.length <= (narrow ? LABELLED_LIMIT_NARROW : LABELLED_LIMIT);
  const hasPartial = shown.some((entry) => !entry.complete) && picked.length > 1;
  const focus = students.find((student) => student.id === (hovered ?? selected)) ?? null;
  const pinned = students.find((student) => student.id === selected) ?? null;
  const detail = focus ?? pinned;

  return (
    <section aria-labelledby={titleId} className={cn(PANEL, "flex flex-col overflow-hidden")}>
      <header className="flex flex-wrap items-start justify-between gap-3 p-5">
        <div className="min-w-0">
          <h2 id={titleId} className="font-serif text-lg font-semibold text-ink">
            {t("stance_title")}
          </h2>
          <p className="mt-1 text-[13px] leading-relaxed text-ink-faint">{t("stance_hint", { max: MAX_AXES })}</p>
        </div>
        <Segmented
          label={t("stance_clusters")}
          value={mode}
          onChange={setMode}
          items={CLUSTER_MODES.map((value) => ({
            value,
            label:
              value === "off"
                ? t("stance_cluster_off")
                : value === "auto"
                  ? t("stance_cluster_auto")
                  : t("stance_cluster_count", { n: value }),
          }))}
        />
      </header>

      <fieldset className={cn(DIVIDER, "grid min-w-0 gap-2 px-5 py-4 sm:grid-cols-3")}>
        <legend className="sr-only">{t("stance_pick_axes")}</legend>
        {axes.map((axis) => {
          const on = picked.includes(axis.name);
          return (
            <button
              key={axis.name}
              type="button"
              aria-pressed={on}
              onClick={() => toggleAxis(axis.name)}
              className={cn(TILE, on ? "border-ink bg-paper" : "border-line bg-transparent hover:border-line-strong")}
            >
              <span className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
                <span
                  aria-hidden
                  className={cn("size-2.5 shrink-0 rounded-full border border-ink", on ? "bg-ink" : "bg-transparent")}
                />
                <span className="min-w-0 break-words">{axis.name}</span>
              </span>
              <span className="mt-1 block break-words text-[12.5px] leading-relaxed text-ink-faint">
                {axis.low} ↔ {axis.high}
              </span>
            </button>
          );
        })}
      </fieldset>

      <div className={cn(DIVIDER, "grid lg:grid-cols-[minmax(0,1fr)_16rem]")}>
        <div className="relative bg-paper">
          {/* biome-ignore lint/a11y/useSemanticElements: SVG has no fieldset; the chart groups its focusable dots */}
          <svg
            viewBox={`${-size.width / 2} ${-size.height / 2} ${size.width} ${size.height}`}
            role="group"
            aria-label={t("stance_stage_label", { n: shown.length, axes: picked.length })}
            tabIndex={spatial ? 0 : -1}
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={endDrag}
            onPointerCancel={endDrag}
            onKeyDown={turnByKey}
            data-stance-stage={picked.length}
            className={cn(
              "block w-full select-none outline-none focus-visible:outline-2 focus-visible:outline-ember",
              spatial ? "cursor-grab touch-none active:cursor-grabbing" : "touch-pan-y",
            )}
          >
            {edges.map(([from, to]) => {
              const a = corners[from];
              const b = corners[to];
              if (!a || !b) return null;
              return (
                <line
                  key={`${from}-${to}`}
                  x1={a.x}
                  y1={a.y}
                  x2={b.x}
                  y2={b.y}
                  className="stroke-line-strong"
                  strokeWidth={1}
                  strokeDasharray="2 4"
                />
              );
            })}
            {names.map((name) => {
              const axis = axisByName.get(name);
              const direction = layout.basis[name];
              if (!axis || !direction) return null;
              const weight = Math.hypot(direction[0], direction[1], direction[2]);
              if (weight < 0.02) return null;
              const low = point(placeIn(layout, { [name]: -1.1 }));
              const high = point(placeIn(layout, { [name]: 1.1 }));
              const ends = [
                { at: point(placeIn(layout, { [name]: -1.28 })), text: axis.low },
                { at: point(placeIn(layout, { [name]: 1.28 })), text: axis.high },
              ];
              return (
                <g key={name} opacity={weight}>
                  <line x1={low.x} y1={low.y} x2={high.x} y2={high.y} className="stroke-ink" strokeWidth={1.4} />
                  {ends.map((end) => (
                    <text
                      key={end.text}
                      x={end.at.x}
                      y={end.at.y}
                      textAnchor={end.at.x > 24 ? "start" : end.at.x < -24 ? "end" : "middle"}
                      dominantBaseline="middle"
                      className="fill-ink-soft text-[12px]"
                      data-stance-end={name}
                    >
                      <title>{end.text}</title>
                      {shorten(end.text, size.chars)}
                    </text>
                  ))}
                </g>
              );
            })}
            <circle r={2} className="fill-ink-faint" />
            {clusters.status === "ok" &&
              clusters.groups.map((group, index) => {
                const coords: Record<string, number> = {};
                for (const name of picked) coords[name] = coordOf(group.mean[name]);
                const center = point(placeIn(layout, coords));
                const arm = size.radius * 0.9 * center.scale;
                return (
                  <path
                    key={group.ids.join("|")}
                    d={`M${center.x - arm} ${center.y}H${center.x + arm}M${center.x} ${center.y - arm}V${center.y + arm}`}
                    data-stance-centre={index}
                    className={cn("fill-none", CLUSTER_STROKE[index % CLUSTER_STROKE.length])}
                    strokeWidth={1.6}
                  />
                );
              })}
            {shown.map((entry) => {
              const active = entry.student.id === selected || entry.student.id === hovered;
              const shape = entry.cluster ?? 0;
              return (
                // biome-ignore lint/a11y/useSemanticElements: an SVG group cannot be a button element
                <g
                  key={entry.student.id}
                  transform={`translate(${entry.x.toFixed(2)} ${entry.y.toFixed(2)})`}
                  data-stance-point={entry.student.id}
                  data-stance-cluster={entry.cluster ?? ""}
                  role="button"
                  tabIndex={entry.student.id === tabStop ? 0 : -1}
                  aria-label={entry.student.id}
                  aria-pressed={entry.student.id === selected}
                  onPointerDown={(event) => event.stopPropagation()}
                  onPointerEnter={() => setHovered(entry.student.id)}
                  onPointerLeave={() => setHovered(null)}
                  onFocus={() => {
                    setHovered(entry.student.id);
                    setCursor(entry.student.id);
                  }}
                  onBlur={() => setHovered(null)}
                  onKeyDown={(event) => pointKey(event, entry.student.id)}
                  onClick={() => setSelected(entry.student.id === selected ? null : entry.student.id)}
                  className="cursor-pointer outline-none"
                >
                  <circle r={size.radius * 2.2} className="fill-transparent" />
                  {active && (
                    <circle r={size.radius * entry.scale + 4} className="fill-none stroke-ink" strokeWidth={1.2} />
                  )}
                  <Marker
                    shape={entry.complete ? shape : 0}
                    radius={size.radius * entry.scale}
                    className={
                      !entry.complete && picked.length > 0
                        ? "fill-paper stroke-ink-faint [stroke-width:1.4]"
                        : entry.cluster === undefined
                          ? "fill-ink"
                          : CLUSTER_FILL[entry.cluster % CLUSTER_FILL.length]
                    }
                  />
                  {(labelled || active) && (
                    <text
                      x={entry.lean[0] * (size.radius * entry.scale + 5)}
                      y={entry.lean[1] * (size.radius * entry.scale + 9)}
                      textAnchor={entry.lean[0] > 0.3 ? "start" : entry.lean[0] < -0.3 ? "end" : "middle"}
                      dominantBaseline="middle"
                      className={cn("text-[11px]", active ? "fill-ink font-semibold" : "fill-ink-soft")}
                    >
                      {entry.student.id}
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          {picked.length === 0 && (
            <p className="pointer-events-none absolute inset-x-4 bottom-4 text-center text-[13px] text-ink-faint">
              {t("stance_empty")}
            </p>
          )}
          {spatial && (
            <button
              type="button"
              onClick={() => setOrbit({ yaw: DEFAULT_YAW, pitch: DEFAULT_PITCH })}
              className={cn(
                CONTROL,
                "absolute right-3 top-3 flex cursor-pointer items-center gap-1.5 px-2.5 py-1 text-[12px] text-ink-soft transition-colors hover:text-ink",
              )}
            >
              <RotateCcw className="size-3.5" aria-hidden />
              {t("stance_reset_view")}
            </button>
          )}
          {spatial && (
            <p className="pointer-events-none absolute bottom-3 left-4 text-[12px] text-ink-faint">
              {t("stance_rotate_hint")}
            </p>
          )}
        </div>

        <aside className="flex min-w-0 flex-col border-t border-line lg:border-l lg:border-t-0">
          {clusters.status !== "off" && (
            <div className="p-4">
              <h3 className={LABEL}>{t("stance_clusters")}</h3>
              {clusters.status === "few" && <p className={NOTE}>{t("stance_cluster_few")}</p>}
              {clusters.status === "many" && <p className={NOTE}>{t("stance_cluster_many")}</p>}
              {clusters.status === "ok" && clusters.short && (
                <p className={NOTE}>{t("stance_cluster_short", { n: clusters.groups.length })}</p>
              )}
              {clusters.status === "ok" && (
                <ul className="mt-2 flex flex-col gap-3">
                  {clusters.groups.map((group, index) => (
                    <li key={group.ids.join("|")} data-stance-group={index}>
                      <p className="flex items-center gap-2 text-[13.5px] font-medium text-ink">
                        <svg viewBox="-9 -9 18 18" className="size-4 shrink-0" aria-hidden>
                          <Marker shape={index} radius={6} className={CLUSTER_FILL[index % CLUSTER_FILL.length]} />
                        </svg>
                        <span className="min-w-0 flex-1">{t("stance_cluster_name", { n: index + 1 })}</span>
                        <span className="font-normal text-ink-faint">
                          {t("stance_cluster_members", { n: group.ids.length })}
                        </span>
                      </p>
                      <p className="mt-1 break-words text-[12.5px] leading-relaxed text-ink-soft">
                        {group.ids.join("、")}
                      </p>
                      {picked.map((name) => (
                        <p key={name} className="break-words text-[12px] leading-relaxed text-ink-faint">
                          {t("stance_cluster_axis", { axis: name, at: group.mean[name] ?? 0 })}
                        </p>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
          <div aria-live="polite" className={cn("flex-1 p-4", clusters.status !== "off" && "border-t border-line")}>
            <h3 className={LABEL}>{t("stance_selected")}</h3>
            {detail ? (
              <div className="mt-2 flex flex-col gap-2">
                <p className="text-[13.5px] font-medium text-ink">{detail.id}</p>
                {picked.map((name) => (
                  <p key={name} className="break-words text-[12.5px] leading-relaxed text-ink-soft">
                    <span className="font-medium text-ink">{name}</span>
                    {detail.at[name] === undefined ? (
                      <span className="text-ink-faint"> · {t("stance_not_on_axis")}</span>
                    ) : (
                      <>
                        <span className="text-ink-faint"> · {t("report_position", { at: detail.at[name] ?? 0 })}</span>
                        <span> — {detail.view[name]}</span>
                      </>
                    )}
                  </p>
                ))}
              </div>
            ) : (
              <p className={NOTE}>{t("stance_select_hint")}</p>
            )}
          </div>
        </aside>
      </div>

      {hasPartial && (
        <p className={cn(DIVIDER, "px-5 py-3 text-[12.5px] leading-relaxed text-ink-faint")}>
          {t("stance_partial_note")}
        </p>
      )}
    </section>
  );
}

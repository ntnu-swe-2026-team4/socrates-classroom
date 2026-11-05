import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api, type GroupReport } from "@/api";
import { scoreToCoords } from "@/components/constellation/sim";
import Scene3D, { type ClusterResult, CLUSTER_PALETTE } from "@/components/constellation/Scene3D";
import { kmeans } from "@/components/constellation/kmeans";
import { Segmented, Spinner, cn } from "@/components/ui";
import { useT } from "@/i18n";
import { useTheme } from "@/theme";

export const Route = createFileRoute("/report/$id")({
  component: ReportPage,
});

function ReportPage() {
  const t = useT();
  const { id } = Route.useParams();
  const [view, setView] = useState<"group" | "individual">("group");
  const [studentIdx, setStudentIdx] = useState(0);
  const [checkedAxes, setCheckedAxes] = useState<number[]>([0, 1, 2]);
  const theme = useTheme();
  const [showTraj, setShowTraj] = useState(false);
  const report = useQuery({ queryKey: ["report", id], queryFn: () => api.report(id) });

  if (report.isPending) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }
  if (report.isError || !report.data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-[15px] text-ink-soft">{t("common_error")}</div>
    );
  }

  const data = report.data;
  const person = data.individuals[Math.min(studentIdx, data.individuals.length - 1)];

  return (
    <div className="mx-auto w-full max-w-4xl px-5 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3 pl-12 md:pl-0">
        <div>
          <h1 className="font-serif text-2xl font-semibold text-ink">{t("report_title")}</h1>
          <p className="mt-1 text-[13px] text-ink-faint">{data.topicTitle}</p>
        </div>
        <Segmented
          label={t("report_title")}
          value={view}
          onChange={setView}
          items={[
            { value: "group", label: t("report_group") },
            { value: "individual", label: t("report_individual") },
          ]}
        />
      </div>

      {view === "group" ? (
        <section className="mt-6 flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12px] font-medium tracking-wider text-ink-faint uppercase">
                {t("report_axes")}
              </span>
              {data.group.axes.map((axis, i) => (
                <button
                  key={axis.name}
                  type="button"
                  onClick={() =>
                    setCheckedAxes((prev) => (prev.includes(i) ? prev.filter((v) => v !== i) : [...prev, i].sort()))
                  }
                  className={cn(
                    "rounded-full border px-3 py-1 text-[12.5px] transition-colors",
                    checkedAxes.includes(i)
                      ? "border-ember bg-ember-wash font-medium text-ember"
                      : "border-line bg-card text-ink-soft",
                  )}
                >
                  {axis.left} ↔ {axis.right}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShowTraj((v) => !v)}
              className={cn(
                "rounded-full border px-3 py-1 text-[12.5px] transition-colors",
                showTraj ? "border-ember bg-ember-wash font-medium text-ember" : "border-line bg-card text-ink-soft",
              )}
            >
              {t("report_trajectory")}
            </button>
          </div>

          <Constellation3D group={data.group} checkedAxes={checkedAxes} showTraj={showTraj} scheme={theme} />
          <div className="flex flex-wrap justify-center gap-4">
            {data.group.clusters.map((cluster) => (
              <span key={cluster.id} className="flex items-center gap-2 text-[13px] text-ink-soft">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: CLUSTER_PALETTE[cluster.id % CLUSTER_PALETTE.length] }}
                />
                {cluster.label}
              </span>
            ))}
          </div>
        </section>
      ) : (
        person && (
          <section className="mt-6 flex flex-col gap-8">
            <div className="flex flex-wrap gap-2">
              {data.individuals.map((individual, index) => (
                <button
                  type="button"
                  key={individual.studentName}
                  onClick={() => setStudentIdx(index)}
                  className={`rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
                    index === studentIdx
                      ? "border-ember bg-ember-wash font-medium text-ember"
                      : "border-line bg-card text-ink-soft"
                  }`}
                >
                  {individual.studentName}
                </button>
              ))}
            </div>
            <div className="flex flex-col items-center gap-10 lg:flex-row lg:items-start lg:justify-center">
              <div className="flex flex-col items-center gap-2">
                <Hexagon axes={person.hexagon} />
                <p className="text-[12.5px] text-ink-faint">{t("report_hex")}</p>
              </div>
              <div className="flex max-w-xl flex-col gap-4">
                <h2 className="font-serif text-lg font-semibold text-ink">{t("report_summary")}</h2>
                {person.arguments.map((argument) => (
                  <div key={argument.claim} className="rounded-2xl border border-line bg-card p-4">
                    <p className="text-[14.5px] font-medium text-ink">{argument.claim}</p>
                    <p className="mt-1.5 text-[13.5px] leading-relaxed text-ink-soft">
                      <span className="font-medium text-moss">{t("report_reason")}·</span> {argument.reason}
                    </p>
                    <p className="mt-1 text-[13.5px] leading-relaxed text-ink-faint">
                      <span className="font-medium text-ember">{t("report_tension")}·</span> {argument.tension}
                    </p>
                  </div>
                ))}
                {person.violations.length > 0 && (
                  <div className="flex flex-col gap-2">
                    <h3 className="text-[14px] font-medium text-flag">{t("report_violations")}</h3>
                    {person.violations.map((violation, index) => (
                      <p
                        // biome-ignore lint/suspicious/noArrayIndexKey: 同一輪可有多筆同類違規，index 僅作消歧
                        key={`${violation.turn}-${violation.type}-${index}`}
                        className="rounded-xl bg-flag-wash px-4 py-2 text-[13px] text-ink-soft"
                      >
                        #{violation.turn} · {violation.type} —「{violation.excerpt}」
                      </p>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </section>
        )
      )}
    </div>
  );
}

const SLOTS = ["x", "y", "z"] as const;
type Slot = (typeof SLOTS)[number];
const AXIS_MAP: Record<Slot, number> = { x: 0, y: 1, z: 2 };

function Constellation3D({
  group,
  checkedAxes,
  showTraj,
  scheme,
}: {
  group: GroupReport;
  checkedAxes: number[];
  showTraj: boolean;
  scheme: "dark" | "light";
}) {
  const agents = useMemo(
    () =>
      group.points.map((point, i) => ({
        id: i,
        history: [point.values.map(() => 0), point.values],
      })),
    [group.points],
  );
  const maxAbsTable = useMemo(() => group.points.map(() => group.axes.map(() => 1)), [group.points, group.axes]);

  const activeSlots = useMemo(() => SLOTS.filter((sl) => checkedAxes.includes(AXIS_MAP[sl])), [checkedAxes]);

  // 分群基於目前顯示的座標（未勾選軸壓平為 0）——群心球隨維度收合移動
  const cluster = useMemo<ClusterResult>(() => {
    const coords = group.points.map((point) => scoreToCoords(point.values, AXIS_MAP, null, activeSlots));
    const k = group.clusters.length || 1;
    return kmeans(coords, k, { seed: 42 + k * 17 });
  }, [group.points, group.clusters, activeSlots]);

  return (
    <div className="h-105 w-full overflow-hidden rounded-2xl border border-line">
      <Scene3D
        key={scheme}
        agents={agents}
        version={0}
        axisMap={AXIS_MAP}
        cluster={cluster}
        showTraj={showTraj}
        maxAbsTable={maxAbsTable}
        dim={checkedAxes.length}
        activeSlots={activeSlots}
        axes={group.axes}
        scheme={scheme}
      />
    </div>
  );
}

function Hexagon({ axes }: { axes: { label: string; value: number }[] }) {
  const cx = 130;
  const cy = 130;
  const r = 100;
  const angle = (i: number) => (Math.PI * 2 * i) / axes.length - Math.PI / 2;
  const vertex = (i: number, scale: number) =>
    [cx + Math.cos(angle(i)) * r * scale, cy + Math.sin(angle(i)) * r * scale] as const;
  const polygon = axes.map((axis, i) => vertex(i, axis.value).join(",")).join(" ");
  const outline = axes.map((_, i) => vertex(i, 1).join(",")).join(" ");

  return (
    <figure>
      <svg aria-hidden viewBox="-64 -18 388 296" className="h-64 w-72">
        {[0.25, 0.5, 0.75, 1].map((scale) => (
          <polygon
            key={scale}
            points={axes.map((_, i) => vertex(i, scale).join(",")).join(" ")}
            className="fill-none stroke-line"
            strokeWidth="1"
          />
        ))}
        <polygon points={outline} className="fill-none stroke-line" strokeWidth="1.2" />
        <polygon points={polygon} className="fill-ember/15 stroke-ember" strokeWidth="2" />
        {axes.map((axis, i) => {
          const [x, y] = vertex(i, 1.28);
          return (
            <text
              key={axis.label}
              x={x}
              y={y}
              textAnchor={Math.abs(x - cx) < 12 ? "middle" : x > cx ? "start" : "end"}
              dominantBaseline="middle"
              className="fill-ink-soft"
              fontSize="11.5"
            >
              {axis.label}
            </text>
          );
        })}
      </svg>
    </figure>
  );
}

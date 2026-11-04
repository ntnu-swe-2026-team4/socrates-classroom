import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api";
import { Segmented, Spinner } from "@/components/ui";
import { useT } from "@/i18n";

export const Route = createFileRoute("/report/$id")({
  component: ReportPage,
});

const CLUSTER_COLORS = ["#b0512b", "#47685a", "#8a6d3b"];

function ReportPage() {
  const t = useT();
  const { id } = Route.useParams();
  const [view, setView] = useState<"group" | "individual">("group");
  const [studentIdx, setStudentIdx] = useState(0);
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
      <div className="flex flex-wrap items-center justify-between gap-3">
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
        <section className="mt-6 flex flex-col items-center gap-6">
          <Constellation
            axisLeft={data.group.axisLeft}
            axisRight={data.group.axisRight}
            points={data.group.points}
            clusters={data.group.clusters}
          />
          <div className="flex flex-wrap justify-center gap-4">
            {data.group.clusters.map((cluster) => (
              <span key={cluster.id} className="flex items-center gap-2 text-[13px] text-ink-soft">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: CLUSTER_COLORS[cluster.id % 3] }} />
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
                    {person.violations.map((violation) => (
                      <p key={violation.turn} className="rounded-xl bg-flag-wash px-4 py-2 text-[13px] text-ink-soft">
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

function Constellation({
  axisLeft,
  axisRight,
  points,
  clusters,
}: {
  axisLeft: string;
  axisRight: string;
  points: { pseudonym: string; x: number; y: number; cluster: number }[];
  clusters: { id: number; label: string }[];
}) {
  void clusters;
  return (
    <figure className="w-full max-w-xl">
      <svg aria-hidden viewBox="0 0 400 320" className="w-full">
        <rect x="60" y="20" width="280" height="260" rx="12" className="fill-card stroke-line" />
        <line x1="200" y1="20" x2="200" y2="280" className="stroke-line" strokeDasharray="3 6" />
        <text x="66" y="300" className="fill-ink-faint" fontSize="11">
          {axisLeft}
        </text>
        <text x="334" y="300" textAnchor="end" className="fill-ink-faint" fontSize="11">
          {axisRight}
        </text>
        {points.map((point) => (
          <g key={point.pseudonym}>
            <circle
              cx={60 + (point.x / 100) * 280}
              cy={20 + (point.y / 100) * 260}
              r="9"
              className="fill-none"
              stroke={CLUSTER_COLORS[point.cluster % 3]}
              strokeWidth="2"
              opacity="0.5"
            />
            <circle
              cx={60 + (point.x / 100) * 280}
              cy={20 + (point.y / 100) * 260}
              r="3.5"
              fill={CLUSTER_COLORS[point.cluster % 3]}
            />
            <text
              x={60 + (point.x / 100) * 280 + 9}
              y={20 + (point.y / 100) * 260 - 9}
              className="fill-ink-soft"
              fontSize="9.5"
            >
              {point.pseudonym}
            </text>
          </g>
        ))}
      </svg>
    </figure>
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

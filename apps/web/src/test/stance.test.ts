import { describe, expect, it } from "vitest";
import {
  type StanceAxis,
  clusterStudents,
  isComplete,
  isVisible,
  mixLayout,
  placeIn,
  project,
  stanceStudents,
  targetLayout,
  togglePicked,
  wardClusters,
} from "@/lib/stance";

const axis = (name: string, positions: Record<string, number>): StanceAxis => ({
  name,
  low: `${name} low`,
  high: `${name} high`,
  why: "",
  positions: Object.entries(positions).map(([id, at]) => ({
    id,
    at,
    turns: [1],
    view: `${id} on ${name}`,
    end: at < 50 ? "low" : at > 50 ? "high" : "middle",
  })),
});

describe("stanceStudents", () => {
  it("merges each student's positions across axes and keeps first-seen order", () => {
    const students = stanceStudents([axis("A", { s1: 0, s2: 100 }), axis("B", { s2: 25, s3: 75 })]);
    expect(students.map((student) => student.id)).toEqual(["s1", "s2", "s3"]);
    expect(students[1]).toMatchObject({ at: { A: 100, B: 25 }, view: { A: "s2 on A", B: "s2 on B" } });
    expect(students[0]?.at.B).toBeUndefined();
  });

  it("separates students who sit on a picked axis from those who never talked about it", () => {
    const [s1, , s3] = stanceStudents([axis("A", { s1: 0, s2: 100 }), axis("B", { s2: 25, s3: 75 })]);
    expect(s1 && isVisible(s1, ["A", "B"])).toBe(true);
    expect(s1 && isComplete(s1, ["A", "B"])).toBe(false);
    expect(s3 && isVisible(s3, ["A"])).toBe(false);
    expect(s3 && isVisible(s3, [])).toBe(true);
  });
});

describe("togglePicked", () => {
  it("adds, removes, and drops the oldest axis past three", () => {
    expect(togglePicked(["A"], "B")).toEqual(["A", "B"]);
    expect(togglePicked(["A", "B"], "A")).toEqual(["B"]);
    expect(togglePicked(["A", "B", "C"], "D")).toEqual(["B", "C", "D"]);
  });
});

describe("layout", () => {
  const students = stanceStudents([axis("A", { s1: 0, s2: 0, s3: 100 }), axis("B", { s1: 50, s2: 50, s3: 0 })]);

  it("stacks students sharing one spot on a single axis and rings them on a plane", () => {
    const line = targetLayout(["A"], students, 1);
    expect(line.offsets.s1).toEqual([0, -0.5]);
    expect(line.offsets.s2).toEqual([0, 0.5]);
    expect(line.offsets.s3).toEqual([0, 0]);
    const plane = targetLayout(["A", "B"], students, 1);
    const [x1, y1] = plane.offsets.s1 ?? [0, 0];
    const [x2, y2] = plane.offsets.s2 ?? [0, 0];
    expect(Math.hypot(x1 - x2, y1 - y2)).toBeCloseTo(1);
    expect(plane.orbit).toBe(0);
    expect(targetLayout(["A", "B", "C"], students, 1).orbit).toBe(1);
  });

  it("grows an entering axis from the centre and collapses a leaving one", () => {
    const from = targetLayout(["A"], students, 1);
    const to = targetLayout(["B"], students, 1);
    const half = mixLayout(from, to, 0.5);
    expect(half.basis.A).toEqual([0.5, 0, 0]);
    expect(half.basis.B).toEqual([0.5, 0, 0]);
    expect(mixLayout(from, to, 1)).toBe(to);
    expect(placeIn(half, { A: 1, B: -1 })).toEqual([0, 0, 0]);
  });

  it("slides a student who only sits in one layout out from their true spot", () => {
    const from = targetLayout(["B"], students, 1);
    const to = targetLayout(["A"], students, 1);
    expect(from.offsets.s1).toEqual([0, -0.5]);
    expect(to.offsets.s1).toEqual([0, -0.5]);
    const entering = mixLayout({ ...from, offsets: {} }, to, 0.5);
    expect(entering.offsets.s1).toEqual([0, -0.25]);
  });

  it("projects flat when not orbiting and adds perspective when orbiting", () => {
    expect(project([1, 1, 1], 1, 1, 0, 100)).toMatchObject({ x: 100, y: -100, scale: 1 });
    const near = project([0, 0, 1], 0, 0, 1, 100);
    const far = project([0, 0, -1], 0, 0, 1, 100);
    expect(near.scale).toBeGreaterThan(far.scale);
  });
});

describe("wardClusters", () => {
  it("keeps the low side and the high side apart on auto", () => {
    const labels = wardClusters([[-1], [-0.5], [0.5], [1]], "auto");
    expect(labels).toEqual([0, 0, 1, 1]);
  });

  it("finds a middle group when students spread evenly", () => {
    const labels = wardClusters([[-1], [-0.9], [0], [0.1], [0.9], [1]], "auto");
    expect(labels).toEqual([0, 0, 1, 1, 2, 2]);
  });

  it("returns one group when nobody is far apart", () => {
    expect(new Set(wardClusters([[0], [0.1], [0.2], [0.3]], "auto")).size).toBe(1);
  });

  it("cuts to the requested number and numbers groups from the low end", () => {
    const labels = wardClusters(
      [
        [1, 1],
        [-1, -1],
        [0.9, 1],
        [-1, -0.9],
        [0, 0],
      ],
      3,
    );
    expect(labels).toEqual([2, 0, 2, 0, 1]);
  });

  it("never returns more than five groups on auto, nor more than half the students", () => {
    const spread = Array.from({ length: 20 }, (_, index) => [index - 10]);
    expect(new Set(wardClusters(spread, "auto")).size).toBe(5);
    expect(new Set(wardClusters([[-1], [0], [1], [2]], "auto")).size).toBe(2);
  });

  it("asks for a wider gap when more axes are picked", () => {
    expect(
      new Set(
        wardClusters(
          [
            [0, 0],
            [0, 0],
            [0.7, 0],
            [0.7, 0],
          ],
          "auto",
        ),
      ).size,
    ).toBe(1);
    expect(new Set(wardClusters([[0], [0], [0.7], [0.7]], "auto")).size).toBe(2);
  });
});

describe("clusterStudents", () => {
  const axes = [axis("A", { s1: 0, s2: 10, s3: 90, s4: 100, s5: 50 }), axis("B", { s1: 0, s2: 0, s3: 100, s4: 100 })];
  const students = stanceStudents(axes);

  it("groups only students with a position on every picked axis and reports each group's mean", () => {
    const result = clusterStudents(students, ["A", "B"], "auto");
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.labels.s5).toBeUndefined();
    expect(result.groups).toEqual([
      { ids: ["s1", "s2"], mean: { A: 5, B: 0 } },
      { ids: ["s3", "s4"], mean: { A: 95, B: 100 } },
    ]);
    expect(result.short).toBe(false);
  });

  it("flags a request for more groups than there are students", () => {
    const result = clusterStudents(students.slice(0, 3), ["A"], "4");
    expect(result).toMatchObject({ status: "ok", short: true });
    expect(result.status === "ok" && result.groups.length).toBe(3);
  });

  it("reports why it did not group", () => {
    expect(clusterStudents(students, ["A"], "off").status).toBe("off");
    expect(clusterStudents(students, [], "auto").status).toBe("off");
    expect(clusterStudents(students.slice(0, 2), ["A"], "auto").status).toBe("few");
  });
});

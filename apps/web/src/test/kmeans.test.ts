import { describe, expect, it } from "vitest";
import { elbowCurve, kmeans } from "@/components/constellation/kmeans";

const blobs = [
  [0.0, 0.0],
  [0.1, 0.2],
  [0.2, 0.05],
  [5.0, 5.0],
  [5.2, 4.8],
  [4.9, 5.1],
];

describe("kmeans", () => {
  it("is deterministic for the same input", () => {
    const a = kmeans(blobs, 2);
    const b = kmeans(blobs, 2);
    expect(a.assignments).toEqual(b.assignments);
    expect(a.centroids).toEqual(b.centroids);
  });

  it("assigns separated blobs to distinct clusters", () => {
    const result = kmeans(blobs, 2);
    const first = result.assignments[0];
    for (let i = 1; i < 3; i++) expect(result.assignments[i]).toBe(first);
    for (let i = 3; i < 6; i++) expect(result.assignments[i]).not.toBe(first);
  });

  it("handles empty input and clamps k", () => {
    expect(kmeans([], 3).assignments).toEqual([]);
    const clamped = kmeans([blobs[0]!], 5);
    expect(clamped.assignments).toEqual([0]);
    expect(clamped.centroids).toHaveLength(1);
  });

  it("survives restarts = 0", () => {
    const result = kmeans(blobs, 2, { restarts: 0 });
    expect(result.assignments).toHaveLength(blobs.length);
  });

  it("elbowCurve returns monotone non-increasing inertia up to k=n", () => {
    const curve = elbowCurve(blobs, 6);
    expect(curve.length).toBeGreaterThan(0);
    for (let i = 1; i < curve.length; i++) {
      expect(curve[i]!.inertia).toBeLessThanOrEqual(curve[i - 1]!.inertia);
    }
  });
});

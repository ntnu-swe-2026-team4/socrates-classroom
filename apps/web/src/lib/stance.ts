import type { ClassReport } from "@socrates/shared";

export type StanceAxis = ClassReport["axes"][number];
export type Vec3 = readonly [number, number, number];
export type ClusterMode = "off" | "auto" | "2" | "3" | "4" | "5";

export const MAX_AXES = 3;
export const MAX_CLUSTERS = 5;
export const MIN_CLUSTERED = 3;
export const MAX_CLUSTERED = 400;
export const AUTO_GAP = 0.6;
export const CAMERA_DISTANCE = 5;
export const DEFAULT_YAW = -0.62;
export const DEFAULT_PITCH = 0.42;
export const MAX_PITCH = 1.3;

const ZERO: Vec3 = [0, 0, 0];
const UNITS: readonly Vec3[] = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

export interface StanceStudent {
  id: string;
  at: Record<string, number>;
  view: Record<string, string>;
}

export interface StanceLayout {
  basis: Record<string, Vec3>;
  orbit: number;
  offsets: Record<string, readonly [number, number]>;
}

export interface Projected {
  x: number;
  y: number;
  depth: number;
  scale: number;
}

export function stanceStudents(axes: readonly StanceAxis[]): StanceStudent[] {
  const byId = new Map<string, StanceStudent>();
  for (const axis of axes) {
    for (const position of axis.positions) {
      let student = byId.get(position.id);
      if (!student) {
        student = { id: position.id, at: {}, view: {} };
        byId.set(position.id, student);
      }
      student.at[axis.name] = position.at;
      student.view[axis.name] = position.view;
    }
  }
  return [...byId.values()];
}

export const coordOf = (at: number | undefined) => (at === undefined ? 0 : at / 50 - 1);

export function isVisible(student: StanceStudent, picked: readonly string[]): boolean {
  return picked.length === 0 || picked.some((name) => student.at[name] !== undefined);
}

export function isComplete(student: StanceStudent, picked: readonly string[]): boolean {
  return picked.length > 0 && picked.every((name) => student.at[name] !== undefined);
}

export function togglePicked(picked: readonly string[], name: string): string[] {
  if (picked.includes(name)) return picked.filter((entry) => entry !== name);
  return [...picked, name].slice(-MAX_AXES);
}

function ring(count: number, index: number, step: number): readonly [number, number] {
  if (count < 2) return [0, 0];
  const radius = (step * 0.5) / Math.sin(Math.PI / count);
  const angle = (index / count) * Math.PI * 2 - Math.PI / 2;
  return [Math.cos(angle) * radius, Math.sin(angle) * radius];
}

export function targetLayout(
  picked: readonly string[],
  students: readonly StanceStudent[],
  step: number,
): StanceLayout {
  const basis: Record<string, Vec3> = {};
  picked.forEach((name, index) => {
    basis[name] = UNITS[index] ?? ZERO;
  });
  const groups = new Map<string, string[]>();
  for (const student of students) {
    if (!isVisible(student, picked)) continue;
    const key = picked.map((name) => student.at[name] ?? 50).join("|");
    const group = groups.get(key);
    if (group) group.push(student.id);
    else groups.set(key, [student.id]);
  }
  const offsets: Record<string, readonly [number, number]> = {};
  for (const group of groups.values()) {
    group.forEach((id, index) => {
      offsets[id] =
        picked.length === 1 ? [0, (index - (group.length - 1) / 2) * step] : ring(group.length, index, step);
    });
  }
  return { basis, orbit: picked.length === MAX_AXES ? 1 : 0, offsets };
}

const lerp = (from: number, to: number, t: number) => from + (to - from) * t;

export const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

export function mixLayout(from: StanceLayout, to: StanceLayout, t: number): StanceLayout {
  if (t >= 1) return to;
  if (t <= 0) return from;
  const basis: Record<string, Vec3> = {};
  for (const name of new Set([...Object.keys(from.basis), ...Object.keys(to.basis)])) {
    const a = from.basis[name] ?? ZERO;
    const b = to.basis[name] ?? ZERO;
    basis[name] = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  }
  const offsets: Record<string, readonly [number, number]> = {};
  for (const id of new Set([...Object.keys(from.offsets), ...Object.keys(to.offsets)])) {
    const a = from.offsets[id] ?? [0, 0];
    const b = to.offsets[id] ?? [0, 0];
    offsets[id] = [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  }
  return { basis, orbit: lerp(from.orbit, to.orbit, t), offsets };
}

export function placeIn(layout: StanceLayout, coords: Record<string, number>): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const [name, direction] of Object.entries(layout.basis)) {
    const value = coords[name] ?? 0;
    x += direction[0] * value;
    y += direction[1] * value;
    z += direction[2] * value;
  }
  return [x, y, z];
}

export function project(point: Vec3, yaw: number, pitch: number, orbit: number, unit: number): Projected {
  const cy = Math.cos(yaw * orbit);
  const sy = Math.sin(yaw * orbit);
  const cp = Math.cos(pitch * orbit);
  const sp = Math.sin(pitch * orbit);
  const x1 = point[0] * cy + point[2] * sy;
  const z1 = -point[0] * sy + point[2] * cy;
  const y2 = point[1] * cp - z1 * sp;
  const depth = point[1] * sp + z1 * cp;
  const scale = 1 / (1 - (orbit * depth) / CAMERA_DISTANCE);
  return { x: x1 * scale * unit, y: -y2 * scale * unit, depth, scale };
}

interface Cluster {
  members: number[];
  centroid: number[];
}

const squaredDistance = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, value, index) => sum + (value - (b[index] ?? 0)) ** 2, 0);

export function wardClusters(points: readonly (readonly number[])[], target: number | "auto"): number[] {
  const clusters: Cluster[] = points.map((point, index) => ({ members: [index], centroid: [...point] }));
  const wanted = target === "auto" ? 1 : Math.max(1, target);
  const autoMost = Math.min(MAX_CLUSTERS, Math.max(1, Math.floor(points.length / 2)));
  const autoGap = AUTO_GAP * Math.sqrt(points[0]?.length ?? 1);
  while (clusters.length > wanted) {
    let best = Number.POSITIVE_INFINITY;
    let left = 0;
    let right = 1;
    for (let i = 0; i < clusters.length; i += 1) {
      for (let j = i + 1; j < clusters.length; j += 1) {
        const a = clusters[i] as Cluster;
        const b = clusters[j] as Cluster;
        const sizes = (a.members.length * b.members.length) / (a.members.length + b.members.length);
        const cost = sizes * squaredDistance(a.centroid, b.centroid);
        if (cost < best) {
          best = cost;
          left = i;
          right = j;
        }
      }
    }
    const a = clusters[left] as Cluster;
    const b = clusters[right] as Cluster;
    const apart = Math.sqrt(squaredDistance(a.centroid, b.centroid));
    if (target === "auto" && clusters.length <= autoMost && apart > autoGap) break;
    const total = a.members.length + b.members.length;
    clusters[left] = {
      members: [...a.members, ...b.members],
      centroid: a.centroid.map(
        (value, index) => (value * a.members.length + (b.centroid[index] ?? 0) * b.members.length) / total,
      ),
    };
    clusters.splice(right, 1);
  }
  clusters.sort((a, b) => {
    for (let index = 0; index < a.centroid.length; index += 1) {
      const delta = (a.centroid[index] ?? 0) - (b.centroid[index] ?? 0);
      if (Math.abs(delta) > 1e-9) return delta;
    }
    return 0;
  });
  const labels = new Array<number>(points.length).fill(0);
  clusters.forEach((cluster, label) => {
    for (const member of cluster.members) labels[member] = label;
  });
  return labels;
}

export type ClusterResult =
  | { status: "off" | "few" | "many" }
  | {
      status: "ok";
      labels: Record<string, number>;
      groups: { ids: string[]; mean: Record<string, number> }[];
      short: boolean;
    };

export function clusterStudents(
  students: readonly StanceStudent[],
  picked: readonly string[],
  mode: ClusterMode,
): ClusterResult {
  if (mode === "off" || picked.length === 0) return { status: "off" };
  const complete = students.filter((student) => isComplete(student, picked));
  if (complete.length < MIN_CLUSTERED) return { status: "few" };
  if (complete.length > MAX_CLUSTERED) return { status: "many" };
  const points = complete.map((student) => picked.map((name) => coordOf(student.at[name])));
  const assigned = wardClusters(points, mode === "auto" ? "auto" : Number(mode));
  const labels: Record<string, number> = {};
  const groups: { ids: string[]; mean: Record<string, number> }[] = [];
  complete.forEach((student, index) => {
    const label = assigned[index] ?? 0;
    labels[student.id] = label;
    const group = groups[label] ?? { ids: [], mean: {} };
    groups[label] = group;
    group.ids.push(student.id);
  });
  for (const group of groups) {
    for (const name of picked) {
      const sum = group.ids.reduce(
        (total, id) => total + (complete.find((student) => student.id === id)?.at[name] ?? 0),
        0,
      );
      group.mean[name] = Math.round(sum / group.ids.length);
    }
  }
  return { status: "ok", labels, groups, short: mode !== "auto" && groups.length < Number(mode) };
}

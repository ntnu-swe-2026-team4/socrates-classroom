import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { scoreToCoords } from "./sim.js";

export interface AxisDef {
  name: string;
  left: string;
  right: string;
  color: string;
}

export interface SceneAgent {
  id: number;
  history: number[][];
}

export interface ClusterResult {
  assignments: number[];
  centroids: number[][];
  inertia: number;
}

type Slot = "x" | "y" | "z";

interface AxisVisual {
  line: THREE.Line;
  labels: THREE.Sprite[];
}

interface TweenState {
  start: number;
  dur: number;
  fromS: Record<Slot, number>;
  toS: Record<Slot, number>;
  fromPlane: number;
  toPlane: number;
  fromCube: number;
  toCube: number;
}

interface CamAnim {
  start: number;
  dur: number;
  fromPos: THREE.Vector3;
  toPos: THREE.Vector3;
  fromUp: THREE.Vector3;
  toUp: THREE.Vector3;
  cb?: () => void;
}

interface PosAnim {
  start: number;
  dur: number;
  from: Float32Array;
  to: Float32Array;
}

interface SceneState {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  controls: OrbitControls;
  axisGroup: THREE.Group;
  trajGroup: THREE.Group;
  centroidGroup: THREE.Group;
  points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  plane: THREE.Group;
  frame: THREE.LineSegments;
  grid: THREE.GridHelper;
  targets: Float32Array;
  disposed: boolean;
  dim: number;
  slotP: Record<Slot, number>;
  planeP: number;
  cubeP: number;
  pointSize: number;
  tween: TweenState | null;
  camAnim: CamAnim | null;
  posAnim: PosAnim | null;
  pendingPosAnim: boolean;
  axisVisuals: Partial<Record<Slot, AxisVisual>>;
  planeScaleMap: { mx: Slot; my: Slot };
}

interface ViewDef {
  pos: [number, number, number];
  up: [number, number, number];
}

export const CLUSTER_PALETTE = ["#c9564f", "#57a86e", "#5b8fc9", "#d9924f", "#9a6fc9", "#4fb3b3", "#c964a5", "#a89f4f"];
const NEUTRAL_COLOR = "#7d7466";

const CUBE = 1;
const SLOTS: Slot[] = ["x", "y", "z"];
const SLOT_DIRS: Record<Slot, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
const PLANAR_VIEWS: Record<string, ViewDef> = {
  "x,y": { pos: [0, 0, 3.2], up: [0, 1, 0] },
  "x,z": { pos: [0, -3.2, 0], up: [0, 0, 1] },
  "y,z": { pos: [3.2, 0, 0], up: [0, 0, 1] },
};
const LINE_VIEWS: Record<string, ViewDef> = {
  x: { pos: [0, 0, 3.2], up: [0, 1, 0] },
  y: { pos: [3.2, 0, 0], up: [0, 0, 1] },
  z: { pos: [0, 3.2, 0], up: [1, 0, 0] },
};

const SCENE_COLORS = {
  dark: {
    bg: "#1f2228",
    frame: "#4a4f5a",
    gridA: "#383d47",
    gridB: "#2d3139",
    planeOutline: "#c9a15a",
    planeGridA: "#4a4f5a",
    planeGridB: "#2d3139",
  },
  light: {
    bg: "#ffffff",
    frame: "#c9c7c0",
    gridA: "#dedcd5",
    gridB: "#ebe9e3",
    planeOutline: "#b3813a",
    planeGridA: "#d3d0c8",
    planeGridB: "#e2e0d9",
  },
} as const;

const DUR = 900;
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

function makeTextSprite(text: string, color: string, scheme: "dark" | "light") {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.font = 'bold 34px "Noto Serif TC", serif';
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  if (scheme === "light") {
    ctx.fillStyle = "#4a4234";
  } else {
    ctx.shadowColor = "rgba(8, 6, 4, 0.95)";
    ctx.shadowBlur = 7;
  }
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 34);
  ctx.fillText(text, 128, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.72, 0.18, 1);
  return sprite;
}

interface Scene3DProps {
  agents: SceneAgent[];
  version: number;
  axisMap: Record<Slot, number>;
  cluster: ClusterResult | null;
  showTraj: boolean;
  maxAbsTable: unknown[];
  dim: number;
  activeSlots: Slot[];
  axes: AxisDef[];
  background?: string;
  scheme?: "dark" | "light";
}

export default function Scene3D({
  agents,
  version,
  axisMap,
  cluster,
  showTraj,
  maxAbsTable,
  dim,
  activeSlots,
  axes,
  background,
  scheme = "dark",
}: Scene3DProps) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const scenePal = SCENE_COLORS[scheme];
  const threeRef = useRef<SceneState | null>(null);

  useEffect(() => {
    const scene = threeRef.current?.scene;
    if (scene) scene.background = new THREE.Color(background ?? scenePal.bg);
  }, [background, scenePal.bg]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: version is a mutation counter mutated in place; intentional recompute trigger
  const targets = useMemo(() => {
    const t = new Float32Array(agents.length * 3);
    agents.forEach((a, i) => {
      const step = a.history.length - 1;
      const c = scoreToCoords(a.history[step], axisMap, maxAbsTable[step], activeSlots);
      t[i * 3] = c[0];
      t[i * 3 + 1] = c[1];
      t[i * 3 + 2] = c[2];
    });
    return t;
  }, [agents, version, axisMap, maxAbsTable, activeSlots]);

  const colors = useMemo(() => {
    const c = new Float32Array(agents.length * 3);
    const neutral = new THREE.Color(NEUTRAL_COLOR);
    const tmp = new THREE.Color();
    agents.forEach((_, i) => {
      if (cluster) {
        tmp.set(CLUSTER_PALETTE[cluster.assignments[i] % CLUSTER_PALETTE.length]);
      } else {
        tmp.copy(neutral);
      }
      c[i * 3] = tmp.r;
      c[i * 3 + 1] = tmp.g;
      c[i * 3 + 2] = tmp.b;
    });
    return c;
  }, [agents, cluster]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: same as above; version retriggers the trajectory rebuild
  const trajectories = useMemo(() => {
    if (!showTraj) return null;
    return agents.map((a) => {
      const arr = new Float32Array(a.history.length * 3);
      a.history.forEach((h, s) => {
        const c = scoreToCoords(h, axisMap, maxAbsTable[s]);
        arr[s * 3] = c[0];
        arr[s * 3 + 1] = c[1];
        arr[s * 3 + 2] = c[2];
      });
      return arr;
    });
  }, [agents, showTraj, axisMap, maxAbsTable, version]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scene initializes once
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(background ?? scenePal.bg);

    const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
    camera.position.set(2.1, 1.7, 2.7);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 1.2;
    controls.maxDistance = 10;

    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(CUBE * 2, CUBE * 2, CUBE * 2)),
      new THREE.LineBasicMaterial({ color: scenePal.frame, transparent: true, opacity: 0.9 }),
    );
    scene.add(frame);

    const grid = new THREE.GridHelper(CUBE * 2, 8, scenePal.gridA, scenePal.gridB);
    grid.material.transparent = true;
    grid.position.y = -CUBE;
    scene.add(grid);

    const plane = new THREE.Group();
    const planeOutline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-CUBE, -CUBE, 0),
        new THREE.Vector3(CUBE, -CUBE, 0),
        new THREE.Vector3(CUBE, CUBE, 0),
        new THREE.Vector3(-CUBE, CUBE, 0),
      ]),
      new THREE.LineBasicMaterial({ color: scenePal.planeOutline, transparent: true, opacity: 0 }),
    );
    planeOutline.userData.base = 0.9;
    const planeGrid = new THREE.GridHelper(CUBE * 2, 8, scenePal.planeGridA, scenePal.planeGridB);
    planeGrid.rotation.x = Math.PI / 2;
    planeGrid.material.transparent = true;
    planeGrid.material.opacity = 0;
    planeGrid.userData.base = 0.55;
    plane.add(planeOutline, planeGrid);
    plane.visible = false;
    scene.add(plane);

    const axisGroup = new THREE.Group();
    const trajGroup = new THREE.Group();
    const centroidGroup = new THREE.Group();
    scene.add(axisGroup, trajGroup, centroidGroup);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(0), 3));
    const material = new THREE.PointsMaterial({
      size: 0.05,
      vertexColors: true,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const points = new THREE.Points(geometry, material);
    scene.add(points);

    const state: SceneState = {
      scene,
      camera,
      renderer,
      controls,
      axisGroup,
      trajGroup,
      centroidGroup,
      points,
      plane,
      frame,
      grid,
      targets: new Float32Array(0),
      disposed: false,
      dim: 3,
      slotP: { x: 1, y: 1, z: 1 },
      planeP: 0,
      cubeP: 1,
      pointSize: 0.05,
      tween: null,
      camAnim: null,
      posAnim: null,
      pendingPosAnim: false,
      axisVisuals: {},
      planeScaleMap: { mx: "x", my: "y" },
    };
    threeRef.current = state;
    const s = state;

    const onWheel = (e: WheelEvent) => {
      if (s.dim === 3 || s.camAnim) return;
      e.preventDefault();
      const dir = s.camera.position.clone().normalize();
      const d = THREE.MathUtils.clamp(s.camera.position.length() * (e.deltaY > 0 ? 1.08 : 0.925), 1.6, 7);
      s.camera.position.copy(dir.multiplyScalar(d));
      s.camera.lookAt(0, 0, 0);
    };
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

    const animate = () => {
      if (state.disposed) return;
      requestAnimationFrame(animate);
      const now = performance.now();

      if (s.camAnim) {
        const a = s.camAnim;
        const t = Math.min(1, (now - a.start) / a.dur);
        const e = easeInOutCubic(t);
        s.camera.position.lerpVectors(a.fromPos, a.toPos, e);
        s.camera.up.lerpVectors(a.fromUp, a.toUp, e).normalize();
        s.camera.lookAt(0, 0, 0);
        if (t >= 1) {
          s.camAnim = null;
          a.cb?.();
        }
      } else if (s.controls.enabled) {
        s.controls.update();
      }

      if (s.tween) {
        const a = s.tween;
        const t = Math.min(1, (now - a.start) / a.dur);
        const e = easeInOutCubic(t);
        for (const sl of SLOTS) s.slotP[sl] = a.fromS[sl] + (a.toS[sl] - a.fromS[sl]) * e;
        s.planeP = a.fromPlane + (a.toPlane - a.fromPlane) * e;
        s.cubeP = a.fromCube + (a.toCube - a.fromCube) * e;
        if (t >= 1) s.tween = null;
      }

      for (const sl of SLOTS) {
        const v = s.axisVisuals[sl];
        if (!v) continue;
        const k = s.slotP[sl];
        const lineMat = v.line.material as THREE.LineBasicMaterial;
        lineMat.opacity = 0.9 * k;
        v.line.visible = k > 0.01;
        v.line.scale.set(1, 1, 1);
        v.line.scale[sl] = Math.max(0.001, k);
        v.labels.forEach((sp) => {
          sp.material.opacity = k;
          sp.visible = k > 0.01;
          sp.position.copy(SLOT_DIRS[sl]).multiplyScalar(CUBE * 1.32 * k * (sp.userData.sign ?? 1));
        });
      }

      s.trajGroup.scale.set(Math.max(0.001, s.slotP.x), Math.max(0.001, s.slotP.y), Math.max(0.001, s.slotP.z));

      s.plane.visible = s.planeP > 0.005;
      if (s.plane.visible) {
        s.plane.traverse((obj) => {
          const mesh = obj as THREE.Mesh;
          const mat = mesh.material as THREE.Material | undefined;
          if (mat && !Array.isArray(mat)) mat.opacity = (obj.userData.base ?? 1) * s.planeP;
        });
        s.plane.scale.set(
          Math.max(0.001, s.slotP[s.planeScaleMap.mx]),
          Math.max(0.001, s.slotP[s.planeScaleMap.my]),
          1,
        );
      }

      (s.frame.material as THREE.LineBasicMaterial).opacity = 0.9 * s.cubeP;
      (s.grid.material as THREE.Material).opacity = s.cubeP;
      s.frame.visible = s.grid.visible = s.cubeP > 0.005;

      const sizeTarget = s.dim === 1 ? 0.105 : s.dim === 2 ? 0.068 : 0.05;
      material.size += (sizeTarget - material.size) * 0.12;

      const pos = geometry.attributes.position.array;
      const tgt = s.targets;
      if (pos.length === tgt.length) {
        if (s.pendingPosAnim) {
          s.pendingPosAnim = false;
          s.posAnim = {
            start: now,
            dur: DUR,
            from: Float32Array.from(pos),
            to: Float32Array.from(tgt),
          };
        }
        if (s.posAnim) {
          const a = s.posAnim;
          const t = Math.min(1, (now - a.start) / a.dur);
          const e = easeInOutCubic(t);
          for (let i = 0; i < pos.length; i++) pos[i] = a.from[i] + (a.to[i] - a.from[i]) * e;
          if (t >= 1) s.posAnim = null;
        } else {
          for (let i = 0; i < pos.length; i++) {
            pos[i] += (tgt[i] - pos[i]) * 0.085;
          }
        }
        geometry.attributes.position.needsUpdate = true;
      }
      renderer.render(scene, camera);
    };
    animate();

    const resize = () => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      // Portrait (phone) viewports: widen the vertical FOV so the horizontal FOV never drops below
      // the 50° landscape framing, otherwise the axis labels at the cube edges get clipped.
      camera.fov =
        camera.aspect < 1
          ? THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(25)) / camera.aspect))
          : 50;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    return () => {
      state.disposed = true;
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("wheel", onWheel);
      geometry.dispose();
      material.dispose();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const meshMat = mesh.material as THREE.Material | THREE.Material[] | undefined;
        const anyMat = meshMat as unknown as { map?: THREE.Texture };
        if (Array.isArray(meshMat)) {
          for (const m of meshMat) m.dispose();
        } else if (meshMat) {
          if (anyMat.map) anyMat.map.dispose();
          meshMat.dispose();
        }
      });
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      threeRef.current = null;
    };
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: rebuild only when the roster size changes
  useEffect(() => {
    const s = threeRef.current;
    if (!s) return;
    const geometry = s.points.geometry;
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(agents.length * 3), 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(colors.slice(), 3));
    s.targets = targets.slice();
    geometry.attributes.position.array.set(targets);
    geometry.attributes.position.needsUpdate = true;
  }, [agents.length]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: axis visuals rebuild only when axisMap changes
  useEffect(() => {
    const s = threeRef.current;
    if (!s) return;
    const { axisGroup } = s;
    axisGroup.clear();
    const visuals: Partial<Record<Slot, AxisVisual>> = {};
    for (const slot of SLOTS) {
      const axis = axes[axisMap[slot]];
      if (!axis) continue;
      const axisMeta = axis;
      const dir = SLOT_DIRS[slot];
      const from = dir.clone().multiplyScalar(-CUBE * 1.12);
      const to = dir.clone().multiplyScalar(CUBE * 1.12);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([from, to]),
        new THREE.LineBasicMaterial({ color: axisMeta.color, transparent: true, opacity: 0.9 }),
      );
      axisGroup.add(line);
      const negLabel = makeTextSprite(axis.left, axisMeta.color, scheme);
      negLabel.position.copy(dir.clone().multiplyScalar(-CUBE * 1.32));
      negLabel.userData.sign = -1;
      axisGroup.add(negLabel);
      const posLabel = makeTextSprite(axis.right, axisMeta.color, scheme);
      posLabel.position.copy(dir.clone().multiplyScalar(CUBE * 1.32));
      posLabel.userData.sign = 1;
      axisGroup.add(posLabel);
      visuals[slot] = { line, labels: [negLabel, posLabel] };
    }
    s.axisVisuals = visuals;
  }, [axisMap]);

  useEffect(() => {
    const s = threeRef.current;
    if (!s) return;
    s.dim = dim;
    s.controls.enabled = false;
    s.pendingPosAnim = true;

    const toS = { x: 0, y: 0, z: 0 };
    for (const sl of activeSlots) toS[sl] = 1;
    s.tween = {
      start: performance.now(),
      dur: DUR,
      fromS: { ...s.slotP },
      toS,
      fromPlane: s.planeP,
      toPlane: dim === 2 ? 1 : 0,
      fromCube: s.cubeP,
      toCube: dim === 3 ? 1 : 0,
    };

    if (dim === 2 && activeSlots.length === 2) {
      const [a, b] = activeSlots;
      if (a === "x" && b === "y") {
        s.plane.rotation.set(0, 0, 0);
        s.planeScaleMap = { mx: "x", my: "y" };
      } else if (a === "x" && b === "z") {
        s.plane.rotation.set(Math.PI / 2, 0, 0);
        s.planeScaleMap = { mx: "x", my: "z" };
      } else {
        s.plane.rotation.set(0, Math.PI / 2, 0);
        s.planeScaleMap = { mx: "z", my: "y" };
      }
    }

    let view: ViewDef;
    if (dim === 3) view = { pos: [2.1, 1.7, 2.7], up: [0, 1, 0] };
    else if (dim === 2) view = PLANAR_VIEWS[activeSlots.join(",")];
    else if (dim === 1) view = LINE_VIEWS[activeSlots[0]];
    else view = { pos: [0, 0, 3.2], up: [0, 1, 0] };

    s.camAnim = {
      start: performance.now(),
      dur: DUR,
      fromPos: s.camera.position.clone(),
      toPos: new THREE.Vector3(...view.pos),
      fromUp: s.camera.up.clone(),
      toUp: new THREE.Vector3(...view.up),
      cb: () => {
        s.controls.enabled = dim === 3;
      },
    };
  }, [dim, activeSlots]);

  useEffect(() => {
    const s = threeRef.current;
    if (!s) return;
    s.targets = targets;
    s.points.geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    s.trajGroup.clear();
    if (trajectories) {
      agents.forEach((_, i) => {
        const arr = trajectories[i];
        if (arr.length < 6) return;
        const g = new THREE.BufferGeometry();
        g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
        const color = cluster ? CLUSTER_PALETTE[cluster.assignments[i] % CLUSTER_PALETTE.length] : NEUTRAL_COLOR;
        const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.28 }));
        s.trajGroup.add(line);
      });
    }

    s.centroidGroup.clear();
    if (cluster) {
      cluster.centroids.forEach((c) => {
        const mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.055, 20, 20),
          new THREE.MeshBasicMaterial({
            color: CLUSTER_PALETTE[cluster.centroids.indexOf(c) % CLUSTER_PALETTE.length],
            transparent: true,
            opacity: 0.5,
          }),
        );
        mesh.position.set(c[0], c[1], c[2]);
        s.centroidGroup.add(mesh);
      });
    }
  }, [targets, colors, trajectories, cluster, agents]);

  return <div ref={mountRef} className="h-full w-full" />;
}

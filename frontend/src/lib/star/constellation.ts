// @ts-nocheck
/* =========================================================
   立場星圖 — three.js 場景引擎（vanilla 版）

   移植自 values-constellation-3d 的 Scene3D.jsx，改成不依賴 React 的
   createConstellation(mount) → 控制物件。保留的行為：
     - 0–3 維漸展：0 軸空白 → 1 軸量表 → 2 軸平面 → 3 軸立體，
       鏡頭 / 軸生長 / 點位全部走同一條 900ms ease-in-out 曲線
     - 逐輪漂移：點位以指數趨近新目標
     - 軌跡、群心球、群色
   新增／改動：
     - 背景透明（讓卡片底色與深淺色主題自己決定），提供 setTheme()
     - 圓形發光的星點（取代預設的方點）
     - 「你」這一點有環形標記與文字標籤
   座標一律 [-1, 1]，槽位 x / y / z 各對應一條軸。
   ========================================================= */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const CUBE = 1;
const SLOTS = ["x", "y", "z"];
const SLOT_DIRS = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1),
};
// 各平面組合的「正面」機位（第一軸水平、第二軸垂直）
const PLANAR_VIEWS = {
  "x,y": { pos: [0, 0, 3.2], up: [0, 1, 0] },
  "x,z": { pos: [0, -3.2, 0], up: [0, 0, 1] },
  "y,z": { pos: [3.2, 0, 0], up: [0, 0, 1] },
};
// 單軸量表：讓該軸呈水平左右的機位
const LINE_VIEWS = {
  x: { pos: [0, 0, 3.2], up: [0, 1, 0] },
  y: { pos: [3.2, 0, 0], up: [0, 0, 1] },
  z: { pos: [0, 3.2, 0], up: [1, 0, 0] },
};
const VIEW_3D = { pos: [2.1, 1.7, 2.7], up: [0, 1, 0] };
const DUR = 900;
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const THEMES = {
  dark: {
    frame: "#666b78", grid1: "#464a55", grid2: "#353840",
    planeLine: "#c9a15a", planeGrid1: "#575c69", planeGrid2: "#3d414b",
    neutral: "#a3a6b1", labelShadow: "rgba(24,26,32,0.95)", labelBlur: 7, me: "#f3efe6",
  },
  light: {
    frame: "#a9a79f", grid1: "#c7c5bd", grid2: "#dad8d0",
    planeLine: "#b3813a", planeGrid1: "#b9b7af", planeGrid2: "#d3d1c9",
    neutral: "#6c6e78", labelShadow: "rgba(255,255,255,0.85)", labelBlur: 3, me: "#17181c",
  },
};

function makeTextSprite(text, color, shadow, blur, size = 34) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.font = `700 ${size}px "Noto Serif TC","Songti TC",serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.shadowColor = shadow;
  ctx.shadowBlur = blur;
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 34);
  ctx.shadowBlur = 0; // 第二次不再加光暈，只把字疊實
  ctx.fillText(text, 128, 34);
  const texture = new THREE.CanvasTexture(canvas);
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace; // 不標的話文字顏色會被當成線性值再提亮一次，淺色背景上會很淡
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }),
  );
  sprite.scale.set(0.66, 0.165, 1);
  return sprite;
}

/** 淺色背景上，軸色（為深色背景挑的）要壓深一點才讀得到 */
function toneFor(color, isLight) {
  return isLight ? new THREE.Color(color).lerp(new THREE.Color(0x000000), 0.45).getStyle() : color;
}

function srgbTex(canvas) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeDotTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.5, "rgba(255,255,255,1)");
  grd.addColorStop(0.68, "rgba(255,255,255,0.4)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function makeRingSprite(color) {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  g.strokeStyle = color;
  g.lineWidth = 7;
  g.beginPath();
  g.arc(64, 64, 46, 0, Math.PI * 2);
  g.stroke();
  g.globalAlpha = 0.28;
  g.lineWidth = 3;
  g.beginPath();
  g.arc(64, 64, 58, 0, Math.PI * 2);
  g.stroke();
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({ map: srgbTex(c), transparent: true, depthTest: false }),
  );
  sprite.scale.set(0.24, 0.24, 1);
  sprite.renderOrder = 10;
  return sprite;
}

function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      if (o.material.map) o.material.map.dispose();
      o.material.dispose();
    }
  });
}

export function createConstellation(mount, { light = false } = {}) {
  let theme = THEMES[light ? "light" : "dark"];

  // ---------- 資料狀態 ----------
  let agents = []; // { id, me, history: [{axKey: v}] }
  let axisDefs = {}; // key → { name, left, right, color }
  let axisMap = { x: null, y: null, z: null };
  let activeSlots = [];
  let step = 0;
  let showTraj = false;
  let cluster = null;
  let meIndex = -1;

  // ---------- 場景 ----------
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.01, 100);
  camera.position.set(...VIEW_3D.pos);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0x000000, 0);
  mount.appendChild(renderer.domElement);
  renderer.domElement.style.display = "block";

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 1.2;
  controls.maxDistance = 10;
  controls.enabled = false;

  // 外框 / 格線 / 2D 平面：換主題時整組重建
  let frames = null;
  const frameRoot = new THREE.Group();
  scene.add(frameRoot);

  function buildFrames() {
    if (frames) {
      frameRoot.remove(frames.group);
      disposeObject(frames.group);
    }
    const group = new THREE.Group();
    const frame = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(CUBE * 2, CUBE * 2, CUBE * 2)),
      new THREE.LineBasicMaterial({ color: theme.frame, transparent: true, opacity: 0.9 }),
    );
    const grid = new THREE.GridHelper(CUBE * 2, 8, theme.grid1, theme.grid2);
    grid.material.transparent = true;
    grid.position.y = -CUBE;

    const plane = new THREE.Group();
    const planeOutline = new THREE.LineLoop(
      new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-CUBE, -CUBE, 0),
        new THREE.Vector3(CUBE, -CUBE, 0),
        new THREE.Vector3(CUBE, CUBE, 0),
        new THREE.Vector3(-CUBE, CUBE, 0),
      ]),
      new THREE.LineBasicMaterial({ color: theme.planeLine, transparent: true, opacity: 0 }),
    );
    planeOutline.userData.base = 0.9;
    const planeGrid = new THREE.GridHelper(CUBE * 2, 8, theme.planeGrid1, theme.planeGrid2);
    planeGrid.rotation.x = Math.PI / 2;
    planeGrid.material.transparent = true;
    planeGrid.material.opacity = 0;
    planeGrid.userData.base = 0.6;
    plane.add(planeOutline, planeGrid);
    plane.rotation.copy(frames ? frames.plane.rotation : new THREE.Euler());

    group.add(frame, grid, plane);
    frameRoot.add(group);
    frames = { group, frame, grid, plane };
  }
  buildFrames();

  const axisGroup = new THREE.Group();
  const trajGroup = new THREE.Group();
  const centroidGroup = new THREE.Group();
  scene.add(axisGroup, trajGroup, centroidGroup);

  // 星點
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(0), 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(0), 3));
  const dotTex = makeDotTexture();
  const material = new THREE.PointsMaterial({
    size: 0.1,
    map: dotTex,
    vertexColors: true,
    sizeAttenuation: true,
    transparent: true,
    alphaTest: 0.04,
    depthWrite: false,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false;
  scene.add(points);

  // 「你」的標記
  let meRing = null;
  let meLabel = null;
  function buildMeMarker() {
    if (meRing) { scene.remove(meRing); disposeObject(meRing); meRing = null; }
    if (meLabel) { scene.remove(meLabel); disposeObject(meLabel); meLabel = null; }
    if (meIndex < 0) return;
    meRing = makeRingSprite(theme.me);
    meLabel = makeTextSprite("你", theme.me, theme.labelShadow, theme.labelBlur, 40);
    meLabel.scale.set(0.42, 0.105, 1);
    meLabel.renderOrder = 11;
    scene.add(meRing, meLabel);
  }

  // ---------- 動畫狀態 ----------
  const S = {
    dim: 3,
    slotP: { x: 1, y: 1, z: 1 },
    planeP: 0,
    cubeP: 1,
    tween: null,
    camAnim: null,
    posAnim: null,
    pendingPosAnim: false,
    axisVisuals: {},
    planeScaleMap: { mx: "x", my: "y" },
    targets: new Float32Array(0),
    disposed: false,
  };

  // ---------- 資料 → 座標 ----------
  function coordOf(hist, slots) {
    return SLOTS.map((sl) => (slots.includes(sl) && axisMap[sl] ? hist[axisMap[sl]] ?? 0 : 0));
  }

  /** 目前這一輪、依「啟用中的軸」換算的座標（給分群用；未啟用的槽位為 0） */
  function coordsAt(s = step) {
    return agents.map((a) => coordOf(a.history[Math.min(s, a.history.length - 1)], activeSlots));
  }

  function nodeColors() {
    const c = new Float32Array(agents.length * 3);
    const neutral = new THREE.Color(theme.neutral);
    const tmp = new THREE.Color();
    agents.forEach((a, i) => {
      if (cluster) tmp.set(cluster.palette[cluster.assignments[i] % cluster.palette.length]);
      else tmp.copy(neutral);
      c[i * 3] = tmp.r; c[i * 3 + 1] = tmp.g; c[i * 3 + 2] = tmp.b;
    });
    return c;
  }

  function refreshTargets() {
    const t = new Float32Array(agents.length * 3);
    agents.forEach((a, i) => {
      const c = coordOf(a.history[Math.min(step, a.history.length - 1)], activeSlots);
      t[i * 3] = c[0]; t[i * 3 + 1] = c[1]; t[i * 3 + 2] = c[2];
    });
    S.targets = t;
  }

  function refreshColors() {
    geometry.setAttribute("color", new THREE.BufferAttribute(nodeColors(), 3));
  }

  function refreshTrajectories() {
    trajGroup.children.slice().forEach((o) => { trajGroup.remove(o); disposeObject(o); });
    if (!showTraj) return;
    agents.forEach((a, i) => {
      const last = Math.min(step, a.history.length - 1);
      if (last < 1) return;
      const arr = new Float32Array((last + 1) * 3);
      for (let s = 0; s <= last; s++) {
        const c = coordOf(a.history[s], SLOTS); // 軌跡維持完整 3D 形狀，收合交給 trajGroup 縮放
        arr[s * 3] = c[0]; arr[s * 3 + 1] = c[1]; arr[s * 3 + 2] = c[2];
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.BufferAttribute(arr, 3));
      const color = cluster ? cluster.palette[cluster.assignments[i] % cluster.palette.length] : theme.neutral;
      trajGroup.add(
        new THREE.Line(g, new THREE.LineBasicMaterial({ color, transparent: true, opacity: a.me ? 0.9 : 0.3 })),
      );
    });
  }

  function refreshCentroids() {
    centroidGroup.children.slice().forEach((o) => { centroidGroup.remove(o); disposeObject(o); });
    if (!cluster) return;
    cluster.centroids.forEach((c, i) => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 20, 20),
        new THREE.MeshBasicMaterial({
          color: cluster.palette[i % cluster.palette.length],
          transparent: true,
          opacity: 0.5,
        }),
      );
      mesh.position.set(c[0], c[1], c[2]);
      centroidGroup.add(mesh);
    });
  }

  function rebuildAxes() {
    axisGroup.children.slice().forEach((o) => { axisGroup.remove(o); disposeObject(o); });
    const visuals = {};
    for (const slot of SLOTS) {
      const axis = axisDefs[axisMap[slot]];
      if (!axis) continue;
      const dir = SLOT_DIRS[slot];
      const col = toneFor(axis.color, theme === THEMES.light);
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([
          dir.clone().multiplyScalar(-CUBE * 1.12),
          dir.clone().multiplyScalar(CUBE * 1.12),
        ]),
        new THREE.LineBasicMaterial({ color: col, transparent: true, opacity: 0.9 }),
      );
      axisGroup.add(line);
      const neg = makeTextSprite(axis.left, col, theme.labelShadow, theme.labelBlur);
      neg.userData.sign = -1;
      const pos = makeTextSprite(axis.right, col, theme.labelShadow, theme.labelBlur);
      pos.userData.sign = 1;
      axisGroup.add(neg, pos);
      visuals[slot] = { line, labels: [neg, pos] };
    }
    S.axisVisuals = visuals;
  }

  // ---------- 對外 API ----------
  const api = {
    /** 換一批資料（切換議題時）。位置直接跳到新位置，不做補間。 */
    setAgents(list) {
      agents = list;
      meIndex = list.findIndex((a) => a.me);
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(list.length * 3), 3));
      refreshTargets();
      geometry.attributes.position.array.set(S.targets);
      geometry.attributes.position.needsUpdate = true;
      cluster = null;
      refreshColors();
      refreshTrajectories();
      refreshCentroids();
      buildMeMarker();
    },

    /** 設定各軸定義與槽位對應（axisDefs: {key: {name,left,right,color}}, map: {x,y,z}） */
    setAxes(defs, map) {
      axisDefs = defs;
      axisMap = { ...map };
      rebuildAxes();
      refreshTargets();
      refreshTrajectories();
      S.pendingPosAnim = true; // 換軸時點位平滑移過去
    },

    /** 啟用中的槽位（長度 0–3 = 維度）。instant 為 true 時不做動畫（初始化用）。 */
    setActive(slots, { instant = false } = {}) {
      activeSlots = slots.slice();
      const dim = activeSlots.length;
      S.dim = dim;
      refreshTargets();
      refreshTrajectories();

      const toS = { x: 0, y: 0, z: 0 };
      for (const sl of activeSlots) toS[sl] = 1;

      if (dim === 2) {
        const [a, b] = activeSlots;
        if (a === "x" && b === "y") { frames.plane.rotation.set(0, 0, 0); S.planeScaleMap = { mx: "x", my: "y" }; }
        else if (a === "x" && b === "z") { frames.plane.rotation.set(Math.PI / 2, 0, 0); S.planeScaleMap = { mx: "x", my: "z" }; }
        else { frames.plane.rotation.set(0, Math.PI / 2, 0); S.planeScaleMap = { mx: "z", my: "y" }; }
      }

      let view;
      if (dim === 3) view = VIEW_3D;
      else if (dim === 2) view = PLANAR_VIEWS[activeSlots.join(",")] || PLANAR_VIEWS["x,y"];
      else if (dim === 1) view = LINE_VIEWS[activeSlots[0]];
      else view = { pos: [0, 0, 3.2], up: [0, 1, 0] };

      if (instant) {
        S.slotP = { ...toS };
        S.planeP = dim === 2 ? 1 : 0;
        S.cubeP = dim === 3 ? 1 : 0;
        camera.position.set(...view.pos);
        camera.up.set(...view.up);
        camera.lookAt(0, 0, 0);
        controls.enabled = dim === 3;
        geometry.attributes.position.array.set(S.targets);
        geometry.attributes.position.needsUpdate = true;
        return;
      }

      controls.enabled = false;
      S.pendingPosAnim = true;
      S.tween = {
        start: performance.now(), dur: DUR,
        fromS: { ...S.slotP }, toS,
        fromPlane: S.planeP, toPlane: dim === 2 ? 1 : 0,
        fromCube: S.cubeP, toCube: dim === 3 ? 1 : 0,
      };
      S.camAnim = {
        start: performance.now(), dur: DUR,
        fromPos: camera.position.clone(), toPos: new THREE.Vector3(...view.pos),
        fromUp: camera.up.clone(), toUp: new THREE.Vector3(...view.up),
        cb: () => { controls.enabled = dim === 3; },
      };
    },

    /** 對話輪次（時間軸）。點位以指數趨近新目標，看起來是連續漂移。 */
    setStep(s) {
      step = s;
      refreshTargets();
      refreshTrajectories();
    },

    setCluster(c) {
      // c: { assignments, centroids, palette } | null
      cluster = c;
      refreshColors();
      refreshTrajectories();
      refreshCentroids();
    },

    setTrajectories(on) {
      showTraj = on;
      refreshTrajectories();
    },

    setTheme(isLight) {
      theme = THEMES[isLight ? "light" : "dark"];
      buildFrames();
      rebuildAxes();
      buildMeMarker();
      refreshColors();
      refreshTrajectories();
    },

    coordsAt,
    resize() { onResize(); },
    dispose() {
      S.disposed = true;
      ro.disconnect();
      controls.dispose();
      renderer.domElement.removeEventListener("wheel", onWheel);
      trajGroup.children.slice().forEach((o) => disposeObject(o));
      disposeObject(scene);
      dotTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    },
  };

  // ---------- 1D / 2D 的滾輪縮放（OrbitControls 停用時） ----------
  function onWheel(e) {
    if (S.dim === 3 || S.camAnim) return;
    e.preventDefault();
    const dir = camera.position.clone().normalize();
    const d = THREE.MathUtils.clamp(camera.position.length() * (e.deltaY > 0 ? 1.08 : 0.925), 1.6, 7);
    camera.position.copy(dir.multiplyScalar(d));
    camera.lookAt(0, 0, 0);
  }
  renderer.domElement.addEventListener("wheel", onWheel, { passive: false });

  // ---------- 渲染迴圈 ----------
  function animate() {
    if (S.disposed) return;
    requestAnimationFrame(animate);
    if (mount.clientWidth === 0 || mount.clientHeight === 0) return; // 頁面被隱藏時不畫

    const now = performance.now();

    if (S.camAnim) {
      const a = S.camAnim;
      const t = Math.min(1, (now - a.start) / a.dur);
      const e = easeInOutCubic(t);
      camera.position.lerpVectors(a.fromPos, a.toPos, e);
      camera.up.lerpVectors(a.fromUp, a.toUp, e).normalize();
      camera.lookAt(0, 0, 0);
      if (t >= 1) { S.camAnim = null; a.cb && a.cb(); }
    } else if (controls.enabled) {
      controls.update();
    }

    if (S.tween) {
      const a = S.tween;
      const t = Math.min(1, (now - a.start) / a.dur);
      const e = easeInOutCubic(t);
      for (const sl of SLOTS) S.slotP[sl] = a.fromS[sl] + (a.toS[sl] - a.fromS[sl]) * e;
      S.planeP = a.fromPlane + (a.toPlane - a.fromPlane) * e;
      S.cubeP = a.fromCube + (a.toCube - a.fromCube) * e;
      if (t >= 1) S.tween = null;
    }

    // 軸線從中心生長，標籤隨之滑出
    for (const sl of SLOTS) {
      const v = S.axisVisuals[sl];
      if (!v) continue;
      const k = S.slotP[sl];
      v.line.material.opacity = 0.9 * k;
      v.line.visible = k > 0.01;
      v.line.scale.set(1, 1, 1);
      v.line.scale[sl] = Math.max(0.001, k);
      v.labels.forEach((sp) => {
        sp.material.opacity = k;
        sp.visible = k > 0.01;
        sp.position.copy(SLOT_DIRS[sl]).multiplyScalar(CUBE * 1.32 * k * (sp.userData.sign ?? 1));
      });
    }

    trajGroup.scale.set(Math.max(0.001, S.slotP.x), Math.max(0.001, S.slotP.y), Math.max(0.001, S.slotP.z));

    const { plane, frame, grid } = frames;
    plane.visible = S.planeP > 0.005;
    if (plane.visible) {
      plane.traverse((o) => { if (o.material) o.material.opacity = (o.userData.base ?? 1) * S.planeP; });
      plane.scale.set(
        Math.max(0.001, S.slotP[S.planeScaleMap.mx]),
        Math.max(0.001, S.slotP[S.planeScaleMap.my]),
        1,
      );
    }
    frame.material.opacity = 0.9 * S.cubeP;
    grid.material.opacity = S.cubeP;
    frame.visible = grid.visible = S.cubeP > 0.005;

    // 低維時星點放大
    const sizeTarget = S.dim === 1 ? 0.15 : S.dim === 2 ? 0.115 : 0.1;
    material.size += (sizeTarget - material.size) * 0.12;

    // 點位：維度切換時以 ease-in-out 補間；平時指數趨近（逐輪漂移）
    const pos = geometry.attributes.position.array;
    const tgt = S.targets;
    if (pos.length === tgt.length) {
      if (S.pendingPosAnim) {
        S.pendingPosAnim = false;
        S.posAnim = { start: now, dur: DUR, from: Float32Array.from(pos), to: null };
      }
      if (S.posAnim) {
        const a = S.posAnim;
        const t = Math.min(1, (now - a.start) / a.dur);
        const e = easeInOutCubic(t);
        for (let i = 0; i < pos.length; i++) pos[i] = a.from[i] + (tgt[i] - a.from[i]) * e; // 目標若中途改變也會追上
        if (t >= 1) S.posAnim = null;
      } else {
        for (let i = 0; i < pos.length; i++) pos[i] += (tgt[i] - pos[i]) * 0.1;
      }
      geometry.attributes.position.needsUpdate = true;
    }

    if (meRing && meIndex >= 0 && pos.length >= (meIndex + 1) * 3) {
      const x = pos[meIndex * 3], y = pos[meIndex * 3 + 1], z = pos[meIndex * 3 + 2];
      meRing.position.set(x, y, z);
      meLabel.position.set(x, y + 0.17, z);
    }

    renderer.render(scene, camera);
  }
  animate();

  function onResize() {
    const w = mount.clientWidth;
    const h = mount.clientHeight;
    if (w === 0 || h === 0) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
  onResize();
  const ro = new ResizeObserver(onResize);
  ro.observe(mount);

  return api;
}

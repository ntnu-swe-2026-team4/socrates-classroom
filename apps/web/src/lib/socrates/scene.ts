import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Avatar } from "./avatar";

type GLTF = { scene: THREE.Object3D; animations: THREE.AnimationClip[] };
const modelCache = new Map<string, Promise<GLTF>>();

export interface SceneOptions {
  mini?: boolean;
  onReady?: () => void;
  onError?: () => void;
}

const FAKE_VISEMES = ["viseme_aa", "viseme_E", "viseme_O", "viseme_PP", "viseme_FF", "viseme_kk", "viseme_I"];

function fakeVisemeSample(t: number) {
  const idx = Math.floor(t * 8) % FAKE_VISEMES.length;
  return { viseme: FAKE_VISEMES[idx] ?? null, weight: 0.4 + 0.4 * Math.abs(Math.sin(t * 13)) };
}

function loadModel(url: string) {
  let load = modelCache.get(url);
  if (!load) {
    const pending = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
    modelCache.set(url, pending);
    pending.catch(() => {
      if (modelCache.get(url) === pending) modelCache.delete(url);
    });
    load = pending;
  }
  return load.then((g) => ({ model: cloneSkinned(g.scene), clips: g.animations }));
}

function buildStoneMaterial(baseMap: THREE.Texture | null, fallback: THREE.Color | null): THREE.ShaderMaterial {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: baseMap },
      uHasMap: { value: baseMap ? 1 : 0 },
      uFallback: { value: fallback ?? new THREE.Color(0x555555) },
    },
    vertexShader: `
      #include <morphtarget_pars_vertex>
      varying vec3 vWorldNormal;
      varying vec2 vUv;
      void main(){
        vUv = uv;
        vec3 transformed = vec3(position);
        #include <morphtarget_vertex>
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float uHasMap;
      uniform vec3 uFallback;
      varying vec3 vWorldNormal;
      varying vec2 vUv;
      void main(){
        vec3 n = normalize(vWorldNormal);
        vec3 base = uHasMap > 0.5 ? texture2D(map, vUv).rgb : uFallback;
        float light = 0.55;
        light += 0.32 * max(dot(n, normalize(vec3(-1.2, 2.0, 1.6))), 0.0);
        light += 0.14 * max(dot(n, normalize(vec3(1.5, 0.4, 1.2))), 0.0);
        light += 0.22 * max(dot(n, normalize(vec3(0.8, 1.5, -1.8))), 0.0);
        vec3 color = pow(max(base * min(light, 1.3), vec3(0.0)), vec3(1.0 / 2.2));
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  (material as unknown as { morphTargets: boolean }).morphTargets = true;
  return material;
}

export function createSocratesScene(canvas: HTMLCanvasElement, stage: HTMLElement, opts: SceneOptions = {}) {
  const mini = !!opts.mini;
  let speaking = false;
  let avatar: Avatar | null = null;
  let pendingExpression: [string, { loop?: boolean }] | null = null;
  let disposed = false;
  const stoneMaterials: THREE.ShaderMaterial[] = [];

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "default" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mini ? 1.75 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  scene.background = null;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  const key = new THREE.DirectionalLight(0xfff1dd, 2.4);
  key.position.set(-1.2, 2.0, 1.6);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
  fill.position.set(1.5, 0.4, 1.2);
  const rim = new THREE.DirectionalLight(0xbfd4ff, 1.6);
  rim.position.set(0.8, 1.5, -1.8);
  scene.add(key, fill, rim, new THREE.HemisphereLight(0xfff6ea, 0x2a221c, 0.4));

  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.minPolarAngle = Math.PI / 2;
  controls.maxPolarAngle = Math.PI / 2;
  const viewDirection = new THREE.Vector3(0, 0, 1);
  let modelCenter = new THREE.Vector3(0, 0, 0);
  let modelHeight = 1;

  function resize() {
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    const fovRad = (camera.fov * Math.PI) / 180;
    const desiredScreenFrac = mini ? 1.1 : 1.25;
    const distance = (modelHeight * desiredScreenFrac) / (2 * Math.tan(fovRad / 2));
    if (camera.position.distanceToSquared(controls.target) > 0) {
      viewDirection.subVectors(camera.position, controls.target).normalize();
    }
    controls.target.copy(modelCenter);
    camera.position.copy(modelCenter).addScaledVector(viewDirection, distance);
    camera.lookAt(modelCenter);
    camera.updateProjectionMatrix();
    kick();
  }
  window.addEventListener("resize", resize);
  const ro = new ResizeObserver(() => resize());
  ro.observe(stage);

  loadModel("/socrates.glb")
    .then(({ model, clips }) => {
      if (disposed) return;
      avatar = new Avatar(model, clips);
      if (pendingExpression) avatar.setExpression(...pendingExpression);
      model.traverse((object) => {
        const mesh = object as THREE.Mesh;
        if (!mesh.isMesh) return;
        const source = mesh.material as THREE.MeshStandardMaterial | null;
        const material = buildStoneMaterial(source?.map ?? null, source?.color ? source.color.clone() : null);
        stoneMaterials.push(material);
        mesh.material = material;
      });
      scene.add(avatar.root);
      const box = new THREE.Box3().setFromObject(avatar.root);
      modelCenter = box.getCenter(new THREE.Vector3());
      modelHeight = box.getSize(new THREE.Vector3()).y || 1;
      resize();
      opts.onReady?.();
      kick();
    })
    .catch(() => {
      if (disposed) return;
      opts.onError?.();
    });

  let lastTick = performance.now();
  let elapsed = 0;
  function tick(): number {
    const now = performance.now();
    const delta = (now - lastTick) / 1000;
    lastTick = now;
    elapsed += delta;
    return delta;
  }
  let raf = 0;
  let visible = true;
  const FRAME_MS = mini ? 1000 / 30 : 0;
  let last = 0;

  function frame(now: number) {
    if (disposed) return;
    raf = 0;
    if (!visible || document.hidden) return;
    if (FRAME_MS && now - last < FRAME_MS) {
      raf = requestAnimationFrame(frame);
      return;
    }
    last = now;
    const dt = Math.min(tick(), 0.1);
    if (avatar) {
      if (speaking) {
        const sample = fakeVisemeSample(elapsed);
        avatar.setViseme(sample.viseme, sample.weight);
      }
      avatar.update(dt);
    }
    controls.update();
    renderer.render(scene, camera);
    raf = requestAnimationFrame(frame);
  }

  function kick() {
    if (disposed || raf || !visible || document.hidden) return;
    tick();
    raf = requestAnimationFrame(frame);
  }

  const io = new IntersectionObserver(([e]) => {
    visible = !!e?.isIntersecting;
    if (visible) kick();
  });
  io.observe(stage);
  const onVisibility = () => {
    if (!document.hidden) kick();
  };
  document.addEventListener("visibilitychange", onVisibility);
  kick();

  return {
    setSpeaking(on: boolean) {
      speaking = on;
      if (!on && avatar) avatar.setViseme(null, 0);
      kick();
    },
    setExpression(name: string | null, options?: { loop?: boolean }) {
      if (avatar) avatar.setExpression(name, options);
      else pendingExpression = name ? [name, options ?? {}] : null;
      kick();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", onVisibility);
      io.disconnect();
      ro.disconnect();
      controls.dispose();
      pmrem.dispose();
      scene.environment?.dispose();
      for (const material of stoneMaterials) material.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

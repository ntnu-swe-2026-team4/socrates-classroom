import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { MeshoptDecoder } from "three/addons/libs/meshopt_decoder.module.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { clone as cloneSkinned } from "three/addons/utils/SkeletonUtils.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Avatar } from "./avatar";

import type { Avatar as AvatarType } from "./avatar";

type GLTF = { scene: THREE.Object3D; animations: THREE.AnimationClip[] };
const modelCache = new Map<string, Promise<GLTF>>();

export interface SceneOptions {
  mini?: boolean;
  onHologram?: (on: boolean) => void;
  onReady?: () => void;
  onError?: () => void;
}

export function createSocratesScene(canvas: HTMLCanvasElement, stage: HTMLElement, opts: SceneOptions = {}) {
  let speaking = false;
  let avatar: AvatarType | null = null;
  const FAKE_VISEMES = ["viseme_aa", "viseme_E", "viseme_O", "viseme_PP", "viseme_FF", "viseme_kk", "viseme_I"];
  function fakeVisemeSample(t: number) {
    const idx = Math.floor(t * 8) % FAKE_VISEMES.length;
    return { viseme: FAKE_VISEMES[idx], weight: 0.4 + 0.4 * Math.abs(Math.sin(t * 13)) };
  }
  const mini = !!opts.mini;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "default" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, mini ? 1.75 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = null;
  renderer.setClearColor(0x000000, 0);
  const setTheme = (_light: boolean) => {};
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

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = false;
  controls.minPolarAngle = Math.PI / 2;
  controls.maxPolarAngle = Math.PI / 2;

  let modelCenter = new THREE.Vector3(0, 0, 0);
  let modelHeight = 1;

  function resize() {
    const w = stage.clientWidth,
      h = stage.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;

    const fovRad = (camera.fov * Math.PI) / 180;
    const desiredScreenFrac = mini ? 1.6 : 1.25;
    const distance = (modelHeight * desiredScreenFrac) / (2 * Math.tan(fovRad / 2));

    const angle = controls.getAzimuthalAngle();
    camera.position.set(
      modelCenter.x + Math.sin(angle) * distance,
      modelCenter.y,
      modelCenter.z + Math.cos(angle) * distance,
    );
    camera.lookAt(modelCenter);
    camera.updateProjectionMatrix();
    controls.target.copy(modelCenter);
    kick();
  }
  window.addEventListener("resize", resize);
  const ro = new ResizeObserver(() => resize());
  ro.observe(stage);

  function buildHybridMaterial(baseMap: THREE.Texture | null, fallbackColor: THREE.Color | null) {
    const uniforms = {
      map: { value: baseMap || null },
      uHasMap: { value: baseMap ? 1.0 : 0.0 },
      uFallback: { value: fallbackColor || new THREE.Color(0x555555) },
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x6fe0e8) },
      uClickPoint: { value: new THREE.Vector3(0, 0, 0) },
      uRadius: { value: 0 },
      uMaxDist: { value: 1 },
      uBandMinY: { value: -1 },
      uBandMaxY: { value: 1 },
      uPrevState: { value: 0 },
      uNewState: { value: 0 },
    };

    const material = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: `
        #include <morphtarget_pars_vertex>
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying vec2 vUv;
        void main(){
          vUv = uv;
          vec3 transformed = vec3(position);
          #include <morphtarget_vertex>

          vec4 wp = modelMatrix * vec4(transformed, 1.0);
          vWorldPos = wp.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D map;
        uniform float uHasMap;
        uniform vec3 uFallback;
        uniform float uTime;
        uniform vec3 uColor;
        uniform vec3 uClickPoint;
        uniform float uRadius;
        uniform float uMaxDist;
        uniform float uBandMinY;
        uniform float uBandMaxY;
        uniform float uPrevState;
        uniform float uNewState;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        varying vec2 vUv;

        void main(){
          vec3 n = normalize(vWorldNormal);
          vec3 viewDir = normalize(cameraPosition - vWorldPos);

          vec3 texColor = uHasMap > 0.5 ? texture2D(map, vUv).rgb : uFallback;
          float lambert = 0.55;
          lambert += 0.32 * max(dot(n, normalize(vec3(-1.2, 2.0, 1.6))), 0.0);
          lambert += 0.14 * max(dot(n, normalize(vec3(1.5, 0.4, 1.2))), 0.0);
          lambert += 0.22 * max(dot(n, normalize(vec3(0.8, 1.5, -1.8))), 0.0);
          lambert = min(lambert, 1.3);
          vec3 baseLit = texColor * lambert;

          float fresnel = pow(1.0 - max(dot(viewDir, n), 0.0), 3.2);

          float span = max(uBandMaxY - uBandMinY, 0.0001);
          float bandPos = uBandMaxY - mod(uTime * span * 0.12, span * 1.4);
          float band = smoothstep(span * 0.05, 0.0, abs(vWorldPos.y - bandPos));

          vec3 hologramLook = mix(baseLit, baseLit * uColor * 1.15, 0.4);
          hologramLook += uColor * fresnel * 0.55;
          hologramLook += uColor * band * 0.9;

          float dist = length(vWorldPos - uClickPoint);
          float edge = max(uMaxDist * 0.16, 0.001);
          float localProgress = clamp((uRadius - dist) / edge + 0.5, 0.0, 1.0);
          float amount = mix(uPrevState, uNewState, localProgress);

          vec3 finalColor = mix(baseLit, hologramLook, amount);

          finalColor = pow(max(finalColor, vec3(0.0)), vec3(1.0/2.2));

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
    });
    (material as unknown as { morphTargets: boolean }).morphTargets = true;
    return material;
  }

  let hologramOn = false;
  let transitioning = false;
  const hybridMaterials: THREE.ShaderMaterial[] = [];
  let maxDist = 1;
  let bandMinY = -1,
    bandMaxY = 1;

  function startTransition(clickPointWorld: THREE.Vector3) {
    if (!hybridMaterials.length || transitioning) return;
    transitioning = true;
    const prevState = hologramOn ? 1 : 0;
    const newState = hologramOn ? 0 : 1;
    hybridMaterials.forEach((m) => {
      m.uniforms.uClickPoint.value.copy(clickPointWorld);
      m.uniforms.uPrevState.value = prevState;
      m.uniforms.uNewState.value = newState;
      m.uniforms.uRadius.value = 0;
    });

    const duration = 900;
    const start = performance.now();
    function step(now: number) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - (1 - t) ** 2;
      hybridMaterials.forEach((m) => {
        m.uniforms.uRadius.value = eased * maxDist * 1.6;
      });
      if (t < 1) {
        requestAnimationFrame(step);
      } else {
        hologramOn = !hologramOn;
        transitioning = false;
        opts.onHologram?.(hologramOn);
      }
    }
    requestAnimationFrame(step);
  }

  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let downPos: { x: number; y: number } | null = null;
  let avatarRootRef: THREE.Object3D | null = null;

  function getPointer(e: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height };
  }
  canvas.addEventListener("pointerdown", (e) => {
    downPos = getPointer(e);
  });
  canvas.addEventListener("pointerup", (e) => {
    if (!downPos || !avatarRootRef) return;
    const up = getPointer(e);
    const moved = Math.hypot(up.x - downPos.x, up.y - downPos.y);
    downPos = null;
    if (moved > 6) return;
    pointerNdc.x = (up.x / up.w) * 2 - 1;
    pointerNdc.y = -(up.y / up.h) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObject(avatarRootRef, true);
    if (hits.length > 0) startTransition(hits[0].point);
  });

  const loadModel = (url: string) => {
    const cached = modelCache.get(url);
    if (cached) return cached.then((g) => ({ model: cloneSkinned(g.scene), clips: g.animations }));
    const load = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(url);
    modelCache.set(url, load);
    load.catch(() => {
      if (modelCache.get(url) === load) modelCache.delete(url);
    });
    return load.then((g) => ({
      model: cloneSkinned(g.scene),
      clips: g.animations,
    }));
  };

  let pendingExpression: [string, { loop?: boolean }] | null = null;
  let disposed = false;
  loadModel("/socrates.glb")
    .then(({ model, clips }) => {
      if (disposed) return;
      avatar = new Avatar(model, clips);
      if (pendingExpression) avatar.setExpression(...pendingExpression);
      avatarRootRef = avatar.root;
      scene.add(avatar.root);

      model.traverse((o: THREE.Object3D) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          const src = mesh.material as THREE.MeshStandardMaterial | null;
          const baseMap = src?.map ?? null;
          const fallback = src?.color ? src.color.clone() : null;
          const mat = buildHybridMaterial(baseMap, fallback);
          mesh.material = mat;
          hybridMaterials.push(mat);
        }
      });

      const box = new THREE.Box3().setFromObject(avatar.root);
      const size = box.getSize(new THREE.Vector3());
      modelCenter = box.getCenter(new THREE.Vector3());
      modelHeight = size.y || 1;
      maxDist = Math.max(size.x, size.y, size.z) * 0.9;
      bandMinY = box.min.y;
      bandMaxY = box.max.y;
      hybridMaterials.forEach((m) => {
        m.uniforms.uMaxDist.value = maxDist;
        m.uniforms.uBandMinY.value = bandMinY;
        m.uniforms.uBandMaxY.value = bandMaxY;
      });

      resize();
      opts.onReady?.();
      kick();
    })
    .catch(() => {
      if (disposed) return;
      opts.onError?.();
    });

  const clock = new THREE.Clock();
  let raf = 0;
  let visible = true;
  const FRAME_MS = mini ? 1000 / 30 : 0;
  let last = 0;
  const busy = () => true;
  function frame(now: number) {
    if (disposed) return;
    raf = 0;
    if (!visible || document.hidden) return;
    if (FRAME_MS && now - last < FRAME_MS) {
      raf = requestAnimationFrame(frame);
      return;
    }
    last = now;
    const dt = Math.min(clock.getDelta(), 0.1);
    if (avatar) {
      if (speaking) {
        const sample = fakeVisemeSample(clock.elapsedTime);
        avatar.setViseme(sample?.viseme ?? null, sample?.weight);
      }
      avatar.update(dt);
    }
    hybridMaterials.forEach((m) => {
      m.uniforms.uTime.value += dt;
    });
    controls.update();
    renderer.render(scene, camera);
    if (busy()) raf = requestAnimationFrame(frame);
  }
  function kick() {
    if (disposed || raf || !visible || document.hidden) return;
    clock.getDelta();
    raf = requestAnimationFrame(frame);
  }
  const io = new IntersectionObserver(([e]) => {
    visible = e.isIntersecting;
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
    setTheme(light: boolean) {
      setTheme(light);
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
      hybridMaterials.forEach((m) => {
        m.dispose();
      });
      renderer.dispose();
      renderer.forceContextLoss();
    },
  };
}

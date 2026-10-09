// @ts-nocheck
/**
 * 3D 蘇格拉底半身像（three.js）。從原型的 scene.js 抽出「只管畫面」的部分：
 * 模型、燈光、拖曳旋轉、全息效果、嘴形動畫。語音辨識 / 合成與對話都改在 React 裡做。
 * 用法：const s = createSocratesScene(canvas, container, { light, onReady, onError });
 *       s.setSpeaking(true) → 嘴巴會動；s.setTheme(light)；s.dispose()
 */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { Avatar } from "./avatar";

export function createSocratesScene(canvas, stage, opts = {}) {
  let speaking = false;
  let avatar = null;
  const FAKE_VISEMES = ["viseme_aa", "viseme_E", "viseme_O", "viseme_PP", "viseme_FF", "viseme_kk", "viseme_I"];
  function fakeVisemeSample(t) {
    const idx = Math.floor(t * 8) % FAKE_VISEMES.length;
    return { viseme: FAKE_VISEMES[idx], weight: 0.4 + 0.4 * Math.abs(Math.sin(t * 13)) };
  }
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const STAGE_DARK = new THREE.Color(0x2b2d33); // 原本 0x1a1714 太黑，調成偏灰的深色
  const STAGE_LIGHT = new THREE.Color(0xdcdad3); // matches the CSS light-mode gradient's base tone
  scene.background = opts.light ? STAGE_LIGHT : STAGE_DARK;
  const setTheme = (light) => { scene.background = light ? STAGE_LIGHT : STAGE_DARK; };
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;

  // Gallery-style lighting for a marble bust: warm key from above-left, cool rim from behind.
  const key = new THREE.DirectionalLight(0xfff1dd, 2.4);
  key.position.set(-1.2, 2.0, 1.6);
  const fill = new THREE.DirectionalLight(0xdfe8ff, 0.5);
  fill.position.set(1.5, 0.4, 1.2);
  const rim = new THREE.DirectionalLight(0xbfd4ff, 1.6);
  rim.position.set(0.8, 1.5, -1.8);
  scene.add(key, fill, rim, new THREE.HemisphereLight(0xfff6ea, 0x2a221c, 0.4));

  const camera = new THREE.PerspectiveCamera(30, 1, 0.01, 20);

  // ---- drag-to-rotate, horizontal only, pivoting on the model's own center ----
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
    const w = stage.clientWidth, h = stage.clientHeight;
    if (w === 0 || h === 0) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;

    // moderate, centered size: distance derived from the model's own
    // height so it reads the same regardless of the model's raw scale
    const fovRad = (camera.fov * Math.PI) / 180;
    const desiredScreenFrac = 1.65; // larger => smaller on screen
    const distance = (modelHeight * desiredScreenFrac) / (2 * Math.tan(fovRad / 2));

    const angle = controls.getAzimuthalAngle();
    camera.position.set(
      modelCenter.x + Math.sin(angle) * distance,
      modelCenter.y,
      modelCenter.z + Math.cos(angle) * distance
    );
    camera.lookAt(modelCenter);
    camera.updateProjectionMatrix();
    controls.target.copy(modelCenter);
  }
  window.addEventListener("resize", resize);
  const ro = new ResizeObserver(() => resize());
  ro.observe(stage);

  /* ---------------------------------------------------------
     HOLOGRAM — one shared material per mesh that can render
     both looks (normal / hologram) and blend between them
     per-fragment based on distance from a click point, so the
     switch spreads outward from wherever you clicked. Still
     honours the model's real viseme morph targets.
  --------------------------------------------------------- */
  function buildHybridMaterial(baseMap, fallbackColor) {
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
      morphTargets: true,
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
          // approximate the scene's actual key/fill/rim lights so the model
          // doesn't look flat/dark (this material bypasses normal PBR lighting)
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

          // this custom material bypasses three.js's automatic output-colorspace
          // pass, so encode back to sRGB ourselves — otherwise the (linear-space)
          // texture sample renders far too dark on screen
          finalColor = pow(max(finalColor, vec3(0.0)), vec3(1.0/2.2));

          gl_FragColor = vec4(finalColor, 1.0);
        }
      `,
    });
    return material;
  }

  let hologramOn = false;
  let transitioning = false;
  const hybridMaterials = [];
  let maxDist = 1;
  let bandMinY = -1, bandMaxY = 1;

  function startTransition(clickPointWorld) {
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
    function step(now) {
      const t = Math.min((now - start) / duration, 1);
      const eased = 1 - Math.pow(1 - t, 2);
      hybridMaterials.forEach((m) => { m.uniforms.uRadius.value = eased * maxDist * 1.6; });
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

  // click (not drag) on the model toggles the hologram, spreading from the click point
  const raycaster = new THREE.Raycaster();
  const pointerNdc = new THREE.Vector2();
  let downPos = null;
  let avatarRootRef = null;

  function getPointer(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top, w: rect.width, h: rect.height };
  }
  canvas.addEventListener("pointerdown", (e) => { downPos = getPointer(e); });
  canvas.addEventListener("pointerup", (e) => {
    if (!downPos || !avatarRootRef) return;
    const up = getPointer(e);
    const moved = Math.hypot(up.x - downPos.x, up.y - downPos.y);
    downPos = null;
    if (moved > 6) return; // it was a drag/rotate, not a click
    pointerNdc.x = (up.x / up.w) * 2 - 1;
    pointerNdc.y = -(up.y / up.h) * 2 + 1;
    raycaster.setFromCamera(pointerNdc, camera);
    const hits = raycaster.intersectObject(avatarRootRef, true);
    if (hits.length > 0) startTransition(hits[0].point);
  });

  function loadModel(url) {
    return new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene);
  }

  loadModel("/socrates.glb")
    .then((model) => {
      avatar = new Avatar(model);
      avatarRootRef = avatar.root;
      scene.add(avatar.root);

      // apply the hologram-capable material to every mesh, keeping
      // each mesh's own texture/color as its "normal" look
      model.traverse((o) => {
        if (o.isMesh) {
          const baseMap = o.material?.map || null;
          const fallback = o.material?.color ? o.material.color.clone() : null;
          const mat = buildHybridMaterial(baseMap, fallback);
          o.material = mat;
          hybridMaterials.push(mat);
        }
      });

      // size + center everything from the model's real bounding box
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
    })
    .catch((e) => {
      console.error(e);
      opts.onError?.();
    });

  const clock = new THREE.Clock();
  let raf = 0;
  function animate() {
    raf = requestAnimationFrame(animate);
    const dt = Math.min(clock.getDelta(), 0.1);
    if (avatar) {
      if (speaking) {
        const sample = fakeVisemeSample(clock.elapsedTime);
        avatar.setViseme(sample?.viseme ?? null, sample?.weight);
      }
      avatar.update(dt);
    }
    hybridMaterials.forEach((m) => { m.uniforms.uTime.value += dt; });
    controls.update();
    renderer.render(scene, camera);
  }
  animate();

  return {
    setSpeaking(on) { speaking = on; if (!on && avatar) avatar.setViseme(null, 0); },
    setTheme,
    dispose() {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
    },
  };
}

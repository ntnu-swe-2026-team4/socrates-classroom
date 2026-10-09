// @ts-nocheck
import * as THREE from "three";

/* =========================================================
   Ported from draft-main's web/src/avatar.ts (TypeScript ->
   plain JS ES module, logic unchanged). Drives the model's
   morph targets: visemes (lip-sync), blinking, idle motion.
========================================================= */

export const VISEMES = [
  "viseme_sil",
  "viseme_PP",
  "viseme_FF",
  "viseme_TH",
  "viseme_DD",
  "viseme_kk",
  "viseme_CH",
  "viseme_SS",
  "viseme_nn",
  "viseme_RR",
  "viseme_aa",
  "viseme_E",
  "viseme_I",
  "viseme_O",
  "viseme_U",
];

const BLINK_KEYS = ["eyeBlinkLeft", "eyeBlinkRight"];
// Slow, calm blink (seconds): lids ease down, rest briefly, then lift more slowly than they fell.
const BLINK_TIMING = { close: 0.28, hold: 0.12, open: 0.45 };

const easeInOut = (x) => x * x * (3 - 2 * x);

/** Drives the bust's morph targets: visemes (lip-sync), blinking and idle head motion. */
export class Avatar {
  constructor(model) {
    this.root = new THREE.Group();
    this.root.add(model);
    this.meshes = [];
    this.visemeTarget = new Map();
    this.visemeCurrent = new Map();
    this.blink = 0;
    this.nextBlinkAt = 2;
    this.blinkStart = -1;
    this.speaking = 0;
    this.time = 0;

    model.traverse((obj) => {
      if (obj.isMesh && obj.morphTargetDictionary && obj.morphTargetInfluences) {
        this.meshes.push(obj);
      }
    });
    if (this.meshes.length === 0) console.warn("Model has no morph targets; lip-sync disabled");
    for (const v of VISEMES) {
      this.visemeTarget.set(v, 0);
      this.visemeCurrent.set(v, 0);
    }
  }

  /** Sets the active viseme; all others relax towards zero. */
  setViseme(viseme, weight = 1) {
    for (const v of VISEMES) this.visemeTarget.set(v, v === viseme ? weight : 0);
  }

  setSpeaking(on) {
    this.speaking = on ? 1 : 0;
    if (!on) this.setViseme(null);
  }

  update(dt) {
    this.time += dt;

    // Frame-rate independent smoothing: attack faster than release so plosives still register.
    for (const v of VISEMES) {
      const cur = this.visemeCurrent.get(v);
      const tgt = this.visemeTarget.get(v);
      const rate = tgt > cur ? 28 : 14;
      this.visemeCurrent.set(v, cur + (tgt - cur) * (1 - Math.exp(-rate * dt)));
    }

    this.updateBlink();

    for (const mesh of this.meshes) {
      const dict = mesh.morphTargetDictionary;
      const inf = mesh.morphTargetInfluences;
      for (const v of VISEMES) {
        const i = dict[v];
        if (i !== undefined) inf[i] = this.visemeCurrent.get(v);
      }
      for (const k of BLINK_KEYS) {
        const i = dict[k];
        if (i !== undefined) inf[i] = this.blink;
      }
    }

    // Idle sway and breathing, plus a slight nod while speaking.
    const t = this.time;
    const talk = this.speaking * (Math.sin(t * 5.3) * 0.5 + Math.sin(t * 3.1) * 0.5);
    this.root.rotation.y = Math.sin(t * 0.37) * 0.05 + Math.sin(t * 0.83) * 0.015;
    this.root.rotation.x = Math.sin(t * 0.51) * 0.012 + talk * 0.008;
    this.root.rotation.z = Math.sin(t * 0.29) * 0.01;
    this.root.position.y = Math.sin(t * 1.3) * 0.0015;
  }

  updateBlink() {
    const t = this.time;
    if (this.blinkStart < 0 && t >= this.nextBlinkAt) this.blinkStart = t;
    if (this.blinkStart < 0) return;

    const { close, hold, open } = BLINK_TIMING;
    const e = t - this.blinkStart;
    if (e < close) {
      this.blink = easeInOut(e / close);
    } else if (e < close + hold) {
      this.blink = 1;
    } else if (e < close + hold + open) {
      this.blink = 1 - easeInOut((e - close - hold) / open);
    } else {
      this.blink = 0;
      this.blinkStart = -1;
      this.nextBlinkAt = t + 3 + Math.random() * 3;
    }
  }
}

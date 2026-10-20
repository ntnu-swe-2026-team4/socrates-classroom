// @ts-nocheck
import * as THREE from "three";

/* =========================================================
   Ported from draft-main's web/src/avatar.ts (TypeScript ->
   plain JS ES module). Drives the model's morph targets:
   visemes (lip-sync), blinking, idle motion, and the model's
   expression clips (Happy = laugh / Confused / Angry) layered on top.
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

/**
 * One expression clip from the model, sampled by hand (not AnimationMixer) so it can be layered
 * over lip-sync and blinking. `used` marks the morphs the clip actually moves: a layer only
 * overrides those, so e.g. "Angry" takes the brows while lip-sync keeps the mouth.
 */
class ClipLayer {
  constructor(track, duration, fadeIn, fadeOut) {
    this.duration = duration;
    this.fadeIn = fadeIn;
    this.fadeOut = fadeOut;
    this.interp = track.createInterpolant();
    const k = track.values.length / track.times.length;
    this.used = new Array(k).fill(false);
    for (let i = 0; i < track.values.length; i++) if (Math.abs(track.values[i]) > 0.01) this.used[i % k] = true;
    this.time = 0;
    this.weight = 0;
    this.playing = false;
    this.loop = false;
    this.values = null;
  }

  play({ loop = false } = {}) {
    this.time = 0;
    this.loop = loop;
    this.playing = true;
  }

  stop() {
    this.playing = false;
  }

  get active() {
    return this.playing || this.weight > 0;
  }

  update(dt) {
    if (!this.active) return;
    this.time += dt;
    if (this.loop) this.time %= this.duration;
    if (!this.loop && this.time > this.duration - this.fadeOut) this.playing = false;
    this.weight = this.playing ? Math.min(1, this.weight + dt / this.fadeIn) : Math.max(0, this.weight - dt / this.fadeOut);
    this.values = this.interp.evaluate(Math.min(this.time, this.duration));
  }

  /** Blends this layer over `base` for morph index i. */
  apply(i, base) {
    if (!this.weight || !this.used[i]) return base;
    return base + (this.values[i] - base) * this.weight;
  }
}

/** Drives the bust's morph targets: visemes (lip-sync), blinking, idle head motion and expression clips. */
export class Avatar {
  constructor(model, clips = []) {
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

    this.expressionLayers = new Map();
    this.expression = null; // the expression layer currently playing (others may still be fading out)
    for (const clip of clips) {
      const track = clip.tracks.find((tr) => tr.name.endsWith(".morphTargetInfluences"));
      if (track) this.expressionLayers.set(clip.name, new ClipLayer(track, clip.duration, 0.35, 0.6));
    }
  }

  /** Names of the expression clips the model ships with (e.g. "Happy", "Confused", "Angry"). */
  get expressions() {
    return [...this.expressionLayers.keys()];
  }

  /** Plays an expression clip once (or looping); null fades back to neutral. */
  setExpression(name, { loop = false } = {}) {
    const next = name ? this.expressionLayers.get(name) : null;
    if (this.expression && this.expression !== next) this.expression.stop();
    this.expression = next ?? null;
    next?.play({ loop });
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
    for (const layer of this.expressionLayers.values()) layer.update(dt);
    const layers = [...this.expressionLayers.values()].filter((l) => l.active);

    for (const mesh of this.meshes) {
      const dict = mesh.morphTargetDictionary;
      const inf = mesh.morphTargetInfluences;
      for (const [name, i] of Object.entries(dict)) {
        let v = this.visemeCurrent.get(name) ?? (BLINK_KEYS.includes(name) ? this.blink : 0);
        // Expressions on top: each only touches the morphs its clip uses, so lip-sync keeps the mouth
        // unless the expression itself moves it (the laugh opens the mouth wide).
        for (const layer of layers) v = layer.apply(i, v);
        inf[i] = v;
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

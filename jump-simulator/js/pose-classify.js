/**
 * Webcam body → game controls. Pure logic, no camera or DOM.
 * Input: MediaPipe Pose world landmarks (metres, hips at origin, y down,
 * z grows away from the camera). The person stands facing the camera.
 *
 * Neutral (calibrated): arms in the box position (elbows near shoulder height,
 * forearms up) and knees flexed. Moving away from it triggers controls:
 *   stand up straight → legsStretch     squat deeper → legsTuck
 *   arms extended     → armsForward     hands below shoulders → armsBack
 *   lean back         → archMore        lean forward → archFlat
 *   shoulder down     → dipLeft / dipRight
 *   one hand above the head + other at the hip (wave-off + pull) → deploy
 * Arms dropped or body not visible → out of position (loses the arch).
 */
(() => {
  'use strict';
  const SV = (window.SV = window.SV || {});

  const LM = { nose: 0, ls: 11, rs: 12, le: 13, re: 14, lw: 15, rw: 16, lh: 23, rh: 24, lk: 25, rk: 26, la: 27, ra: 28 };
  const NEEDED = [LM.ls, LM.rs, LM.le, LM.re, LM.lw, LM.rw, LM.lh, LM.rh, LM.lk, LM.rk, LM.la, LM.ra];

  const T = Object.freeze({
    visibility: 0.5,
    smooth: 0.45,          // EMA weight of the newest frame
    hold: 0.15,            // s a new state must last before it counts
    deployHold: 0.4,       // s holding the deploy gesture
    lean: 0.13,            // torso lean (z / torso length) from neutral
    tilt: 0.16,            // shoulder tilt (dy / shoulder width) from neutral
    tuck: 22,              // degrees deeper than neutral knee bend
    stretchShare: 0.6,     // share of the way from neutral knee bend to straight
    armsExtended: 150,     // elbow angle (deg) for "arms forward"
    handsLow: -0.25,       // hands below shoulders (torso lengths) → arms back
    armsDropped: -0.9,     // hands down by the hips → out of position
    exit: 0.7,             // hysteresis: leave a state at 70% of its threshold
  });

  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, z: (a.z + b.z) / 2 });
  const len = (v) => Math.hypot(v.x, v.y, v.z);
  function angle(a, b, c) { // angle at b, degrees
    const u = sub(a, b), v = sub(c, b);
    const d = (u.x * v.x + u.y * v.y + u.z * v.z) / ((len(u) * len(v)) || 1);
    return (Math.acos(Math.max(-1, Math.min(1, d))) * 180) / Math.PI;
  }

  /** Measurements from one frame, or null when the body isn't fully visible. */
  function features(world, image) {
    if (!world || !image) return null;
    if (NEEDED.some((i) => (image[i]?.visibility ?? 0) < T.visibility)) return null;
    const p = world;
    const sh = mid(p[LM.ls], p[LM.rs]);
    const hip = mid(p[LM.lh], p[LM.rh]);
    const torso = len(sub(sh, hip)) || 0.5;
    const shoulderW = len(sub(p[LM.ls], p[LM.rs])) || 0.35;
    const hand = (w, s) => (s.y - w.y) / torso; // + above the shoulder
    return {
      knee: (angle(p[LM.lh], p[LM.lk], p[LM.la]) + angle(p[LM.rh], p[LM.rk], p[LM.ra])) / 2,
      elbow: (angle(p[LM.ls], p[LM.le], p[LM.lw]) + angle(p[LM.rs], p[LM.re], p[LM.rw])) / 2,
      handL: hand(p[LM.lw], p[LM.ls]),
      handR: hand(p[LM.rw], p[LM.rs]),
      lean: (sh.z - hip.z) / torso,                       // + leaning back
      tilt: (p[LM.rs].y - p[LM.ls].y) / shoulderW,         // + right shoulder lower
      // wave-off + pull: one wrist above the nose, the other down at hip height
      waveR: p[LM.rw].y < p[LM.nose].y && p[LM.lw].y > hip.y - 0.15 * torso,
      waveL: p[LM.lw].y < p[LM.nose].y && p[LM.rw].y > hip.y - 0.15 * torso,
    };
  }

  /** -1 / 0 / +1 with hysteresis around ±limit. */
  function tri(v, limit, prev) {
    const enter = limit, exit = limit * T.exit;
    if (prev === 1 && v > exit) return 1;
    if (prev === -1 && v < -exit) return -1;
    return v > enter ? 1 : v < -enter ? -1 : 0;
  }

  class PoseClassifier {
    constructor() { this.reset(); }

    reset() {
      this.base = null;     // calibrated neutral
      this.f = null;        // smoothed features
      this.raw = { legs: 0, arms: 0, arch: 0, turn: 0 };
      this.state = { legs: 0, arms: 0, arch: 0, turn: 0 };
      this.pending = {};    // group → { value, since }
      this.deploySince = null;
      this.calib = [];
    }

    /** Smooth one frame's features in. Returns the smoothed features (or null). */
    push(world, image) {
      const f = features(world, image);
      if (!f) { this.f = null; return null; }
      if (!this.f) this.f = { ...f };
      else for (const k of Object.keys(f)) {
        this.f[k] = typeof f[k] === 'boolean' ? f[k] : this.f[k] + (f[k] - this.f[k]) * T.smooth;
      }
      return this.f;
    }

    /** Is the current frame a plausible neutral box position? Used by calibration. */
    looksNeutral(f = this.f) {
      if (!f) return false;
      const armsUp = f.handL > -0.1 && f.handR > -0.1 && f.elbow < T.armsExtended;
      return armsUp && f.knee < 165;
    }

    /** Add a calibration sample; returns progress 0..1. */
    addCalibration(f = this.f) {
      if (!this.looksNeutral(f)) { this.calib = []; return 0; }
      this.calib.push({ ...f });
      return Math.min(1, this.calib.length / 45);
    }

    finishCalibration() {
      const n = this.calib.length || 1;
      const avg = (k) => this.calib.reduce((s, f) => s + f[k], 0) / n;
      this.base = { knee: avg('knee'), lean: avg('lean'), tilt: avg('tilt') };
      this.calib = [];
    }

    /**
     * Classify the smoothed frame at time `now` (seconds).
     * @returns {{ visible: boolean, inPosition: boolean, held: Set<string>, deploy: boolean }}
     */
    classify(now) {
      const f = this.f;
      const held = new Set();
      if (!f || !this.base) {
        this.deploySince = null;
        return { visible: Boolean(f), inPosition: false, held: new Set(['archFlat']), deploy: false };
      }
      const b = this.base;

      // deploy gesture wins over everything else
      if (f.waveL || f.waveR) {
        this.deploySince ??= now;
        const deploy = now - this.deploySince >= T.deployHold;
        return { visible: true, inPosition: true, held, deploy };
      }
      this.deploySince = null;

      const hands = Math.min(f.handL, f.handR);
      const inPosition = hands > T.armsDropped;

      const stretchAt = b.knee + (180 - b.knee) * T.stretchShare;
      const kneeV = f.knee >= b.knee
        ? (f.knee - b.knee) / Math.max(4, stretchAt - b.knee)
        : -(b.knee - f.knee) / T.tuck;
      const handsLowV = -(Math.max(f.handL, f.handR) - 0.05) / Math.abs(T.handsLow - 0.05);
      const extendedV = (f.elbow - 115) / (T.armsExtended - 115);

      this.raw = {
        legs: tri(kneeV, 1, this.raw.legs),
        arms: handsLowV > 1 || (this.raw.arms === 1 && handsLowV > T.exit) ? 1
          : extendedV > 1 || (this.raw.arms === -1 && extendedV > T.exit) ? -1 : 0,
        arch: tri((f.lean - b.lean) / T.lean, 1, this.raw.arch),
        turn: tri((f.tilt - b.tilt) / T.tilt, 1, this.raw.turn),
      };
      if (!inPosition) this.raw.arms = 0;

      // debounce: a new value must last T.hold seconds
      for (const g of Object.keys(this.raw)) {
        const v = this.raw[g];
        if (v === this.state[g]) { delete this.pending[g]; continue; }
        const p = this.pending[g];
        if (!p || p.value !== v) this.pending[g] = { value: v, since: now };
        else if (now - p.since >= T.hold) { this.state[g] = v; delete this.pending[g]; }
      }

      const s = this.state;
      const pick = (v, pos, neg) => { if (v > 0) held.add(pos); else if (v < 0) held.add(neg); };
      pick(s.legs, 'legsStretch', 'legsTuck');
      pick(s.arms, 'armsBack', 'armsForward');
      pick(inPosition ? s.arch : -1, 'archMore', 'archFlat');
      pick(s.turn, 'dipRight', 'dipLeft');
      return { visible: true, inPosition, held, deploy: false };
    }
  }

  SV.PoseClassifier = PoseClassifier;
  SV.POSE_LM = LM;
  SV.poseFeatures = features;
})();

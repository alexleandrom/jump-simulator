/**
 * Skydiver drawn on canvas from a small 3D body, so turning really rotates it.
 * Body coords: [forward, up, right] in metres, origin at the hips.
 * World: X screen-right, Y up, Z toward the viewer. Heading 0 faces screen-right
 * with the jumper's right side toward the viewer; positive heading = right turn.
 */
(() => {
  'use strict';
  const SV = (window.SV = window.SV || {});
  const RAD = Math.PI / 180;

  const lerp = (a, b, k) => a + (b - a) * k;
  /** Blend a [low, mid, high] triple for v in -1..1 (numbers or vectors). */
  function blend([low, mid, high], v) {
    const [a, b, k] = v < 0 ? [mid, low, -v] : [mid, high, v];
    return Array.isArray(a) ? a.map((x, i) => lerp(x, b[i], k)) : lerp(a, b, k);
  }
  const unit = (v) => { const n = Math.hypot(...v) || 1; return v.map((x) => x / n); };
  const add = (p, d, len) => p.map((x, i) => x + d[i] * len);

  // Leg angles (deg) in the forward/up plane: 0 = forward, 90 = up. [tucked, box, stretched]
  const LEGS = { thigh: [172, 170, 176], spread: [26, 26, 12], knee: [110, 48, 18] };
  // Arm directions [forward, up, out]. [forward, box, back]
  const ARMS = {
    upper: [[0.85, 0.12, 0.5], [0.45, 0.1, 0.89], [-0.35, 0.08, 0.93]],
    fore: [[0.98, 0.12, 0.12], [0.9, 0.38, 0.05], [-0.75, 0.12, 0.6]],
  };
  const LEN = { thigh: 0.45, shin: 0.43, upper: 0.3, fore: 0.28 };

  /** Leg direction in the leg's plane, turned outward by `spread` degrees. */
  function legDir(angle, spread, side) {
    const f = Math.cos(angle * RAD);
    const u = Math.sin(angle * RAD);
    return [f * Math.cos(spread * RAD), u, side * -f * Math.sin(spread * RAD)];
  }

  /** Joint positions for a (possibly in-between) pose. */
  function buildModel(pose) {
    const arch = pose.arch;
    const hip = [0, -0.02 * arch, 0];
    const belly = [0.28, -0.07 - 0.05 * arch, 0];
    const chest = [0.56, 0.02 + 0.05 * arch, 0];
    const head = [0.78, 0.06 + 0.06 * arch, 0];
    const limbs = [];
    for (const side of [-1, 1]) {
      const hipS = [0.02, hip[1], 0.11 * side];
      const thigh = blend(LEGS.thigh, pose.legs) - arch * 6;
      const spread = blend(LEGS.spread, pose.legs);
      const knee = add(hipS, legDir(thigh, spread, side), LEN.thigh);
      const foot = add(knee, legDir(thigh - blend(LEGS.knee, pose.legs), spread, side), LEN.shin);
      limbs.push({ kind: 'leg', side, a: hipS, b: knee, c: foot });

      const sh = [0.52, chest[1], 0.2 * side];
      const flip = (v) => [v[0], v[1], v[2] * side];
      const elbow = add(sh, flip(unit(blend(ARMS.upper, pose.arms))), LEN.upper);
      const hand = add(elbow, flip(unit(blend(ARMS.fore, pose.arms))), LEN.fore);
      limbs.push({ kind: 'arm', side, a: sh, b: elbow, c: hand });
    }
    return { hip, belly, chest, head, limbs };
  }

  /** Rotate body point → world: roll (dip), pitch (tilt), heading. */
  function makeProjector(view) {
    const roll = (view.roll || 0) * RAD;
    const pitch = (view.tilt || 0) * RAD;
    const h = (view.heading || 0) * RAD;
    const upright = (view.upright || 0) * (Math.PI / 2);
    const [cr, sr, cp, sp, ch, sh, cu, su] = [roll, roll, pitch, pitch, h, h, upright, upright]
      .map((a, i) => (i % 2 ? Math.sin(a) : Math.cos(a)));
    return ([f0, u0, r0]) => {
      // roll around forward: right side goes down for positive roll
      let u = u0 * cr - r0 * sr;
      const r = r0 * cr + u0 * sr;
      // pitch: positive tilt puts the head down
      let f = f0 * cp + u * sp;
      u = u * cp - f0 * sp;
      // under canopy: stand the body up (head up)
      const f2 = f * cu - u * su;
      u = u * cu + f * su;
      f = f2;
      return { X: f * ch - r * sh, Y: u, Z: f * sh + r * ch };
    };
  }

  function shade(hex, k) {
    const n = parseInt(hex.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => Math.round(v * k));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  }

  /**
   * Side view. opts: { x, y (px), ppm (px per metre), heading, tilt, roll, rock,
   *   upright (0..1), suit: {main, accent, helmet}, alpha }
   */
  function drawSide(ctx, pose, opts) {
    const m = buildModel(pose);
    const proj = makeProjector({ heading: opts.heading, tilt: (opts.tilt || 0) + (opts.rock || 0),
      roll: pose.turn * 16, upright: opts.upright });
    const P = (p) => { const w = proj(p); return { x: w.X, y: -w.Y, z: w.Z }; };
    const suit = opts.suit;

    ctx.save();
    ctx.globalAlpha = opts.alpha ?? 1;
    ctx.translate(opts.x, opts.y);
    ctx.scale(opts.ppm, opts.ppm);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const parts = [];
    for (const l of m.limbs) {
      const a = P(l.a), b = P(l.b), c = P(l.c);
      const z = (a.z + b.z + c.z) / 3;
      const leg = l.kind === 'leg';
      parts.push({ z, draw: (k) => {
        ctx.strokeStyle = shade(leg ? suit.main : suit.accent, k);
        ctx.lineWidth = leg ? 0.15 : 0.11;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
        ctx.fillStyle = shade(leg ? '#2b2b33' : '#e8b896', k);
        ctx.beginPath(); ctx.arc(c.x, c.y, leg ? 0.075 : 0.055, 0, Math.PI * 2); ctx.fill();
      } });
    }
    const hip = P(m.hip), belly = P(m.belly), chest = P(m.chest), head = P(m.head);
    const rigA = P([0.08, 0.1, 0]), rigB = P([0.48, 0.14 + 0.03 * pose.arch, 0]);
    parts.push({ z: 0, draw: () => {
      ctx.strokeStyle = suit.main; ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.quadraticCurveTo(belly.x, belly.y, chest.x, chest.y); ctx.stroke();
      ctx.strokeStyle = '#1f2a37'; ctx.lineWidth = 0.18; // container (rig) on the back
      ctx.beginPath(); ctx.moveTo(rigA.x, rigA.y); ctx.lineTo(rigB.x, rigB.y); ctx.stroke();
      ctx.fillStyle = suit.helmet;
      ctx.beginPath(); ctx.arc(head.x, head.y, 0.13, 0, Math.PI * 2); ctx.fill();
      const vis = P([0.86, 0.02 + 0.06 * pose.arch, 0]);
      ctx.fillStyle = 'rgba(20,30,45,0.85)';
      ctx.beginPath(); ctx.arc(vis.x, vis.y, 0.06, 0, Math.PI * 2); ctx.fill();
    } });
    parts.sort((p, q) => p.z - q.z);
    for (const p of parts) p.draw(p.z < -0.02 ? 0.72 : 1);
    ctx.restore();
  }

  /** Top view (from above), used as the heading compass. Screen y = world Z. */
  function drawTop(ctx, pose, x, y, ppm, heading, suit) {
    const m = buildModel(pose);
    const proj = makeProjector({ heading, roll: pose.turn * 16 });
    const P = (p) => { const w = proj(p); return { x: w.X, y: w.Z, z: w.Y }; };
    ctx.save();
    ctx.translate(x, y); ctx.scale(ppm, ppm);
    ctx.lineCap = 'round';
    for (const l of m.limbs) {
      const a = P(l.a), b = P(l.b), c = P(l.c);
      ctx.strokeStyle = l.kind === 'leg' ? suit.main : suit.accent;
      ctx.lineWidth = l.kind === 'leg' ? 0.15 : 0.11;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(c.x, c.y); ctx.stroke();
    }
    const hip = P(m.hip), chest = P(m.chest), head = P(m.head);
    ctx.strokeStyle = '#1f2a37'; ctx.lineWidth = 0.36;
    ctx.beginPath(); ctx.moveTo(hip.x, hip.y); ctx.lineTo(chest.x, chest.y); ctx.stroke();
    ctx.fillStyle = suit.helmet;
    ctx.beginPath(); ctx.arc(head.x, head.y, 0.13, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  /** Ram-air canopy above the jumper, opening with k (0..1). Facing = ±1. */
  function drawCanopy(ctx, x, y, ppm, k, facing, color) {
    const open = Math.min(1, k);
    const span = lerp(0.4, 3.2, open);      // side view: chord length
    const height = lerp(0.3, 0.75, open);
    const above = lerp(1.8, 3.6, open);
    ctx.save();
    ctx.translate(x, y); ctx.scale(ppm, ppm);
    const cx = 0.25 * facing, top = -above;
    ctx.strokeStyle = 'rgba(240,240,240,0.7)'; ctx.lineWidth = 0.02;
    for (let i = 0; i <= 4; i++) {
      const px = cx + (i / 4 - 0.5) * span;
      ctx.beginPath(); ctx.moveTo(0, -0.55); ctx.lineTo(px, top + height); ctx.stroke();
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(cx - span / 2, top + height);
    ctx.quadraticCurveTo(cx - span / 2, top - height * 0.2, cx, top - height * 0.35);
    ctx.quadraticCurveTo(cx + span / 2, top - height * 0.2, cx + span / 2, top + height * 0.6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.25)';
    for (let i = 1; i < 6; i += 2) {
      const px = cx - span / 2 + (i / 6) * span;
      ctx.fillRect(px, top - height * 0.2, span / 12, height * 1.1);
    }
    ctx.restore();
  }

  SV.Jumper = { buildModel, drawSide, drawTop, drawCanopy };
})();

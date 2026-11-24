/**
 * Freefall physics: body position → flight. Pure functions, no DOM.
 * Model: belly-to-earth flying (AFF), simplified.
 *   legs: +1 stretched, -1 tucked     arms: +1 swept back, -1 forward
 *   arch: +1 more arch, -1 flat        turn: +1 right shoulder down, -1 left
 */
(() => {
  'use strict';
  const SV = (window.SV = window.SV || {});

  const EFFECT = Object.freeze({
    driftPerLimb: 0.5,     // forward drift per limb group (max 1)
    fallFaster: 0.3,       // fall-rate gain with arch / tucked combo
    fallSlower: 0.25,      // fall-rate loss when flat / spread combo
    turnDegPerSecond: 90,
    settleSeconds: 0.6,    // how long the flight takes to follow a new pose
  });

  const TUNING = Object.freeze({
    exitAltitude: 4000,    // m
    fallSpeed: 55,         // m/s at neutral (~200 km/h)
    driftSpeed: 5.5,       // m/s horizontal at full drift
    relFallSpeed: 26,      // m/s up/down vs. the group, per unit of fall rate
    wobbleSpeed: 1.4,      // m/s lateral rocking when flat
    pushDecay: 0.5,        // s, bump impulse decay
  });

  const NEUTRAL = Object.freeze({ legs: 0, arms: 0, arch: 0, turn: 0 });

  const CONTROLS = Object.freeze([
    { id: 'legsStretch', group: 'legs', value: 1, label: 'Esticar pernas' },
    { id: 'legsTuck', group: 'legs', value: -1, label: 'Dobrar pernas' },
    { id: 'armsForward', group: 'arms', value: -1, label: 'Braços à frente' },
    { id: 'armsBack', group: 'arms', value: 1, label: 'Braços para trás' },
    { id: 'archMore', group: 'arch', value: 1, label: 'Selar mais' },
    { id: 'archFlat', group: 'arch', value: -1, label: 'Selar menos' },
    { id: 'dipLeft', group: 'turn', value: -1, label: 'Curva à esquerda' },
    { id: 'dipRight', group: 'turn', value: 1, label: 'Curva à direita' },
  ]);

  const EXPLAIN = Object.freeze({
    legsStretch: 'Pernas estendidas: o vento levanta as pernas, a cabeça desce e você vai para frente.',
    legsTuck: 'Pernas recolhidas: menos perna no vento, o corpo inclina e você vai para trás.',
    armsForward: 'Braços à frente: o vento levanta o peito e você vai para trás.',
    armsBack: 'Braços para trás: o peito pega menos ar, a cabeça desce e você vai para frente.',
    archMore: 'Mais sela: menos arrasto e mais estabilidade — você cai mais rápido.',
    archFlat: 'Menos sela: mais área no vento — cai mais devagar, mas fica instável e balança.',
    dipLeft: 'Ombro esquerdo abaixo: o ar escapa pela esquerda e você gira para a esquerda.',
    dipRight: 'Ombro direito abaixo: o ar escapa pela direita e você gira para a direita.',
    slowFall: 'Pernas esticadas + braços à frente + sem sela: a menor razão de queda possível.',
    moreArea: 'Pernas esticadas + braços à frente: mais área no vento, sem deslocamento — cai mais devagar.',
    tucked: 'Pernas dobradas + braços para trás: corpo compacto, cai mais rápido sem se deslocar.',
  });

  const spreadOut = (p) => Math.max(p.legs, 0) * Math.max(-p.arms, 0);
  const tuckedIn = (p) => Math.max(-p.legs, 0) * Math.max(p.arms, 0);

  /** What a pose does: drift -1..1 along heading, fallRate (1 = neutral), turnRate deg/s, wobble 0..1. */
  function effects(pose) {
    return {
      drift: (pose.legs + pose.arms) * EFFECT.driftPerLimb,
      fallRate: 1 + pose.arch * (pose.arch > 0 ? EFFECT.fallFaster : EFFECT.fallSlower)
        - spreadOut(pose) * EFFECT.fallSlower
        + tuckedIn(pose) * EFFECT.fallFaster,
      turnRate: pose.turn * EFFECT.turnDegPerSecond,
      wobble: pose.arch < 0 ? 1 : 0,
    };
  }

  function comboNote(pose) {
    if (pose.legs === 1 && pose.arms === -1) return pose.arch === -1 ? 'slowFall' : 'moreArea';
    if (pose.legs === -1 && pose.arms === 1) return 'tucked';
    return null;
  }

  /** Short Portuguese status, e.g. "Para frente, caindo mais rápido, curva à direita". */
  function describe(flight) {
    const parts = [];
    parts.push(flight.drift > 0.05 ? 'Para frente' : flight.drift < -0.05 ? 'Para trás' : 'Neutro');
    if (flight.fallRate > 1.02) parts.push('caindo mais rápido');
    else if (flight.fallRate < 0.98) parts.push('caindo mais devagar');
    if (flight.turnRate > 3) parts.push('curva à direita');
    else if (flight.turnRate < -3) parts.push('curva à esquerda');
    return parts.join(', ');
  }

  /** Build a pose from the set of held control ids; opposites cancel. */
  function poseFromHeld(held) {
    const axis = (pos, neg) => (held.has(pos) ? 1 : 0) - (held.has(neg) ? 1 : 0);
    return {
      legs: axis('legsStretch', 'legsTuck'),
      arms: axis('armsBack', 'armsForward'),
      arch: axis('archMore', 'archFlat'),
      turn: axis('dipRight', 'dipLeft'),
    };
  }

  const approach = (a, b, dt, s) => b + (a - b) * Math.exp(-dt / Math.max(s / 3, 1e-6));

  /** Jumper in metres, relative to a camera falling at the neutral rate (y grows downward). */
  function createJumper(x = 0, y = 0, heading = 0) {
    return { x, y, vx: 0, vy: 0, push: 0, heading, time: 0, flight: effects(NEUTRAL) };
  }

  function stepJumper(j, pose, dt) {
    const target = effects(pose);
    const flight = {};
    for (const k of Object.keys(target)) flight[k] = approach(j.flight[k], target[k], dt, EFFECT.settleSeconds);
    const heading = (((j.heading + flight.turnRate * dt) % 360) + 360) % 360;
    const along = Math.cos((heading * Math.PI) / 180);
    const time = j.time + dt;
    const wob = flight.wobble * TUNING.wobbleSpeed * (Math.sin(time * 3.1) + 0.6 * Math.sin(time * 5.3 + 1.7));
    const push = j.push * Math.exp(-dt / TUNING.pushDecay);
    const vx = flight.drift * along * TUNING.driftSpeed + wob + push;
    const vy = (flight.fallRate - 1) * TUNING.relFallSpeed;
    return { x: j.x + vx * dt, y: j.y + vy * dt, vx, vy, push, heading, time, flight };
  }

  Object.assign(SV, {
    EFFECT, TUNING, NEUTRAL, CONTROLS, EXPLAIN,
    effects, comboNote, describe, poseFromHeld, createJumper, stepJumper,
  });
})();

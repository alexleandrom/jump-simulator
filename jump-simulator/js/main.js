/**
 * Entry point: full-screen canvas, animation loop, camera, overlays.
 */
(() => {
  'use strict';
  const SV = window.SV;
  const $ = (sel) => document.querySelector(sel);

  const canvas = $('#game');
  const ctx = canvas.getContext('2d');
  const world = new SV.World();
  const game = new SV.Game();
  const cam = { x: 0, y: 0 };
  let touch = window.matchMedia('(pointer: coarse)').matches;
  document.body.classList.toggle('touch', touch);
  // A touch on a hybrid device (laptop with touchscreen) also turns the pad on.
  window.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch' && !touch) { touch = true; document.body.classList.add('touch'); }
  });

  let W = 0, H = 0, ppm = 30;
  let shown = { ...SV.NEUTRAL };
  let tip = null;
  let paused = false;
  let last = null;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ppm = Math.min(W, H) / 13; // pixels per metre: the view is ~13 m tall
    world.resize(W, H);
  }
  window.addEventListener('resize', resize);
  resize();

  // ---- overlays -------------------------------------------------------
  const show = (id, on) => { $(id).hidden = !on; };

  function goFullscreen() {
    const el = document.documentElement;
    if (!document.fullscreenElement && el.requestFullscreen) {
      el.requestFullscreen({ navigationUI: 'hide' })
        .then(() => screen.orientation?.lock?.('landscape').catch(() => {}))
        .catch(() => {});
    }
  }
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen?.(); else goFullscreen();
  }

  function startGame() {
    game.start();
    cam.x = 0; cam.y = 0;
    shown = { ...SV.NEUTRAL };
    tip = null;
    input.clear();
    setPaused(false);
    show('#title', false); show('#over', false);
    goFullscreen();
    SV.Wind.init();
  }

  function setPaused(p) {
    paused = p && game.state === 'play';
    show('#pause', paused);
    if (paused) input.clear();
  }

  function showResults() {
    const r = game.result;
    $('#res-score').textContent = r.score;
    $('#res-rank').textContent = r.rank;
    $('#res-docks').textContent = r.docks;
    $('#res-bumps').textContent = r.bumps;
    $('#res-alt').textContent = `${r.deployAlt.toLocaleString('pt-BR')} m`;
    $('#res-best').textContent = r.newBest ? `Novo recorde! ${r.best}` : `Recorde: ${r.best}`;
    $('#res-verdict').textContent = r.verdict;
    show('#over', true);
  }

  // ---- input ----------------------------------------------------------
  function onAction(a) {
    if (a === 'deploy') {
      if (game.state === 'play' && !paused) game.openParachute('player');
      else if (game.state === 'title' || game.state === 'over') startGame();
    } else if (a === 'start') {
      if (game.state === 'title' || game.state === 'over') startGame();
      else if (paused) setPaused(false);
    } else if (a === 'pause') {
      setPaused(!paused);
    } else if (a === 'mute') {
      const m = SV.Wind.toggleMute();
      document.querySelectorAll('[data-action="mute"]').forEach((b) => b.classList.toggle('on', m));
    } else if (a === 'fullscreen') {
      toggleFullscreen();
    }
  }

  function onControl(id) {
    if (game.state !== 'play') return;
    const combo = SV.comboNote(SV.poseFromHeld(input.held));
    tip = { text: SV.EXPLAIN[combo || id], life: 4 };
  }

  SV.game = game; // handy for tuning from the console
  const input = new SV.Input(onAction, onControl);
  input.bindPad($('#pad'));
  $('#play').addEventListener('click', startGame);
  $('#again').addEventListener('click', startGame);
  $('#resume').addEventListener('click', () => setPaused(false));
  document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); });

  // ---- loop -----------------------------------------------------------
  function update(dt) {
    const pose = game.state === 'play' ? SV.poseFromHeld(input.held) : SV.NEUTRAL;
    game.update(dt, pose);
    if (game.state === 'over' && $('#over').hidden) showResults();

    const target = game.state === 'canopy' || game.state === 'over'
      ? { legs: 0.3, arms: -0.4, arch: 0, turn: 0 } : pose;
    const k = 1 - Math.exp(-dt / 0.1);
    for (const key of Object.keys(shown)) shown[key] += (target[key] - shown[key]) * k;
    if (tip) { tip.life -= dt; if (tip.life <= 0) tip = null; }

    // camera follows the player; up/down with some lag so fall-rate changes show
    const j = game.jumper;
    const ox = cam.x, oy = cam.y;
    cam.x += (j.x - cam.x) * (1 - Math.exp(-dt * 3));
    cam.y += (j.y - cam.y) * (1 - Math.exp(-dt * 1.1));
    const maxDy = (H * 0.3) / ppm;
    cam.y = Math.max(j.y - maxDy, Math.min(j.y + maxDy, cam.y));

    const canopyK = game.deploy ? Math.min(1, game.deploy.t / 1.2) : 0;
    const fallRate = game.state === 'play' ? j.flight.fallRate : 1;
    const air = H * 1.9 * Math.max(fallRate, 0.7) * (1 - canopyK * 0.93);
    world.update(dt, {
      camDX: (cam.x - ox) * ppm, camDY: (cam.y - oy) * ppm,
      air, fall: SV.TUNING.fallSpeed * fallRate * (1 - canopyK * 0.9), alt: game.alt,
    });

    if (game.state === 'play') SV.Wind.set(Math.min(1, 0.35 + 0.5 * fallRate), fallRate - 0.5);
    else SV.Wind.set(game.state === 'title' ? 0 : 0.08, 0.1);
  }

  const toScreen = (x, y) => ({ x: W / 2 + (x - cam.x) * ppm, y: H / 2 + (y - cam.y) * ppm });

  function render() {
    const j = game.jumper;
    const air = H * 1.9 * (game.deploy ? 1 - Math.min(1, game.deploy.t / 1.2) * 0.93 : Math.max(j.flight.fallRate, 0.7));
    world.drawBackground(ctx, game.alt);
    world.drawStreaks(ctx, air);

    for (const m of game.mates) {
      const p = toScreen(m.x, m.y);
      const off = p.x < -40 || p.x > W + 40 || p.y < -40 || p.y > H + 40;
      if (off) {
        if (m.state === 'free') SV.HUD.edgeArrow(ctx, p.x, p.y, W, H, Math.hypot(m.x - j.x, m.y - j.y));
        continue;
      }
      if (m.state === 'free' && m.hold > 0) { // docking progress ring
        ctx.strokeStyle = '#7CFC9A'; ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.arc(p.x + ppm * 0.1, p.y, ppm * 1.3, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, m.hold / SV.RULES.dockHold));
        ctx.stroke();
      }
      const mp = m.state === 'docked' ? { legs: 0, arms: -1, arch: 0.3, turn: 0 }
        : m.state === 'leaving' ? { legs: 1, arms: 1, arch: 0, turn: 0 } : { legs: 0, arms: 0, arch: 0.2, turn: 0 };
      const facing = m.state === 'leaving' ? (m.vx > 0 ? 0 : 180) : m.heading;
      SV.Jumper.drawSide(ctx, mp, { x: p.x, y: p.y, ppm, heading: facing, tilt: m.state === 'leaving' ? 6 : 0,
        rock: Math.sin(m.t * 2) * 2, suit: m.suit, alpha: Math.max(0, Math.min(1, m.fade)) });
    }

    const p = toScreen(j.x, j.y);
    const d = game.deploy;
    if (game.state === 'title') {
      p.y += Math.sin(performance.now() / 700) * 6;
    }
    if (d) {
      const k = Math.min(1, d.t / 1.0);
      p.y += k * H * 0.12;
      SV.Jumper.drawCanopy(ctx, p.x, p.y, ppm, d.t / 0.9, d.facing, d.reason === 'aad' ? '#e9ecef' : '#ff7a1a');
      SV.Jumper.drawSide(ctx, shown, { x: p.x, y: p.y, ppm, heading: d.facing > 0 ? 0 : 180, upright: k, suit: SV.PLAYER_SUIT });
    } else {
      const f = j.flight;
      SV.Jumper.drawSide(ctx, shown, { x: p.x, y: p.y, ppm, heading: j.heading, tilt: f.drift * 6,
        rock: f.wobble * 9 * Math.sin(j.time * 2 * Math.PI * 1.1), suit: SV.PLAYER_SUIT });
    }

    world.drawForeground(ctx, game.alt);
    if (game.state === 'play' || game.state === 'canopy') {
      SV.HUD.draw(ctx, game, { w: W, h: H, pose: shown, tip, touch });
    }
  }

  function frame(now) {
    const dt = last === null ? 0 : Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!paused) update(dt);
    render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();

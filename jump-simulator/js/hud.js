/**
 * Canvas HUD: altimeter, score, heading compass (top view), status line,
 * position tips, centre messages, off-screen teammate arrow.
 */
(() => {
  'use strict';
  const SV = (window.SV = window.SV || {});
  const FONT = '"Archivo", system-ui, -apple-system, Segoe UI, sans-serif';

  function text(ctx, str, x, y, size, color = '#fff', align = 'left', weight = 800) {
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineWidth = Math.max(2, size / 7);
    ctx.strokeStyle = 'rgba(10,20,35,0.55)';
    ctx.strokeText(str, x, y);
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  function panel(ctx, x, y, w, h, r = 14) {
    ctx.fillStyle = 'rgba(10,22,40,0.45)';
    ctx.beginPath(); ctx.roundRect(x, y, w, h, r); ctx.fill();
  }

  /** Analogue altimeter, one turn = 4000 m. */
  function altimeter(ctx, x, y, r, alt) {
    const ang = (a) => -Math.PI / 2 + (a / 4000) * Math.PI * 2;
    ctx.fillStyle = 'rgba(10,22,40,0.6)';
    ctx.beginPath(); ctx.arc(x, y, r + 6, 0, Math.PI * 2); ctx.fill();
    const band = (a0, a1, color) => {
      ctx.strokeStyle = color; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.arc(x, y, r - 4, ang(a0), ang(a1)); ctx.stroke();
    };
    band(0, 1000, '#e63946'); band(1000, 1200, '#f4a261'); band(1200, 1700, '#ffd166');
    ctx.strokeStyle = '#fff';
    for (let i = 0; i < 40; i++) {
      const a = ang(i * 100);
      const big = i % 10 === 0;
      ctx.lineWidth = big ? 2.5 : 1;
      const r0 = r - (big ? 16 : 10);
      ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
      ctx.lineTo(x + Math.cos(a) * (r - 8), y + Math.sin(a) * (r - 8)); ctx.stroke();
      if (big) text(ctx, String(i / 10), x + Math.cos(a) * (r - 28), y + Math.sin(a) * (r - 28), r * 0.2, '#fff', 'center');
    }
    const a = ang(Math.max(0, alt));
    ctx.strokeStyle = '#ff7a1a'; ctx.lineWidth = 3.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * (r - 12), y + Math.sin(a) * (r - 12)); ctx.stroke();
    ctx.fillStyle = '#ff7a1a'; ctx.beginPath(); ctx.arc(x, y, 5, 0, Math.PI * 2); ctx.fill();
  }

  function compass(ctx, x, y, r, pose, heading, mateSide) {
    ctx.fillStyle = 'rgba(10,22,40,0.55)';
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1.5; ctx.stroke();
    if (mateSide) { // teammate is to the screen right (0°) or left (180°)
      ctx.fillStyle = '#7CFC9A';
      ctx.beginPath(); ctx.arc(x + mateSide * (r - 7), y, 6, 0, Math.PI * 2); ctx.fill();
    }
    SV.Jumper.drawTop(ctx, pose, x - 0.25 * r * 0.55 * Math.cos(heading * Math.PI / 180), y - 0.25 * r * 0.55 * Math.sin(heading * Math.PI / 180), r * 0.55, heading, SV.PLAYER_SUIT);
    text(ctx, 'VISTA DE CIMA', x, y + r + 12, 10, 'rgba(255,255,255,0.8)', 'center', 700);
  }

  function draw(ctx, g, view) {
    const { w, h, pose, tip, touch, webcam, camWarning } = view;
    const s = Math.min(1.25, Math.max(0.7, Math.min(w, h) / 720));
    const j = g.jumper;

    // altimeter + numbers
    const r = 62 * s;
    altimeter(ctx, 20 * s + r, 20 * s + r, r, g.alt);
    panel(ctx, 14 * s, 34 * s + r * 2, 150 * s, 64 * s);
    const low = g.alt < SV.RULES.deployHigh;
    text(ctx, `${Math.max(0, Math.round(g.alt)).toLocaleString('pt-BR')} m`, 26 * s, 54 * s + r * 2, 24 * s, low ? '#ffd166' : '#fff');
    const kmh = g.state === 'play' ? Math.round(SV.TUNING.fallSpeed * j.flight.fallRate * 3.6) : 0;
    text(ctx, `${kmh} km/h`, 26 * s, 82 * s + r * 2, 15 * s, 'rgba(255,255,255,0.85)', 'left', 700);

    // score
    panel(ctx, w - 190 * s, 14 * s, 176 * s, 70 * s);
    text(ctx, `${g.score}`, w - 26 * s, 40 * s, 28 * s, '#fff', 'right');
    text(ctx, `Docks ${g.docks}  ·  Recorde ${g.best}`, w - 26 * s, 68 * s, 12 * s, 'rgba(255,255,255,0.8)', 'right', 700);

    const mate = g.activeMate();
    const mateSide = mate ? Math.sign(mate.x - j.x) : 0;
    compass(ctx, w - 70 * s, 150 * s, 52 * s, pose, j.heading, mateSide);

    // status + tip (bottom centre, above the touch pad)
    const by = touch ? h - 210 * s : h - 60 * s;
    if (g.state === 'play') {
      text(ctx, SV.describe(j.flight), w / 2, by, 17 * s, '#fff', 'center', 800);
      if (g.hint) text(ctx, g.hint, w / 2, by - 30 * s, 16 * s, '#ffd166', 'center', 800);
      if (camWarning && Math.sin(g.time * 8) > -0.4) text(ctx, camWarning, w / 2, h * 0.62, 20 * s, '#ff8a8a', 'center', 900);
      if (tip) {
        ctx.font = `600 ${14 * s}px ${FONT}`;
        const tw = Math.min(w - 32, ctx.measureText(tip.text).width + 32 * s);
        ctx.globalAlpha = Math.min(1, tip.life);
        panel(ctx, w / 2 - tw / 2, by + 16 * s, tw, 30 * s, 10);
        text(ctx, tip.text, w / 2, by + 31 * s, 14 * s, '#e9f2ff', 'center', 600);
        ctx.globalAlpha = 1;
      }
    }

    // keyboard legend (desktop)
    if (!touch && !webcam && g.state === 'play' && g.time < 14) {
      const lines = ['A/D  pernas: dobrar / esticar', 'Q/E  braços: à frente / para trás',
        '↑/↓  sela: menos / mais', '←/→  curvas', 'ESPAÇO  abrir   ·   P  pausa'];
      ctx.globalAlpha = Math.min(1, 14 - g.time);
      panel(ctx, 14 * s, h - (lines.length * 20 + 24) * s, 250 * s, (lines.length * 20 + 12) * s);
      lines.forEach((l, i) => text(ctx, l, 26 * s, h - (lines.length * 20 + 8 - i * 20) * s, 12.5 * s, '#fff', 'left', 600));
      ctx.globalAlpha = 1;
    }

    // deploy prompt
    if (g.state === 'play' && g.alt <= SV.RULES.deployHigh && Math.sin(g.time * 10) > -0.2) {
      text(ctx, 'ABRA AGORA!', w / 2, h * 0.2, 40 * s, '#ffd166', 'center', 900);
    }

    // messages
    g.msgs.forEach((m, i) => {
      const a = Math.min(1, (m.life - m.t) * 3, m.t * 8);
      const y = h * 0.3 + i * 64 * s - m.t * 14;
      ctx.globalAlpha = Math.max(0, a);
      text(ctx, m.text, w / 2, y, 34 * s, m.color, 'center', 900);
      if (m.sub) text(ctx, m.sub, w / 2, y + 28 * s, 15 * s, '#fff', 'center', 700);
      ctx.globalAlpha = 1;
    });
  }

  /** Arrow at the screen edge pointing to an off-screen teammate. */
  function edgeArrow(ctx, sx, sy, w, h, dist) {
    const m = 36;
    const x = Math.max(m, Math.min(w - m, sx));
    const y = Math.max(h * 0.32, Math.min(h * 0.7, sy)); // clear of the HUD corners
    const a = Math.atan2(sy - y, sx - x);
    ctx.save(); ctx.translate(x, y); ctx.rotate(a);
    ctx.fillStyle = '#7CFC9A';
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-8, -11); ctx.lineTo(-8, 11); ctx.closePath(); ctx.fill();
    ctx.restore();
    text(ctx, `${Math.round(dist)} m`, x - Math.cos(a) * 26, y - Math.sin(a) * 26, 13, '#7CFC9A', 'center', 800);
  }

  SV.HUD = { draw, edgeArrow, text };
})();

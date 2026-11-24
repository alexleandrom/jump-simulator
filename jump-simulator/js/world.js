/**
 * Background: sky by altitude, ground and horizon, far clouds, a cloud deck to fall
 * through, and air streaks rushing up past the jumper. Screen-space, CSS pixels.
 */
(() => {
  'use strict';
  const SV = (window.SV = window.SV || {});
  const CLOUD_DECK = 2900;   // m, altitude of the cloud layer
  const DECK_DEPTH = 160;    // m, thickness of the layer

  const rand = (a, b) => a + Math.random() * (b - a);
  const mix = (a, b, k) => a.map((v, i) => Math.round(v + (b[i] - v) * k));
  const rgb = (c, a = 1) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;

  class World {
    constructor() {
      this.w = 0; this.h = 0;
      this.streaks = []; this.clouds = []; this.puffs = [];
    }

    resize(w, h) {
      this.w = w; this.h = h;
      const n = Math.min(260, Math.round((w * h) / 7000));
      this.streaks = Array.from({ length: n }, () => this.newStreak(true));
      this.clouds = Array.from({ length: 6 }, () => this.newCloud(true));
    }

    newStreak(anywhere) {
      const depth = rand(0.3, 1);
      return { x: rand(0, this.w), y: anywhere ? rand(0, this.h) : this.h + rand(0, 40), depth };
    }

    newCloud(anywhere) {
      const s = rand(0.6, 1.6);
      return { x: rand(-100, this.w + 100), y: anywhere ? rand(0, this.h) : this.h + 120 * s, s, par: rand(0.05, 0.2) };
    }

    /**
     * @param {number} dt
     * @param {object} m motion: camDX/camDY (px moved by the camera this frame),
     *   air (px/s air rush), fall (true fall m/s), alt (m)
     */
    update(dt, m) {
      for (const s of this.streaks) {
        s.y -= m.air * (0.55 + 0.45 * s.depth) * dt + m.camDY * s.depth;
        s.x -= m.camDX * s.depth;
        // wrap around the screen edges
        if (s.y < -60) { s.y += this.h + 120; s.x = rand(0, this.w); s.depth = rand(0.3, 1); }
        else if (s.y > this.h + 60) { s.y -= this.h + 120; s.x = rand(0, this.w); }
        if (s.x < -20) s.x += this.w + 40;
        else if (s.x > this.w + 20) s.x -= this.w + 40;
      }
      const rise = m.fall * this.h * 0.0016;
      for (const c of this.clouds) {
        c.y -= rise * c.par * 4 * dt;
        c.x -= m.camDX * c.par;
        if (c.y < -150 * c.s) Object.assign(c, this.newCloud(false));
        if (c.x < -260) c.x += this.w + 500;
        if (c.x > this.w + 260) c.x -= this.w + 500;
      }
      // Cloud deck: big puffs rushing past while inside the layer.
      const inDeck = Math.abs(m.alt - CLOUD_DECK) < DECK_DEPTH;
      if (inDeck && this.puffs.length < 18 && Math.random() < dt * 14) {
        this.puffs.push({ x: rand(-0.1, 1.1) * this.w, y: this.h + 200, r: rand(120, 320) });
      }
      for (const p of this.puffs) { p.y -= m.air * 0.9 * dt; p.x -= m.camDX; }
      this.puffs = this.puffs.filter((p) => p.y > -p.r * 1.5);
    }

    horizonY(alt) {
      return this.h * (0.9 - (1 - Math.min(alt, 4000) / 4000) * 0.22);
    }

    drawBackground(ctx, alt) {
      const { w, h } = this;
      const k = Math.max(0, Math.min(1, alt / 4000));
      const hy = this.horizonY(alt);
      const sky = ctx.createLinearGradient(0, 0, 0, hy);
      sky.addColorStop(0, rgb(mix([96, 160, 220], [18, 62, 128], k)));
      sky.addColorStop(1, rgb(mix([214, 232, 246], [168, 204, 236], k)));
      ctx.fillStyle = sky; ctx.fillRect(0, 0, w, hy + 1);

      const sun = ctx.createRadialGradient(w * 0.82, h * 0.12, 0, w * 0.82, h * 0.12, h * 0.5);
      sun.addColorStop(0, 'rgba(255,250,225,0.55)'); sun.addColorStop(1, 'rgba(255,250,225,0)');
      ctx.fillStyle = sun; ctx.fillRect(0, 0, w, hy);

      const ground = ctx.createLinearGradient(0, hy, 0, h);
      ground.addColorStop(0, '#9fb3a3'); ground.addColorStop(0.15, '#6f8d5c'); ground.addColorStop(1, '#4a6a38');
      ctx.fillStyle = ground; ctx.fillRect(0, hy, w, h - hy);
      // fields, squeezed toward the horizon
      const bands = 9;
      for (let i = 1; i < bands; i++) {
        const y0 = hy + (h - hy) * (i / bands) ** 2;
        const y1 = hy + (h - hy) * ((i + 0.5) / bands) ** 2;
        ctx.fillStyle = i % 2 ? 'rgba(160,140,70,0.18)' : 'rgba(40,80,30,0.18)';
        ctx.fillRect(0, y0, w, y1 - y0);
      }
      const haze = ctx.createLinearGradient(0, hy - 30, 0, hy + 40);
      haze.addColorStop(0, 'rgba(220,235,245,0)'); haze.addColorStop(0.5, 'rgba(220,235,245,0.7)');
      haze.addColorStop(1, 'rgba(220,235,245,0)');
      ctx.fillStyle = haze; ctx.fillRect(0, hy - 30, w, 70);

      for (const c of this.clouds) this.cloud(ctx, c.x, c.y, 60 * c.s, 0.4);
    }

    cloud(ctx, x, y, r, a) {
      ctx.fillStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.arc(x + r * 0.9, y + r * 0.2, r * 0.75, 0, Math.PI * 2);
      ctx.arc(x - r * 0.9, y + r * 0.25, r * 0.7, 0, Math.PI * 2);
      ctx.arc(x + r * 0.3, y - r * 0.45, r * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }

    drawStreaks(ctx, air) {
      const len = Math.max(2, Math.abs(air) * 0.028);
      ctx.lineCap = 'round';
      for (const s of this.streaks) {
        ctx.strokeStyle = `rgba(255,255,255,${0.15 + s.depth * 0.35})`;
        ctx.lineWidth = 0.6 + s.depth * 1.4;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x, s.y + len * s.depth * Math.sign(air || 1)); ctx.stroke();
      }
    }

    /** Fog and near puffs while inside the cloud deck; drawn over everything. */
    drawForeground(ctx, alt) {
      for (const p of this.puffs) this.cloud(ctx, p.x, p.y, p.r, 0.5);
      const fog = Math.max(0, 1 - Math.abs(alt - CLOUD_DECK) / DECK_DEPTH) * 0.7;
      if (fog > 0) { ctx.fillStyle = `rgba(245,248,252,${fog})`; ctx.fillRect(0, 0, this.w, this.h); }
    }
  }

  SV.World = World;
})();

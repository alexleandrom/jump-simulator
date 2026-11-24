/** Wind noise that follows the fall rate (Web Audio, no files). */
(() => {
  'use strict';
  const SV = (window.SV = window.SV || {});

  const Wind = {
    ctx: null, gain: null, filter: null, muted: false,

    init() {
      if (this.ctx) { this.ctx.resume?.(); return; }
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        const ctx = new AC();
        const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
        const data = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < data.length; i++) { last = (last + 0.04 * (Math.random() * 2 - 1)) / 1.04; data[i] = last * 3.5; }
        const src = ctx.createBufferSource();
        src.buffer = buf; src.loop = true;
        this.filter = ctx.createBiquadFilter();
        this.filter.type = 'lowpass'; this.filter.frequency.value = 700;
        this.gain = ctx.createGain(); this.gain.gain.value = 0;
        src.connect(this.filter).connect(this.gain).connect(ctx.destination);
        src.start();
        this.ctx = ctx;
      } catch { this.ctx = null; }
    },

    /** level 0..1, tone 0..1 */
    set(level, tone) {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      this.gain.gain.setTargetAtTime(this.muted ? 0 : level * 0.5, t, 0.15);
      this.filter.frequency.setTargetAtTime(400 + tone * 900, t, 0.2);
    },

    toggleMute() { this.muted = !this.muted; return this.muted; },
  };

  SV.Wind = Wind;
})();

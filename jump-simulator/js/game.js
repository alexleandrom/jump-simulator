/**
 * Game rules: exit at 4000 m, fly to teammates and dock gently (facing them),
 * break off at 1800 m, deploy between 1700 and 1200 m. Positions in metres,
 * relative to a camera falling at the neutral rate (y grows downward).
 */
(() => {
  'use strict';
  const SV = (window.SV = window.SV || {});

  const RULES = Object.freeze({
    breakOff: 1800,
    deployHigh: 1700,
    deployLow: 1200,
    hardDeck: 900,      // below: "abertura baixa"
    aad: 750,           // automatic activation device fires the reserve
    lastSpawn: 2000,
    dockMaxSpeed: 2.6,  // m/s relative speed allowed to dock
    dockHold: 0.45,     // s inside the slot to dock
    bumpSpeed: 3.2,     // m/s: faster than this into a teammate is a collision
    canopySeconds: 3.2,
  });

  const SUITS = [
    { main: '#2f6fd6', accent: '#f2c14e', helmet: '#f4f4f4' },
    { main: '#d6452f', accent: '#2c2c2c', helmet: '#ffd23f' },
    { main: '#7b3fd6', accent: '#3fd6b0', helmet: '#222831' },
    { main: '#1f9e6a', accent: '#f4f4f4', helmet: '#e85d75' },
  ];
  const PLAYER_SUIT = { main: '#ff7a1a', accent: '#1d3557', helmet: '#1d3557' };

  const rand = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function loadBest() {
    try { return Number(localStorage.getItem('skyventure.best')) || 0; } catch { return 0; }
  }
  function saveBest(v) {
    try { localStorage.setItem('skyventure.best', String(v)); } catch { /* storage blocked */ }
  }

  class Game {
    constructor() {
      this.best = loadBest();
      this.reset();
      this.state = 'title';
    }

    reset() {
      this.state = 'play';
      this.alt = SV.TUNING.exitAltitude;
      this.jumper = SV.createJumper();
      this.mates = [];
      this.score = 0;
      this.docks = 0;
      this.bumps = 0;
      this.time = 0;
      this.msgs = [];
      this.spawnIn = 2.5;
      this.breakOffCalled = false;
      this.deployCalled = false;
      this.deploy = null;       // { alt, t, reason }
      this.result = null;
      this.hint = '';
      this.suitIndex = 0;
    }

    start() {
      this.reset();
      this.say('SAÍDA!', 'Estabilize na posição neutra', '#ffffff', 2.2);
    }

    say(text, sub = '', color = '#ffffff', life = 1.8) {
      this.msgs.push({ text, sub, color, life, t: 0 });
      if (this.msgs.length > 3) this.msgs.shift();
    }

    addScore(points, label, color) {
      this.score = Math.max(0, this.score + points);
      this.say(`${points >= 0 ? '+' : ''}${points}`, label, color || (points >= 0 ? '#7CFC9A' : '#ff6b6b'));
    }

    spawnMate() {
      const p = this.jumper;
      const side = Math.random() < 0.5 ? -1 : 1;
      const level = Math.min(1, this.docks / 4); // later teammates sit further up/down
      const dy = rand(-1, 1) * (3 + 7 * level);
      this.mates.push({
        x: p.x + side * rand(9, 15), y: p.y + dy,
        heading: side > 0 ? 180 : 0, // faces the player
        suit: SUITS[this.suitIndex++ % SUITS.length],
        state: 'free', hold: 0, born: this.time, fade: 1, cool: 0, t: rand(0, 9),
      });
    }

    activeMate() { return this.mates.find((m) => m.state === 'free') || null; }

    update(dt, pose) {
      for (const m of this.msgs) m.t += dt;
      this.msgs = this.msgs.filter((m) => m.t < m.life);
      if (this.state === 'play') this.updatePlay(dt, pose);
      else if (this.state === 'canopy') this.updateCanopy(dt);
    }

    updatePlay(dt, pose) {
      this.time += dt;
      this.jumper = SV.stepJumper(this.jumper, pose, dt);
      const j = this.jumper;
      this.alt -= SV.TUNING.fallSpeed * j.flight.fallRate * dt;

      // teammates
      this.hint = '';
      for (const m of this.mates) {
        m.t += dt;
        m.cool = Math.max(0, m.cool - dt);
        m.y += Math.sin(m.t * 1.3) * 0.15 * dt;
        if (m.state === 'docked') {
          m.hold += dt;
          j.x += (m.x - Math.sign(m.x - j.x) * 1.7 - j.x) * Math.min(1, dt * 6);
          if (m.hold > 1.1) { m.state = 'leaving'; m.vx = Math.sign(m.x - j.x) * 4; }
        } else if (m.state === 'leaving') {
          m.x += m.vx * dt; m.y -= 2 * dt; m.fade -= dt / 1.6;
        } else {
          this.checkDock(m, dt);
        }
      }
      this.mates = this.mates.filter((m) => m.fade > 0);

      if (this.alt > RULES.lastSpawn && !this.activeMate() && !this.mates.some((m) => m.state === 'docked')) {
        this.spawnIn -= dt;
        if (this.spawnIn <= 0) { this.spawnMate(); this.spawnIn = 1.2; }
      }

      if (!this.breakOffCalled && this.alt <= RULES.breakOff) {
        this.breakOffCalled = true;
        for (const m of this.mates) if (m.state !== 'leaving') { m.state = 'leaving'; m.vx = Math.sign(m.x - j.x || 1) * 5; }
        this.say('BREAK-OFF!', 'Afaste-se do grupo', '#ffd166', 2.4);
      }
      if (!this.deployCalled && this.alt <= RULES.deployHigh) {
        this.deployCalled = true;
        this.say('ABRA!', 'Pressione ESPAÇO / ABRIR', '#ffd166', 2.4);
      }
      if (this.alt <= RULES.aad) this.openParachute('aad');
    }

    checkDock(m, dt) {
      const j = this.jumper;
      const dx = m.x - j.x;
      const dy = m.y - j.y;
      const dist = Math.hypot(dx, dy);
      const speed = Math.hypot(j.vx, j.vy);
      const facing = Math.cos((j.heading * Math.PI) / 180) * Math.sign(dx) > 0.5;
      const inSlot = Math.abs(dx) > 0.9 && Math.abs(dx) < 2.7 && Math.abs(dy) < 1.3;

      if (Math.abs(dx) < 1.4 && Math.abs(dy) < 1.0 && speed > RULES.bumpSpeed && m.cool === 0) {
        m.cool = 1.2;
        this.bumps++;
        j.push = -Math.sign(dx || 1) * 6;
        this.addScore(-50, 'Colisão! Chegue devagar');
        return;
      }
      if (inSlot && facing && speed < RULES.dockMaxSpeed) {
        m.hold += dt;
        if (m.hold >= RULES.dockHold) {
          m.state = 'docked'; m.hold = 0;
          this.docks++;
          const bonus = Math.round(clamp(120 - (this.time - m.born) * 8, 0, 120));
          this.addScore(100 + bonus, `Dock! ${bonus ? `bônus de tempo +${bonus}` : ''}`, '#7CFC9A');
        }
      } else {
        m.hold = Math.max(0, m.hold - dt * 2);
      }

      if (dist < 6) {
        if (!facing) this.hint = 'Fique de frente para o colega (curva)';
        else if (speed >= RULES.dockMaxSpeed) this.hint = 'Devagar! Freie antes de chegar';
        else if (Math.abs(dy) >= 1.3) this.hint = dy < 0 ? 'Ele está acima: caia mais devagar' : 'Ele está abaixo: sele mais';
      }
    }

    /** Space / ABRIR. reason: 'player' or 'aad'. */
    openParachute(reason = 'player') {
      if (this.state !== 'play') return;
      const a = this.alt;
      const j = this.jumper;
      this.state = 'canopy';
      this.msgs = [];
      this.deploy = { alt: a, t: 0, reason, facing: Math.cos((j.heading * Math.PI) / 180) >= 0 ? 1 : -1 };
      const near = this.mates.some((m) => m.fade > 0.3 && Math.abs(m.x - j.x) < 6 && Math.abs(m.y - j.y) < 8);

      let verdict;
      if (reason === 'aad') {
        this.addScore(-400, 'DAA acionou o reserva!');
        verdict = 'O DAA abriu seu reserva. Nunca deixe de abrir na altura certa!';
      } else if (a > RULES.deployHigh) {
        this.addScore(-100, 'Abertura alta');
        verdict = 'Abertura alta: você pode atrapalhar quem ainda está em queda livre.';
      } else if (a >= RULES.deployLow) {
        const bonus = Math.round(300 - Math.abs(a - 1500) * 1.2);
        this.addScore(bonus, 'Abertura na altura certa', '#7CFC9A');
        verdict = 'Abertura na altura certa. Boa!';
      } else if (a >= RULES.hardDeck) {
        this.addScore(-150, 'Abertura baixa');
        verdict = 'Abertura baixa: pouca margem para resolver uma pane.';
      } else {
        this.addScore(-300, 'Abertura MUITO baixa');
        verdict = 'Abertura muito abaixo do limite. Perigoso!';
      }
      if (near && reason === 'player') {
        this.addScore(-150, 'Abriu perto de outro paraquedista');
        verdict += ' E você abriu perto de outro paraquedista: faça o break-off!';
      }
      this.result = { verdict };
    }

    updateCanopy(dt) {
      const d = this.deploy;
      d.t += dt;
      const k = Math.min(1, d.t / 1.2);
      this.alt -= SV.TUNING.fallSpeed * (1 - k * 0.9) * dt;
      for (const m of this.mates) { m.fade -= dt; m.y -= 20 * dt; }
      if (d.t >= RULES.canopySeconds) this.finish();
    }

    finish() {
      this.state = 'over';
      const newBest = this.score > this.best;
      if (newBest) { this.best = this.score; saveBest(this.score); }
      Object.assign(this.result, {
        score: this.score, docks: this.docks, bumps: this.bumps,
        deployAlt: Math.round(this.deploy.alt), newBest, best: this.best,
        rank: this.score >= 900 ? 'Instrutor' : this.score >= 600 ? 'Paraquedista B' : this.score >= 300 ? 'Aluno AFF' : 'Primeiro salto',
      });
    }
  }

  Object.assign(SV, { Game, RULES, PLAYER_SUIT });
})();

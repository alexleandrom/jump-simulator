/**
 * Keyboard + touch input. Held body controls live in `held` (a Set of control ids);
 * one-shot actions (deploy, pause, mute, fullscreen) go to `onAction`.
 */
(() => {
  'use strict';
  const SV = (window.SV = window.SV || {});

  const KEYS = {
    KeyD: 'legsStretch', KeyA: 'legsTuck',
    KeyE: 'armsBack', KeyQ: 'armsForward',
    ArrowDown: 'archMore', KeyS: 'archMore',
    ArrowUp: 'archFlat', KeyW: 'archFlat',
    ArrowLeft: 'dipLeft', ArrowRight: 'dipRight',
  };
  const ACTIONS = { Space: 'deploy', Enter: 'start', KeyP: 'pause', KeyM: 'mute', KeyF: 'fullscreen' };

  class Input {
    constructor(onAction, onControl) {
      this.held = new Set();
      this.keyHeld = new Map(); // code → control id
      this.touchHeld = new Map(); // pointerId → control id
      this.onAction = onAction;
      this.onControl = onControl;

      window.addEventListener('keydown', (e) => {
        if (KEYS[e.code]) {
          e.preventDefault();
          if (!e.repeat) { this.keyHeld.set(e.code, KEYS[e.code]); this.sync(); this.onControl(KEYS[e.code]); }
        } else if (ACTIONS[e.code] && !e.repeat) {
          e.preventDefault();
          this.onAction(ACTIONS[e.code]);
        }
      });
      window.addEventListener('keyup', (e) => {
        if (this.keyHeld.delete(e.code)) this.sync();
      });
      window.addEventListener('blur', () => this.clear());
    }

    /** Bind on-screen buttons: [data-control] are held, [data-action] are one-shot. */
    bindPad(root) {
      root.querySelectorAll('[data-control]').forEach((btn) => {
        const id = btn.dataset.control;
        btn.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          try { btn.setPointerCapture(e.pointerId); } catch { /* pointer already gone */ }
          this.touchHeld.set(e.pointerId, id); this.sync(); this.onControl(id);
        });
        const up = (e) => { if (this.touchHeld.delete(e.pointerId)) this.sync(); };
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach((t) => btn.addEventListener(t, up));
      });
      root.querySelectorAll('[data-action]').forEach((btn) => {
        btn.addEventListener('pointerdown', (e) => { e.preventDefault(); this.onAction(btn.dataset.action); });
      });
      root.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    /** Controls from another source (the webcam). Newly added ones count as presses. */
    setExternal(set) {
      const prev = this.external || new Set();
      if (prev.size === set.size && [...set].every((id) => prev.has(id))) return;
      this.external = set;
      this.sync();
      for (const id of set) if (!prev.has(id)) this.onControl(id);
    }

    sync() {
      this.held = new Set([...this.keyHeld.values(), ...this.touchHeld.values(), ...(this.external || [])]);
      document.querySelectorAll('[data-control]').forEach((b) => b.classList.toggle('on', this.held.has(b.dataset.control)));
    }

    clear() { this.keyHeld.clear(); this.touchHeld.clear(); this.sync(); }
  }

  SV.Input = Input;
})();

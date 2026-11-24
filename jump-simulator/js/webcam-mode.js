/**
 * Webcam play mode: setup screen, calibration of the neutral flying position,
 * then each analysed frame becomes held controls for the game.
 */
(() => {
  'use strict';
  const SV = (window.SV = window.SV || {});
  const $ = (sel) => document.querySelector(sel);
  const LABEL = Object.fromEntries(SV.CONTROLS.map((c) => [c.id, c.label]));

  function setStatus(text, error = false) {
    const el = $('#cam-status');
    el.textContent = text;
    el.classList.toggle('error', error);
  }
  const setProgress = (p) => { $('#cam-progress').style.width = `${Math.round(p * 100)}%`; };

  function errorText(e) {
    if (e?.name === 'NotAllowedError') return 'Permissão da câmera negada. Libere a câmera no ícone da barra de endereço e tente de novo.';
    if (e?.name === 'NotFoundError') return 'Nenhuma câmera encontrada neste dispositivo.';
    if (e?.name === 'NotReadableError') return 'A câmera está sendo usada por outro programa.';
    return `Não foi possível iniciar a webcam: ${e?.message || e}`;
  }

  /** What to fix to reach the neutral position. */
  function calibrationHint(f) {
    if (f.handL < -0.1 || f.handR < -0.1) return 'Levante os braços: cotovelos na altura dos ombros, mãos para cima (box)';
    if (f.elbow >= 150) return 'Dobre os cotovelos: antebraços para cima, como na posição box';
    if (f.knee >= 165) return 'Flexione os joelhos';
    return 'Segure a posição de voo…';
  }

  const WebcamMode = {
    classifier: null,
    phase: 'off',           // off | loading | calibrating | playing
    status: { visible: false, inPosition: false },
    lastDeploy: false,
    opts: null,

    /** opts: { input, onReady, onBack, onDeploy } */
    init(opts) {
      this.opts = opts;
      this.classifier = new SV.PoseClassifier();
      SV.Webcam.addPreview($('#cam-big'));
      SV.Webcam.addPreview($('#cam-mini'));
      SV.Webcam.onFrame = (r) => this.onFrame(r);
      $('#cam-back').addEventListener('click', () => { this.stop(); opts.onBack(); });
    },

    /** Show the setup screen, start the camera and calibrate. */
    async open() {
      $('#cam-setup').hidden = false;
      setProgress(0);
      this.classifier.reset();
      this.phase = 'loading';
      try {
        await SV.Webcam.start((t) => setStatus(t));
      } catch (e) {
        this.phase = 'off';
        setStatus(errorText(e), true);
        return;
      }
      if (this.phase !== 'loading') return; // closed while loading
      this.phase = 'calibrating';
      setStatus('Fique de corpo inteiro na frente da câmera');
    },

    onFrame(r) {
      const f = this.classifier.push(r.world, r.image);
      if (this.phase === 'calibrating') this.calibrate(f);
      else if (this.phase === 'playing') this.play();
    },

    calibrate(f) {
      if (!f) {
        this.classifier.calib = [];
        setProgress(0);
        setStatus('Não estou te vendo por inteiro: afaste-se até aparecer da cabeça aos pés');
        return;
      }
      const p = this.classifier.addCalibration(f);
      setProgress(p);
      setStatus(calibrationHint(f));
      if (p >= 1) {
        this.classifier.finishCalibration();
        this.phase = 'playing';
        setStatus('Pronto! Bom salto!');
        setTimeout(() => { $('#cam-setup').hidden = true; this.opts.onReady(); }, 500);
      }
    },

    play() {
      const res = this.classifier.classify(performance.now() / 1000);
      this.status = res;
      this.opts.input.setExternal(res.held);
      if (res.deploy && !this.lastDeploy) this.opts.onDeploy();
      this.lastDeploy = res.deploy;

      const chips = [];
      if (!res.visible) chips.push({ text: 'Não estou te vendo', color: 'rgba(230,57,70,0.95)' });
      else if (res.deploy) chips.push({ text: 'ABRIR!', color: 'rgba(230,57,70,0.95)' });
      else if (!res.inPosition) chips.push({ text: 'Fora da posição', color: 'rgba(230,57,70,0.95)' });
      else if (!res.held.size) chips.push({ text: 'Neutro', color: 'rgba(31,158,106,0.95)' });
      for (const id of res.held) if (res.inPosition) chips.push({ text: LABEL[id] });
      SV.Webcam.setChips(chips);
    },

    /** A warning for the HUD, or ''. */
    warning() {
      if (this.phase !== 'playing') return '';
      if (!this.status.visible) return 'Não estou te vendo — apareça de corpo inteiro na câmera';
      if (!this.status.inPosition) return 'Volte à posição de voo: braços em box!';
      return '';
    },

    /** Recalibrate without restarting the camera. */
    recalibrate() {
      this.phase = 'calibrating';
      this.classifier.reset();
      this.opts.input.setExternal(new Set());
      $('#cam-setup').hidden = false;
      setProgress(0);
    },

    stop() {
      this.phase = 'off';
      SV.Webcam.stop();
      this.opts?.input.setExternal(new Set());
      $('#cam-setup').hidden = true;
      $('#cam-mini').hidden = true;
    },
  };

  SV.WebcamMode = WebcamMode;
})();

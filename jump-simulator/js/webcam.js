/**
 * Webcam + MediaPipe Pose Landmarker (runs on this device; no video leaves it).
 * Calls onFrame({ world, image }) for every analysed video frame, and draws a
 * mirrored preview with the skeleton on any canvases registered with addPreview().
 */
(() => {
  'use strict';
  const SV = (window.SV = window.SV || {});

  const VERSION = '0.10.14';
  const CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${VERSION}`;
  const MODEL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';
  const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [24, 26], [26, 28]];

  const Webcam = {
    video: null, landmarker: null, stream: null, running: false,
    onFrame: null, previews: [], last: null, lastTime: -1, chips: [],

    /** Ask for the camera and load the detector. onStatus(text) reports progress. */
    async start(onStatus = () => {}) {
      if (this.running) return;
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Este navegador não dá acesso à câmera. Use o Chrome, Edge ou Safari atualizados, via https ou localhost.');
      }
      onStatus('Pedindo acesso à câmera…');
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } }, audio: false,
      });
      this.video = document.createElement('video');
      Object.assign(this.video, { srcObject: this.stream, muted: true, playsInline: true });
      await this.video.play();

      if (!this.landmarker) {
        onStatus('Carregando o detector de movimentos…');
        const vision = await import(`${CDN}/vision_bundle.mjs`);
        const files = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
        const opts = (delegate) => ({
          baseOptions: { modelAssetPath: MODEL, delegate },
          runningMode: 'VIDEO', numPoses: 1,
          minPoseDetectionConfidence: 0.5, minPosePresenceConfidence: 0.5, minTrackingConfidence: 0.5,
        });
        try {
          this.landmarker = await vision.PoseLandmarker.createFromOptions(files, opts('GPU'));
        } catch {
          this.landmarker = await vision.PoseLandmarker.createFromOptions(files, opts('CPU'));
        }
      }
      this.running = true;
      this.loop();
    },

    stop() {
      this.running = false;
      this.stream?.getTracks().forEach((t) => t.stop());
      this.stream = null;
      this.last = null;
    },

    loop() {
      if (!this.running) return;
      const v = this.video;
      if (v.readyState >= 2 && v.currentTime !== this.lastTime) {
        this.lastTime = v.currentTime;
        try {
          const r = this.landmarker.detectForVideo(v, performance.now());
          this.last = { world: r.worldLandmarks?.[0] || null, image: r.landmarks?.[0] || null };
        } catch { this.last = { world: null, image: null }; }
        this.onFrame?.(this.last);
        for (const c of this.previews) if (!c.closest('[hidden]')) this.draw(c);
      }
      requestAnimationFrame(() => this.loop());
    },

    addPreview(canvas) { if (!this.previews.includes(canvas)) this.previews.push(canvas); },

    /** Labels of the active controls, shown on the preview. */
    setChips(list) { this.chips = list; },

    draw(canvas) {
      const v = this.video;
      const ctx = canvas.getContext('2d');
      const w = canvas.clientWidth, h = canvas.clientHeight;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr); }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      // cover-fit, mirrored like a mirror
      const s = Math.max(w / v.videoWidth, h / v.videoHeight);
      const vw = v.videoWidth * s, vh = v.videoHeight * s;
      const ox = (w - vw) / 2, oy = (h - vh) / 2;
      ctx.save();
      ctx.translate(w, 0); ctx.scale(-1, 1);
      ctx.drawImage(v, ox, oy, vw, vh);
      const lm = this.last?.image;
      if (lm) {
        const P = (i) => [ox + lm[i].x * vw, oy + lm[i].y * vh];
        ctx.strokeStyle = '#7CFC9A'; ctx.lineWidth = 3; ctx.lineCap = 'round';
        for (const [a, b] of BONES) {
          if ((lm[a].visibility ?? 1) < 0.4 || (lm[b].visibility ?? 1) < 0.4) continue;
          ctx.beginPath(); ctx.moveTo(...P(a)); ctx.lineTo(...P(b)); ctx.stroke();
        }
        ctx.fillStyle = '#ff7a1a';
        for (const i of [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28]) {
          if ((lm[i].visibility ?? 1) < 0.4) continue;
          ctx.beginPath(); ctx.arc(...P(i), 4, 0, Math.PI * 2); ctx.fill();
        }
      }
      ctx.restore();
      if (this.chips.length) {
        ctx.font = '700 11px system-ui, sans-serif';
        let y = h - 8;
        for (const c of this.chips.slice().reverse()) {
          const tw = ctx.measureText(c.text).width + 12;
          ctx.fillStyle = c.color || 'rgba(255,122,26,0.9)';
          ctx.beginPath(); ctx.roundRect(6, y - 18, tw, 18, 6); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.textBaseline = 'middle'; ctx.fillText(c.text, 12, y - 9);
          y -= 22;
        }
      }
    },
  };

  SV.Webcam = Webcam;
})();

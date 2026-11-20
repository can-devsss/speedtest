class SpeedVisuals {
  constructor(gaugeId, waveId) {
    this.gaugeCanvas = document.getElementById(gaugeId);
    this.waveCanvas = document.getElementById(waveId);
    this.gCtx = this.gaugeCanvas.getContext("2d");
    this.wCtx = this.waveCanvas.getContext("2d");

    this.currentSpeed = 0;
    this.targetSpeed = 0;
    this.velocity = 0;
    this.maxScale = 250;
    this.mode = "IDLE";
    this.autoLabel = "AUTO SCALE";
    this.wavePoints = Array(42).fill(0);

    this.raf = null;
    this.lastFrame = 0;
    this.tick = this.tick.bind(this);

    this.setupHiDPI();
    this.draw();

    // Boyut değişimleri (döndürme, accordion, pencere) için ResizeObserver
    if (typeof ResizeObserver !== "undefined") {
      this.ro = new ResizeObserver(() => {
        this.setupHiDPI();
        this.draw();
      });
      this.ro.observe(this.gaugeCanvas);
      this.ro.observe(this.waveCanvas);
    } else {
      window.addEventListener("resize", () => {
        this.setupHiDPI();
        this.draw();
      });
    }
  }

  setupHiDPI() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const gRect = this.gaugeCanvas.getBoundingClientRect();
    this.gw = gRect.width || 280;
    this.gh = gRect.height || 240;
    this.gaugeCanvas.width = Math.round(this.gw * dpr);
    this.gaugeCanvas.height = Math.round(this.gh * dpr);
    this.gCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const wRect = this.waveCanvas.getBoundingClientRect();
    this.ww = wRect.width || 280;
    this.wh = wRect.height || 50;
    this.waveCanvas.width = Math.round(this.ww * dpr);
    this.waveCanvas.height = Math.round(this.wh * dpr);
    this.wCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setAutoLabel(label) {
    this.autoLabel = label;
    const badge = document.getElementById("scale-badge");
    if (badge) badge.textContent = label;
  }

  setTarget(mbps, mode = "DOWNLOAD") {
    this.targetSpeed = Math.max(0, mbps);
    this.mode = mode;

    if (this.targetSpeed > 900) this.maxScale = 2500;
    else if (this.targetSpeed > 420) this.maxScale = 1000;
    else if (this.targetSpeed > 210) this.maxScale = 500;
    else this.maxScale = 250;

    this.wavePoints.push(this.targetSpeed);
    if (this.wavePoints.length > 42) this.wavePoints.shift();
    this.kick();
  }

  setFinalSamples(samples) {
    if (!samples || !samples.length) return;
    this.mode = "DOWNLOAD";
    const padded = samples.slice(-42);
    while (padded.length < 12) padded.unshift(padded[0] || 0);
    this.wavePoints = padded;
    this.draw();
  }

  reset() {
    this.targetSpeed = 0;
    this.currentSpeed = 0;
    this.velocity = 0;
    this.maxScale = 250;
    this.mode = "IDLE";
    this.wavePoints = Array(42).fill(0);
    this.draw();
  }

  getActiveColor() {
    if (this.mode === "UPLOAD") return "#f59e0b";
    if (this.mode === "PING") return "#f43f5e";
    return "#10b981";
  }

  drawGauge() {
    const ctx = this.gCtx;
    const w = this.gw;
    const h = this.gh;
    ctx.clearRect(0, 0, w, h);

    const isDark = document.body.classList.contains("dark-theme");
    const lineW = Math.max(10, Math.min(w, h) * 0.055);
    const fontPx = Math.max(9, w * 0.036);
    const cx = w / 2;
    const cy = h * 0.54;
    const radius = Math.min(w * 0.36, h * 0.4);

    const startAngle = Math.PI * 0.8;
    const endAngle = Math.PI * 2.2;
    const totalArc = endAngle - startAngle;

    // Arka plan rayı
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.lineWidth = lineW;
    ctx.lineCap = "round";
    ctx.strokeStyle = isDark ? "rgba(255,255,255,0.09)" : "rgba(24,21,18,0.08)";
    ctx.stroke();

    // Ölçek işaretleri
    const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1];
    ctx.font = `700 ${fontPx}px -apple-system, BlinkMacSystemFont, 'Inter', sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = isDark ? "rgba(255,255,255,0.46)" : "rgba(24,21,18,0.46)";

    const labelRadius = radius + lineW / 2 + fontPx * 1.15;
    ticks.forEach((tk) => {
      const ang = startAngle + totalArc * tk;
      const val = Math.round(this.maxScale * tk);
      ctx.fillText(
        val >= 1000 ? `${val / 1000}G` : String(val),
        cx + Math.cos(ang) * labelRadius,
        cy + Math.sin(ang) * labelRadius
      );
    });

    // Aktif hız yayı
    const ratio = Math.min(this.currentSpeed / this.maxScale, 1);
    if (ratio > 0.002) {
      const accent = this.getActiveColor();
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, startAngle + totalArc * ratio);
      ctx.lineWidth = lineW;
      ctx.lineCap = "round";
      ctx.strokeStyle = accent;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 12;
      ctx.stroke();
      ctx.restore();
    }
  }

  drawWave() {
    const ctx = this.wCtx;
    const w = this.ww;
    const h = this.wh;
    ctx.clearRect(0, 0, w, h);

    const maxVal = Math.max(...this.wavePoints, 10);
    const accent = this.getActiveColor();
    const count = this.wavePoints.length;
    const stepX = count > 1 ? w / (count - 1) : w;

    ctx.beginPath();
    this.wavePoints.forEach((val, idx) => {
      const x = idx * stepX;
      const y = h - 6 - (val / (maxVal * 1.15)) * (h - 14);
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });

    ctx.lineWidth = 2.4;
    ctx.lineJoin = "round";
    ctx.strokeStyle = accent;
    ctx.stroke();

    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();

    const rgb = this.mode === "UPLOAD" ? "245,158,11" : this.mode === "PING" ? "244,63,94" : "16,185,129";
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, `rgba(${rgb},0.24)`);
    grad.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = grad;
    ctx.fill();
  }

  draw() {
    this.drawGauge();
    this.drawWave();
  }

  renderOnce() {
    this.draw();
  }

  // Animasyon döngüsünü yalnızca gerekirse uyandırır (boştayken CPU/pil harcamaz)
  kick() {
    if (this.raf === null) {
      this.lastFrame = performance.now();
      this.raf = requestAnimationFrame(this.tick);
    }
  }

  tick(now) {
    this.raf = null;
    // 60Hz'e normalize edilmiş yay fiziği: 120Hz ekranlarda da aynı his
    const frames = Math.min(Math.max((now - this.lastFrame) / 16.667, 0.5), 4);
    this.lastFrame = now;
    const steps = Math.max(1, Math.round(frames));
    for (let i = 0; i < steps; i++) {
      const force = (this.targetSpeed - this.currentSpeed) * 0.14;
      this.velocity = (this.velocity + force) * 0.72;
      this.currentSpeed += this.velocity;
    }

    const settled =
      Math.abs(this.targetSpeed - this.currentSpeed) < 0.01 && Math.abs(this.velocity) < 0.01;
    if (settled) {
      this.currentSpeed = this.targetSpeed;
      this.velocity = 0;
    }

    this.draw();
    if (!settled) this.raf = requestAnimationFrame(this.tick);
  }
}

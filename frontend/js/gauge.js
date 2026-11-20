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

    this.setupHiDPI();
    window.addEventListener("resize", () => {
      this.setupHiDPI();
      this.renderOnce();
    });

    this.animate = this.animate.bind(this);
    requestAnimationFrame(this.animate);
  }

  setupHiDPI() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const gRect = this.gaugeCanvas.getBoundingClientRect();
    const gw = gRect.width || 264;
    const gh = gRect.height || 230;
    this.gaugeCanvas.width = gw * dpr;
    this.gaugeCanvas.height = gh * dpr;
    this.gCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.gw = gw;
    this.gh = gh;

    const wRect = this.waveCanvas.getBoundingClientRect();
    const ww = wRect.width || 280;
    const wh = wRect.height || 52;
    this.waveCanvas.width = ww * dpr;
    this.waveCanvas.height = wh * dpr;
    this.wCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ww = ww;
    this.wh = wh;
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
  }

  setFinalSamples(samples) {
    if (!samples || !samples.length) return;
    this.mode = "DOWNLOAD";
    const padded = samples.slice(-42);
    while (padded.length < 12) {
      padded.unshift(padded[0] || 0);
    }
    this.wavePoints = padded;
    this.renderOnce();
  }

  reset() {
    this.targetSpeed = 0;
    this.currentSpeed = 0;
    this.velocity = 0;
    this.maxScale = 250;
    this.mode = "IDLE";
    this.wavePoints = Array(42).fill(0);
    this.renderOnce();
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
    const cx = w / 2;
    const cy = h * 0.52;
    const radius = Math.min(w, h) * 0.39;

    const startAngle = Math.PI * 0.8;
    const endAngle = Math.PI * 2.2;
    const totalArc = endAngle - startAngle;

    // Arka Plan Rayı
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.lineWidth = 14;
    ctx.lineCap = "round";
    ctx.strokeStyle = isDark ? "rgba(255,255,255,0.09)" : "rgba(24,21,18,0.08)";
    ctx.stroke();

    // Ölçek İşaretleri
    const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1];
    ctx.font = "700 10px -apple-system, BlinkMacSystemFont, 'Inter', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = isDark ? "rgba(255,255,255,0.42)" : "rgba(24,21,18,0.42)";

    ticks.forEach((t) => {
      const ang = startAngle + totalArc * t;
      const labelRadius = radius + 21;
      const lx = cx + Math.cos(ang) * labelRadius;
      const ly = cy + Math.sin(ang) * labelRadius;
      const val = Math.round(this.maxScale * t);
      ctx.fillText(val >= 1000 ? `${val / 1000}G` : String(val), lx, ly);
    });

    // Aktif Hız Yayı
    const ratio = Math.min(this.currentSpeed / this.maxScale, 1);
    if (ratio > 0.002) {
      const activeEnd = startAngle + totalArc * ratio;
      const accent = this.getActiveColor();

      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, activeEnd);
      ctx.lineWidth = 14;
      ctx.lineCap = "round";
      ctx.strokeStyle = accent;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 15;
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
      const norm = val / (maxVal * 1.15);
      const y = h - 6 - norm * (h - 14);
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

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, this.mode === "UPLOAD" ? "rgba(245,158,11,0.24)" : "rgba(16,185,129,0.24)");
    grad.addColorStop(1, "rgba(16,185,129,0.0)");
    ctx.fillStyle = grad;
    ctx.fill();
  }

  renderOnce() {
    this.drawGauge();
    this.drawWave();
  }

  animate() {
    const force = (this.targetSpeed - this.currentSpeed) * 0.14;
    this.velocity = (this.velocity + force) * 0.72;
    this.currentSpeed += this.velocity;

    if (Math.abs(this.targetSpeed - this.currentSpeed) < 0.01 && Math.abs(this.velocity) < 0.01) {
      this.currentSpeed = this.targetSpeed;
    }

    this.drawGauge();
    this.drawWave();
    requestAnimationFrame(this.animate);
  }
}

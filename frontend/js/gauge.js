class SpeedVisuals {
  constructor(gaugeCanvasId, waveCanvasId) {
    this.gaugeCanvas = document.getElementById(gaugeCanvasId);
    this.gaugeCtx = this.gaugeCanvas.getContext("2d", { alpha: true });

    this.waveCanvas = document.getElementById(waveCanvasId);
    this.waveCtx = this.waveCanvas.getContext("2d", { alpha: true });

    this.currentValue = 0;
    this.targetValue = 0;
    this.maxScale = 1000;
    this.mode = "IDLE";
    this.wavePoints = [];
    this.isAnimating = false;
    this.scaleLabelAuto = "AUTO SCALE";

    this.setupRetina();
    window.addEventListener("resize", () => {
      this.setupRetina();
      this.renderOnce();
    });
  }

  setAutoLabel(label) {
    this.scaleLabelAuto = label;
    if (this.maxScale === 1000) {
      const ind = document.getElementById("scale-indicator");
      if (ind) ind.textContent = label;
    }
  }

  setupRetina() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    [this.gaugeCanvas, this.waveCanvas].forEach((canvas) => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        const ctx = canvas.getContext("2d");
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
    });
    this.renderOnce();
  }

  wakeUp() {
    if (!this.isAnimating) {
      this.isAnimating = true;
      this.animate();
    }
  }

  setTarget(mbps, mode = "DOWNLOAD") {
    this.targetValue = Math.max(0, mbps);
    this.mode = mode;

    if (mbps > 950 && this.maxScale < 10000) {
      this.maxScale = 10000;
      const ind = document.getElementById("scale-indicator");
      if (ind) ind.textContent = "10G MAX";
    }
    if (mbps > 9500 && this.maxScale < 25000) {
      this.maxScale = 25000;
      const ind = document.getElementById("scale-indicator");
      if (ind) ind.textContent = "25G MAX";
    }

    if (mbps > 0) {
      this.wavePoints.push(mbps);
      if (this.wavePoints.length > 50) this.wavePoints.shift();
    }
    this.wakeUp();
  }

  reset() {
    this.targetValue = 0;
    this.maxScale = 1000;
    this.mode = "IDLE";
    this.wavePoints = [];
    const ind = document.getElementById("scale-indicator");
    if (ind) ind.textContent = this.scaleLabelAuto;
    this.wakeUp();
  }

  speedToRatio(mbps) {
    if (mbps <= 0) return 0;
    const maxLog = Math.log10(this.maxScale + 1);
    return Math.min(1, Math.log10(mbps + 1) / maxLog);
  }

  getTrackColor() {
    return document.body.classList.contains("dark-theme")
      ? "rgba(255, 255, 255, 0.09)"
      : "rgba(15, 15, 20, 0.08)";
  }

  drawGauge() {
    const ctx = this.gaugeCtx;
    const width = this.gaugeCanvas.clientWidth || 342;
    const height = this.gaugeCanvas.clientHeight || 260;

    ctx.clearRect(0, 0, width, height);

    const cx = width / 2;
    const cy = height / 2 + 16;
    const radius = Math.min(width, height) * 0.51;
    const startAngle = Math.PI * 0.78;
    const endAngle = Math.PI * 2.22;
    const totalArc = endAngle - startAngle;

    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.lineWidth = 15;
    ctx.lineCap = "round";
    ctx.strokeStyle = this.getTrackColor();
    ctx.stroke();

    const ratio = this.speedToRatio(this.currentValue);
    if (ratio > 0.004) {
      const currentAngle = startAngle + totalArc * ratio;
      const isUpload = this.mode === "UPLOAD";

      const grad = ctx.createLinearGradient(0, height, width, 0);
      if (isUpload) {
        grad.addColorStop(0, "#f59e0b");
        grad.addColorStop(1, "#ea580c");
      } else {
        grad.addColorStop(0, "#10b981");
        grad.addColorStop(1, "#059669");
      }

      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, currentAngle);
      ctx.lineWidth = 24;
      ctx.lineCap = "round";
      ctx.strokeStyle = isUpload
        ? "rgba(245, 158, 11, 0.22)"
        : "rgba(16, 185, 129, 0.22)";
      ctx.stroke();

      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, currentAngle);
      ctx.lineWidth = 15;
      ctx.lineCap = "round";
      ctx.strokeStyle = grad;
      ctx.stroke();

      const tipX = cx + Math.cos(currentAngle) * radius;
      const tipY = cy + Math.sin(currentAngle) * radius;
      ctx.beginPath();
      ctx.arc(tipX, tipY, 4.6, 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }

    const ticks =
      this.maxScale === 1000
        ? [0, 10, 50, 100, 250, 500, 1000]
        : this.maxScale === 10000
        ? [0, 50, 250, 1000, 2500, 5000, 10000]
        : [0, 100, 500, 2500, 5000, 10000, 25000];

    ctx.font = "700 9.5px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.fillStyle = "#868692";
    ctx.textAlign = "center";

    ticks.forEach((val) => {
      const r = this.speedToRatio(val);
      const angle = startAngle + totalArc * r;
      const tx = cx + Math.cos(angle) * (radius - 23);
      const ty = cy + Math.sin(angle) * (radius - 23);
      const label = val >= 1000 ? `${val / 1000}G` : String(val);
      ctx.fillText(label, tx, ty + 3);
    });
  }

  drawWave() {
    const ctx = this.waveCtx;
    const width = this.waveCanvas.clientWidth || 312;
    const height = this.waveCanvas.clientHeight || 76;

    ctx.clearRect(0, 0, width, height);

    if (this.wavePoints.length < 2) return;

    const maxVal = Math.max(...this.wavePoints, 10) * 1.18;
    const stepX = width / (50 - 1);
    const isUpload = this.mode === "UPLOAD";
    const activeColor = isUpload ? "#f59e0b" : "#10b981";

    const pts = this.wavePoints.map((val, idx) => ({
      x: idx * stepX,
      y: height - (val / maxVal) * (height - 14) - 7
    }));

    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 0; i < pts.length - 1; i++) {
      const xc = (pts[i].x + pts[i + 1].x) / 2;
      const yc = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, xc, yc);
    }
    const last = pts[pts.length - 1];
    ctx.lineTo(last.x, last.y);

    ctx.lineWidth = 2.6;
    ctx.lineCap = "round";
    ctx.strokeStyle = activeColor;
    ctx.stroke();

    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(
      0,
      isUpload ? "rgba(245, 158, 11, 0.24)" : "rgba(16, 185, 129, 0.24)"
    );
    grad.addColorStop(1, "rgba(0, 0, 0, 0)");

    ctx.lineTo(last.x, height);
    ctx.lineTo(0, height);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }

  renderOnce() {
    this.drawGauge();
    this.drawWave();
  }

  animate() {
    const diff = this.targetValue - this.currentValue;
    if (Math.abs(diff) < 0.05) {
      this.currentValue = this.targetValue;
      this.renderOnce();
      this.isAnimating = false;
      return;
    }

    this.currentValue += diff * 0.16;
    this.renderOnce();
    requestAnimationFrame(() => this.animate());
  }
}
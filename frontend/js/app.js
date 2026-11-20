const visuals = new SpeedVisuals("speed-gauge", "wave-chart");
let worker = null;
let isRunning = false;
let networkMetadata = null;
let lastReportData = null;
let currentLang = localStorage.getItem("speedtest_lang") || "en";
let currentPhaseKey = "ready";
let displayUnit = "Mbps"; // "Mbps" veya "MB/s"
let rawLiveMbps = 0;
let rawDlMbps = null;
let rawUlMbps = null;

const I18N = {
  en: {
    zeroLogBadge: "ZERO-LOG",
    detectingNet: "Detecting Network...",
    netUnavailable: "Network Unavailable",
    localLoopbackIsp: "Local Loopback",
    localLoopbackCity: "Localhost",
    historyBtn: "HISTORY",
    stepPing: "PING",
    stepDown: "DOWN",
    stepUp: "UP",
    autoScale: "AUTO SCALE",
    stabilityLabel: "Throughput Stability",
    downloadLabel: "DOWNLOAD",
    uploadLabel: "UPLOAD",
    pingLabel: "IDLE PING",
    jitterLabel: "JITTER",
    qualityTitle: "Line Quality Index",
    qualityReadyDesc: "Run a test to evaluate overall connection health",
    qualityGradeUltra: "Ultra-Low Latency • Ideal for 4K Streaming & Competitive Gaming",
    qualityGradeGood: "Balanced Line • Smooth Video Calls & Fast Downloads",
    qualityGradeFair: "Moderate Congestion • Noticeable Load Latency",
    scStream: "4K Stream",
    scGame: "Gaming",
    scCall: "Video Call",
    bufferbloatTitle: "Bufferbloat",
    bufferbloatDesc: "Latency inflation under load",
    unloadedLabel: "Unloaded (Idle)",
    dlActiveLabel: "Download Active",
    ulActiveLabel: "Upload Active",
    diagnosticsTitle: "Line Telemetry",
    diagnosticsDesc: "Response & routing metadata",
    telemetryTag: "REAL-TIME",
    ttfbLabel: "First Byte (TTFB)",
    serverNodeLabel: "Test Node",
    asnLabel: "Network ASN",
    historyTitle: "Test History",
    historySub: "Stored locally on this device",
    clearBtn: "Clear",
    thDate: "Date",
    thDownload: "Down",
    thUpload: "Up",
    thPing: "Ping",
    thGrade: "Bloat",
    emptyHistory: "No recorded measurements on this device.",
    footerNotice:
      "Zero-Log Architecture: All bandwidth calculations execute locally in your browser. IP metadata is processed transiently in memory and never stored.",
    startBtn: "Start Test",
    stopBtn: "Stop Test",
    againBtn: "Run Again",
    copyBtn: "Copy",
    copiedBtn: "Copied",
    phaseReady: "READY",
    phasePing: "PING & JITTER",
    phaseDownload: "DOWNLOAD (4X)",
    phaseUpload: "UPLOAD (4X)",
    phaseCompleted: "COMPLETED",
    phaseError: "CONNECTION ERROR",
    phaseRateLimit: "RATE LIMIT • WAIT 60S",
    packetLossInline: "Packet Loss",
    minMaxPrefix: "Min",
    maxLabel: "Max"
  },
  tr: {
    zeroLogBadge: "SIFIR KAYIT",
    detectingNet: "Ağ Analiz Ediliyor...",
    netUnavailable: "Ağ Bilgisi Alınamadı",
    localLoopbackIsp: "Yerel Ağ Testi",
    localLoopbackCity: "Localhost",
    historyBtn: "GEÇMİŞ",
    stepPing: "PING",
    stepDown: "İNDİR",
    stepUp: "YÜKLE",
    autoScale: "OTO ÖLÇEK",
    stabilityLabel: "Akış Kararlılığı",
    downloadLabel: "İNDİRME",
    uploadLabel: "YÜKLEME",
    pingLabel: "BOŞTA PING",
    jitterLabel: "JITTER",
    qualityTitle: "Hat Kalite Endeksi",
    qualityReadyDesc: "Genel bağlantı sağlığını ölçmek için testi başlatın",
    qualityGradeUltra: "Ultra Düşük Gecikme • 4K Yayın ve Rekabetçi Oyunlar İçin İdeal",
    qualityGradeGood: "Dengeli Hat • Akıcı Görüntülü Görüşme ve Hızlı İndirme",
    qualityGradeFair: "Orta Düzey Yük • Tam Kapasitede Gecikme Artışı Mevcut",
    scStream: "4K Yayın",
    scGame: "Oyun",
    scCall: "Görüntülü Görüşme",
    bufferbloatTitle: "Bufferbloat",
    bufferbloatDesc: "Tam yük altında gecikme artışı",
    unloadedLabel: "Boşta Gecikme",
    dlActiveLabel: "Download Yükü Altında",
    ulActiveLabel: "Upload Yükü Altında",
    diagnosticsTitle: "Hat Telemetrisi",
    diagnosticsDesc: "Yanıt süresi ve yönlendirme",
    telemetryTag: "CANLI VERİ",
    ttfbLabel: "İlk Bayt Süresi (TTFB)",
    serverNodeLabel: "Test Sunucusu",
    asnLabel: "Ağ ASN Numarası",
    historyTitle: "Ölçüm Geçmişi",
    historySub: "Yalnızca bu cihazda saklanır",
    clearBtn: "Temizle",
    thDate: "Tarih",
    thDownload: "İndirme",
    thUpload: "Yükleme",
    thPing: "Ping",
    thGrade: "Bloat",
    emptyHistory: "Bu cihazda henüz kayıtlı ölçüm bulunmuyor.",
    footerNotice:
      "Zero-Log Mimarisi: Tüm hız hesaplamaları tarayıcınızda yerel olarak yürütülür. IP bilgileri yalnızca bellekte anlık işlenir ve asla kaydedilmez.",
    startBtn: "Testi Başlat",
    stopBtn: "Testi Durdur",
    againBtn: "Tekrar Ölç",
    copyBtn: "Kopyala",
    copiedBtn: "Kopyalandı",
    phaseReady: "HAZIR",
    phasePing: "PING & JITTER",
    phaseDownload: "İNDİRME (4X)",
    phaseUpload: "YÜKLEME (4X)",
    phaseCompleted: "TAMAMLANDI",
    phaseError: "BAĞLANTI HATASI",
    phaseRateLimit: "HIZ SINIRI • 60 SN BEKLEYİN",
    packetLossInline: "Paket Kaybı",
    minMaxPrefix: "Min",
    maxLabel: "Maks"
  }
};

const els = {
  gaugeCard: document.getElementById("gauge-card"),
  startBtn: document.getElementById("start-btn"),
  btnIcon: document.getElementById("btn-icon"),
  btnText: document.getElementById("btn-text"),
  copyReportBtn: document.getElementById("copy-report-btn"),
  copyText: document.getElementById("copy-text"),
  unitToggleBtn: document.getElementById("unit-toggle-btn"),
  langToggle: document.getElementById("lang-toggle"),
  langLabel: document.getElementById("lang-label"),
  themeToggle: document.getElementById("theme-toggle"),
  themeLabel: document.getElementById("theme-label"),
  historyOpenBtn: document.getElementById("history-open-btn"),
  historyCloseBtn: document.getElementById("history-close-btn"),
  historyDrawer: document.getElementById("history-drawer"),
  drawerBackdrop: document.getElementById("drawer-backdrop"),
  historyCount: document.getElementById("history-count"),
  liveSpeed: document.getElementById("live-speed"),
  liveUnit: document.getElementById("live-unit"),
  testPhase: document.getElementById("test-phase"),
  stabilityScore: document.getElementById("stability-score"),
  ispName: document.getElementById("isp-name"),
  ipInfo: document.getElementById("ip-info"),
  cardDownload: document.getElementById("card-download"),
  cardUpload: document.getElementById("card-upload"),
  cardPing: document.getElementById("card-ping"),
  resDownload: document.getElementById("res-download"),
  resDownloadUnit: document.getElementById("res-download-unit"),
  resDownloadMb: document.getElementById("res-download-mb"),
  resUpload: document.getElementById("res-upload"),
  resUploadUnit: document.getElementById("res-upload-unit"),
  resUploadMb: document.getElementById("res-upload-mb"),
  resPing: document.getElementById("res-ping"),
  resMinMaxPing: document.getElementById("res-min-max-ping"),
  resJitter: document.getElementById("res-jitter"),
  resLoss: document.getElementById("res-loss"),
  qualityScore: document.getElementById("quality-score"),
  qualityVerdict: document.getElementById("quality-verdict"),
  qualityFill: document.getElementById("quality-fill"),
  scStream: document.getElementById("sc-stream"),
  scGame: document.getElementById("sc-game"),
  scCall: document.getElementById("sc-call"),
  bloatGrade: document.getElementById("bufferbloat-grade"),
  bloatIdle: document.getElementById("bloat-idle"),
  bloatDl: document.getElementById("bloat-dl"),
  bloatUl: document.getElementById("bloat-ul"),
  diagTtfb: document.getElementById("diag-ttfb"),
  diagAsn: document.getElementById("diag-asn"),
  historyBody: document.getElementById("history-body"),
  clearHistoryBtn: document.getElementById("clear-history-btn")
};

function t(key) {
  return I18N[currentLang][key] || key;
}

function updatePhaseVisuals(phaseKey) {
  els.cardDownload.classList.remove("card-active-emerald");
  els.cardUpload.classList.remove("card-active-amber");
  els.cardPing.classList.remove("card-active-coral");
  els.testPhase.classList.remove("phase-upload", "phase-ping");
  els.gaugeCard.classList.remove("phase-glow-emerald", "phase-glow-amber", "phase-glow-coral");

  const steps = document.querySelectorAll(".step-pill");
  steps.forEach((s) => s.classList.remove("active-step", "done-step"));

  if (phaseKey === "ping") {
    els.cardPing.classList.add("card-active-coral");
    els.testPhase.classList.add("phase-ping");
    els.gaugeCard.classList.add("phase-glow-coral");
    document.querySelector('[data-step="ping"]')?.classList.add("active-step");
  } else if (phaseKey === "download") {
    els.cardDownload.classList.add("card-active-emerald");
    els.gaugeCard.classList.add("phase-glow-emerald");
    document.querySelector('[data-step="ping"]')?.classList.add("done-step");
    document.querySelector('[data-step="download"]')?.classList.add("active-step");
  } else if (phaseKey === "upload") {
    els.cardUpload.classList.add("card-active-amber");
    els.testPhase.classList.add("phase-upload");
    els.gaugeCard.classList.add("phase-glow-amber");
    document.querySelector('[data-step="ping"]')?.classList.add("done-step");
    document.querySelector('[data-step="download"]')?.classList.add("done-step");
    document.querySelector('[data-step="upload"]')?.classList.add("active-step");
  } else if (phaseKey === "completed") {
    steps.forEach((s) => s.classList.add("done-step"));
  } else if (phaseKey === "rateLimit" || phaseKey === "error") {
    els.testPhase.classList.add("phase-ping");
  }
}

function setPhase(phaseKey) {
  currentPhaseKey = phaseKey;
  updatePhaseVisuals(phaseKey);
  const map = {
    ready: "phaseReady",
    ping: "phasePing",
    download: "phaseDownload",
    upload: "phaseUpload",
    completed: "phaseCompleted",
    error: "phaseError",
    rateLimit: "phaseRateLimit"
  };
  els.testPhase.textContent = t(map[phaseKey] || "phaseReady");
}

function renderSpeedValues() {
  if (displayUnit === "MB/s") {
    els.liveSpeed.textContent = (rawLiveMbps / 8).toFixed(2);
    els.liveUnit.textContent = "MB/s";
    if (rawDlMbps !== null) {
      els.resDownload.textContent = (rawDlMbps / 8).toFixed(2);
      els.resDownloadUnit.textContent = "MB/s";
      els.resDownloadMb.textContent = `${rawDlMbps.toFixed(1)} Mbps`;
    }
    if (rawUlMbps !== null) {
      els.resUpload.textContent = (rawUlMbps / 8).toFixed(2);
      els.resUploadUnit.textContent = "MB/s";
      els.resUploadMb.textContent = `${rawUlMbps.toFixed(1)} Mbps`;
    }
  } else {
    els.liveSpeed.textContent = rawLiveMbps.toFixed(2);
    els.liveUnit.textContent = "Mbps";
    if (rawDlMbps !== null) {
      els.resDownload.textContent = rawDlMbps.toFixed(1);
      els.resDownloadUnit.textContent = "Mbps";
      els.resDownloadMb.textContent = `${(rawDlMbps / 8).toFixed(2)} MB/s`;
    }
    if (rawUlMbps !== null) {
      els.resUpload.textContent = rawUlMbps.toFixed(1);
      els.resUploadUnit.textContent = "Mbps";
      els.resUploadMb.textContent = `${(rawUlMbps / 8).toFixed(2)} MB/s`;
    }
  }
}

els.unitToggleBtn.addEventListener("click", () => {
  displayUnit = displayUnit === "Mbps" ? "MB/s" : "Mbps";
  renderSpeedValues();
});

function renderNetworkLabel() {
  if (!networkMetadata) {
    els.ispName.textContent = t("detectingNet");
    return;
  }
  if (networkMetadata.asn === "AS0000") {
    els.ispName.textContent = `${t("localLoopbackIsp")} (${t("localLoopbackCity")})`;
  } else {
    els.ispName.textContent = `${networkMetadata.isp} (${networkMetadata.city})`;
  }
}

function renderMinMaxLabel(minVal, maxVal) {
  if (minVal === undefined || maxVal === undefined) {
    els.resMinMaxPing.textContent = `${t("minMaxPrefix")} -- / ${t("maxLabel")} -- ms`;
  } else {
    els.resMinMaxPing.textContent = `${t("minMaxPrefix")} ${minVal} / ${t("maxLabel")} ${maxVal} ms`;
  }
}

function applyLanguage() {
  document.documentElement.lang = currentLang;
  els.langLabel.textContent = currentLang === "en" ? "TR" : "EN";
  visuals.setAutoLabel(t("autoScale"));

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.getAttribute("data-i18n");
    if (I18N[currentLang][key]) {
      node.textContent = I18N[currentLang][key];
    }
  });

  if (isRunning) {
    els.btnText.textContent = t("stopBtn");
  } else if (currentPhaseKey === "completed") {
    els.btnText.textContent = t("againBtn");
  } else {
    els.btnText.textContent = t("startBtn");
  }

  setPhase(currentPhaseKey);
  renderNetworkLabel();
  renderMinMaxLabel(els.resMinMaxPing.dataset.min, els.resMinMaxPing.dataset.max);

  const currentLoss = els.resLoss.dataset.lossVal || "0.0%";
  els.resLoss.textContent = `${t("packetLossInline")}: ${currentLoss}`;

  if (els.qualityVerdict.dataset.verdictKey) {
    els.qualityVerdict.textContent = t(els.qualityVerdict.dataset.verdictKey);
  }

  renderHistory();
}

function toggleDrawer(open) {
  els.historyDrawer.classList.toggle("open", open);
  els.drawerBackdrop.classList.toggle("open", open);
  els.historyDrawer.setAttribute("aria-hidden", String(!open));
}

els.historyOpenBtn.addEventListener("click", () => toggleDrawer(true));
els.historyCloseBtn.addEventListener("click", () => toggleDrawer(false));
els.drawerBackdrop.addEventListener("click", () => toggleDrawer(false));

els.langToggle.addEventListener("click", () => {
  currentLang = currentLang === "en" ? "tr" : "en";
  localStorage.setItem("speedtest_lang", currentLang);
  applyLanguage();
});

function initTheme() {
  const saved = localStorage.getItem("speedtest_theme");
  if (saved === "dark") {
    document.body.classList.add("dark-theme");
    els.themeLabel.textContent = "LIGHT";
  }
}

els.themeToggle.addEventListener("click", () => {
  const isDark = document.body.classList.toggle("dark-theme");
  localStorage.setItem("speedtest_theme", isDark ? "dark" : "light");
  els.themeLabel.textContent = isDark ? "LIGHT" : "DARK";
  visuals.renderOnce();
});

async function fetchNetworkInfo() {
  try {
    const res = await fetch("/api/network-info");
    networkMetadata = await res.json();
    renderNetworkLabel();
    els.ipInfo.textContent = `${networkMetadata.ip_version} • ${networkMetadata.ip_masked}`;
    els.diagAsn.textContent = networkMetadata.asn;
  } catch {
    els.ispName.textContent = t("netUnavailable");
  }
}

function calculateStability(samples) {
  if (!samples || samples.length < 4) return 96;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  if (mean <= 0) return 0;
  const variance =
    samples.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / samples.length;
  const stdDev = Math.sqrt(variance);
  const cv = stdDev / mean;
  return Math.max(12, Math.min(99, Math.round((1 - cv) * 100)));
}

function evaluateBufferbloat(idlePing, dlPing, ulPing) {
  const maxIncrease = Math.max(dlPing - idlePing, ulPing - idlePing, 0);
  if (maxIncrease < 15) return { grade: "A+", cls: "grade-A", penalty: 0 };
  if (maxIncrease < 35) return { grade: "A", cls: "grade-A", penalty: 5 };
  if (maxIncrease < 75) return { grade: "B", cls: "grade-B", penalty: 14 };
  if (maxIncrease < 140) return { grade: "C", cls: "grade-B", penalty: 25 };
  return { grade: "F", cls: "grade-F", penalty: 38 };
}

function computeQualityScore(dl, ping, jitter, bloatPenalty) {
  let score = 100 - bloatPenalty;
  if (ping > 85) score -= 16;
  else if (ping > 45) score -= 7;
  if (jitter > 15) score -= 12;
  else if (jitter > 6) score -= 5;
  if (dl < 25) score -= 12;
  score = Math.max(25, Math.min(100, Math.round(score)));

  let verdictKey = "qualityGradeUltra";
  if (score < 70) verdictKey = "qualityGradeFair";
  else if (score < 88) verdictKey = "qualityGradeGood";

  return { score, verdictKey };
}

function updateScenarioChips(dl, ul, ping, jitter) {
  [els.scStream, els.scGame, els.scCall].forEach((c) => c.classList.remove("sc-ok", "sc-warn"));

  els.scStream.classList.add(dl >= 25 ? "sc-ok" : "sc-warn");
  els.scGame.classList.add(ping <= 85 && jitter <= 12 ? "sc-ok" : "sc-warn");
  els.scCall.classList.add(dl >= 10 && ul >= 5 && jitter <= 20 ? "sc-ok" : "sc-warn");
}

function saveToLocalHistory(entry) {
  const existing = JSON.parse(localStorage.getItem("speedtest_engine_history") || "[]");
  existing.unshift(entry);
  localStorage.setItem("speedtest_engine_history", JSON.stringify(existing.slice(0, 15)));
  renderHistory();
}

function renderHistory() {
  const records = JSON.parse(localStorage.getItem("speedtest_engine_history") || "[]");
  els.historyCount.textContent = String(records.length);

  if (!records.length) {
    els.historyBody.innerHTML = `<tr><td colspan="5" class="empty-row">${t("emptyHistory")}</td></tr>`;
    return;
  }

  els.historyBody.innerHTML = records
    .map(
      (r) => `
      <tr>
        <td class="mono">${r.date}</td>
        <td class="mono"><strong>${r.download}</strong> Mbps</td>
        <td class="mono"><strong>${r.upload}</strong> Mbps</td>
        <td class="mono">${r.ping} ms</td>
        <td><span class="grade-badge ${r.bloatCls}">${r.bloatGrade}</span></td>
      </tr>
    `
    )
    .join("");
}

function startTest() {
  if (isRunning) {
    if (worker) worker.postMessage({ command: "STOP" });
    resetUIState(false);
    return;
  }

  isRunning = true;
  rawLiveMbps = 0;
  visuals.reset();
  renderSpeedValues();

  els.copyReportBtn.classList.add("hidden");
  els.startBtn.classList.add("btn-running");
  els.btnIcon.textContent = "■";
  els.btnText.textContent = t("stopBtn");

  els.bloatGrade.className = "grade-badge";
  els.bloatGrade.textContent = "-";
  els.qualityScore.textContent = "--";
  els.qualityFill.style.width = "0%";
  [els.scStream, els.scGame, els.scCall].forEach((c) => c.classList.remove("sc-ok", "sc-warn"));

  worker = new Worker("/js/worker.js");

  worker.onmessage = (e) => {
    const msg = e.data;

    if (msg.type === "PHASE") {
      if (msg.phase === "PING") setPhase("ping");
      else if (msg.phase === "DOWNLOAD") setPhase("download");
      else if (msg.phase === "UPLOAD") setPhase("upload");
    } else if (msg.type === "PING_TICK") {
      const minV = msg.stats.min.toFixed(0);
      const maxV = msg.stats.max.toFixed(0);
      els.resPing.textContent = msg.stats.avg.toFixed(1);
      els.resMinMaxPing.dataset.min = minV;
      els.resMinMaxPing.dataset.max = maxV;
      renderMinMaxLabel(minV, maxV);
      els.resJitter.textContent = msg.stats.jitter.toFixed(1);
    } else if (msg.type === "SPEED_TICK") {
      rawLiveMbps = msg.mbps;
      renderSpeedValues();
      visuals.setTarget(msg.mbps, msg.mode);
    } else if (msg.type === "COMPLETE") {
      finalizeResults(msg.results);
    } else if (msg.type === "ERROR") {
      visuals.reset();
      rawLiveMbps = 0;
      renderSpeedValues();
      setPhase(msg.code === "RATE_LIMIT" ? "rateLimit" : "error");
      resetUIState(false);
    }
  };

  worker.postMessage({
    command: "START",
    baseUrl: window.location.origin
  });
}

function finalizeResults(res) {
  const dl = res.download.mbps;
  const ul = res.upload.mbps;
  const ping = res.ping.avg;
  const jitter = res.ping.jitter;
  const loss = res.ping.packetLoss;
  const ttfb = res.download.ttfb || ping;

  rawLiveMbps = dl;
  rawDlMbps = dl;
  rawUlMbps = ul;
  renderSpeedValues();

  visuals.setTarget(dl, "DOWNLOAD");
  setPhase("completed");

  els.resPing.textContent = ping.toFixed(1);
  els.resJitter.textContent = jitter.toFixed(1);

  const lossFormatted = `${loss.toFixed(1)}%`;
  els.resLoss.dataset.lossVal = lossFormatted;
  els.resLoss.textContent = `${t("packetLossInline")}: ${lossFormatted}`;

  els.diagTtfb.textContent = `${ttfb.toFixed(1)} ms`;

  const dlLoaded = res.download.loadedPing || ping;
  const ulLoaded = res.upload.loadedPing || ping;
  els.bloatIdle.textContent = `${ping.toFixed(1)} ms`;
  els.bloatDl.textContent = `${dlLoaded.toFixed(1)} ms (+${Math.max(0, dlLoaded - ping).toFixed(0)})`;
  els.bloatUl.textContent = `${ulLoaded.toFixed(1)} ms (+${Math.max(0, ulLoaded - ping).toFixed(0)})`;

  const bloat = evaluateBufferbloat(ping, dlLoaded, ulLoaded);
  els.bloatGrade.textContent = bloat.grade;
  els.bloatGrade.className = `grade-badge ${bloat.cls}`;

  const quality = computeQualityScore(dl, ping, jitter, bloat.penalty);
  els.qualityScore.textContent = String(quality.score);
  els.qualityFill.style.width = `${quality.score}%`;
  els.qualityVerdict.dataset.verdictKey = quality.verdictKey;
  els.qualityVerdict.textContent = t(quality.verdictKey);

  updateScenarioChips(dl, ul, ping, jitter);

  const stability = calculateStability(res.download.samples);
  els.stabilityScore.textContent = `${stability}%`;

  lastReportData = {
    dl: dl.toFixed(1),
    ul: ul.toFixed(1),
    ping: ping.toFixed(1),
    jitter: jitter.toFixed(1),
    grade: bloat.grade,
    score: quality.score
  };
  els.copyReportBtn.classList.remove("hidden");

  saveToLocalHistory({
    date: new Date().toLocaleString("en-GB", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    }),
    download: dl.toFixed(1),
    upload: ul.toFixed(1),
    ping: ping.toFixed(0),
    jitter: jitter.toFixed(1),
    bloatGrade: bloat.grade,
    bloatCls: bloat.cls
  });

  resetUIState(true);
}

function resetUIState(completed = false) {
  isRunning = false;
  els.startBtn.classList.remove("btn-running");
  els.btnIcon.textContent = "▶";
  els.btnText.textContent = completed ? t("againBtn") : t("startBtn");
  if (worker) {
    worker.terminate();
    worker = null;
  }
}

els.copyReportBtn.addEventListener("click", async () => {
  if (!lastReportData) return;
  const r = lastReportData;
  const summary =
    currentLang === "tr"
      ? `Speedtest Engine | İndirme: ${r.dl} Mbps | Yükleme: ${r.ul} Mbps | Ping: ${r.ping} ms | Jitter: ${r.jitter} ms | Bufferbloat: ${r.grade} | Puan: ${r.score}/100`
      : `Speedtest Engine | Download: ${r.dl} Mbps | Upload: ${r.ul} Mbps | Ping: ${r.ping} ms | Jitter: ${r.jitter} ms | Bufferbloat: ${r.grade} | Score: ${r.score}/100`;
  await navigator.clipboard.writeText(summary);
  els.copyText.textContent = t("copiedBtn");
  setTimeout(() => {
    els.copyText.textContent = t("copyBtn");
  }, 1800);
});

els.startBtn.addEventListener("click", startTest);
els.clearHistoryBtn.addEventListener("click", () => {
  localStorage.removeItem("speedtest_engine_history");
  renderHistory();
});

initTheme();
applyLanguage();
fetchNetworkInfo();

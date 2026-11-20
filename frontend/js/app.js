"use strict";

const visuals = new SpeedVisuals("speed-gauge", "wave-chart");

let worker = null;
let platformWorker = null;
let platformBusy = false;
let isRunning = false;
let networkMetadata = null;
let lastReportData = null;
let currentPhaseKey = "ready";
let displayUnit = "Mbps";
let rawLiveMbps = 0;
let rawDlMbps = null;
let rawUlMbps = null;

const store = {
  get(key, fallback = null) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch (_) {
      return fallback;
    }
  },
  set(key, value) {
    try { localStorage.setItem(key, value); } catch (_) {}
  },
  remove(key) {
    try { localStorage.removeItem(key); } catch (_) {}
  }
};

function readHistory() {
  try {
    const parsed = JSON.parse(store.get("speedtest_engine_history", "[]"));
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const browserLang = (navigator.language || "en").toLowerCase().startsWith("tr") ? "tr" : "en";
let currentLang = store.get("speedtest_lang") || browserLang;

const I18N = {
  en: {
    zeroLogBadge: "ZERO-LOG",
    detectingNet: "Detecting Network...",
    netUnavailable: "Network Unavailable",
    localLoopbackIsp: "Local Loopback",
    localLoopbackCity: "Localhost",
    historyBtn: "HISTORY",
    themeDark: "DARK",
    themeLight: "LIGHT",
    stepPing: "PING",
    stepDown: "DOWN",
    stepUp: "UP",
    autoScale: "AUTO SCALE",
    stabilityLabel: "Throughput Stability",
    downloadLabel: "DOWNLOAD",
    uploadLabel: "UPLOAD",
    pingLabel: "LOCAL PING",
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
    unloadedLabel: "EU Server Idle",
    dlActiveLabel: "Download Load",
    ulActiveLabel: "Upload Load",
    diagnosticsTitle: "Line Telemetry",
    diagnosticsDesc: "Response & routing metadata",
    telemetryTag: "REAL-TIME",
    euPingLabel: "Frankfurt Node",
    ttfbLabel: "First Byte (TTFB)",
    asnLabel: "Network ASN",
    platformTitle: "Social & Media CDN Ping",
    platformDesc: "Live edge reachability from your device",
    pingAppsBtn: "Measure",
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
    phasePing: "LOCAL PING & JITTER",
    phaseDownload: "DOWNLOAD (4X)",
    phaseUpload: "UPLOAD (4X)",
    phaseCompleted: "COMPLETED",
    phaseError: "CONNECTION ERROR",
    phaseRateLimit: "RATE LIMIT • WAIT 60S",
    packetLossInline: "Packet Loss",
    minMaxPrefix: "Min",
    maxLabel: "Max",
    blockedText: "Unreachable",
    timeoutText: "Timeout"
  },
  tr: {
    zeroLogBadge: "SIFIR KAYIT",
    detectingNet: "Ağ Analiz Ediliyor...",
    netUnavailable: "Ağ Bilgisi Alınamadı",
    localLoopbackIsp: "Yerel Ağ Testi",
    localLoopbackCity: "Localhost",
    historyBtn: "GEÇMİŞ",
    themeDark: "KOYU",
    themeLight: "AÇIK",
    stepPing: "PING",
    stepDown: "İNDİR",
    stepUp: "YÜKLE",
    autoScale: "OTO ÖLÇEK",
    stabilityLabel: "Akış Kararlılığı",
    downloadLabel: "İNDİRME",
    uploadLabel: "YÜKLEME",
    pingLabel: "YEREL PING",
    jitterLabel: "JITTER",
    qualityTitle: "Hat Kalite Endeksi",
    qualityReadyDesc: "Genel bağlantı sağlığını ölçmek için testi başlatın",
    qualityGradeUltra: "Ultra Düşük Gecikme • 4K Yayın ve Rekabetçi Oyunlar İçin İdeal",
    qualityGradeGood: "Dengeli Hat • Akıcı Görüntülü Görüşme ve Hızlı İndirme",
    qualityGradeFair: "Orta Düzey Yük • Tam Kapasitede Gecikme Artışı Mevcut",
    scStream: "4K Yayın",
    scGame: "Oyun",
    scCall: "Görüşme",
    bufferbloatTitle: "Bufferbloat",
    bufferbloatDesc: "Tam yük altında gecikme artışı",
    unloadedLabel: "Avrupa Boşta",
    dlActiveLabel: "İndirme Yükünde",
    ulActiveLabel: "Yükleme Yükünde",
    diagnosticsTitle: "Hat Telemetrisi",
    diagnosticsDesc: "Yanıt süresi ve yönlendirme",
    telemetryTag: "CANLI VERİ",
    euPingLabel: "Frankfurt Sunucu",
    ttfbLabel: "İlk Bayt Süresi (TTFB)",
    asnLabel: "Ağ ASN Numarası",
    platformTitle: "Sosyal Medya & CDN Ping",
    platformDesc: "Cihazınızdan en yakın medya düğümlerine erişim süresi",
    pingAppsBtn: "Ölç",
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
    phasePing: "YEREL PING & JITTER",
    phaseDownload: "İNDİRME (4X)",
    phaseUpload: "YÜKLEME (4X)",
    phaseCompleted: "TAMAMLANDI",
    phaseError: "BAĞLANTI HATASI",
    phaseRateLimit: "HIZ SINIRI • 60 SN BEKLEYİN",
    packetLossInline: "Paket Kaybı",
    minMaxPrefix: "Min",
    maxLabel: "Maks",
    blockedText: "Erişim Yok",
    timeoutText: "Zaman Aşımı"
  }
};

function t(key) {
  return I18N[currentLang][key] || key;
}

const TT_PATH =
  "M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1-.1z";

const PLATFORMS = [
  {
    id: "youtube",
    name: "YouTube",
    tile: "#ffffff",
    ring: true,
    glyph: `<path fill="#FF0000" d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.4 31.4 0 0 0 0 12a31.4 31.4 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.4 31.4 0 0 0 24 12a31.4 31.4 0 0 0-.5-5.8zM9.6 15.6V8.4l6.3 3.6-6.3 3.6z"/>`
  },
  {
    id: "instagram",
    name: "Instagram",
    tile: "radial-gradient(circle at 30% 107%, #fdf497 0%, #fdf497 5%, #fd5949 45%, #d6249f 60%, #7c3aed 90%)",
    glyph: `<g fill="none" stroke="#fff" stroke-width="2.2"><rect x="2.5" y="2.5" width="19" height="19" rx="5.5"/><circle cx="12" cy="12" r="4.2"/></g><circle cx="17.5" cy="6.5" r="1.3" fill="#fff"/>`
  },
  {
    id: "tiktok",
    name: "TikTok",
    tile: "#09090b",
    glyph: `<path fill="#25F4EE" transform="translate(-.8 -.6)" d="${TT_PATH}"/><path fill="#FE2C55" transform="translate(.8 .6)" d="${TT_PATH}"/><path fill="#fff" d="${TT_PATH}"/>`
  },
  {
    id: "x",
    name: "X",
    tile: "#09090b",
    glyph: `<path fill="#fff" transform="translate(2 2) scale(.83)" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>`
  },
  {
    id: "whatsapp",
    name: "WhatsApp",
    tile: "#25D366",
    glyph: `<path fill="#fff" d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2.05 22l5.25-1.38c1.45.79 3.08 1.21 4.74 1.21 5.46 0 9.91-4.45 9.91-9.91C21.95 6.45 17.5 2 12.04 2zm5.82 14.01c-.24.68-1.41 1.3-1.95 1.38-.5.08-1.13.11-1.82-.11-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.79-4.17-4.94-4.36-.14-.19-1.18-1.57-1.18-3 0-1.43.75-2.13 1.01-2.42.27-.29.58-.36.78-.36.19 0 .39 0 .56.01.18.01.42-.07.66.5.24.58.82 2.01.89 2.15.07.15.12.32.02.51-.1.19-.15.31-.29.48-.15.17-.31.38-.44.51-.15.15-.3.31-.13.61.17.29.76 1.25 1.63 2.03 1.12 1 2.06 1.31 2.36 1.46.29.15.46.12.63-.07.17-.19.73-.85.92-1.14.19-.29.39-.24.66-.15.27.1 1.7.8 1.99.95.29.14.48.22.55.34.07.12.07.69-.17 1.37z"/>`
  },
  {
    id: "telegram",
    name: "Telegram",
    tile: "#18181b",
    glyph: `<path fill="#ffffff" transform="translate(2.2 2.2) scale(.82)" d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z"/>`
  },
  {
    id: "twitch",
    name: "Twitch",
    tile: "#9146FF",
    glyph: `<path fill="#ffffff" transform="translate(3 2.5) scale(.76)" d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714Z"/>`
  },
  {
    id: "spotify",
    name: "Spotify",
    tile: "#1DB954",
    glyph: `<path fill="#ffffff" transform="translate(2 2) scale(.83)" d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.721 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z"/>`
  }
];

function buildPlatformGrid() {
  const grid = document.getElementById("platform-grid");
  grid.innerHTML = PLATFORMS.map(
    (p) => `
    <div class="plat-card" data-plat="${p.id}">
      <span class="plat-logo${p.ring ? " has-ring" : ""}" style="background:${p.tile}" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="17" height="17" focusable="false">${p.glyph}</svg>
      </span>
      <span class="plat-info">
        <span class="plat-name">${p.name}</span>
        <span class="plat-ms num" id="plat-ms-${p.id}">-- ms</span>
      </span>
    </div>`
  ).join("");
}

const $ = (id) => document.getElementById(id);
const els = {
  gaugeCard: $("gauge-card"),
  startBtn: $("start-btn"),
  btnIcon: $("btn-icon"),
  btnText: $("btn-text"),
  copyReportBtn: $("copy-report-btn"),
  copyText: $("copy-text"),
  unitToggleBtn: $("unit-toggle-btn"),
  langToggle: $("lang-toggle"),
  langLabel: $("lang-label"),
  themeToggle: $("theme-toggle"),
  themeLabel: $("theme-label"),
  historyOpenBtn: $("history-open-btn"),
  historyCloseBtn: $("history-close-btn"),
  historyDrawer: $("history-drawer"),
  drawerBackdrop: $("drawer-backdrop"),
  historyCount: $("history-count"),
  liveSpeed: $("live-speed"),
  liveUnit: $("live-unit"),
  testPhase: $("test-phase"),
  stabilityScore: $("stability-score"),
  ispName: $("isp-name"),
  ipInfo: $("ip-info"),
  cardDownload: $("card-download"),
  cardUpload: $("card-upload"),
  cardPing: $("card-ping"),
  resDownload: $("res-download"),
  resDownloadUnit: $("res-download-unit"),
  resDownloadMb: $("res-download-mb"),
  resUpload: $("res-upload"),
  resUploadUnit: $("res-upload-unit"),
  resUploadMb: $("res-upload-mb"),
  resPing: $("res-ping"),
  resMinMaxPing: $("res-min-max-ping"),
  resJitter: $("res-jitter"),
  resLoss: $("res-loss"),
  qualityScore: $("quality-score"),
  qualityVerdict: $("quality-verdict"),
  qualityFill: $("quality-fill"),
  scStream: $("sc-stream"),
  scGame: $("sc-game"),
  scCall: $("sc-call"),
  bloatGrade: $("bufferbloat-grade"),
  bloatIdle: $("bloat-idle"),
  bloatDl: $("bloat-dl"),
  bloatUl: $("bloat-ul"),
  diagEuPing: $("diag-eu-ping"),
  diagTtfb: $("diag-ttfb"),
  diagAsn: $("diag-asn"),
  platformAccordion: $("platform-accordion"),
  platformToggle: $("platform-toggle"),
  accordionChevron: $("accordion-chevron"),
  pingAppsBtn: $("ping-apps-btn"),
  historyBody: $("history-body"),
  clearHistoryBtn: $("clear-history-btn"),
  metaTheme: $("meta-theme-color")
};

function updateThemeButtonLabel() {
  const isDark = document.body.classList.contains("dark-theme");
  els.themeLabel.textContent = isDark ? t("themeLight") : t("themeDark");
  if (els.metaTheme) els.metaTheme.content = isDark ? "#08080a" : "#f6f4f0";
}

function initTheme() {
  const saved = store.get("speedtest_theme");
  const prefersDark = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
  if (saved ? saved === "dark" : prefersDark) document.body.classList.add("dark-theme");
  updateThemeButtonLabel();
}

els.themeToggle.addEventListener("click", () => {
  document.body.classList.toggle("dark-theme");
  store.set("speedtest_theme", document.body.classList.contains("dark-theme") ? "dark" : "light");
  updateThemeButtonLabel();
  visuals.renderOnce();
});

function setAccordion(open) {
  els.platformAccordion.classList.toggle("collapsed", !open);
  els.platformToggle.setAttribute("aria-expanded", String(open));
  els.accordionChevron.setAttribute("aria-expanded", String(open));
}
function toggleAccordion() {
  setAccordion(els.platformAccordion.classList.contains("collapsed"));
}
els.platformToggle.addEventListener("click", toggleAccordion);
els.accordionChevron.addEventListener("click", toggleAccordion);

function updatePlatformBadge(id, ms) {
  const el = $(`plat-ms-${id}`);
  if (!el) return;
  el.dataset.ms = String(ms);
  el.closest(".plat-card")?.classList.remove("loading");
  el.classList.remove("ms-fast", "ms-mid", "ms-slow");

  if (ms < 0) {
    el.textContent = t(ms === -2 ? "timeoutText" : "blockedText");
    el.classList.add("ms-slow");
    return;
  }
  el.textContent = `${ms} ms`;
  if (ms <= 75) el.classList.add("ms-fast");
  else if (ms <= 145) el.classList.add("ms-mid");
  else el.classList.add("ms-slow");
}

function refreshPlatformBadges() {
  document.querySelectorAll(".plat-ms[data-ms]").forEach((el) => {
    updatePlatformBadge(el.id.replace("plat-ms-", ""), Number(el.dataset.ms));
  });
}

function setPlatformLoading(on) {
  document.querySelectorAll(".plat-card").forEach((card) => {
    card.classList.toggle("loading", on);
    if (on) {
      const ms = card.querySelector(".plat-ms");
      ms.classList.remove("ms-fast", "ms-mid", "ms-slow");
      ms.textContent = "…";
      delete ms.dataset.ms;
    }
  });
  els.pingAppsBtn.classList.toggle("spinning", on);
  els.pingAppsBtn.disabled = on;
  platformBusy = on;
}

function stopPlatformWorker() {
  if (platformWorker) {
    platformWorker.terminate();
    platformWorker = null;
  }
}

function runPlatformPingOnly() {
  if (isRunning || platformBusy) return;
  setAccordion(true);
  setPlatformLoading(true);

  stopPlatformWorker();
  platformWorker = new Worker("/js/worker.js?v=5");
  platformWorker.onmessage = (e) => {
    const msg = e.data;
    if (msg.type === "PLATFORM_TICK") {
      updatePlatformBadge(msg.id, msg.ms);
    } else if (msg.type === "PLATFORMS_DONE") {
      setPlatformLoading(false);
      stopPlatformWorker();
    }
  };
  platformWorker.postMessage({ command: "PING_PLATFORMS" });
}
els.pingAppsBtn.addEventListener("click", runPlatformPingOnly);

function updatePhaseVisuals(phaseKey) {
  els.cardDownload.classList.remove("card-active-emerald");
  els.cardUpload.classList.remove("card-active-amber");
  els.cardPing.classList.remove("card-active-coral");
  els.testPhase.classList.remove("phase-upload", "phase-ping");
  els.gaugeCard.classList.remove("phase-glow-emerald", "phase-glow-amber", "phase-glow-coral");

  const steps = document.querySelectorAll(".step-pill");
  steps.forEach((s) => s.classList.remove("active-step", "done-step"));
  const step = (name) => document.querySelector(`[data-step="${name}"]`);

  if (phaseKey === "ping") {
    els.cardPing.classList.add("card-active-coral");
    els.testPhase.classList.add("phase-ping");
    els.gaugeCard.classList.add("phase-glow-coral");
    step("ping")?.classList.add("active-step");
  } else if (phaseKey === "download") {
    els.cardDownload.classList.add("card-active-emerald");
    els.gaugeCard.classList.add("phase-glow-emerald");
    step("ping")?.classList.add("done-step");
    step("download")?.classList.add("active-step");
  } else if (phaseKey === "upload") {
    els.cardUpload.classList.add("card-active-amber");
    els.testPhase.classList.add("phase-upload");
    els.gaugeCard.classList.add("phase-glow-amber");
    step("ping")?.classList.add("done-step");
    step("download")?.classList.add("done-step");
    step("upload")?.classList.add("active-step");
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

function fmtLive(v) {
  if (v >= 1000) return v.toFixed(0);
  if (v >= 100) return v.toFixed(1);
  return v.toFixed(2);
}

function renderSpeedValues() {
  const inMB = displayUnit === "MB/s";
  els.liveSpeed.textContent = fmtLive(inMB ? rawLiveMbps / 8 : rawLiveMbps);
  els.liveUnit.textContent = displayUnit;

  const main = (v) => (inMB ? (v / 8).toFixed(2) : v.toFixed(1));
  const sub = (v) => (inMB ? `${v.toFixed(1)} Mbps` : `${(v / 8).toFixed(2)} MB/s`);

  if (rawDlMbps !== null) {
    els.resDownload.textContent = main(rawDlMbps);
    els.resDownloadUnit.textContent = displayUnit;
    els.resDownloadMb.textContent = sub(rawDlMbps);
  }
  if (rawUlMbps !== null) {
    els.resUpload.textContent = main(rawUlMbps);
    els.resUploadUnit.textContent = displayUnit;
    els.resUploadMb.textContent = sub(rawUlMbps);
  }
}

els.unitToggleBtn.addEventListener("click", () => {
  displayUnit = displayUnit === "Mbps" ? "MB/s" : "Mbps";
  renderSpeedValues();
  renderHistory();
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
  updateThemeButtonLabel();
  visuals.setAutoLabel(t("autoScale"));

  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const key = node.getAttribute("data-i18n");
    if (I18N[currentLang][key]) node.textContent = I18N[currentLang][key];
  });

  if (isRunning) els.btnText.textContent = t("stopBtn");
  else if (currentPhaseKey === "completed") els.btnText.textContent = t("againBtn");
  else els.btnText.textContent = t("startBtn");

  els.copyText.textContent = t("copyBtn");
  els.historyCloseBtn.setAttribute("aria-label", currentLang === "tr" ? "Kapat" : "Close");
  els.accordionChevron.setAttribute("aria-label", t("platformTitle"));

  setPhase(currentPhaseKey);
  renderNetworkLabel();
  renderMinMaxLabel(els.resMinMaxPing.dataset.min, els.resMinMaxPing.dataset.max);
  els.resLoss.textContent = `${t("packetLossInline")}: ${els.resLoss.dataset.lossVal || "0.0%"}`;

  if (els.qualityVerdict.dataset.verdictKey) {
    els.qualityVerdict.textContent = t(els.qualityVerdict.dataset.verdictKey);
  }
  refreshPlatformBadges();
  renderHistory();
}

els.langToggle.addEventListener("click", () => {
  currentLang = currentLang === "en" ? "tr" : "en";
  store.set("speedtest_lang", currentLang);
  applyLanguage();
});

function toggleDrawer(open) {
  els.historyDrawer.classList.toggle("open", open);
  els.drawerBackdrop.classList.toggle("open", open);
  els.historyDrawer.setAttribute("aria-hidden", String(!open));
  els.historyDrawer.inert = !open;
  document.documentElement.classList.toggle("no-scroll", open);
  if (open) els.historyCloseBtn.focus();
  else els.historyOpenBtn.focus({ preventScroll: true });
}
els.historyDrawer.inert = true;
els.historyOpenBtn.addEventListener("click", () => toggleDrawer(true));
els.historyCloseBtn.addEventListener("click", () => toggleDrawer(false));
els.drawerBackdrop.addEventListener("click", () => toggleDrawer(false));
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && els.historyDrawer.classList.contains("open")) toggleDrawer(false);
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
  const variance = samples.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / samples.length;
  const cv = Math.sqrt(variance) / mean;
  return Math.max(12, Math.min(99, Math.round((1 - cv) * 100)));
}

function evaluateBufferbloat(idlePing, dlPing, ulPing) {
  const maxIncrease = Math.max(dlPing - idlePing, ulPing - idlePing, 0);
  if (maxIncrease < 15) return { grade: "A+", cls: "grade-A", penalty: 0 };
  if (maxIncrease < 35) return { grade: "A", cls: "grade-A", penalty: 4 };
  if (maxIncrease < 75) return { grade: "B", cls: "grade-B", penalty: 10 };
  if (maxIncrease < 140) return { grade: "C", cls: "grade-B", penalty: 18 };
  return { grade: "F", cls: "grade-F", penalty: 30 };
}

function computeQualityScore(dl, localPing, jitter, bloatPenalty) {
  let score = 100 - bloatPenalty;
  if (localPing > 65) score -= 14;
  else if (localPing > 35) score -= 6;
  if (jitter > 12) score -= 10;
  else if (jitter > 4) score -= 4;
  if (dl < 25) score -= 10;
  score = Math.max(30, Math.min(100, Math.round(score)));

  let verdictKey = "qualityGradeUltra";
  if (score < 72) verdictKey = "qualityGradeFair";
  else if (score < 88) verdictKey = "qualityGradeGood";
  return { score, verdictKey };
}

function updateScenarioChips(dl, ul, localPing, jitter) {
  [els.scStream, els.scGame, els.scCall].forEach((c) => c.classList.remove("sc-ok", "sc-warn"));
  els.scStream.classList.add(dl >= 25 ? "sc-ok" : "sc-warn");
  els.scGame.classList.add(localPing <= 55 && jitter <= 10 ? "sc-ok" : "sc-warn");
  els.scCall.classList.add(dl >= 10 && ul >= 5 && jitter <= 18 ? "sc-ok" : "sc-warn");
}

function saveToLocalHistory(entry) {
  const existing = readHistory();
  existing.unshift(entry);
  store.set("speedtest_engine_history", JSON.stringify(existing.slice(0, 15)));
  renderHistory();
}

function renderHistory() {
  const records = readHistory();
  els.historyCount.textContent = String(records.length);
  document.querySelectorAll(".th-unit").forEach((n) => (n.textContent = ` (${displayUnit})`));

  if (!records.length) {
    els.historyBody.innerHTML = `<tr><td colspan="5" class="empty-row">${esc(t("emptyHistory"))}</td></tr>`;
    return;
  }

  els.historyBody.innerHTML = records
    .map((r) => {
      const dl = parseFloat(r.download) || 0;
      const ul = parseFloat(r.upload) || 0;
      const fmt = (v) => (displayUnit === "MB/s" ? (v / 8).toFixed(2) : v.toFixed(1));
      return `
      <tr>
        <td class="num">${esc(r.date)}</td>
        <td class="num"><strong>${fmt(dl)}</strong></td>
        <td class="num"><strong>${fmt(ul)}</strong></td>
        <td class="num">${esc(r.ping)} ms</td>
        <td><span class="grade-badge num ${esc(r.bloatCls)}">${esc(r.bloatGrade)}</span></td>
      </tr>`;
    })
    .join("");
}

function killWorkers() {
  if (worker) {
    try { worker.postMessage({ command: "STOP" }); } catch (_) {}
    worker.terminate();
    worker = null;
  }
  stopPlatformWorker();
  setPlatformLoading(false);
}

function setIdleButton(label) {
  isRunning = false;
  els.startBtn.classList.remove("btn-running");
  els.btnIcon.textContent = "▶";
  els.btnText.textContent = t(label);
}

function stopByUser() {
  killWorkers();
  visuals.reset();
  rawLiveMbps = 0;
  renderSpeedValues();
  setPhase("ready");
  setIdleButton("startBtn");
}

function startTest() {
  if (isRunning) {
    stopByUser();
    return;
  }

  killWorkers();

  isRunning = true;
  rawLiveMbps = 0;
  visuals.reset();
  renderSpeedValues();

  els.copyReportBtn.classList.add("hidden");
  els.startBtn.classList.add("btn-running");
  els.btnIcon.textContent = "■";
  els.btnText.textContent = t("stopBtn");
  els.pingAppsBtn.disabled = true;

  els.bloatGrade.className = "grade-badge num";
  els.bloatGrade.textContent = "-";
  els.qualityScore.textContent = "--";
  els.qualityFill.style.width = "0%";
  [els.scStream, els.scGame, els.scCall].forEach((c) => c.classList.remove("sc-ok", "sc-warn"));

  worker = new Worker("/js/worker.js?v=5");
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
      setPlatformLoading(true);
    } else if (msg.type === "PLATFORM_TICK") {
      updatePlatformBadge(msg.id, msg.ms);
    } else if (msg.type === "PLATFORMS_DONE") {
      setPlatformLoading(false);
      if (worker) {
        worker.terminate();
        worker = null;
      }
    } else if (msg.type === "ERROR") {
      killWorkers();
      visuals.reset();
      rawLiveMbps = 0;
      renderSpeedValues();
      setPhase(msg.code === "RATE_LIMIT" ? "rateLimit" : "error");
      setIdleButton("startBtn");
    }
  };
  worker.onerror = () => {
    killWorkers();
    setPhase("error");
    setIdleButton("startBtn");
  };

  worker.postMessage({ command: "START", baseUrl: window.location.origin });
}

function finalizeResults(res) {
  const dl = res.download.mbps;
  const ul = res.upload.mbps;
  const localPing = res.ping.avg;
  const euPing = res.ping.euAvg || localPing;
  const jitter = res.ping.jitter;
  const loss = res.ping.packetLoss;
  const ttfb = res.download.ttfb || euPing;

  rawLiveMbps = dl;
  rawDlMbps = dl;
  rawUlMbps = ul;
  renderSpeedValues();

  visuals.setTarget(dl, "DOWNLOAD");
  visuals.setFinalSamples(res.download.samples);
  setPhase("completed");

  els.resPing.textContent = localPing.toFixed(1);
  els.resJitter.textContent = jitter.toFixed(1);

  const lossFormatted = `${loss.toFixed(1)}%`;
  els.resLoss.dataset.lossVal = lossFormatted;
  els.resLoss.textContent = `${t("packetLossInline")}: ${lossFormatted}`;

  els.diagEuPing.textContent = `${euPing.toFixed(1)} ms`;
  els.diagTtfb.textContent = `${ttfb.toFixed(1)} ms`;

  const dlLoaded = res.download.loadedPing || euPing;
  const ulLoaded = res.upload.loadedPing || euPing;
  els.bloatIdle.textContent = `${euPing.toFixed(1)} ms`;
  els.bloatDl.textContent = `${dlLoaded.toFixed(1)} ms (+${Math.max(0, dlLoaded - euPing).toFixed(0)})`;
  els.bloatUl.textContent = `${ulLoaded.toFixed(1)} ms (+${Math.max(0, ulLoaded - euPing).toFixed(0)})`;

  const bloat = evaluateBufferbloat(euPing, dlLoaded, ulLoaded);
  els.bloatGrade.textContent = bloat.grade;
  els.bloatGrade.className = `grade-badge num ${bloat.cls}`;

  const quality = computeQualityScore(dl, localPing, jitter, bloat.penalty);
  els.qualityScore.textContent = String(quality.score);
  els.qualityFill.style.width = `${quality.score}%`;
  els.qualityVerdict.dataset.verdictKey = quality.verdictKey;
  els.qualityVerdict.textContent = t(quality.verdictKey);

  updateScenarioChips(dl, ul, localPing, jitter);
  els.stabilityScore.textContent = `${calculateStability(res.download.samples)}%`;

  lastReportData = {
    dl: dl.toFixed(1),
    ul: ul.toFixed(1),
    ping: localPing.toFixed(1),
    jitter: jitter.toFixed(1),
    grade: bloat.grade,
    score: quality.score
  };
  els.copyReportBtn.classList.remove("hidden");

  saveToLocalHistory({
    date: new Date().toLocaleString("en-GB", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
    download: dl.toFixed(1),
    upload: ul.toFixed(1),
    ping: localPing.toFixed(0),
    jitter: jitter.toFixed(1),
    bloatGrade: bloat.grade,
    bloatCls: bloat.cls
  });

  setIdleButton("againBtn");
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (_) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.cssText = "position:fixed;top:-9999px;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand("copy"); } catch (_) {}
    ta.remove();
    return ok;
  }
}

els.copyReportBtn.addEventListener("click", async () => {
  if (!lastReportData) return;
  const r = lastReportData;
  const summary =
    currentLang === "tr"
      ? `Speedtest Engine | İndirme: ${r.dl} Mbps | Yükleme: ${r.ul} Mbps | Yerel Ping: ${r.ping} ms | Jitter: ${r.jitter} ms | Bufferbloat: ${r.grade} | Puan: ${r.score}/100`
      : `Speedtest Engine | Download: ${r.dl} Mbps | Upload: ${r.ul} Mbps | Local Ping: ${r.ping} ms | Jitter: ${r.jitter} ms | Bufferbloat: ${r.grade} | Score: ${r.score}/100`;
  if (await copyText(summary)) {
    els.copyText.textContent = t("copiedBtn");
    setTimeout(() => (els.copyText.textContent = t("copyBtn")), 1800);
  }
});

els.startBtn.addEventListener("click", startTest);
els.clearHistoryBtn.addEventListener("click", () => {
  store.remove("speedtest_engine_history");
  renderHistory();
});

buildPlatformGrid();
initTheme();
applyLanguage();
fetchNetworkInfo();

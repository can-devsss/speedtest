"use strict";

const CONFIG = {
  pingCount: 16,
  downloadStreams: 4,
  uploadStreams: 4,
  phaseDurationMs: 6000,
  warmupMs: 1000,
  chunkSizeMb: 15,
  uploadChunkBytes: 4 * 1024 * 1024,
  edgeTimeoutMs: 4500,
  serverTimeoutMs: 6000,
  platformSamples: 4,
  platformConcurrency: 2
};

// Kullanıcıya en yakın Cloudflare Anycast noktası (yerel ping referansı)
const LOCAL_EDGE_URL = "https://www.cloudflare.com/cdn-cgi/trace";

// Yalnızca gerçek kenar (Edge CDN) düğümleri üzerinden yanıt veren 8 platform
const PLATFORM_TARGETS = [
  { id: "youtube",   url: "https://www.youtube.com/generate_204" },
  { id: "instagram", url: "https://static.cdninstagram.com/rsrc.php/v3/yI/r/VsNE-OHk_8a.png" },
  { id: "tiktok",    url: "https://www.tiktok.com/favicon.ico" },
  { id: "x",         url: "https://abs.twimg.com/favicons/twitter.3.ico" },
  { id: "whatsapp",  url: "https://static.whatsapp.net/rsrc.php/v3/yz/r/ujTY9i_Jhs1.png" },
  { id: "telegram",  url: "https://telegram.org/favicon.ico" },
  { id: "twitch",    url: "https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png" },
  { id: "spotify",   url: "https://open.spotifycdn.com/cdn/images/favicon32.b64ecc03.png" }
];

let abortController = null;

const isAbort = (err) => err && err.name === "AbortError";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

self.onmessage = async (e) => {
  const cmd = e.data.command;
  if (cmd === "START") {
    if (abortController) abortController.abort();
    abortController = new AbortController();
    try {
      await runFullSuite(e.data.baseUrl, abortController.signal);
    } catch (err) {
      if (!isAbort(err)) {
        self.postMessage({ type: "ERROR", code: err.code || "NET_ERROR", message: err.message });
      }
    }
  } else if (cmd === "PING_PLATFORMS") {
    if (abortController) abortController.abort();
    abortController = new AbortController();
    await measurePlatforms(abortController.signal);
  } else if (cmd === "STOP") {
    if (abortController) abortController.abort();
  }
};

function timedFetch(url, options, timeoutMs, outerSignal) {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, timeoutMs);
  const onAbort = () => ctrl.abort();
  if (outerSignal) {
    if (outerSignal.aborted) ctrl.abort();
    else outerSignal.addEventListener("abort", onAbort, { once: true });
  }
  return fetch(url, { ...options, signal: ctrl.signal })
    .catch((err) => {
      if (timedOut) {
        const e = new Error("timeout");
        e.name = "TimeoutError";
        throw e;
      }
      throw err;
    })
    .finally(() => {
      clearTimeout(timer);
      if (outerSignal) outerSignal.removeEventListener("abort", onAbort);
    });
}

function linkedController(signal) {
  const ctrl = new AbortController();
  if (signal.aborted) ctrl.abort();
  else signal.addEventListener("abort", () => ctrl.abort(), { once: true });
  return ctrl;
}

async function measureServerPing(baseUrl, signal) {
  const start = performance.now();
  const res = await timedFetch(
    `${baseUrl}/api/ping?r=${Math.random()}`,
    { method: "GET", cache: "no-store" },
    CONFIG.serverTimeoutMs,
    signal
  );
  if (!res.ok) throw new Error("Ping failed");
  await res.arrayBuffer();
  return performance.now() - start;
}

// Mobil tarayıcıda no-cors yönlendirme (301/302) hatalarını önleyen saf RTT ölçümü
async function measureEdgeRtt(url, signal) {
  const sep = url.includes("?") ? "&" : "?";
  const target = `${url}${sep}t=${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const start = performance.now();
  await timedFetch(
    target,
    {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer"
    },
    CONFIG.edgeTimeoutMs,
    signal
  );
  return performance.now() - start;
}

function filterOutliers(rawSamples) {
  if (rawSamples.length <= 4) return rawSamples;
  const sorted = [...rawSamples].sort((a, b) => a - b);
  const q1 = sorted[Math.floor(sorted.length * 0.25)];
  const q3 = sorted[Math.floor(sorted.length * 0.75)];
  const iqr = Math.max(q3 - q1, 5);
  const upperFence = q3 + iqr * 1.6;
  const filtered = rawSamples.filter((v) => v <= upperFence);
  return filtered.length >= 4 ? filtered : sorted.slice(0, Math.max(4, sorted.length - 2));
}

function calculateStats(rawSamples) {
  if (!rawSamples.length) return { avg: 0, min: 0, max: 0, jitter: 0 };
  const avg = mean(filterOutliers(rawSamples));
  const min = Math.min(...rawSamples);
  const max = Math.max(...rawSamples);
  let jitterSum = 0;
  for (let i = 1; i < rawSamples.length; i++) {
    jitterSum += Math.abs(rawSamples[i] - rawSamples[i - 1]);
  }
  const jitter = rawSamples.length > 1 ? jitterSum / (rawSamples.length - 1) : 0;
  return { avg, min, max, jitter };
}

function loadedAverage(samples) {
  if (!samples.length) return 0;
  return mean(filterOutliers(samples));
}

function startBloatMonitor(baseUrl, signal, targetArray, delayMs) {
  let active = true;
  (async () => {
    await sleep(delayMs);
    while (active && !signal.aborted) {
      try {
        targetArray.push(await measureServerPing(baseUrl, signal));
      } catch (_) {}
      await sleep(380);
    }
  })();
  return () => {
    active = false;
  };
}

async function runPingPhase(baseUrl, signal) {
  self.postMessage({ type: "PHASE", phase: "PING" });
  const localPings = [];
  const serverPings = [];
  let localFailed = 0;
  let serverFailed = 0;

  for (let w = 0; w < 3; w++) {
    try { await measureEdgeRtt(LOCAL_EDGE_URL, signal); } catch (e) { if (isAbort(e)) throw e; }
  }
  for (let w = 0; w < 2; w++) {
    try { await measureServerPing(baseUrl, signal); } catch (e) { if (isAbort(e)) throw e; }
  }

  for (let i = 0; i < CONFIG.pingCount; i++) {
    try {
      localPings.push(await measureEdgeRtt(LOCAL_EDGE_URL, signal));
    } catch (err) {
      if (isAbort(err)) throw err;
      localFailed++;
    }
    try {
      serverPings.push(await measureServerPing(baseUrl, signal));
    } catch (err) {
      if (isAbort(err)) throw err;
      serverFailed++;
    }

    const live = localPings.length ? localPings : serverPings;
    self.postMessage({
      type: "PING_TICK",
      current: live[live.length - 1] || 0,
      stats: calculateStats(live)
    });
    await sleep(25);
  }

  const useLocal = localPings.length > 0;
  const mainStats = calculateStats(useLocal ? localPings : serverPings);
  const serverStats = calculateStats(serverPings);
  const failed = useLocal ? localFailed : serverFailed;

  return {
    ...mainStats,
    euAvg: serverStats.avg || mainStats.avg,
    packetLoss: (failed / CONFIG.pingCount) * 100
  };
}

async function runDownloadPhase(baseUrl, signal) {
  self.postMessage({ type: "PHASE", phase: "DOWNLOAD" });

  const phase = linkedController(signal);
  const startTime = performance.now();
  let totalBytes = 0;
  let validBytes = 0;
  let measureStart = null;
  let lastByteTime = startTime;
  let ttfbMin = null;
  let rateLimited = false;
  const loadedPings = [];
  const speedSamples = [];

  const stopBloat = startBloatMonitor(baseUrl, phase.signal, loadedPings, CONFIG.warmupMs);

  let lastTickBytes = 0;
  let lastTickTime = startTime;
  const reportInterval = setInterval(() => {
    const now = performance.now();
    const dt = (now - lastTickTime) / 1000;
    if (dt <= 0) return;
    const instantMbps = ((totalBytes - lastTickBytes) * 8) / (dt * 1_000_000);
    if (now - startTime > CONFIG.warmupMs && instantMbps > 0) speedSamples.push(instantMbps);
    self.postMessage({ type: "SPEED_TICK", mode: "DOWNLOAD", mbps: instantMbps });
    lastTickBytes = totalBytes;
    lastTickTime = now;
  }, 180);

  const workerStream = async () => {
    try {
      while (
        performance.now() - startTime < CONFIG.phaseDurationMs &&
        !phase.signal.aborted &&
        !rateLimited
      ) {
        const reqStart = performance.now();
        const response = await fetch(
          `${baseUrl}/api/download?size=${CONFIG.chunkSizeMb}&r=${Math.random()}`,
          { cache: "no-store", signal: phase.signal }
        );
        if (response.status === 429) {
          rateLimited = true;
          if (totalBytes === 0) {
            const err = new Error("Rate limit exceeded");
            err.code = "RATE_LIMIT";
            throw err;
          }
          break;
        }
        if (!response.ok) throw new Error("Download stream error");

        const ttfb = performance.now() - reqStart;
        if (ttfbMin === null || ttfb < ttfbMin) ttfbMin = ttfb;

        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const now = performance.now();
          totalBytes += value.byteLength;
          lastByteTime = now;

          if (now - startTime >= CONFIG.warmupMs) {
            if (measureStart === null) measureStart = now;
            else validBytes += value.byteLength;
          }
          if (now - startTime >= CONFIG.phaseDurationMs) {
            await reader.cancel().catch(() => {});
            break;
          }
        }
      }
    } catch (err) {
      if (isAbort(err)) {
        if (signal.aborted) throw err;
        return;
      }
      if (err.code === "RATE_LIMIT" || validBytes === 0) throw err;
    }
  };

  try {
    await Promise.all(Array.from({ length: CONFIG.downloadStreams }, workerStream));
  } finally {
    stopBloat();
    clearInterval(reportInterval);
    phase.abort();
  }

  let finalMbps;
  if (measureStart !== null && lastByteTime > measureStart) {
    const sec = Math.max((lastByteTime - measureStart) / 1000, 0.3);
    finalMbps = (validBytes * 8) / (sec * 1_000_000);
  } else {
    const sec = Math.max((lastByteTime - startTime) / 1000, 0.5);
    finalMbps = (totalBytes * 8) / (sec * 1_000_000);
  }

  return {
    mbps: finalMbps,
    loadedPing: loadedAverage(loadedPings),
    ttfb: ttfbMin || 0,
    samples: speedSamples
  };
}

function createRandomPayload(sizeBytes) {
  const buffer = new Uint8Array(sizeBytes);
  const step = 65536;
  for (let offset = 0; offset < sizeBytes; offset += step) {
    const len = Math.min(step, sizeBytes - offset);
    crypto.getRandomValues(buffer.subarray(offset, offset + len));
  }
  return buffer;
}

function postChunk(url, payload, onDelta, signal) {
  return new Promise((resolve, reject) => {
    const abortErr = () => Object.assign(new Error("Aborted"), { name: "AbortError" });
    if (signal.aborted) return reject(abortErr());

    const xhr = new XMLHttpRequest();
    let last = 0;
    const onAbort = () => xhr.abort();
    const cleanup = () => signal.removeEventListener("abort", onAbort);

    xhr.open("POST", url, true);
    xhr.setRequestHeader("Content-Type", "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      const delta = e.loaded - last;
      last = e.loaded;
      if (delta > 0) onDelta(delta);
    };
    xhr.onload = () => { cleanup(); resolve(xhr.status); };
    xhr.onerror = () => { cleanup(); reject(new Error("Upload stream error")); };
    xhr.ontimeout = () => { cleanup(); reject(new Error("Upload timeout")); };
    xhr.onabort = () => { cleanup(); reject(abortErr()); };
    xhr.timeout = 30000;

    signal.addEventListener("abort", onAbort, { once: true });
    xhr.send(payload);
  });
}

async function runUploadPhase(baseUrl, signal) {
  self.postMessage({ type: "PHASE", phase: "UPLOAD" });

  const phase = linkedController(signal);
  const payload = createRandomPayload(CONFIG.uploadChunkBytes);
  const startTime = performance.now();
  let totalBytes = 0;
  let validBytes = 0;
  let measureStart = null;
  let lastByteTime = startTime;
  let rateLimited = false;
  let phaseEnded = false;
  const loadedPings = [];
  const speedSamples = [];

  const stopBloat = startBloatMonitor(baseUrl, phase.signal, loadedPings, CONFIG.warmupMs);

  const onDelta = (bytes) => {
    const now = performance.now();
    totalBytes += bytes;
    lastByteTime = now;
    if (now - startTime >= CONFIG.warmupMs) {
      if (measureStart === null) measureStart = now;
      else validBytes += bytes;
    }
  };

  let lastTickBytes = 0;
  let lastTickTime = startTime;
  const reportInterval = setInterval(() => {
    const now = performance.now();
    const dt = (now - lastTickTime) / 1000;
    if (dt <= 0) return;
    const instantMbps = ((totalBytes - lastTickBytes) * 8) / (dt * 1_000_000);
    if (now - startTime > CONFIG.warmupMs && instantMbps > 0) speedSamples.push(instantMbps);
    self.postMessage({ type: "SPEED_TICK", mode: "UPLOAD", mbps: instantMbps });
    lastTickBytes = totalBytes;
    lastTickTime = now;
  }, 220);

  const endTimer = setTimeout(() => {
    phaseEnded = true;
    phase.abort();
  }, CONFIG.phaseDurationMs);

  const uploadStream = async () => {
    try {
      while (!phaseEnded && !phase.signal.aborted && !rateLimited) {
        const status = await postChunk(
          `${baseUrl}/api/upload?r=${Math.random()}`,
          payload,
          onDelta,
          phase.signal
        );
        if (status === 429) {
          rateLimited = true;
          if (totalBytes === 0) {
            const err = new Error("Rate limit exceeded");
            err.code = "RATE_LIMIT";
            throw err;
          }
          break;
        }
        if (status < 200 || status >= 300) throw new Error("Upload stream error");
      }
    } catch (err) {
      if (isAbort(err)) {
        if (signal.aborted) throw err;
        return;
      }
      if (err.code === "RATE_LIMIT" || validBytes === 0) throw err;
    }
  };

  try {
    await Promise.all(Array.from({ length: CONFIG.uploadStreams }, uploadStream));
  } finally {
    clearTimeout(endTimer);
    stopBloat();
    clearInterval(reportInterval);
    phase.abort();
  }

  let finalMbps;
  if (measureStart !== null && lastByteTime > measureStart) {
    const sec = Math.max((lastByteTime - measureStart) / 1000, 0.3);
    finalMbps = (validBytes * 8) / (sec * 1_000_000);
  } else {
    const sec = Math.max((lastByteTime - startTime) / 1000, 0.5);
    finalMbps = (totalBytes * 8) / (sec * 1_000_000);
  }

  return { mbps: finalMbps, loadedPing: loadedAverage(loadedPings), samples: speedSamples };
}

async function measurePlatform(item, signal) {
  const samples = [];
  let blocked = 0;
  let timeouts = 0;

  for (let k = 0; k <= CONFIG.platformSamples; k++) {
    if (signal.aborted) return null;
    try {
      const rtt = await measureEdgeRtt(item.url, signal);
      if (k > 0) samples.push(rtt);
    } catch (err) {
      if (isAbort(err)) return null;
      if (err.name === "TimeoutError") timeouts++;
      else blocked++;
      if (blocked + timeouts >= 3 && samples.length === 0) break;
    }
    await sleep(45);
  }

  if (!samples.length) return timeouts > blocked ? -2 : -1;
  samples.sort((a, b) => a - b);
  const mid = Math.floor(samples.length / 2);
  const median = samples.length % 2 ? samples[mid] : (samples[mid - 1] + samples[mid]) / 2;
  return Math.max(1, Math.round(median));
}

async function measurePlatforms(signal) {
  const queue = [...PLATFORM_TARGETS];
  const runners = Array.from({ length: CONFIG.platformConcurrency }, async () => {
    while (queue.length && !signal.aborted) {
      const item = queue.shift();
      const ms = await measurePlatform(item, signal);
      if (ms === null) return;
      self.postMessage({ type: "PLATFORM_TICK", id: item.id, ms });
    }
  });
  await Promise.all(runners);
  if (!signal.aborted) self.postMessage({ type: "PLATFORMS_DONE" });
}

async function runFullSuite(baseUrl, signal) {
  const pingResult = await runPingPhase(baseUrl, signal);
  const downloadResult = await runDownloadPhase(baseUrl, signal);
  const uploadResult = await runUploadPhase(baseUrl, signal);

  self.postMessage({
    type: "COMPLETE",
    results: { ping: pingResult, download: downloadResult, upload: uploadResult }
  });

  await measurePlatforms(signal);
}

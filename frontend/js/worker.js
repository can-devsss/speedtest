const CONFIG = {
  pingCount: 16,
  downloadStreams: 4,
  uploadStreams: 4,
  phaseDurationMs: 6000,
  warmupMs: 1000,
  chunkSizeMb: 15
};

// Tek ve tutarlı yerel Anycast Edge noktası (Jitter sapmasını sıfırlar)
const LOCAL_EDGE_URL = "https://www.cloudflare.com/cdn-cgi/trace";

const PLATFORM_TARGETS = [
  { id: "youtube", url: "https://www.youtube.com/favicon.ico" },
  { id: "instagram", url: "https://www.instagram.com/favicon.ico" },
  { id: "tiktok", url: "https://www.tiktok.com/favicon.ico" },
  { id: "x", url: "https://abs.twimg.com/favicons/twitter.3.ico" },
  { id: "whatsapp", url: "https://static.whatsapp.net/rsrc.php/v3/yz/r/ujTY9i_Jhs1.png" },
  { id: "telegram", url: "https://telegram.org/favicon.ico" },
  { id: "steam", url: "https://store.steampowered.com/favicon.ico" },
  { id: "discord", url: "https://discord.com/assets/f9bb9c4af2b9c32a2c5ee0014661546d.png" },
  { id: "twitch", url: "https://static.twitchcdn.net/assets/favicon-32-e29e246c157142c94346.png" },
  { id: "spotify", url: "https://open.spotifycdn.com/cdn/images/favicon32.b64ecc03.png" }
];

let abortController = null;

self.onmessage = async (e) => {
  if (e.data.command === "START") {
    abortController = new AbortController();
    try {
      await runFullSuite(e.data.baseUrl, abortController.signal);
    } catch (err) {
      if (err.name !== "AbortError") {
        self.postMessage({
          type: "ERROR",
          code: err.code || "NET_ERROR",
          message: err.message
        });
      }
    }
  } else if (e.data.command === "PING_PLATFORMS") {
    const controller = new AbortController();
    await measurePlatforms(controller.signal);
  } else if (e.data.command === "STOP") {
    if (abortController) abortController.abort();
  }
};

async function measureServerPing(baseUrl, signal) {
  const start = performance.now();
  const res = await fetch(`${baseUrl}/api/ping?r=${Math.random()}`, {
    method: "GET",
    cache: "no-store",
    signal
  });
  if (!res.ok) throw new Error("Ping failed");
  await res.arrayBuffer();
  return performance.now() - start;
}

async function measureEdgeRtt(url, signal) {
  const start = performance.now();
  await fetch(`${url}?t=${performance.now()}`, {
    method: "HEAD",
    mode: "no-cors",
    cache: "no-store",
    signal
  });
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
  const samples = filterOutliers(rawSamples);
  const min = Math.min(...samples);
  const max = Math.max(...samples);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;

  let jitterSum = 0;
  for (let i = 1; i < samples.length; i++) {
    jitterSum += Math.abs(samples[i] - samples[i - 1]);
  }
  const jitter = samples.length > 1 ? jitterSum / (samples.length - 1) : 0;

  return { avg, min, max, jitter };
}

function startBloatMonitor(baseUrl, signal, targetArray) {
  let active = true;
  const loop = async () => {
    while (active && !signal.aborted) {
      try {
        const rtt = await measureServerPing(baseUrl, signal);
        targetArray.push(rtt);
      } catch (_) {}
      await new Promise((r) => setTimeout(r, 420));
    }
  };
  loop();
  return () => {
    active = false;
  };
}

async function runPingPhase(baseUrl, signal) {
  self.postMessage({ type: "PHASE", phase: "PING" });
  const localPings = [];
  const euPings = [];
  let failed = 0;

  // 4 ısınma isteği: DNS, TLS ve mobil Wi-Fi radyosunu tam uyanık moda alır
  for (let w = 0; w < 4; w++) {
    try {
      await measureEdgeRtt(LOCAL_EDGE_URL, signal);
      if (w === 0) await measureServerPing(baseUrl, signal);
    } catch (_) {}
  }

  for (let i = 0; i < CONFIG.pingCount; i++) {
    try {
      const rawRtt = await measureEdgeRtt(LOCAL_EDGE_URL, signal);
      // Tarayıcı HTTP/2 + CDN katmanının sabit ~18ms ek yükünü arındırarak saf hat RTT'sini hesaplar
      const pureLineRtt = Math.max(4, rawRtt - 18);
      localPings.push(pureLineRtt);

      // Her 4 adımda bir Frankfurt sunucusuna da gerçek gecikme ölçülür
      if (i % 4 === 0) {
        const euRtt = await measureServerPing(baseUrl, signal);
        euPings.push(euRtt);
      }

      self.postMessage({
        type: "PING_TICK",
        current: pureLineRtt,
        stats: calculateStats(localPings)
      });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      failed++;
    }
    await new Promise((r) => setTimeout(r, 30));
  }

  const localStats = calculateStats(localPings);
  const euStats = calculateStats(euPings);
  const packetLoss = (failed / CONFIG.pingCount) * 100;

  return {
    ...localStats,
    euAvg: euStats.avg || localStats.avg,
    packetLoss
  };
}

async function measurePlatforms(signal) {
  for (const item of PLATFORM_TARGETS) {
    if (signal && signal.aborted) break;
    try {
      await measureEdgeRtt(item.url, signal);
      const rtt = await measureEdgeRtt(item.url, signal);
      self.postMessage({
        type: "PLATFORM_TICK",
        id: item.id,
        ms: Math.round(rtt)
      });
    } catch (_) {
      self.postMessage({
        type: "PLATFORM_TICK",
        id: item.id,
        ms: -1
      });
    }
  }
  self.postMessage({ type: "PLATFORMS_DONE" });
}

async function runDownloadPhase(baseUrl, signal) {
  self.postMessage({ type: "PHASE", phase: "DOWNLOAD" });

  let totalBytes = 0;
  let validBytes = 0;
  const startTime = performance.now();
  let measureStartTime = null;
  let firstByteMs = null;
  const loadedPings = [];
  const speedSamples = [];

  const stopBloat = startBloatMonitor(baseUrl, signal, loadedPings);

  let lastTickBytes = 0;
  let lastTickTime = startTime;
  const reportInterval = setInterval(() => {
    const now = performance.now();
    const dt = (now - lastTickTime) / 1000;
    if (dt > 0) {
      const instantMbps = ((totalBytes - lastTickBytes) * 8) / (dt * 1_000_000);
      if (now - startTime > CONFIG.warmupMs && instantMbps > 0) {
        speedSamples.push(instantMbps);
      }
      self.postMessage({
        type: "SPEED_TICK",
        mode: "DOWNLOAD",
        mbps: instantMbps
      });
      lastTickBytes = totalBytes;
      lastTickTime = now;
    }
  }, 180);

  const workerStream = async () => {
    while (performance.now() - startTime < CONFIG.phaseDurationMs) {
      if (signal.aborted) break;
      const reqStart = performance.now();
      const response = await fetch(
        `${baseUrl}/api/download?size=${CONFIG.chunkSizeMb}&r=${Math.random()}`,
        { cache: "no-store", signal }
      );
      if (response.status === 429) {
        const err = new Error("Rate limit exceeded");
        err.code = "RATE_LIMIT";
        throw err;
      }
      if (!response.ok) throw new Error("Download stream error");

      if (firstByteMs === null) {
        firstByteMs = performance.now() - reqStart;
      }
      const reader = response.body.getReader();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const now = performance.now();
        totalBytes += value.byteLength;

        if (now - startTime >= CONFIG.warmupMs) {
          if (!measureStartTime) measureStartTime = now;
          validBytes += value.byteLength;
        }
        if (now - startTime >= CONFIG.phaseDurationMs) {
          reader.cancel();
          break;
        }
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: CONFIG.downloadStreams }, () => workerStream())
    );
  } finally {
    stopBloat();
    clearInterval(reportInterval);
  }

  const effectiveSec = Math.max(
    (performance.now() - (measureStartTime || startTime)) / 1000,
    0.5
  );
  const finalMbps = (validBytes * 8) / (effectiveSec * 1_000_000);
  const loadedPingAvg = loadedPings.length
    ? filterOutliers(loadedPings).reduce((a, b) => a + b, 0) / filterOutliers(loadedPings).length
    : 0;

  return {
    mbps: finalMbps,
    loadedPing: loadedPingAvg,
    ttfb: firstByteMs || 0,
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

async function runUploadPhase(baseUrl, signal) {
  self.postMessage({ type: "PHASE", phase: "UPLOAD" });

  const payload = createRandomPayload(2 * 1024 * 1024);
  let totalBytes = 0;
  let validBytes = 0;
  const startTime = performance.now();
  let measureStartTime = null;
  const loadedPings = [];
  const speedSamples = [];

  const stopBloat = startBloatMonitor(baseUrl, signal, loadedPings);

  let lastTickBytes = 0;
  let lastTickTime = startTime;
  const reportInterval = setInterval(() => {
    const now = performance.now();
    const dt = (now - lastTickTime) / 1000;
    if (dt > 0) {
      const instantMbps = ((totalBytes - lastTickBytes) * 8) / (dt * 1_000_000);
      if (now - startTime > CONFIG.warmupMs && instantMbps > 0) {
        speedSamples.push(instantMbps);
      }
      self.postMessage({
        type: "SPEED_TICK",
        mode: "UPLOAD",
        mbps: instantMbps
      });
      lastTickBytes = totalBytes;
      lastTickTime = now;
    }
  }, 220);

  const uploadStream = async () => {
    while (performance.now() - startTime < CONFIG.phaseDurationMs) {
      if (signal.aborted) break;
      const res = await fetch(`${baseUrl}/api/upload?r=${Math.random()}`, {
        method: "POST",
        body: payload,
        headers: { "Content-Type": "application/octet-stream" },
        cache: "no-store",
        signal
      });
      if (!res.ok) throw new Error("Upload stream error");
      await res.json();
      const now = performance.now();
      totalBytes += payload.byteLength;

      if (now - startTime >= CONFIG.warmupMs) {
        if (!measureStartTime) measureStartTime = now;
        validBytes += payload.byteLength;
      }
    }
  };

  try {
    await Promise.all(
      Array.from({ length: CONFIG.uploadStreams }, () => uploadStream())
    );
  } finally {
    stopBloat();
    clearInterval(reportInterval);
  }

  const effectiveSec = Math.max(
    (performance.now() - (measureStartTime || startTime)) / 1000,
    0.5
  );
  const finalMbps = (validBytes * 8) / (effectiveSec * 1_000_000);
  const loadedPingAvg = loadedPings.length
    ? filterOutliers(loadedPings).reduce((a, b) => a + b, 0) / filterOutliers(loadedPings).length
    : 0;

  return { mbps: finalMbps, loadedPing: loadedPingAvg, samples: speedSamples };
}

async function runFullSuite(baseUrl, signal) {
  const pingResult = await runPingPhase(baseUrl, signal);
  const downloadResult = await runDownloadPhase(baseUrl, signal);
  const uploadResult = await runUploadPhase(baseUrl, signal);

  self.postMessage({
    type: "COMPLETE",
    results: {
      ping: pingResult,
      download: downloadResult,
      upload: uploadResult
    }
  });

  await measurePlatforms(signal);
}

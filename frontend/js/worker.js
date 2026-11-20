const CONFIG = {
  pingCount: 16,
  downloadStreams: 4,
  uploadStreams: 4,
  phaseDurationMs: 6000, // Kota dostu 6 saniye faz suresi
  warmupMs: 1000,
  chunkSizeMb: 15
};

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
  } else if (e.data.command === "STOP") {
    if (abortController) abortController.abort();
  }
};

async function measureSinglePing(baseUrl, signal) {
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

function calculateStats(samples) {
  if (!samples.length) return { avg: 0, min: 0, max: 0, jitter: 0 };
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

async function runPingPhase(baseUrl, signal) {
  self.postMessage({ type: "PHASE", phase: "PING" });
  const pings = [];
  let failed = 0;

  for (let i = 0; i < CONFIG.pingCount; i++) {
    try {
      const rtt = await measureSinglePing(baseUrl, signal);
      pings.push(rtt);
      self.postMessage({
        type: "PING_TICK",
        current: rtt,
        stats: calculateStats(pings)
      });
    } catch (err) {
      if (err.name === "AbortError") throw err;
      failed++;
    }
    await new Promise((r) => setTimeout(r, 50));
  }

  const stats = calculateStats(pings);
  const packetLoss = (failed / CONFIG.pingCount) * 100;
  return { ...stats, packetLoss };
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

  const bloatInterval = setInterval(async () => {
    try {
      const rtt = await measureSinglePing(baseUrl, signal);
      loadedPings.push(rtt);
    } catch (_) {}
  }, 400);

  let lastTickBytes = 0;
  let lastTickTime = startTime;
  const reportInterval = setInterval(() => {
    const now = performance.now();
    const dt = (now - lastTickTime) / 1000;
    if (dt > 0) {
      const instantMbps = ((totalBytes - lastTickBytes) * 8) / (dt * 1_000_000);
      if (now - startTime > CONFIG.warmupMs) {
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
  }, 200);

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
    clearInterval(bloatInterval);
    clearInterval(reportInterval);
  }

  const effectiveSec = Math.max(
    (performance.now() - (measureStartTime || startTime)) / 1000,
    0.5
  );
  const finalMbps = (validBytes * 8) / (effectiveSec * 1_000_000);
  const loadedPingAvg = loadedPings.length
    ? loadedPings.reduce((a, b) => a + b, 0) / loadedPings.length
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

  const bloatInterval = setInterval(async () => {
    try {
      const rtt = await measureSinglePing(baseUrl, signal);
      loadedPings.push(rtt);
    } catch (_) {}
  }, 400);

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
  }, 250);

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
    clearInterval(bloatInterval);
    clearInterval(reportInterval);
  }

  const effectiveSec = Math.max(
    (performance.now() - (measureStartTime || startTime)) / 1000,
    0.5
  );
  const finalMbps = (validBytes * 8) / (effectiveSec * 1_000_000);
  const loadedPingAvg = loadedPings.length
    ? loadedPings.reduce((a, b) => a + b, 0) / loadedPings.length
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
}
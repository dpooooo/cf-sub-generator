import net from "node:net";
import { fetchPreferredItems, selectPreferredEndpointsFromItems } from "./core.js";

function positiveInt(value, fallback, min = 1, max = 10000) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(Math.floor(number), max));
}

export function probeConfigFromEnv(env = process.env) {
  return {
    enabled: /^(1|true|yes|on)$/i.test(env.IP_PROBE_ENABLED || ""),
    port: positiveInt(env.IP_PROBE_PORT, 443, 1, 65535),
    count: positiveInt(env.IP_PROBE_COUNT, 3, 1, 10),
    timeout: positiveInt(env.IP_PROBE_TIMEOUT, 1200, 200, 10000),
    candidateLimit: positiveInt(env.IP_PROBE_CANDIDATE_LIMIT, 120, 1, 500),
    concurrency: positiveInt(env.IP_PROBE_CONCURRENCY, 20, 1, 100)
  };
}

function tcpConnectOnce(host, port, timeout) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const socket = new net.Socket();
    let settled = false;

    function finish(result) {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    }

    socket.setTimeout(timeout);
    socket.once("connect", () => {
      finish({ ok: true, latency: Date.now() - startedAt });
    });
    socket.once("timeout", () => {
      finish({ ok: false, latency: timeout, error: "timeout" });
    });
    socket.once("error", (error) => {
      finish({ ok: false, latency: timeout, error: error.code || error.message });
    });
    socket.connect(port, host);
  });
}

async function probeEndpoint(endpoint, config) {
  const attempts = [];
  for (let index = 0; index < config.count; index += 1) {
    attempts.push(await tcpConnectOnce(endpoint.host, endpoint.port || config.port, config.timeout));
  }

  const successes = attempts.filter((attempt) => attempt.ok);
  const avgLatency = successes.length
    ? Math.round(successes.reduce((sum, attempt) => sum + attempt.latency, 0) / successes.length)
    : config.timeout;
  const loss = Number((((attempts.length - successes.length) / attempts.length) * 100).toFixed(2));

  return {
    ip: endpoint.host,
    port: endpoint.port || config.port,
    line: endpoint.label || "综合",
    latency: avgLatency,
    loss,
    score: loss * 1000 + avgLatency,
    probe: {
      attempts: attempts.length,
      successes: successes.length,
      failures: attempts.length - successes.length,
      avgLatency,
      loss,
      testedAt: new Date().toISOString()
    }
  };
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await mapper(items[currentIndex], currentIndex);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

export async function runIpProbe(profile, options = {}) {
  const config = options.config || probeConfigFromEnv();
  const source = profile.preferredIpSource || "vps789-list";
  const sourceItems = await fetchPreferredItems(profile, { ipSourceBase: options.ipSourceBase });
  const candidates = selectPreferredEndpointsFromItems(sourceItems, config.candidateLimit, source);
  const startedAt = new Date().toISOString();
  const items = await mapLimit(candidates, config.concurrency, (endpoint) => probeEndpoint(endpoint, config));
  const usableItems = items.filter((item) => item.probe.successes > 0);

  return {
    version: 1,
    source,
    startedAt,
    generatedAt: new Date().toISOString(),
    config,
    sourceCount: sourceItems.length,
    candidateCount: candidates.length,
    testedCount: items.length,
    usableCount: usableItems.length,
    items
  };
}

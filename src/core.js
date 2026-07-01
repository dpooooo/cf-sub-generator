export const defaultProfile = {
  id: "default",
  name: "默认订阅",
  nodeLinks: "",
  preferredMode: "auto",
  preferredIps: "",
  preferredIpSource: "vps789-list",
  preferredIpLimit: 20,
  namePrefix: "CF",
  keepOriginalHost: true
};

function b64EncodeUtf8(value) {
  return Buffer.from(String(value), "utf8").toString("base64");
}

function b64DecodeUtf8(value) {
  return Buffer.from(String(value), "base64").toString("utf8");
}

function parseVmess(link) {
  const raw = link.slice("vmess://".length).trim();
  const obj = JSON.parse(b64DecodeUtf8(raw));
  return {
    type: "vmess",
    name: obj.ps || "vmess",
    server: obj.add,
    originalServer: obj.add,
    port: Number(obj.port || 443),
    uuid: obj.id,
    cipher: obj.scy || "auto",
    network: obj.net || "ws",
    tls: obj.tls === "tls",
    host: obj.host || "",
    path: obj.path || "/",
    sni: obj.sni || obj.host || obj.add || "",
    alpn: obj.alpn || "",
    fp: obj.fp || ""
  };
}

function parseUrlNode(link, type) {
  const url = new URL(link);
  const params = url.searchParams;
  return {
    type,
    name: decodeURIComponent(url.hash.replace(/^#/, "")) || type,
    server: url.hostname,
    originalServer: url.hostname,
    port: Number(url.port || 443),
    password: type === "trojan" ? decodeURIComponent(url.username) : undefined,
    uuid: type === "vless" ? decodeURIComponent(url.username) : undefined,
    network: params.get("type") || "tcp",
    tls: (params.get("security") || "").toLowerCase() === "tls",
    host: params.get("host") || "",
    path: params.get("path") || "/",
    sni: params.get("sni") || params.get("host") || url.hostname,
    fp: params.get("fp") || "",
    alpn: params.get("alpn") || "",
    flow: params.get("flow") || ""
  };
}

export function parseRawLinks(input) {
  const lines = String(input || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const nodes = [];

  for (const line of lines) {
    if (line.startsWith("vmess://")) nodes.push(parseVmess(line));
    else if (line.startsWith("vless://")) nodes.push(parseUrlNode(line, "vless"));
    else if (line.startsWith("trojan://")) nodes.push(parseUrlNode(line, "trojan"));
    else {
      try {
        const decoded = b64DecodeUtf8(line);
        if (/^(vmess|vless|trojan):\/\//m.test(decoded)) {
          nodes.push(...parseRawLinks(decoded));
        }
      } catch {}
    }
  }

  return nodes;
}

function splitHostAndPort(value) {
  const input = String(value || "").trim();
  if (!input) return { host: "", port: undefined };

  if (input.startsWith("[")) {
    const match = input.match(/^\[([^\]]+)](?::(\d+))?$/);
    return { host: match?.[1] || input, port: match?.[2] ? Number(match[2]) : undefined };
  }

  const colonCount = (input.match(/:/g) || []).length;
  if (colonCount > 1) return { host: input, port: undefined };

  const parts = input.split(":");
  if (parts.length === 2 && /^\d+$/.test(parts[1])) {
    return { host: parts[0], port: Number(parts[1]) };
  }
  return { host: input, port: undefined };
}

export function parsePreferredEndpoints(input) {
  return String(input || "")
    .split(/[\r\n,;]+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const hashIndex = line.indexOf("#");
      const raw = hashIndex >= 0 ? line.slice(0, hashIndex) : line;
      const label = hashIndex >= 0 ? line.slice(hashIndex + 1).trim() : "";
      const { host, port } = splitHostAndPort(raw);
      return { host, port, label };
    })
    .filter((item) => item.host);
}

export function endpointText(item) {
  const port = item.port || 443;
  const host = String(item.ip || item.host || "");
  return `${host.includes(":") ? `[${host}]` : host}:${port}`;
}

function isIpv4(host) {
  const parts = String(host || "").trim().split(".");
  return parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) >= 0 && Number(part) <= 255);
}

function finiteNumber(value, fallback = Number.POSITIVE_INFINITY) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeLineGroup(line) {
  const value = String(line || "");
  if (value.includes("电信") || /\bCT\b/i.test(value)) return "电信";
  if (value.includes("联通") || /\bCU\b/i.test(value)) return "联通";
  if (value.includes("移动") || /\bCM\b/i.test(value)) return "移动";
  if (value.includes("综合") || /all|avg|榜单/i.test(value)) return "综合";
  return "综合";
}

function candidateLabel(group, candidate) {
  return group || "";
}

function compareCandidate(a, b) {
  const lossDelta = finiteNumber(a.loss) - finiteNumber(b.loss);
  if (lossDelta !== 0) return lossDelta;

  const latencyDelta = finiteNumber(a.latency) - finiteNumber(b.latency);
  if (latencyDelta !== 0) return latencyDelta;

  return finiteNumber(a.score) - finiteNumber(b.score);
}

function addCandidate(groups, group, item, metrics) {
  const host = item.ip || item.host;
  if (!isIpv4(host)) return;

  const candidate = {
    host,
    port: item.port || 443,
    group,
    line: item.line,
    latency: finiteNumber(metrics.latency),
    loss: finiteNumber(metrics.loss),
    score: finiteNumber(item.score),
    sourceItem: item
  };

  if (!groups.has(group)) groups.set(group, []);
  groups.get(group).push(candidate);
}

function buildCandidateGroups(items) {
  const groups = new Map();

  for (const item of items) {
    const hasCarrierMetrics =
      item.dxLatency !== undefined ||
      item.ltLatency !== undefined ||
      item.ydLatency !== undefined ||
      item.dxLoss !== undefined ||
      item.ltLoss !== undefined ||
      item.ydLoss !== undefined;

    if (hasCarrierMetrics) {
      addCandidate(groups, "电信", item, { latency: item.dxLatency, loss: item.dxLoss });
      addCandidate(groups, "联通", item, { latency: item.ltLatency, loss: item.ltLoss });
      addCandidate(groups, "移动", item, { latency: item.ydLatency, loss: item.ydLoss });
      addCandidate(groups, "综合", item, { latency: item.latency, loss: item.loss });
      continue;
    }

    const group = normalizeLineGroup(item.line);
    addCandidate(groups, group, item, { latency: item.latency, loss: item.loss });
  }

  const orderedGroups = ["电信", "联通", "移动", "综合"]
    .map((name) => [name, (groups.get(name) || []).sort(compareCandidate)])
    .filter(([, candidates]) => candidates.length);

  return orderedGroups;
}

function selectBalancedCandidates(items, limit) {
  const groups = buildCandidateGroups(items);
  const selected = [];
  const selectedHosts = new Set();
  const cursors = new Map(groups.map(([name]) => [name, 0]));
  const groupOrder = new Map(groups.map(([name], index) => [name, index]));

  while (selected.length < limit) {
    let addedInRound = false;

    for (const [group, candidates] of groups) {
      if (selected.length >= limit) break;

      let cursor = cursors.get(group) || 0;
      while (cursor < candidates.length && selectedHosts.has(candidates[cursor].host)) {
        cursor += 1;
      }

      if (cursor >= candidates.length) {
        cursors.set(group, cursor);
        continue;
      }

      const candidate = candidates[cursor];
      selected.push(candidate);
      selectedHosts.add(candidate.host);
      cursors.set(group, cursor + 1);
      addedInRound = true;
    }

    if (!addedInRound) break;
  }

  return selected.sort((a, b) => {
    const groupDelta = (groupOrder.get(a.group) ?? 99) - (groupOrder.get(b.group) ?? 99);
    if (groupDelta !== 0) return groupDelta;
    return compareCandidate(a, b);
  });
}

async function fetchJson(url) {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  return response.json();
}

export async function loadPreferredEndpoints(profile, options = {}) {
  if (profile.preferredMode === "manual") {
    return parsePreferredEndpoints(profile.preferredIps);
  }

  const ipSourceBase = options.ipSourceBase || "http://127.0.0.1:5173";
  const source = profile.preferredIpSource || "vps789-list";
  const limit = Math.max(1, Math.min(Number(profile.preferredIpLimit || 20), 200));
  const payload = await fetchJson(`${ipSourceBase}/api/cloudflare?source=${encodeURIComponent(source)}`);
  const items = Array.isArray(payload.items) ? payload.items : [];

  return selectBalancedCandidates(items, limit).map((candidate, index) => {
    return {
      host: candidate.host,
      port: candidate.port,
      label: candidateLabel(candidate.group, candidate) || `${source}-${index + 1}`
    };
  });
}

export function buildNodes(baseNodes, endpoints, options) {
  const nodes = [];
  const prefix = String(options.namePrefix || "").trim();

  for (const base of baseNodes) {
    endpoints.forEach((endpoint) => {
      const suffix = endpoint.label || `${endpoint.host}:${endpoint.port || base.port}`;
      const name = [base.name, prefix, suffix].filter(Boolean).join(" | ");
      nodes.push({
        ...base,
        name,
        server: endpoint.host,
        port: endpoint.port || base.port,
        host: options.keepOriginalHost ? base.host || base.originalServer || "" : "",
        sni: options.keepOriginalHost ? base.sni || base.host || base.originalServer || "" : ""
      });
    });
  }

  return nodes;
}

export async function buildProfileNodes(profile, options = {}) {
  const baseNodes = parseRawLinks(profile.nodeLinks);
  if (!baseNodes.length) throw new Error("没有识别到可用节点");
  const endpoints = await loadPreferredEndpoints(profile, options);
  if (!endpoints.length) throw new Error("没有识别到可用优选 IP");
  return {
    baseNodes,
    endpoints,
    nodes: buildNodes(baseNodes, endpoints, profile)
  };
}

function encodeVmess(node) {
  const obj = {
    v: "2",
    ps: node.name,
    add: node.server,
    port: String(node.port),
    id: node.uuid,
    aid: "0",
    scy: node.cipher || "auto",
    net: node.network || "ws",
    type: "none",
    host: node.host || "",
    path: node.path || "/",
    tls: node.tls ? "tls" : "",
    sni: node.sni || "",
    alpn: node.alpn || "",
    fp: node.fp || ""
  };
  return `vmess://${b64EncodeUtf8(JSON.stringify(obj))}`;
}

function hostForUrl(host) {
  const value = String(host || "");
  if (value.includes(":") && !value.startsWith("[") && !value.endsWith("]")) return `[${value}]`;
  return value;
}

function encodeUrlNode(node) {
  const auth = node.type === "trojan" ? node.password : node.uuid;
  const url = new URL(`${node.type}://${encodeURIComponent(auth)}@${hostForUrl(node.server)}:${node.port}`);
  if (node.network) url.searchParams.set("type", node.network);
  if (node.type === "vless") url.searchParams.set("encryption", "none");
  if (node.tls) url.searchParams.set("security", "tls");
  if (node.host) url.searchParams.set("host", node.host);
  if (node.sni) url.searchParams.set("sni", node.sni);
  if (node.path) url.searchParams.set("path", node.path);
  if (node.fp) url.searchParams.set("fp", node.fp);
  if (node.alpn) url.searchParams.set("alpn", node.alpn);
  if (node.flow) url.searchParams.set("flow", node.flow);
  url.hash = node.name;
  return url.toString();
}

export function renderRaw(nodes) {
  const lines = nodes
    .map((node) => (node.type === "vmess" ? encodeVmess(node) : encodeUrlNode(node)))
    .join("\n");
  return b64EncodeUtf8(lines);
}

function yamlQuote(value) {
  return `"${String(value || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export function renderClash(nodes) {
  const proxies = nodes.map((node) => {
    const lines = [
      `  - name: ${yamlQuote(node.name)}`,
      `    type: ${node.type}`,
      `    server: ${yamlQuote(node.server)}`,
      `    port: ${node.port}`,
      "    udp: true"
    ];

    if (node.type === "vmess") {
      lines.push(`    uuid: ${yamlQuote(node.uuid)}`);
      lines.push("    alterId: 0");
      lines.push(`    cipher: ${node.cipher || "auto"}`);
    } else if (node.type === "vless") {
      lines.push(`    uuid: ${yamlQuote(node.uuid)}`);
    } else if (node.type === "trojan") {
      lines.push(`    password: ${yamlQuote(node.password)}`);
    }

    lines.push(`    tls: ${node.tls ? "true" : "false"}`);
    if (node.sni) lines.push(`    servername: ${yamlQuote(node.sni)}`);
    lines.push(`    network: ${node.network || "tcp"}`);
    if ((node.network || "tcp") === "ws") {
      lines.push("    ws-opts:");
      lines.push(`      path: ${yamlQuote(node.path || "/")}`);
      if (node.host) {
        lines.push("      headers:");
        lines.push(`        Host: ${yamlQuote(node.host)}`);
      }
    }
    return lines.join("\n");
  });

  const names = nodes.map((node) => `      - ${yamlQuote(node.name)}`);
  return [
    "mixed-port: 7890",
    "allow-lan: false",
    "mode: rule",
    "log-level: info",
    "proxies:",
    ...proxies,
    "proxy-groups:",
    '  - name: "自动选择"',
    "    type: url-test",
    '    url: "http://www.gstatic.com/generate_204"',
    "    interval: 300",
    "    tolerance: 50",
    "    proxies:",
    ...names,
    '  - name: "节点选择"',
    "    type: select",
    "    proxies:",
    '      - "自动选择"',
    ...names,
    "rules:",
    "  - MATCH,节点选择"
  ].join("\n");
}

export function renderSurge(nodes, requestUrl) {
  const supported = nodes.filter((node) => node.type === "vmess" || node.type === "trojan");
  const lines = [
    `#!MANAGED-CONFIG ${requestUrl} interval=86400 strict=false`,
    "",
    "[Proxy]"
  ];
  for (const node of supported) {
    if (node.type === "vmess") {
      lines.push(`${node.name} = vmess, ${node.server}, ${node.port}, username=${node.uuid}, tls=${node.tls ? "true" : "false"}, sni=${node.sni || ""}`);
    } else {
      lines.push(`${node.name} = trojan, ${node.server}, ${node.port}, password=${node.password || ""}, sni=${node.sni || ""}`);
    }
  }
  lines.push("", "[Proxy Group]", `Proxy = select, ${supported.map((node) => node.name).join(", ")}`, "", "[Rule]", "FINAL,Proxy");
  return lines.join("\n");
}

export function renderSubscription(nodes, target, requestUrl) {
  if (target === "clash") {
    return { body: renderClash(nodes), type: "text/yaml; charset=utf-8" };
  }
  if (target === "surge") {
    return { body: renderSurge(nodes, requestUrl), type: "text/plain; charset=utf-8" };
  }
  return { body: renderRaw(nodes), type: "text/plain; charset=utf-8" };
}

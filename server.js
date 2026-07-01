import http from "node:http";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildProfileNodes,
  defaultProfile,
  endpointText,
  loadPreferredEndpoints,
  renderSubscription
} from "./src/core.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

await loadEnvFile(path.join(__dirname, ".env"));

const PORT = Number(process.env.PORT || 5176);
const HOST = process.env.HOST || "127.0.0.1";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");
const PROFILE_FILE = path.join(DATA_DIR, "profiles.json");
const PUBLIC_DIR = path.join(__dirname, "public");
const IP_SOURCE_BASE = process.env.IP_SOURCE_BASE || "http://127.0.0.1:5173";
const SUB_ACCESS_TOKEN = process.env.SUB_ACCESS_TOKEN || "";
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || "";
const SITE_USERNAME = process.env.SITE_USERNAME || "admin";
const SITE_PASSWORD = process.env.SITE_PASSWORD || "";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

async function loadEnvFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const index = trimmed.indexOf("=");
      if (index < 0) continue;
      const key = trimmed.slice(0, index).trim();
      const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
      if (key && process.env[key] === undefined) process.env[key] = value;
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, {
    "Content-Type": type,
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
    "Access-Control-Allow-Headers": "content-type,x-admin-token"
  });
  res.end(body);
}

function json(res, status, data) {
  send(res, status, JSON.stringify(data, null, 2), "application/json; charset=utf-8");
}

async function readProfiles() {
  try {
    const raw = await fs.readFile(PROFILE_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const profiles = {};
    for (const [id, profile] of Object.entries(parsed || {})) {
      if (!isValidProfileId(id) || !profile || typeof profile !== "object") continue;
      profiles[id] = {
        ...defaultProfile,
        ...profile,
        id,
        name: String(profile.name || (id === "default" ? "默认订阅" : id))
      };
    }
    profiles.default = {
      ...defaultProfile,
      ...(profiles.default || {}),
      id: "default",
      name: String(profiles.default?.name || "默认订阅")
    };
    return profiles;
  } catch {
    return { default: { ...defaultProfile, name: "默认订阅" } };
  }
}

async function writeProfiles(profiles) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(PROFILE_FILE, JSON.stringify(profiles, null, 2), "utf8");
}

async function getProfile(id) {
  const profiles = await readProfiles();
  return profiles[id] || (id === "default" ? defaultProfile : null);
}

function isValidProfileId(id) {
  return /^[a-z0-9][a-z0-9_-]{0,39}$/.test(String(id || ""));
}

function profileIdFromMatch(match) {
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return "";
  }
}

function profileSummary(profile) {
  return {
    id: profile.id,
    name: profile.name || profile.id,
    nodeCount: String(profile.nodeLinks || "").split(/\r?\n/).filter((line) => line.trim()).length,
    preferredIpSource: profile.preferredIpSource,
    preferredIpLimit: profile.preferredIpLimit
  };
}

async function createProfile(body) {
  const id = String(body.id || "").trim().toLowerCase();
  if (!isValidProfileId(id)) {
    const error = new Error("Profile ID 只能使用小写字母、数字、横线和下划线，最长 40 位");
    error.statusCode = 400;
    throw error;
  }

  const profiles = await readProfiles();
  if (profiles[id]) {
    const error = new Error("Profile ID 已存在");
    error.statusCode = 409;
    throw error;
  }

  profiles[id] = {
    ...defaultProfile,
    id,
    name: String(body.name || id).trim() || id
  };
  await writeProfiles(profiles);
  return profiles[id];
}

async function saveProfile(id, body) {
  const profiles = await readProfiles();
  const current = profiles[id];
  if (!current) return null;
  profiles[id] = {
    ...defaultProfile,
    id,
    name: current.name || id,
    nodeLinks: String(body.nodeLinks || ""),
    preferredMode: body.preferredMode === "manual" ? "manual" : "auto",
    preferredIps: String(body.preferredIps || ""),
    preferredIpSource: body.preferredIpSource || "vps789-list",
    preferredIpLimit: Number(body.preferredIpLimit || 20),
    namePrefix: String(body.namePrefix || ""),
    keepOriginalHost: body.keepOriginalHost !== false
  };
  await writeProfiles(profiles);
  return profiles[id];
}

async function renameProfile(id, body) {
  const profiles = await readProfiles();
  if (!profiles[id]) return null;
  const name = String(body.name || "").trim();
  if (!name) {
    const error = new Error("配置名称不能为空");
    error.statusCode = 400;
    throw error;
  }
  profiles[id] = { ...profiles[id], name };
  await writeProfiles(profiles);
  return profiles[id];
}

async function deleteProfile(id) {
  if (id === "default") {
    const error = new Error("default 配置不能删除");
    error.statusCode = 400;
    throw error;
  }
  const profiles = await readProfiles();
  if (!profiles[id]) return false;
  delete profiles[id];
  await writeProfiles(profiles);
  return true;
}

function validateToken(url) {
  if (!SUB_ACCESS_TOKEN) return true;
  return url.searchParams.get("token") === SUB_ACCESS_TOKEN;
}

function validateAdmin(req, url) {
  if (!ADMIN_TOKEN) return true;
  const headerToken = req.headers["x-admin-token"];
  return headerToken === ADMIN_TOKEN || url.searchParams.get("admin_token") === ADMIN_TOKEN;
}

function validateSiteAccess(req) {
  if (!SITE_PASSWORD) return true;
  const authorization = req.headers.authorization || "";
  if (!authorization.startsWith("Basic ")) return false;

  try {
    const expected = Buffer.from(`${SITE_USERNAME}:${SITE_PASSWORD}`, "utf8");
    const provided = Buffer.from(authorization.slice(6), "base64");
    return provided.length === expected.length && crypto.timingSafeEqual(provided, expected);
  } catch {
    return false;
  }
}

function requireSiteAccess(req, res) {
  if (validateSiteAccess(req)) return true;
  res.writeHead(401, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-store",
    "WWW-Authenticate": 'Basic realm="CF Subscription Generator", charset="UTF-8"'
  });
  res.end("Authentication required");
  return false;
}

function requireAdmin(req, res, url) {
  if (validateAdmin(req, url)) return true;
  json(res, 401, {
    ok: false,
    error: "Admin token required",
    code: "ADMIN_TOKEN_REQUIRED"
  });
  return false;
}

async function readRequestJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

async function handleApi(req, res, url) {
  if (!requireAdmin(req, res, url)) return;

  if (url.pathname === "/api/profiles" && req.method === "GET") {
    const profiles = await readProfiles();
    const items = Object.values(profiles)
      .map(profileSummary)
      .sort((a, b) => (a.id === "default" ? -1 : b.id === "default" ? 1 : a.name.localeCompare(b.name, "zh-CN")));
    return json(res, 200, { ok: true, profiles: items });
  }

  if (url.pathname === "/api/profiles" && req.method === "POST") {
    const profile = await createProfile(await readRequestJson(req));
    return json(res, 201, { ok: true, profile });
  }

  const profileMatch = url.pathname.match(/^\/api\/profile\/([^/]+)$/);
  if (profileMatch && req.method === "GET") {
    const profile = await getProfile(profileIdFromMatch(profileMatch));
    if (!profile) return json(res, 404, { ok: false, error: "profile not found" });
    return json(res, 200, { ok: true, profile });
  }

  if (profileMatch && req.method === "POST") {
    const body = await readRequestJson(req);
    const profile = await saveProfile(profileIdFromMatch(profileMatch), body);
    if (!profile) return json(res, 404, { ok: false, error: "profile not found" });
    return json(res, 200, { ok: true, profile });
  }

  if (profileMatch && req.method === "PATCH") {
    const profile = await renameProfile(profileIdFromMatch(profileMatch), await readRequestJson(req));
    if (!profile) return json(res, 404, { ok: false, error: "profile not found" });
    return json(res, 200, { ok: true, profile });
  }

  if (profileMatch && req.method === "DELETE") {
    const deleted = await deleteProfile(profileIdFromMatch(profileMatch));
    if (!deleted) return json(res, 404, { ok: false, error: "profile not found" });
    return json(res, 200, { ok: true });
  }

  if (url.pathname === "/api/preferred-ips" && req.method === "GET") {
    const source = url.searchParams.get("source") || "vps789-list";
    const limit = Number(url.searchParams.get("limit") || 20);
    const profile = { ...defaultProfile, preferredIpSource: source, preferredIpLimit: limit };
    const endpoints = await loadPreferredEndpoints(profile, { ipSourceBase: IP_SOURCE_BASE });
    return json(res, 200, { ok: true, source, endpoints: endpoints.map(endpointText) });
  }

  const previewMatch = url.pathname.match(/^\/api\/preview\/([^/]+)$/);
  if (previewMatch && req.method === "GET") {
    const profile = await getProfile(profileIdFromMatch(previewMatch));
    if (!profile) return json(res, 404, { ok: false, error: "profile not found" });
    const built = await buildProfileNodes(profile, { ipSourceBase: IP_SOURCE_BASE });
    return json(res, 200, {
      ok: true,
      counts: {
        baseNodes: built.baseNodes.length,
        preferredEndpoints: built.endpoints.length,
        outputNodes: built.nodes.length
      },
      preview: built.nodes.slice(0, 20).map((node) => ({
        name: node.name,
        type: node.type,
        server: node.server,
        port: node.port,
        host: node.host,
        sni: node.sni
      }))
    });
  }

  return json(res, 404, { ok: false, error: "not found" });
}

async function handleSub(req, res, url) {
  if (!validateToken(url)) return send(res, 403, "Forbidden: invalid token");
  const id = url.pathname.split("/").pop() || "default";
  const profile = await getProfile(id);
  if (!profile) return send(res, 404, "profile not found");

  const { nodes } = await buildProfileNodes(profile, { ipSourceBase: IP_SOURCE_BASE });
  const target = (url.searchParams.get("target") || "auto").toLowerCase();
  const requestUrl = `${url.origin}${url.pathname}?target=${encodeURIComponent(target)}`;
  const output = renderSubscription(nodes, target, requestUrl);
  return send(res, 200, output.body, output.type);
}

async function serveStatic(res, url) {
  const requested = url.pathname === "/" ? "/index.html" : url.pathname;
  const safe = path.normalize(decodeURIComponent(requested)).replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, safe);
  if (!filePath.startsWith(PUBLIC_DIR)) return send(res, 403, "Forbidden");

  try {
    const data = await fs.readFile(filePath);
    send(res, 200, data, mimeTypes[path.extname(filePath)] || "application/octet-stream");
  } catch {
    send(res, 404, "Not found");
  }
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (req.method === "OPTIONS") return send(res, 204, "");
    if (url.pathname.startsWith("/api/")) return await handleApi(req, res, url);
    if (req.method === "GET" && url.pathname.startsWith("/sub/")) return await handleSub(req, res, url);
    if (!requireSiteAccess(req, res)) return;
    return await serveStatic(res, url);
  } catch (error) {
    json(res, error.statusCode || 500, { ok: false, error: error.message });
  }
}

http.createServer(route).listen(PORT, HOST, () => {
  console.log(`Subscription generator running at http://${HOST}:${PORT}`);
});

const els = {
  adminToken: document.querySelector("#adminToken"),
  rememberAdminToken: document.querySelector("#rememberAdminToken"),
  nodeLinks: document.querySelector("#nodeLinks"),
  preferredMode: document.querySelector("#preferredMode"),
  preferredIpSource: document.querySelector("#preferredIpSource"),
  preferredIpLimit: document.querySelector("#preferredIpLimit"),
  preferredIps: document.querySelector("#preferredIps"),
  namePrefix: document.querySelector("#namePrefix"),
  keepOriginalHost: document.querySelector("#keepOriginalHost"),
  saveButton: document.querySelector("#saveButton"),
  previewButton: document.querySelector("#previewButton"),
  generateButton: document.querySelector("#generateButton"),
  previewBody: document.querySelector("#previewBody"),
  statusText: document.querySelector("#statusText"),
  toast: document.querySelector("#toast"),
  qrDialog: document.querySelector("#qrDialog"),
  qrImage: document.querySelector("#qrImage"),
  qrText: document.querySelector("#qrText"),
  closeQrButton: document.querySelector("#closeQrButton")
};

const linkTargets = [
  ["autoLink", "auto"],
  ["v2raynLink", "v2rayn"],
  ["clashLink", "clash"],
  ["shadowrocketLink", "shadowrocket"],
  ["surgeLink", "surge"]
];

function showToast(message) {
  els.toast.textContent = message;
  els.toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => els.toast.classList.remove("show"), 1800);
}

function adminHeaders(extra = {}) {
  const token = els.adminToken.value.trim();
  return token ? { ...extra, "x-admin-token": token } : extra;
}

function rememberTokenIfNeeded() {
  if (els.rememberAdminToken.checked) {
    localStorage.setItem("cfSubAdminToken", els.adminToken.value.trim());
  } else {
    localStorage.removeItem("cfSubAdminToken");
  }
}

function profileFromForm() {
  return {
    nodeLinks: els.nodeLinks.value,
    preferredMode: els.preferredMode.value,
    preferredIpSource: els.preferredIpSource.value,
    preferredIpLimit: Number(els.preferredIpLimit.value || 20),
    preferredIps: els.preferredIps.value,
    namePrefix: els.namePrefix.value,
    keepOriginalHost: els.keepOriginalHost.checked
  };
}

function fillForm(profile) {
  els.nodeLinks.value = profile.nodeLinks || "";
  els.preferredMode.value = profile.preferredMode || "auto";
  els.preferredIpSource.value = profile.preferredIpSource || "vps789-list";
  els.preferredIpLimit.value = profile.preferredIpLimit || 20;
  els.preferredIps.value = profile.preferredIps || "";
  els.namePrefix.value = profile.namePrefix || "CF";
  els.keepOriginalHost.checked = profile.keepOriginalHost !== false;
}

function subscriptionUrl(target) {
  const url = new URL("/sub/default", window.location.origin);
  url.searchParams.set("target", target);
  return url.toString();
}

function fillSubscriptionLinks() {
  for (const [id, target] of linkTargets) {
    document.querySelector(`#${id}`).value = subscriptionUrl(target);
  }
}

async function parseJsonResponse(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    throw new Error(data.error || `请求失败：${response.status}`);
  }
  return data;
}

async function loadProfile() {
  const response = await fetch("/api/profile/default", {
    headers: adminHeaders()
  });
  const data = await parseJsonResponse(response);
  if (data.ok) fillForm(data.profile);
  fillSubscriptionLinks();
}

async function saveProfile({ quiet = false } = {}) {
  rememberTokenIfNeeded();
  els.saveButton.disabled = true;
  if (els.generateButton) els.generateButton.disabled = true;
  try {
    const response = await fetch("/api/profile/default", {
      method: "POST",
      headers: adminHeaders({ "content-type": "application/json" }),
      body: JSON.stringify(profileFromForm())
    });
    const data = await parseJsonResponse(response);
    fillSubscriptionLinks();
    if (!quiet) showToast("配置已保存，订阅链接已生成");
    return data.profile;
  } catch (error) {
    showToast(error.message || "保存失败");
    throw error;
  } finally {
    els.saveButton.disabled = false;
    if (els.generateButton) els.generateButton.disabled = false;
  }
}

function renderPreview(items) {
  els.previewBody.innerHTML = items
    .map(
      (item) => `
        <tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.type)}</td>
          <td>${escapeHtml(item.server)}</td>
          <td>${escapeHtml(String(item.port))}</td>
          <td>${escapeHtml(item.host || "-")}</td>
          <td>${escapeHtml(item.sni || "-")}</td>
        </tr>`
    )
    .join("");
}

async function preview() {
  await saveProfile({ quiet: true });
  els.previewButton.disabled = true;
  els.statusText.textContent = "生成预览中";
  try {
    const response = await fetch("/api/preview/default", {
      headers: adminHeaders()
    });
    const data = await parseJsonResponse(response);
    renderPreview(data.preview || []);
    els.statusText.textContent = `原始节点 ${data.counts.baseNodes} 个，优选 IP ${data.counts.preferredEndpoints} 个，输出 ${data.counts.outputNodes} 个`;
    showToast("预览已生成");
  } catch (error) {
    els.statusText.textContent = error.message || "预览失败";
  } finally {
    els.previewButton.disabled = false;
  }
}

async function copyInputValue(id) {
  const input = document.querySelector(`#${id}`);
  if (!input.value) fillSubscriptionLinks();
  await navigator.clipboard.writeText(input.value);
  showToast("订阅链接已复制");
}

function openQr(id) {
  const input = document.querySelector(`#${id}`);
  if (!input.value) fillSubscriptionLinks();
  els.qrText.value = input.value;
  els.qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=260x260&data=${encodeURIComponent(input.value)}`;
  els.qrDialog.showModal();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const savedToken = localStorage.getItem("cfSubAdminToken") || "";
if (savedToken) {
  els.adminToken.value = savedToken;
  els.rememberAdminToken.checked = true;
}

els.saveButton.addEventListener("click", () => saveProfile());
els.generateButton.addEventListener("click", () => saveProfile());
els.previewButton.addEventListener("click", preview);
els.closeQrButton.addEventListener("click", () => els.qrDialog.close());
els.adminToken.addEventListener("change", () => {
  rememberTokenIfNeeded();
  loadProfile().catch((error) => showToast(error.message || "配置加载失败"));
});
els.rememberAdminToken.addEventListener("change", rememberTokenIfNeeded);

document.querySelectorAll(".copy-link").forEach((button) => {
  button.addEventListener("click", () => copyInputValue(button.dataset.link));
});

document.querySelectorAll(".qr-link").forEach((button) => {
  button.addEventListener("click", () => openQr(button.dataset.link));
});

fillSubscriptionLinks();
loadProfile().catch((error) => showToast(error.message || "配置加载失败"));

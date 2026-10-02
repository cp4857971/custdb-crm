// 服务器地址：默认同源网关 /app/custdb；可在「设置」中改为 NAS 地址（手机端/异地访问）
const DEFAULT_BASE = "/app/custdb";

export function getBase() {
  const saved = localStorage.getItem("custdb_base");
  return saved && saved.trim() ? saved.trim().replace(/\/+$/, "") : DEFAULT_BASE;
}

export function setBase(v) {
  if (v && v.trim()) localStorage.setItem("custdb_base", v.trim().replace(/\/+$/, ""));
  else localStorage.removeItem("custdb_base");
}

async function api(path, opts) {
  const headers = { "Content-Type": "application/json" };
  const token = localStorage.getItem("custdb_token");
  if (token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch(getBase() + path, { headers, ...opts });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    if (res.status === 401 && !path.startsWith("/api/auth/")) {
      logoutLocal();
      const err = new Error(e.error || "登录已过期，请重新登录");
      err.code = 401;
      throw err;
    }
    throw new Error(e.error || "请求失败");
  }
  return res.json();
}

// ---------------- 登录（超级管理员 / 临时访问用户） ----------------
export function login(username, password) {
  return api("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
}

export function me() {
  return api("/api/auth/me");
}

export function logoutLocal() {
  localStorage.removeItem("custdb_token");
  localStorage.removeItem("custdb_user");
  localStorage.removeItem("custdb_uid");
  localStorage.removeItem("custdb_isSuper");
  localStorage.removeItem("custdb_isOperator");
}

export function saveLogin(r) {
  localStorage.setItem("custdb_token", r.token);
  localStorage.setItem("custdb_user", r.username || "");
  localStorage.setItem("custdb_uid", r.uid || r.username || "");
  localStorage.setItem("custdb_isSuper", r.isSuper ? "1" : "0");
  if (r.isOperator) localStorage.setItem("custdb_isOperator", "1");
  else localStorage.removeItem("custdb_isOperator");
}

export function isSuperLocal() {
  return localStorage.getItem("custdb_isSuper") === "1";
}

export function isOperatorLocal() {
  return localStorage.getItem("custdb_isOperator") === "1";
}

// 管理员切换的 NAS 用户（Token 身份下 uid 固定，不切换）
export function effectiveUid() {
  const u = localStorage.getItem("custdb_uid");
  return u && u.trim() ? u.trim() : null;
}

// ---------------- 管理员视角 ----------------
// 管理员可切换查看某个 NAS 用户的客户数据（viewUid 为空 = 查看自己的数据）
let viewUid = null;
export function setAdminView(uid) {
  viewUid = uid && String(uid).trim() ? String(uid).trim() : null;
}
export function getAdminView() {
  return viewUid;
}

export function getAdminStatus() {
  return api("/api/admin/status");
}

export function listAdminUsers() {
  return api("/api/admin/users");
}

export function adminListCustomers(q, status, uid) {
  return api("/api/admin/customers?uid=" + encodeURIComponent(uid) + "&q=" + encodeURIComponent(q || "") + "&status=" + encodeURIComponent(status || ""));
}

export function adminStats(uid) {
  return api("/api/admin/stats?uid=" + encodeURIComponent(uid));
}

export function adminAnalytics(uid) {
  return api("/api/admin/analytics" + (uid ? "?uid=" + encodeURIComponent(uid) : ""));
}

export function adminCreate(uid, data) {
  return api("/api/admin/customers", { method: "POST", body: JSON.stringify(Object.assign({ uid }, data)) });
}

export function adminUpdate(uid, id, data) {
  return api("/api/admin/customers/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(Object.assign({ uid }, data)) });
}

export function adminDelete(uid, id) {
  return api("/api/admin/customers/" + encodeURIComponent(id) + "?uid=" + encodeURIComponent(uid), { method: "DELETE" });
}

export function adminAddAdmin(username) {
  return api("/api/admin/admins", { method: "POST", body: JSON.stringify({ action: "add", username }) });
}

export function adminRemoveAdmin(username) {
  return api("/api/admin/admins", { method: "POST", body: JSON.stringify({ action: "remove", username }) });
}

// ---------------- 超级管理员专属 ----------------
export function superChangePassword(oldPassword, newPassword) {
  return api("/api/admin/super-password", { method: "POST", body: JSON.stringify({ oldPassword, newPassword }) });
}

export function superListTempUsers() {
  return api("/api/admin/temp-users");
}

export function superCreateTempUser(data) {
  return api("/api/admin/temp-users", { method: "POST", body: JSON.stringify(data) });
}

export function superDeleteTempUser(username) {
  return api("/api/admin/temp-users/" + encodeURIComponent(username), { method: "DELETE" });
}

export function superSetRequireLogin(requireLogin) {
  return api("/api/admin/require-login", { method: "POST", body: JSON.stringify({ requireLogin }) });
}

// ---------------- 登录用户（管理员可管理） ----------------
export function listLoginUsers() {
  return api("/api/admin/login-users");
}

export function createLoginUser(u) {
  return api("/api/admin/login-users", { method: "POST", body: JSON.stringify(u) });
}

export function updateLoginUser(username, patch) {
  return api("/api/admin/login-users/" + encodeURIComponent(username), { method: "PUT", body: JSON.stringify(patch) });
}

export function deleteLoginUser(username) {
  return api("/api/admin/login-users/" + encodeURIComponent(username), { method: "DELETE" });
}

// ---------------- 客户数据（自动按管理员视角路由） ----------------
export function listCustomers(q, status) {
  if (viewUid) return adminListCustomers(q, status, viewUid);
  return api("/api/customers?q=" + encodeURIComponent(q || "") + "&status=" + encodeURIComponent(status || ""));
}

export function getStats() {
  if (viewUid) return adminStats(viewUid);
  return api("/api/stats");
}

export function getSettings() {
  return api("/api/settings");
}

export function setDataPath(dataDir) {
  return api("/api/settings/path", { method: "POST", body: JSON.stringify({ dataDir }) });
}

export function setPort(port) {
  return api("/api/settings/port", { method: "POST", body: JSON.stringify({ port }) });
}

export function ping() {
  const headers = {};
  const token = localStorage.getItem("custdb_token");
  if (token) headers["Authorization"] = "Bearer " + token;
  return fetch(getBase() + "/api/health", { method: "GET", headers }).then((res) => res.ok);
}

export function createCustomer(data) {
  if (viewUid) return adminCreate(viewUid, data);
  return api("/api/customers", { method: "POST", body: JSON.stringify(data) });
}

export function updateCustomer(id, data) {
  if (viewUid) return adminUpdate(viewUid, id, data);
  return api("/api/customers/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(data) });
}

export function deleteCustomer(id) {
  if (viewUid) return adminDelete(viewUid, id);
  return api("/api/customers/" + encodeURIComponent(id), { method: "DELETE" });
}

export function importFile(file, mode, type) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mode", mode);
  fd.append("type", type || "customers");
  if (viewUid) fd.append("uid", viewUid);
  const headers = {};
  const token = localStorage.getItem("custdb_token");
  if (token) headers["Authorization"] = "Bearer " + token;
  return fetch(getBase() + "/api/import", { method: "POST", headers, body: fd }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401) logoutLocal();
      throw new Error(data.error || data.message || "导入失败");
    }
    return data;
  });
}

// ---------------- 异网用户（策反名单） ----------------
export function adminPortinList(uid, q) {
  return api("/api/admin/portin?uid=" + encodeURIComponent(uid) + "&q=" + encodeURIComponent(q || ""));
}

export function adminPortinStats(uid) {
  return api("/api/admin/portin/stats?uid=" + encodeURIComponent(uid));
}

export function adminPortinCreate(uid, data) {
  return api("/api/admin/portin", { method: "POST", body: JSON.stringify(Object.assign({ uid }, data)) });
}

export function adminPortinUpdate(uid, id, data) {
  return api("/api/admin/portin/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(Object.assign({ uid }, data)) });
}

export function adminPortinDelete(uid, id) {
  return api("/api/admin/portin/" + encodeURIComponent(id) + "?uid=" + encodeURIComponent(uid), { method: "DELETE" });
}

export function listPortin(q) {
  if (viewUid) return adminPortinList(viewUid, q);
  return api("/api/portin?q=" + encodeURIComponent(q || ""));
}

export function getPortinStats() {
  if (viewUid) return adminPortinStats(viewUid);
  return api("/api/portin/stats");
}

export function createPortin(data) {
  if (viewUid) return adminPortinCreate(viewUid, data);
  return api("/api/portin", { method: "POST", body: JSON.stringify(data) });
}

export function updatePortin(id, data) {
  if (viewUid) return adminPortinUpdate(viewUid, id, data);
  return api("/api/portin/" + encodeURIComponent(id), { method: "PUT", body: JSON.stringify(data) });
}

export function deletePortin(id) {
  if (viewUid) return adminPortinDelete(viewUid, id);
  return api("/api/portin/" + encodeURIComponent(id), { method: "DELETE" });
}

// ---------------- 套餐业务库 / 小业务库 / 号码识别（v0.0.23） ----------------
export function listPlans(operator) {
  return api("/api/library/plans" + (operator ? "?operator=" + encodeURIComponent(operator) : ""));
}

export function listAddons(operator) {
  return api("/api/library/addons" + (operator ? "?operator=" + encodeURIComponent(operator) : ""));
}

export function createPlan(data) {
  return api("/api/library/plans", { method: "POST", body: JSON.stringify(data) });
}

export function deletePlan(id) {
  return api("/api/library/plans/" + encodeURIComponent(id), { method: "DELETE" });
}

export function createAddon(data) {
  return api("/api/library/addons", { method: "POST", body: JSON.stringify(data) });
}

export function deleteAddon(id) {
  return api("/api/library/addons/" + encodeURIComponent(id), { method: "DELETE" });
}

export function detectOperatorApi(phone) {
  return api("/api/detect-operator?phone=" + encodeURIComponent(phone || ""));
}

// ---------------- 数据导出（CSV / Excel / JSON） ----------------// format: csv|xlsx|json；type: customers|portin；all=true 导出全部用户（仅管理员非视角状态）
// 用 fetch + Blob 下载（携带登录 Token），修复严格登录模式下 location.href 跳转被 401 拒绝的问题
export function exportUrl(format, type, all) {
  const p = new URLSearchParams();
  p.set("format", format);
  p.set("type", type);
  if (all && !viewUid) p.set("all", "1");
  else if (viewUid) p.set("uid", viewUid);
  return getBase() + "/api/export?" + p.toString();
}

export async function exportData(format, type, all) {
  const headers = {};
  const token = localStorage.getItem("custdb_token");
  if (token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch(exportUrl(format, type, all), { method: "GET", headers });
  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    if (res.status === 401) logoutLocal();
    throw new Error(e.error || "导出失败（HTTP " + res.status + "）");
  }
  return res.blob();
}

// 触发浏览器下载 Blob（含中文文件名）
export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

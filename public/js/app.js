// Shared helpers for every page -- same-origin API, since this website is
// served by the same Express app as /api/* (see src/app.ts).
const API_BASE = "/api";

function authToken() {
  return localStorage.getItem("mb_affiliate_token");
}
function setAuthToken(token) {
  localStorage.setItem("mb_affiliate_token", token);
}
function clearAuthToken() {
  localStorage.removeItem("mb_affiliate_token");
}
function requireAuthOrRedirect() {
  if (!authToken()) window.location.href = "/login.html";
}

async function apiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = authToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const resp = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const e = new Error(data.error || `Request failed (${resp.status})`);
    e.reason = data.reason;
    throw e;
  }
  return data;
}

function logout() {
  clearAuthToken();
  window.location.href = "/login.html";
}

// ─── Admin dashboard auth (completely separate token/namespace from the
// affiliate helpers above -- different localStorage key, different login
// page, different API prefix path shape, so the two auth systems can never
// be confused with each other). ───
function adminAuthToken() {
  return localStorage.getItem("mb_admin_token");
}
function setAdminAuthToken(token) {
  localStorage.setItem("mb_admin_token", token);
}
function clearAdminAuthToken() {
  localStorage.removeItem("mb_admin_token");
}
function requireAdminAuthOrRedirect() {
  if (!adminAuthToken()) window.location.href = "/admin-login.html";
}

async function adminApiFetch(path, options = {}) {
  const headers = { "Content-Type": "application/json", ...(options.headers || {}) };
  const token = adminAuthToken();
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const resp = await fetch(`${API_BASE}${path}`, { ...options, headers });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const e = new Error(data.error || `Request failed (${resp.status})`);
    e.reason = data.reason;
    throw e;
  }
  return data;
}

function adminLogout() {
  clearAdminAuthToken();
  window.location.href = "/admin-login.html";
}

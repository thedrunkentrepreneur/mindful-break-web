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
  if (!resp.ok) throw new Error(data.error || `Request failed (${resp.status})`);
  return data;
}

function logout() {
  clearAuthToken();
  window.location.href = "/login.html";
}

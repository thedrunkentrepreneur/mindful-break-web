requireAdminAuthOrRedirect();

document.getElementById("nav-email").textContent = localStorage.getItem("mb_admin_email") || "";
document.getElementById("logout-link").addEventListener("click", (e) => { e.preventDefault(); adminLogout(); });

function fmtMoney(n) {
  return `₹${Math.round(n || 0).toLocaleString("en-IN")}`;
}
function fmtDate(iso) {
  if (!iso) return "—";
  return iso.slice(0, 10);
}
function statusPill(status) {
  return `<span class="status-pill status-${status}">${status}</span>`;
}
function escapeHtml(s) {
  return (s ?? "").toString().replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function payoutMethodSummary(pm) {
  if (!pm) return "—";
  if (pm.type === "upi") return `UPI: ${escapeHtml(pm.upiId)}`;
  if (pm.type === "bank") return `Bank: ${escapeHtml(pm.accountName)} · ${escapeHtml(pm.accountNumber)} · ${escapeHtml(pm.ifscOrSwift)} · ${escapeHtml(pm.bankName)}`;
  return "—";
}
function socialLinksSummary(links) {
  if (!links || !links.length) return "—";
  return links.map((l) => `<a href="${escapeHtml(l)}" target="_blank" rel="noopener" style="display:block;">${escapeHtml(l)}</a>`).join("");
}

let currentAffiliates = [];
let currentOverview = null;

async function loadOverview() {
  const ov = await adminApiFetch("/admin/overview");
  currentOverview = ov;
  document.getElementById("ov-pending").textContent = ov.pendingApprovals;
  document.getElementById("ov-approved").textContent = ov.approved;
  document.getElementById("ov-rejected").textContent = ov.rejected;
  document.getElementById("ov-total").textContent = ov.totalAffiliates;
  document.getElementById("ov-installs").textContent = ov.installs.toLocaleString("en-IN");
  document.getElementById("ov-sessions-started").textContent = ov.sessionsStarted.toLocaleString("en-IN");
  document.getElementById("ov-sessions-completed").textContent = ov.sessionsCompleted.toLocaleString("en-IN");
  document.getElementById("ov-failed").textContent = ov.failedSessions.toLocaleString("en-IN");
  document.getElementById("ov-unlocks").textContent = ov.paidUnlocks.toLocaleString("en-IN");
  document.getElementById("ov-earnings").textContent = fmtMoney(ov.totalEarningsINR);
  document.getElementById("ov-paid-out").textContent = fmtMoney(ov.paidOutINR);
  document.getElementById("ov-pending-payout").textContent = fmtMoney(ov.pendingINR);
}

async function loadAffiliates() {
  const data = await adminApiFetch("/admin/affiliates");
  currentAffiliates = data.affiliates;
  renderPendingTable();
  renderAllTable();
}

function renderPendingTable() {
  const pending = currentAffiliates.filter((a) => a.status === "pending");
  const tbody = document.getElementById("pending-tbody");
  if (!pending.length) {
    tbody.innerHTML = `<tr><td colspan="8" style="color:var(--muted);">No pending approvals. 🎉</td></tr>`;
    return;
  }
  tbody.innerHTML = pending.map((a) => `
    <tr>
      <td>${escapeHtml(a.name)}</td>
      <td>${escapeHtml(a.email)}</td>
      <td>${escapeHtml(a.phone)}</td>
      <td>${escapeHtml(a.country)}</td>
      <td>${escapeHtml(a.promotionChannel)}</td>
      <td>${socialLinksSummary(a.socialLinks)}</td>
      <td>${fmtDate(a.createdAt)}</td>
      <td>
        <div class="mini-btn-row">
          <button class="btn btn-sm" style="background:rgba(0,217,166,0.15); color:var(--primary);" onclick="setStatus('${a.id}','approved')">Approve</button>
          <button class="btn btn-sm" style="background:rgba(255,77,106,0.12); color:var(--danger);" onclick="setStatus('${a.id}','rejected')">Reject</button>
          <button class="btn btn-sm btn-outline" onclick="openDetail('${a.id}')">View</button>
        </div>
      </td>
    </tr>
  `).join("");
}

function renderAllTable() {
  const tbody = document.getElementById("all-tbody");
  if (!currentAffiliates.length) {
    tbody.innerHTML = `<tr><td colspan="12" style="color:var(--muted);">No affiliates yet.</td></tr>`;
    return;
  }
  tbody.innerHTML = currentAffiliates.map((a) => `
    <tr>
      <td>${escapeHtml(a.name)}</td>
      <td>${escapeHtml(a.email)}</td>
      <td>${statusPill(a.status)}</td>
      <td class="num">${a.installs.toLocaleString("en-IN")}</td>
      <td class="num">${a.sessionsStarted.toLocaleString("en-IN")}</td>
      <td class="num">${a.failedSessions.toLocaleString("en-IN")}</td>
      <td class="num">${a.paidUnlocks.toLocaleString("en-IN")}</td>
      <td class="num money">${fmtMoney(a.totalEarningsINR)}</td>
      <td class="num">${fmtMoney(a.paidOutINR)}</td>
      <td class="num">${fmtMoney(a.pendingINR)}</td>
      <td>${a.lastPayout ? fmtDate(a.lastPayout.paidAt) : "Never"}</td>
      <td><button class="btn btn-sm btn-outline" onclick="openDetail('${a.id}')">View</button></td>
    </tr>
  `).join("");
}

async function setStatus(id, status) {
  try {
    await adminApiFetch(`/admin/affiliates/${id}/status`, { method: "POST", body: JSON.stringify({ status }) });
    await Promise.all([loadOverview(), loadAffiliates()]);
    if (currentDetailId === id) openDetail(id);
  } catch (err) {
    alert(err.message);
  }
}

let currentDetailId = null;
const detailModal = document.getElementById("detail-modal");

async function openDetail(id) {
  currentDetailId = id;
  try {
    const d = await adminApiFetch(`/admin/affiliates/${id}`);
    document.getElementById("detail-name").textContent = d.name;
    document.getElementById("detail-email").textContent = d.email;

    document.getElementById("detail-grid").innerHTML = `
      <div><div class="k">Status</div><div class="v">${statusPill(d.status)}</div></div>
      <div><div class="k">Phone</div><div class="v">${escapeHtml(d.phone) || "—"}</div></div>
      <div><div class="k">Country</div><div class="v">${escapeHtml(d.country) || "—"}</div></div>
      <div><div class="k">Payout currency</div><div class="v">${escapeHtml(d.currency)}</div></div>
      <div><div class="k">Referral code</div><div class="v">${escapeHtml(d.referralCode)}</div></div>
      <div><div class="k">Signed up</div><div class="v">${fmtDate(d.createdAt)}</div></div>
      <div><div class="k">Email verified</div><div class="v">${d.emailVerified ? "Yes" : "No"}</div></div>
      <div><div class="k">Promotion channel</div><div class="v">${escapeHtml(d.promotionChannel) || "—"}</div></div>
      <div style="grid-column:1/-1;"><div class="k">Social / promo links</div><div class="v">${socialLinksSummary(d.socialLinks)}</div></div>
      <div style="grid-column:1/-1;"><div class="k">Payout method (bank/UPI details)</div><div class="v">${payoutMethodSummary(d.payoutMethod)}</div></div>
      <div><div class="k">Installs</div><div class="v">${d.installs.toLocaleString("en-IN")}</div></div>
      <div><div class="k">Sessions started</div><div class="v">${d.sessionsStarted.toLocaleString("en-IN")}</div></div>
      <div><div class="k">Sessions completed</div><div class="v">${d.sessionsCompleted.toLocaleString("en-IN")}</div></div>
      <div><div class="k">Failed sessions</div><div class="v">${d.failedSessions.toLocaleString("en-IN")}</div></div>
      <div><div class="k">Paid unlocks</div><div class="v">${d.paidUnlocks.toLocaleString("en-IN")}</div></div>
      <div><div class="k">Total earned</div><div class="v money">${fmtMoney(d.totalEarningsINR)}</div></div>
      <div><div class="k">Paid out so far</div><div class="v">${fmtMoney(d.paidOutINR)}</div></div>
      <div><div class="k">Pending payout</div><div class="v">${fmtMoney(d.pendingINR)}</div></div>
    `;

    const payoutsTbody = document.getElementById("detail-payouts-tbody");
    if (!d.payouts || !d.payouts.length) {
      payoutsTbody.innerHTML = `<tr><td colspan="4" style="color:var(--muted);">No payouts yet.</td></tr>`;
    } else {
      payoutsTbody.innerHTML = d.payouts.slice().reverse().map((p) => `
        <tr>
          <td>${fmtDate(p.paidAt)}</td>
          <td class="num money">${fmtMoney(p.amountINR)}</td>
          <td>${escapeHtml(p.note) || "—"}</td>
          <td>${p.screenshotDataUrl ? `<a href="${p.screenshotDataUrl}" target="_blank" rel="noopener">View proof</a>` : "—"}</td>
        </tr>
      `).join("");
    }

    document.getElementById("payout-date").value = new Date().toISOString().slice(0, 10);
    document.getElementById("payout-form").reset();
    document.getElementById("payout-date").value = new Date().toISOString().slice(0, 10);
    document.getElementById("payout-screenshot-preview").style.display = "none";
    document.getElementById("payout-msg").textContent = "";
    document.getElementById("payout-msg").className = "form-msg";

    detailModal.classList.add("open");
  } catch (err) {
    alert(err.message);
  }
}

document.getElementById("detail-close").addEventListener("click", () => detailModal.classList.remove("open"));
detailModal.addEventListener("click", (e) => { if (e.target === detailModal) detailModal.classList.remove("open"); });

document.getElementById("detail-approve").addEventListener("click", () => setStatus(currentDetailId, "approved"));
document.getElementById("detail-reject").addEventListener("click", () => setStatus(currentDetailId, "rejected"));
document.getElementById("detail-pending").addEventListener("click", () => setStatus(currentDetailId, "pending"));

// Screenshot file -> base64 data URL, shown as a preview before submit.
let payoutScreenshotDataUrl = null;
document.getElementById("payout-screenshot").addEventListener("change", (e) => {
  const file = e.target.files[0];
  const preview = document.getElementById("payout-screenshot-preview");
  if (!file) { payoutScreenshotDataUrl = null; preview.style.display = "none"; return; }
  if (file.size > 5 * 1024 * 1024) {
    alert("Screenshot is larger than 5MB. Please pick a smaller image.");
    e.target.value = "";
    payoutScreenshotDataUrl = null;
    preview.style.display = "none";
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    payoutScreenshotDataUrl = reader.result;
    preview.src = payoutScreenshotDataUrl;
    preview.style.display = "block";
  };
  reader.readAsDataURL(file);
});

document.getElementById("payout-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("payout-msg");
  const btn = document.getElementById("payout-submit");
  msg.textContent = "";
  msg.className = "form-msg";
  const amountINR = parseFloat(document.getElementById("payout-amount").value);
  const paidAt = document.getElementById("payout-date").value;
  const note = document.getElementById("payout-note").value.trim();
  if (!amountINR || amountINR <= 0) { msg.textContent = "Enter a valid amount."; msg.className = "form-msg error"; return; }
  btn.disabled = true;
  btn.textContent = "Recording…";
  try {
    await adminApiFetch(`/admin/affiliates/${currentDetailId}/payout`, {
      method: "POST",
      body: JSON.stringify({ amountINR, paidAt, note, screenshotDataUrl: payoutScreenshotDataUrl }),
    });
    msg.textContent = "Payout recorded!";
    msg.className = "form-msg success";
    await Promise.all([loadOverview(), loadAffiliates()]);
    await openDetail(currentDetailId);
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "form-msg error";
  } finally {
    btn.disabled = false;
    btn.textContent = "Record payout";
  }
});

// ---- Change password modal ----
const pwModal = document.getElementById("pw-modal");
document.getElementById("change-pw-link").addEventListener("click", (e) => { e.preventDefault(); pwModal.classList.add("open"); });
document.getElementById("pw-close").addEventListener("click", () => pwModal.classList.remove("open"));
pwModal.addEventListener("click", (e) => { if (e.target === pwModal) pwModal.classList.remove("open"); });

document.getElementById("pw-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const msg = document.getElementById("pw-msg");
  const btn = document.getElementById("pw-submit");
  msg.textContent = "";
  msg.className = "form-msg";
  btn.disabled = true;
  btn.textContent = "Updating…";
  try {
    await adminApiFetch("/admin/change-password", {
      method: "POST",
      body: JSON.stringify({
        currentPassword: document.getElementById("current-pw").value,
        newPassword: document.getElementById("new-pw").value,
      }),
    });
    msg.textContent = "Password updated!";
    msg.className = "form-msg success";
    document.getElementById("pw-form").reset();
  } catch (err) {
    msg.textContent = err.message;
    msg.className = "form-msg error";
  } finally {
    btn.disabled = false;
    btn.textContent = "Update password";
  }
});

// ---- Boot + auto-refresh ----
async function boot() {
  try {
    await Promise.all([loadOverview(), loadAffiliates()]);
  } catch (err) {
    if (err.message?.toLowerCase().includes("not authenticated")) {
      adminLogout();
    } else {
      document.querySelector(".dash-wrap").insertAdjacentHTML(
        "afterbegin",
        `<div class="card" style="margin-bottom:20px; border-color:var(--danger);"><p style="color:var(--danger);">Couldn't load dashboard: ${err.message}</p></div>`
      );
    }
  }
}
boot();
setInterval(boot, 60000);

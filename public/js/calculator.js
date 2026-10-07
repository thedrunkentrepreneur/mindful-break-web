// Earnings calculator -- exact assumptions confirmed with the product owner:
//   views            = followers x 5
//   installs          = views x 1%
//   active users      = installs x 60%
//   sessions/month    = active users x 20
//   paid unlocks      = sessions x 15%
//   commission/unlock = INR 20.80  (50% of INR 49 unlock fee net of Google
//                        Play's 15% billing cut)
//
// This is deliberately an ILLUSTRATIVE model, not a promise -- the growth
// curve (new followers added per month, decaying ~70% each month) is a
// simple, editable assumption, not a guarantee. All inputs below are meant
// to be played with.
const VIEWS_PER_FOLLOWER = 5;
const INSTALL_CONVERSION = 0.01;
const ACTIVE_USER_RATE = 0.6;
const SESSIONS_PER_ACTIVE_USER = 20;
const PAID_UNLOCK_RATE = 0.15;
const COMMISSION_PER_UNLOCK_INR = 20.8;

// Net INR earned per follower per month, holding the follower count fixed
// for that month (the per-month breakdown below re-derives this fresh off
// each month's follower count, so growth compounds correctly).
function monthlyEarningsINR(followers) {
  const views = followers * VIEWS_PER_FOLLOWER;
  const installs = views * INSTALL_CONVERSION;
  const activeUsers = installs * ACTIVE_USER_RATE;
  const sessions = activeUsers * SESSIONS_PER_ACTIVE_USER;
  const paidUnlocks = sessions * PAID_UNLOCK_RATE;
  return paidUnlocks * COMMISSION_PER_UNLOCK_INR;
}

function buildProjection(startFollowers, growthRatePct, decayPct, months) {
  const growth = growthRatePct / 100;
  const decay = decayPct / 100;
  const rows = [];
  let followers = startFollowers;
  let newAdd = startFollowers * growth;
  let cumulativeINR = 0;

  for (let m = 1; m <= months; m++) {
    const earnings = monthlyEarningsINR(followers);
    cumulativeINR += earnings;
    rows.push({
      month: m,
      followers: Math.round(followers),
      earningsINR: earnings,
      cumulativeINR,
    });
    followers += newAdd;
    newAdd *= decay;
  }
  return rows;
}

function fmtINR(n) {
  return "\u20b9" + Math.round(n).toLocaleString("en-IN");
}
function fmtNum(n) {
  return Math.round(n).toLocaleString("en-IN");
}

function renderCalculator() {
  const followersSlider = document.getElementById("calc-followers");
  const growthSlider = document.getElementById("calc-growth");
  const decaySlider = document.getElementById("calc-decay");
  const followersLabel = document.getElementById("calc-followers-label");
  const growthLabel = document.getElementById("calc-growth-label");
  const decayLabel = document.getElementById("calc-decay-label");
  const statsEl = document.getElementById("calc-month1-stats");
  const tbody = document.getElementById("calc-table-body");
  const cumulativeEl = document.getElementById("calc-cumulative-value");

  function render() {
    const followers = Number(followersSlider.value);
    const growthPct = Number(growthSlider.value);
    const decayPct = Number(decaySlider.value);
    followersLabel.textContent = fmtNum(followers);
    growthLabel.textContent = growthPct + "%";
    decayLabel.textContent = decayPct + "%";

    const rows = buildProjection(followers, growthPct, decayPct, 12);
    const month1 = rows[0];

    const views = month1.followers * VIEWS_PER_FOLLOWER;
    const installs = views * INSTALL_CONVERSION;
    const activeUsers = installs * ACTIVE_USER_RATE;
    const sessions = activeUsers * SESSIONS_PER_ACTIVE_USER;
    const paidUnlocks = sessions * PAID_UNLOCK_RATE;

    statsEl.innerHTML = `
      <div class="stat-box"><div class="v">${fmtNum(views)}</div><div class="l">Views / mo</div></div>
      <div class="stat-box"><div class="v">${fmtNum(installs)}</div><div class="l">Installs</div></div>
      <div class="stat-box"><div class="v">${fmtNum(sessions)}</div><div class="l">Sessions / mo</div></div>
      <div class="stat-box"><div class="v">${fmtNum(paidUnlocks)}</div><div class="l">Paid unlocks</div></div>
    `;

    tbody.innerHTML = rows
      .slice(0, 6)
      .map(
        (r) => `
      <tr>
        <td>Month ${r.month}</td>
        <td>${fmtNum(r.followers)}</td>
        <td class="money">${fmtINR(r.earningsINR)}</td>
      </tr>`
      )
      .join("");

    cumulativeEl.textContent = fmtINR(rows[11].cumulativeINR);
  }

  [followersSlider, growthSlider, decaySlider].forEach((el) => el.addEventListener("input", render));
  render();
}

document.addEventListener("DOMContentLoaded", renderCalculator);

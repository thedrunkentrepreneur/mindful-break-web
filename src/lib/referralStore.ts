import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Referral / affiliate ledger storage.
 *
 * Follows the same pattern as detox.ts's detox-stats.json: a flat JSON file
 * on disk, read-modify-write per request, no locking. That's an accepted
 * tradeoff at this project's current scale (see DEPLOY.md's "Data storage
 * caveat") -- fine for a side project's first real affiliates, not meant to
 * survive serious concurrent write traffic. Revisit with a real DB
 * (@workspace/db is already a workspace dependency) if this ever needs to.
 */

const DATA_FILE = path.join(process.cwd(), "referral-data.json");

// ---- Commission economics -------------------------------------------------
// Unlock fee: INR 49. Google Play Billing's small-developer tier takes 15%,
// leaving INR 41.65 net. The affiliate gets 50% of that net amount. Rounded
// to 2 decimals -- this is the exact figure Arpit confirmed aligned with.
export const UNLOCK_FEE_INR = 49;
export const COMMISSION_PER_UNLOCK_INR = 20.8;

// Round-number payout thresholds per currency (NOT live FX-converted --
// deliberately simple, fixed round numbers per Arpit's explicit ask).
// INR 1000 is the anchor; everything else is "about $10" rounded to a clean
// number in that currency. Any currency not listed here falls back to the
// USD row.
export const PAYOUT_THRESHOLDS: Record<string, number> = {
  INR: 1000,
  USD: 10,
  EUR: 10,
  GBP: 10,
  AUD: 15,
  CAD: 15,
  SGD: 15,
  AED: 40,
  JPY: 1500,
};

export function payoutThresholdFor(currency: string): number {
  return PAYOUT_THRESHOLDS[currency?.toUpperCase()] ?? PAYOUT_THRESHOLDS["USD"];
}

// ---- Types ------------------------------------------------------------

export type PayoutMethod =
  | { type: "upi"; upiId: string }
  | { type: "bank"; accountName: string; accountNumber: string; ifscOrSwift: string; bankName: string };

export interface Affiliate {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  phone: string;
  country: string;
  currency: string; // ISO code, e.g. "INR", "USD"
  promotionChannel: string;
  payoutMethod: PayoutMethod;
  referralCode: string;
  createdAt: string;
  totalEarningsINR: number; // lifetime, never decreases
  paidOutINR: number; // lifetime, incremented only by an admin mark-paid action
  lastSettlementAt: string | null;
  // Email verification (requires RESEND_API_KEY env var to send the link)
  emailVerified: boolean;
  emailVerificationToken: string | null;
  // Password reset (token is a 1-hour-expiry hex string, cleared after use)
  passwordResetToken: string | null;
  passwordResetExpiry: number | null; // ms timestamp
}

export interface DailyBucket {
  installs: number;
  sessionsStarted: number;
  sessionsCompleted: number;
  paidUnlocks: number;
  commissionINR: number;
}

interface StoreData {
  affiliates: Record<string, Affiliate>;
  codeToAffiliateId: Record<string, string>;
  emailToAffiliateId: Record<string, string>;
  phoneToAffiliateId: Record<string, string>; // normalized phone -> affiliateId dedup index
  devices: Record<string, { affiliateId: string; referralCode: string; source: string; attributedAt: string }>;
  dailyStats: Record<string, Record<string, DailyBucket>>; // affiliateId -> dateISO -> bucket
  sessions: Record<string, { affiliateId: string; createdAt: string }>; // auth token -> session
  helpRequests: Array<{ affiliateId: string; subject: string; message: string; createdAt: string }>;
}

const EMPTY: StoreData = {
  affiliates: {},
  codeToAffiliateId: {},
  emailToAffiliateId: {},
  phoneToAffiliateId: {},
  devices: {},
  dailyStats: {},
  sessions: {},
  helpRequests: [],
};

function load(): StoreData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      return { ...EMPTY, ...JSON.parse(raw) };
    }
  } catch {
    // Corrupt or unreadable file -- fail safe to an empty store rather than
    // crash the whole API over one bad write.
  }
  return structuredClone(EMPTY);
}

function save(data: StoreData) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch {
    // Best-effort, same as detox-stats.json.
  }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---- Password hashing (stdlib crypto only -- no bcrypt/argon2, both are
// native modules esbuild externalizes and that would need extra deploy
// steps we don't have time for today) ----------------------------------

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return { hash, salt };
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const attempt = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(attempt, "hex"), Buffer.from(hash, "hex"));
}

function generateReferralCode(data: StoreData, name: string): string {
  const base = (name || "AFF").replace(/[^a-zA-Z]/g, "").toUpperCase().slice(0, 6) || "AFF";
  for (let attempt = 0; attempt < 20; attempt++) {
    const suffix = crypto.randomBytes(3).toString("hex").toUpperCase();
    const code = `${base}${suffix}`;
    if (!data.codeToAffiliateId[code]) return code;
  }
  // Astronomically unlikely fallback.
  return `AFF${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
}

// ---- Affiliate signup / login ------------------------------------------

export function createAffiliate(input: {
  name: string;
  email: string;
  password: string;
  phone: string;
  country: string;
  currency: string;
  promotionChannel?: string;
  payoutMethod: PayoutMethod;
}): { affiliate: Affiliate; verificationToken: string } | { error: string } {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password || input.password.length < 8) {
    return { error: "Email and a password of at least 8 characters are required." };
  }
  const data = load();
  if (data.emailToAffiliateId[email]) {
    return { error: "An affiliate account with this email already exists." };
  }
  // Deduplicate by normalized phone (non-empty phones only)
  const normalizedPhone = (input.phone ?? "").replace(/\s/g, "").trim();
  if (normalizedPhone && data.phoneToAffiliateId?.[normalizedPhone]) {
    return { error: "An affiliate account with this phone number already exists." };
  }

  const { hash, salt } = hashPassword(input.password);
  const id = crypto.randomUUID();
  const referralCode = generateReferralCode(data, input.name);
  const verificationToken = crypto.randomBytes(32).toString("hex");

  const affiliate: Affiliate = {
    id,
    name: input.name.trim(),
    email,
    passwordHash: hash,
    passwordSalt: salt,
    phone: normalizedPhone,
    country: input.country?.trim() ?? "",
    currency: (input.currency || "USD").toUpperCase(),
    promotionChannel: input.promotionChannel?.trim() ?? "",
    payoutMethod: input.payoutMethod,
    referralCode,
    createdAt: new Date().toISOString(),
    totalEarningsINR: 0,
    paidOutINR: 0,
    lastSettlementAt: null,
    emailVerified: false,
    emailVerificationToken: verificationToken,
    passwordResetToken: null,
    passwordResetExpiry: null,
  };

  data.affiliates[id] = affiliate;
  data.codeToAffiliateId[referralCode] = id;
  data.emailToAffiliateId[email] = id;
  if (normalizedPhone) {
    if (!data.phoneToAffiliateId) data.phoneToAffiliateId = {};
    data.phoneToAffiliateId[normalizedPhone] = id;
  }
  save(data);

  return { affiliate, verificationToken };
}

// Verify email using the token sent at signup.
export function verifyEmail(token: string): { ok: boolean; error?: string } {
  const data = load();
  const affiliate = Object.values(data.affiliates).find((a) => a.emailVerificationToken === token);
  if (!affiliate) return { ok: false, error: "Invalid or expired verification link." };
  affiliate.emailVerified = true;
  affiliate.emailVerificationToken = null;
  save(data);
  return { ok: true };
}

// Issue a 1-hour password reset token.
export function createPasswordResetToken(email: string): { token: string; affiliate: Affiliate } | { error: string } {
  const data = load();
  const id = data.emailToAffiliateId[email.trim().toLowerCase()];
  const affiliate = id ? data.affiliates[id] : undefined;
  if (!affiliate) {
    // Return a vague success-like message to prevent email enumeration.
    return { error: "not_found" };
  }
  const token = crypto.randomBytes(32).toString("hex");
  affiliate.passwordResetToken = token;
  affiliate.passwordResetExpiry = Date.now() + 60 * 60 * 1000; // 1 hour
  save(data);
  return { token, affiliate };
}

// Consume the reset token and set a new password.
export function resetPassword(token: string, newPassword: string): { ok: boolean; error?: string } {
  if (!newPassword || newPassword.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  const data = load();
  const affiliate = Object.values(data.affiliates).find(
    (a) => a.passwordResetToken === token && a.passwordResetExpiry && a.passwordResetExpiry > Date.now()
  );
  if (!affiliate) return { ok: false, error: "This reset link has expired or is invalid. Please request a new one." };
  const { hash, salt } = hashPassword(newPassword);
  affiliate.passwordHash = hash;
  affiliate.passwordSalt = salt;
  affiliate.passwordResetToken = null;
  affiliate.passwordResetExpiry = null;
  save(data);
  return { ok: true };
}

// Log a help request from an affiliate.
export function logHelpRequest(affiliateId: string, subject: string, message: string): { ok: boolean } {
  const data = load();
  if (!data.helpRequests) data.helpRequests = [];
  data.helpRequests.push({ affiliateId, subject, message, createdAt: new Date().toISOString() });
  save(data);
  return { ok: true };
}

export function loginAffiliate(
  email: string,
  password: string
): { token: string; affiliate: Affiliate } | { error: string; reason?: "unverified" } {
  const data = load();
  const id = data.emailToAffiliateId[email.trim().toLowerCase()];
  const affiliate = id ? data.affiliates[id] : undefined;
  if (!affiliate || !verifyPassword(password, affiliate.passwordHash, affiliate.passwordSalt)) {
    return { error: "Invalid email or password." };
  }
  // Hard gate: email must be verified before a session token is issued.
  // The password check above already ran, so this only blocks real account
  // owners who haven't clicked their verification link yet -- not a way to
  // probe which emails exist.
  if (!affiliate.emailVerified) {
    return { error: "Please verify your email before logging in. Check your inbox, or resend the link.", reason: "unverified" };
  }
  const token = crypto.randomBytes(32).toString("hex");
  data.sessions[token] = { affiliateId: affiliate.id, createdAt: new Date().toISOString() };
  save(data);
  return { token, affiliate };
}

// Re-issue a verification token for an affiliate who hasn't verified yet
// (e.g. they lost the original email or it expired/landed in spam).
// Always returns the same vague shape regardless of whether the email
// exists, to avoid leaking account existence.
export function resendVerification(email: string): { affiliate: Affiliate; token: string } | { error: string } {
  const data = load();
  const id = data.emailToAffiliateId[email.trim().toLowerCase()];
  const affiliate = id ? data.affiliates[id] : undefined;
  if (!affiliate) return { error: "not_found" };
  if (affiliate.emailVerified) return { error: "already_verified" };
  const token = affiliate.emailVerificationToken ?? crypto.randomBytes(32).toString("hex");
  affiliate.emailVerificationToken = token;
  save(data);
  return { affiliate, token };
}

export function affiliateFromToken(token: string | undefined | null): Affiliate | null {
  if (!token) return null;
  const data = load();
  const session = data.sessions[token];
  if (!session) return null;
  return data.affiliates[session.affiliateId] ?? null;
}

export function affiliateByCode(code: string): Affiliate | null {
  const data = load();
  const id = data.codeToAffiliateId[code];
  return id ? data.affiliates[id] ?? null : null;
}

// ---- Install / session-event attribution --------------------------------

export function attributeDevice(deviceId: string, referralCode: string, source: string): { ok: boolean; reason?: string } {
  const data = load();
  const affiliateId = data.codeToAffiliateId[referralCode];
  if (!affiliateId) return { ok: false, reason: "unknown_referral_code" };

  // First attribution for a device wins; a device re-reporting the same
  // (or a different) code later doesn't re-count as a fresh install.
  if (data.devices[deviceId]) return { ok: true };

  data.devices[deviceId] = { affiliateId, referralCode, source, attributedAt: new Date().toISOString() };

  const bucket = ensureBucket(data, affiliateId, todayISO());
  bucket.installs += 1;
  save(data);
  return { ok: true };
}

function ensureBucket(data: StoreData, affiliateId: string, date: string): DailyBucket {
  if (!data.dailyStats[affiliateId]) data.dailyStats[affiliateId] = {};
  if (!data.dailyStats[affiliateId][date]) {
    data.dailyStats[affiliateId][date] = {
      installs: 0,
      sessionsStarted: 0,
      sessionsCompleted: 0,
      paidUnlocks: 0,
      commissionINR: 0,
    };
  }
  return data.dailyStats[affiliateId][date];
}

export function recordSessionEvent(
  deviceId: string,
  outcome: "started" | "completed" | "paid_unlock",
  _amountPaid: number | null,
): { ok: boolean } {
  const data = load();
  const device = data.devices[deviceId];
  if (!device) return { ok: true }; // unattributed device -- nothing to credit, not an error

  const bucket = ensureBucket(data, device.affiliateId, todayISO());
  if (outcome === "started") bucket.sessionsStarted += 1;
  if (outcome === "completed") bucket.sessionsCompleted += 1;
  if (outcome === "paid_unlock") {
    bucket.paidUnlocks += 1;
    bucket.commissionINR = parseFloat((bucket.commissionINR + COMMISSION_PER_UNLOCK_INR).toFixed(2));
    const affiliate = data.affiliates[device.affiliateId];
    if (affiliate) {
      affiliate.totalEarningsINR = parseFloat((affiliate.totalEarningsINR + COMMISSION_PER_UNLOCK_INR).toFixed(2));
    }
  }
  save(data);
  return { ok: true };
}

// ---- Dashboard read model -------------------------------------------------

export function dashboardFor(affiliateId: string, days = 180) {
  const data = load();
  const affiliate = data.affiliates[affiliateId];
  if (!affiliate) return null;

  const buckets = data.dailyStats[affiliateId] ?? {};
  const dates: string[] = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }

  const revenueByDay = dates.map((date) => ({
    date,
    installs: buckets[date]?.installs ?? 0,
    sessionsStarted: buckets[date]?.sessionsStarted ?? 0,
    sessionsCompleted: buckets[date]?.sessionsCompleted ?? 0,
    paidUnlocks: buckets[date]?.paidUnlocks ?? 0,
    commissionINR: buckets[date]?.commissionINR ?? 0,
  }));

  const totals = revenueByDay.reduce(
    (acc, d) => ({
      installs: acc.installs + d.installs,
      sessionsStarted: acc.sessionsStarted + d.sessionsStarted,
      sessionsCompleted: acc.sessionsCompleted + d.sessionsCompleted,
      paidUnlocks: acc.paidUnlocks + d.paidUnlocks,
    }),
    { installs: 0, sessionsStarted: 0, sessionsCompleted: 0, paidUnlocks: 0 }
  );
  const failedSessions = Math.max(0, totals.sessionsStarted - totals.sessionsCompleted);

  const pendingINR = parseFloat((affiliate.totalEarningsINR - affiliate.paidOutINR).toFixed(2));
  const currencyKey = affiliate.currency?.toUpperCase() ?? "USD";
  const displayCurrency = PAYOUT_THRESHOLDS[currencyKey] ? currencyKey : "USD";
  const threshold = payoutThresholdFor(currencyKey);

  // Next settlement date: the 1st of next month -- payouts are monthly and
  // manual (Arpit pays out himself via UPI), this is just an informational
  // date shown on the dashboard, not something that triggers an automatic
  // transfer.
  // Built with Date.UTC rather than the local-timezone Date constructor --
  // the latter shifts the displayed date backward by a day whenever the
  // server's local timezone is ahead of UTC (confirmed bug: IST showed
  // Oct 31 for a "Nov 1" settlement date after the UTC round-trip).
  const now = new Date();
  const nextSettlement = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    affiliateName: affiliate.name,
    referralCode: affiliate.referralCode,
    currency: affiliate.currency,
    installs: totals.installs,
    sessionsStarted: totals.sessionsStarted,
    sessionsCompleted: totals.sessionsCompleted,
    failedSessions,
    paidUnlocks: totals.paidUnlocks,
    totalEarningsINR: affiliate.totalEarningsINR,
    paidOutINR: affiliate.paidOutINR,
    pendingINR,
    payoutThresholdDisplay: `${threshold} ${displayCurrency}`,
    // The real eligibility test always runs off the INR ledger anchor --
    // every currency row in PAYOUT_THRESHOLDS is just a round-number
    // *display* of the same ~$10 bar, not a separately FX-converted one.
    eligibleForPayout: pendingINR >= PAYOUT_THRESHOLDS["INR"],
    nextSettlementDate: nextSettlement.toISOString().slice(0, 10),
    revenueByDay,
  };
}

// ---- Admin: manual payout marking -----------------------------------------

export function markPaidOut(affiliateId: string, amountINR: number): { ok: boolean; reason?: string } {
  const data = load();
  const affiliate = data.affiliates[affiliateId];
  if (!affiliate) return { ok: false, reason: "not_found" };
  affiliate.paidOutINR = parseFloat((affiliate.paidOutINR + amountINR).toFixed(2));
  affiliate.lastSettlementAt = new Date().toISOString();
  save(data);
  return { ok: true };
}

// Admin-only: permanently remove an affiliate (and all their derived index
// entries). Used to clean up test/duplicate accounts -- there's no self-serve
// "delete my account" path, this is deliberately admin-gated only.
export function deleteAffiliate(affiliateId: string): { ok: boolean; reason?: string } {
  const data = load();
  const affiliate = data.affiliates[affiliateId];
  if (!affiliate) return { ok: false, reason: "not_found" };

  delete data.affiliates[affiliateId];
  delete data.codeToAffiliateId[affiliate.referralCode];
  delete data.emailToAffiliateId[affiliate.email];
  if (affiliate.phone && data.phoneToAffiliateId) delete data.phoneToAffiliateId[affiliate.phone];
  delete data.dailyStats[affiliateId];
  for (const [token, session] of Object.entries(data.sessions)) {
    if (session.affiliateId === affiliateId) delete data.sessions[token];
  }
  // Deliberately NOT touching data.devices: those rows record which affiliate
  // an install was attributed to at the time, a historical fact independent
  // of whether the affiliate account itself still exists.

  save(data);
  return { ok: true };
}

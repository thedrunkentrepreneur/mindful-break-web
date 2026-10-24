import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { loadSnapshotFromDb, persistSnapshotToDb } from "./db";

/**
 * Referral / affiliate ledger storage.
 *
 * Follows the same pattern as detox.ts's detox-stats.json: a flat JSON file
 * on disk, read-modify-write per request, no locking. That's an accepted
 * tradeoff at this project's current scale (see DEPLOY.md's "Data storage
 * caveat") -- fine for a side project's first real affiliates, not meant to
 * survive serious concurrent write traffic. Revisit with a real DB
 * (@workspace/db is already a workspace dependency) if this ever needs to.
 *
 * IMPORTANT KNOWN RISK (flagged, not silently ignored): Render's free tier
 * runs this on an EPHEMERAL disk -- every redeploy wipes this file. That is
 * fine for test traffic, but affiliate payout history (PayoutRecord[] below)
 * is financial record-keeping Arpit has explicitly asked be retained for the
 * lifetime of the affiliate (5+ years minimum). A flat JSON file on ephemeral
 * storage CANNOT honestly guarantee that. Treat migrating this store to a
 * real persistent DB (e.g. Neon Postgres, already discussed) as a pre-launch
 * blocker once real payouts start being recorded here, not a someday-item.
 */

const DATA_FILE = path.join(process.cwd(), "referral-data.json");

export const UNLOCK_FEE_INR = 49;
export const COMMISSION_PER_UNLOCK_INR = 20.8;

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

export type AffiliateStatus = "pending" | "approved" | "rejected";

export interface PayoutRecord {
  id: string;
  amountINR: number;
  paidAt: string;
  note: string;
  screenshotDataUrl: string | null;
  recordedAt: string;
}

export interface Affiliate {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  passwordSalt: string;
  phone: string;
  country: string;
  currency: string;
  promotionChannel: string;
  socialLinks: string[];
  payoutMethod: PayoutMethod;
  referralCode: string;
  createdAt: string;
  status: AffiliateStatus;
  totalEarningsINR: number;
  paidOutINR: number;
  lastSettlementAt: string | null;
  payouts: PayoutRecord[];
  emailVerified: boolean;
  emailVerificationToken: string | null;
  passwordResetToken: string | null;
  passwordResetExpiry: number | null;
}

export interface DailyBucket {
  installs: number;
  sessionsStarted: number;
  sessionsCompleted: number;
  paidUnlocks: number;
  commissionINR: number;
}

export interface AdminAccount {
  email: string;
  passwordHash: string;
  passwordSalt: string;
  passwordResetToken: string | null;
  passwordResetExpiry: number | null;
}

interface StoreData {
  affiliates: Record<string, Affiliate>;
  codeToAffiliateId: Record<string, string>;
  emailToAffiliateId: Record<string, string>;
  phoneToAffiliateId: Record<string, string>;
  devices: Record<string, { affiliateId: string; referralCode: string; source: string; attributedAt: string }>;
  dailyStats: Record<string, Record<string, DailyBucket>>;
  sessions: Record<string, { affiliateId: string; createdAt: string }>;
  helpRequests: Array<{ affiliateId: string; subject: string; message: string; createdAt: string }>;
  adminAccounts: Record<string, AdminAccount>;
  adminSessions: Record<string, { email: string; createdAt: string }>;
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
  adminAccounts: {},
  adminSessions: {},
};

function load(): StoreData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      return { ...EMPTY, ...JSON.parse(raw) };
    }
  } catch {
    // Corrupt or unreadable file -- fail safe to an empty store.
  }
  return structuredClone(EMPTY);
}

function save(data: StoreData) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch {
    // Best-effort, same as detox-stats.json.
  }
  // Fire-and-forget mirror to Postgres (no-op if DATABASE_URL unset) so
  // affiliate/payout data survives Render's ephemeral-disk redeploys --
  // see db.ts for details. Never awaited: must not slow down or risk
  // failing any of this file's existing synchronous call sites.
  persistSnapshotToDb(data);
}

/**
 * Called once at server boot, before the app starts accepting traffic (see
 * index.ts). If the local JSON file is missing -- the signature of a fresh
 * Render redeploy having just wiped the ephemeral disk -- restore it from
 * the last snapshot mirrored to Postgres. If the file already exists (e.g.
 * local dev, or a non-wiped disk), this intentionally does nothing: the
 * local file is treated as the freshest source of truth whenever present.
 */
export async function hydrateLocalFileFromDb(): Promise<void> {
  if (fs.existsSync(DATA_FILE)) return;
  const snapshot = await loadSnapshotFromDb();
  if (!snapshot) return;
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(snapshot, null, 2));
  } catch {
    // Best-effort; if this fails, load() below still falls back to EMPTY.
  }
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function normalizeAffiliate(a: Affiliate): Affiliate {
  return {
    ...a,
    status: a.status ?? "approved",
    socialLinks: a.socialLinks ?? [],
    payouts: a.payouts ?? [],
  };
}

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
  return `AFF${crypto.randomBytes(6).toString("hex").toUpperCase()}`;
}

function sanitizeSocialLinks(links: unknown): string[] {
  if (!Array.isArray(links)) return [];
  return links
    .filter((l): l is string => typeof l === "string")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .slice(0, 3)
    .map((l) => l.slice(0, 300));
}

export function createAffiliate(input: {
  name: string;
  email: string;
  password: string;
  phone: string;
  country: string;
  currency: string;
  promotionChannel?: string;
  socialLinks?: unknown;
  payoutMethod: PayoutMethod;
}): { affiliate: Affiliate; verificationToken: string } | { error: string } {
  const email = input.email.trim().toLowerCase();
  if (!email || !input.password || input.password.length < 8) {
    return { error: "Email and a password of at least 8 characters are required." };
  }
  if (!input.promotionChannel || !input.promotionChannel.trim()) {
    return { error: "Please select how you'll promote the app." };
  }
  const data = load();
  if (data.emailToAffiliateId[email]) {
    return { error: "An affiliate account with this email already exists." };
  }
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
    socialLinks: sanitizeSocialLinks(input.socialLinks),
    payoutMethod: input.payoutMethod,
    referralCode,
    createdAt: new Date().toISOString(),
    status: "pending",
    totalEarningsINR: 0,
    paidOutINR: 0,
    lastSettlementAt: null,
    payouts: [],
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

export function verifyEmail(token: string): { ok: boolean; error?: string } {
  const data = load();
  const affiliate = Object.values(data.affiliates).find((a) => a.emailVerificationToken === token);
  if (!affiliate) return { ok: false, error: "Invalid or expired verification link." };
  affiliate.emailVerified = true;
  affiliate.emailVerificationToken = null;
  save(data);
  return { ok: true };
}

export function createPasswordResetToken(email: string): { token: string; affiliate: Affiliate } | { error: string } {
  const data = load();
  const id = data.emailToAffiliateId[email.trim().toLowerCase()];
  const affiliate = id ? data.affiliates[id] : undefined;
  if (!affiliate) {
    return { error: "not_found" };
  }
  const token = crypto.randomBytes(32).toString("hex");
  affiliate.passwordResetToken = token;
  affiliate.passwordResetExpiry = Date.now() + 60 * 60 * 1000;
  save(data);
  return { token, affiliate };
}

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
): { token: string; affiliate: Affiliate } | { error: string; reason?: "unverified" | "pending_approval" | "rejected" } {
  const data = load();
  const id = data.emailToAffiliateId[email.trim().toLowerCase()];
  const rawAffiliate = id ? data.affiliates[id] : undefined;
  if (!rawAffiliate || !verifyPassword(password, rawAffiliate.passwordHash, rawAffiliate.passwordSalt)) {
    return { error: "Invalid email or password." };
  }
  const affiliate = normalizeAffiliate(rawAffiliate);
  if (!affiliate.emailVerified) {
    return { error: "Please verify your email before logging in. Check your inbox, or resend the link.", reason: "unverified" };
  }
  if (affiliate.status === "pending") {
    return {
      error: "Your affiliate account is awaiting approval. We'll email you once it's reviewed.",
      reason: "pending_approval",
    };
  }
  if (affiliate.status === "rejected") {
    return {
      error: "This affiliate application was not approved. Contact digitox007@gmail.com with questions.",
      reason: "rejected",
    };
  }
  const token = crypto.randomBytes(32).toString("hex");
  data.sessions[token] = { affiliateId: affiliate.id, createdAt: new Date().toISOString() };
  save(data);
  return { token, affiliate };
}

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
  const affiliate = data.affiliates[session.affiliateId];
  return affiliate ? normalizeAffiliate(affiliate) : null;
}

export function lookupAttribution(deviceId: string): { referralCode: string; source: string } | null {
  const data = load();
  const device = data.devices[deviceId];
  if (!device) return null;
  return { referralCode: device.referralCode, source: device.source };
}

export function affiliateByCode(code: string): Affiliate | null {
  const data = load();
  const id = data.codeToAffiliateId[code];
  return id ? data.affiliates[id] ?? null : null;
}

export function attributeDevice(deviceId: string, referralCode: string, source: string): { ok: boolean; reason?: string } {
  const data = load();
  const affiliateId = data.codeToAffiliateId[referralCode];
  if (!affiliateId) return { ok: false, reason: "unknown_referral_code" };

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
  if (!device) return { ok: true };

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

interface AffiliateStats {
  installs: number;
  sessionsStarted: number;
  sessionsCompleted: number;
  failedSessions: number;
  paidUnlocks: number;
  revenueByDay: Array<{
    date: string;
    installs: number;
    sessionsStarted: number;
    sessionsCompleted: number;
    paidUnlocks: number;
    commissionINR: number;
  }>;
}

// Extracted out of dashboardFor() so the admin dashboard's per-affiliate
// rows use the exact same (bug-fixed) math as the affiliate's own view.
//
// BUG FIX (2026-10-22, reported by Arpit: "it recorded a failed session
// even while the session was running and not closed"):
//
// The old formula was `sessionsStarted - sessionsCompleted` summed across
// ALL days, which had two real bugs:
//   1. A session started today, still running, with no terminal event sent
//      yet, was immediately counted as "failed" the instant it started --
//      before it had any chance to resolve. This is exactly the symptom
//      Arpit saw.
//   2. A "paid_unlock" session (the best outcome -- user paid to unlock
//      early) never fires a "completed" event, only "paid_unlock". The old
//      formula only ever subtracted sessionsCompleted, so every paid
//      unlock was ALSO being miscounted as a failure.
//
// Fix: (a) skip the most recent 2 calendar days entirely when tallying
// failures -- a grace window safely longer than any realistic focus-session
// duration, so an in-progress session is never presumed failed; (b)
// subtract BOTH sessionsCompleted and paidUnlocks from sessionsStarted.
function computeAffiliateStats(data: StoreData, affiliateId: string, days: number): AffiliateStats {
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

  const graceCutoff = new Date(today);
  graceCutoff.setDate(graceCutoff.getDate() - 2);
  const graceCutoffISO = graceCutoff.toISOString().slice(0, 10);

  let failedSessions = 0;
  for (const d of revenueByDay) {
    if (d.date > graceCutoffISO) continue;
    failedSessions += Math.max(0, d.sessionsStarted - d.sessionsCompleted - d.paidUnlocks);
  }

  return {
    installs: totals.installs,
    sessionsStarted: totals.sessionsStarted,
    sessionsCompleted: totals.sessionsCompleted,
    failedSessions,
    paidUnlocks: totals.paidUnlocks,
    revenueByDay,
  };
}

export function dashboardFor(affiliateId: string, days = 180) {
  const data = load();
  const rawAffiliate = data.affiliates[affiliateId];
  if (!rawAffiliate) return null;
  const affiliate = normalizeAffiliate(rawAffiliate);

  const stats = computeAffiliateStats(data, affiliateId, days);

  const pendingINR = parseFloat((affiliate.totalEarningsINR - affiliate.paidOutINR).toFixed(2));
  const currencyKey = affiliate.currency?.toUpperCase() ?? "USD";
  const displayCurrency = PAYOUT_THRESHOLDS[currencyKey] ? currencyKey : "USD";
  const threshold = payoutThresholdFor(currencyKey);

  const now = new Date();
  const nextSettlement = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  const lastPayoutRecord = affiliate.payouts.length ? affiliate.payouts[affiliate.payouts.length - 1] : null;

  return {
    affiliateName: affiliate.name,
    referralCode: affiliate.referralCode,
    currency: affiliate.currency,
    installs: stats.installs,
    sessionsStarted: stats.sessionsStarted,
    sessionsCompleted: stats.sessionsCompleted,
    failedSessions: stats.failedSessions,
    paidUnlocks: stats.paidUnlocks,
    totalEarningsINR: affiliate.totalEarningsINR,
    paidOutINR: affiliate.paidOutINR,
    pendingINR,
    payoutThresholdDisplay: `${threshold} ${displayCurrency}`,
    eligibleForPayout: pendingINR >= PAYOUT_THRESHOLDS["INR"],
    nextSettlementDate: nextSettlement.toISOString().slice(0, 10),
    revenueByDay: stats.revenueByDay,
    lastSettlementAt: affiliate.lastSettlementAt,
    lastPayout: lastPayoutRecord
      ? { amountINR: lastPayoutRecord.amountINR, paidAt: lastPayoutRecord.paidAt, note: lastPayoutRecord.note }
      : null,
  };
}

export function markPaidOut(affiliateId: string, amountINR: number): { ok: boolean; reason?: string } {
  const data = load();
  const affiliate = data.affiliates[affiliateId];
  if (!affiliate) return { ok: false, reason: "not_found" };
  affiliate.paidOutINR = parseFloat((affiliate.paidOutINR + amountINR).toFixed(2));
  affiliate.lastSettlementAt = new Date().toISOString();
  save(data);
  return { ok: true };
}

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

  save(data);
  return { ok: true };
}

// =====================================================================
// ---- Admin accounts (Arpit's own login, separate from affiliates) ----
// =====================================================================

export const ADMIN_EMAILS = ["digitox007@gmail.com", "arpitagrawal131@gmail.com"];
const DEFAULT_ADMIN_PASSWORD = "Digitox@2026!";

export function seedAdminAccounts(): void {
  const data = load();
  let changed = false;
  for (const email of ADMIN_EMAILS) {
    if (!data.adminAccounts[email]) {
      const { hash, salt } = hashPassword(DEFAULT_ADMIN_PASSWORD);
      data.adminAccounts[email] = {
        email,
        passwordHash: hash,
        passwordSalt: salt,
        passwordResetToken: null,
        passwordResetExpiry: null,
      };
      changed = true;
    }
  }
  if (changed) save(data);
}

export function loginAdmin(email: string, password: string): { token: string; email: string } | { error: string } {
  const data = load();
  const account = data.adminAccounts[email.trim().toLowerCase()];
  if (!account || !verifyPassword(password, account.passwordHash, account.passwordSalt)) {
    return { error: "Invalid email or password." };
  }
  const token = crypto.randomBytes(32).toString("hex");
  data.adminSessions[token] = { email: account.email, createdAt: new Date().toISOString() };
  save(data);
  return { token, email: account.email };
}

export function adminFromToken(token: string | undefined | null): { email: string } | null {
  if (!token) return null;
  const data = load();
  const session = data.adminSessions[token];
  if (!session) return null;
  return data.adminAccounts[session.email] ? { email: session.email } : null;
}

export function changeAdminPassword(
  email: string,
  currentPassword: string,
  newPassword: string
): { ok: boolean; error?: string } {
  if (!newPassword || newPassword.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  const data = load();
  const account = data.adminAccounts[email.trim().toLowerCase()];
  if (!account || !verifyPassword(currentPassword, account.passwordHash, account.passwordSalt)) {
    return { ok: false, error: "Current password is incorrect." };
  }
  const { hash, salt } = hashPassword(newPassword);
  account.passwordHash = hash;
  account.passwordSalt = salt;
  save(data);
  return { ok: true };
}

export function createAdminPasswordResetToken(email: string): { token: string } | { error: string } {
  const data = load();
  const account = data.adminAccounts[email.trim().toLowerCase()];
  if (!account) return { error: "not_found" };
  const token = crypto.randomBytes(32).toString("hex");
  account.passwordResetToken = token;
  account.passwordResetExpiry = Date.now() + 60 * 60 * 1000;
  save(data);
  return { token };
}

export function resetAdminPassword(token: string, newPassword: string): { ok: boolean; error?: string } {
  if (!newPassword || newPassword.length < 8) return { ok: false, error: "Password must be at least 8 characters." };
  const data = load();
  const account = Object.values(data.adminAccounts).find(
    (a) => a.passwordResetToken === token && a.passwordResetExpiry && a.passwordResetExpiry > Date.now()
  );
  if (!account) return { ok: false, error: "This reset link has expired or is invalid. Please request a new one." };
  const { hash, salt } = hashPassword(newPassword);
  account.passwordHash = hash;
  account.passwordSalt = salt;
  account.passwordResetToken = null;
  account.passwordResetExpiry = null;
  save(data);
  return { ok: true };
}

// =====================================================================
// ---- Admin data views: approvals, overview, per-affiliate detail -----
// =====================================================================

export interface AdminAffiliateRow {
  id: string;
  name: string;
  email: string;
  phone: string;
  country: string;
  currency: string;
  status: AffiliateStatus;
  referralCode: string;
  promotionChannel: string;
  socialLinks: string[];
  payoutMethod: PayoutMethod;
  createdAt: string;
  emailVerified: boolean;
  installs: number;
  sessionsStarted: number;
  sessionsCompleted: number;
  failedSessions: number;
  paidUnlocks: number;
  totalEarningsINR: number;
  paidOutINR: number;
  pendingINR: number;
  lastSettlementAt: string | null;
  lastPayout: { amountINR: number; paidAt: string; note: string } | null;
}

function toAdminRow(data: StoreData, affiliateId: string): AdminAffiliateRow {
  const affiliate = normalizeAffiliate(data.affiliates[affiliateId]);
  const stats = computeAffiliateStats(data, affiliateId, 36500);
  const pendingINR = parseFloat((affiliate.totalEarningsINR - affiliate.paidOutINR).toFixed(2));
  const lastPayoutRecord = affiliate.payouts.length ? affiliate.payouts[affiliate.payouts.length - 1] : null;
  return {
    id: affiliate.id,
    name: affiliate.name,
    email: affiliate.email,
    phone: affiliate.phone,
    country: affiliate.country,
    currency: affiliate.currency,
    status: affiliate.status,
    referralCode: affiliate.referralCode,
    promotionChannel: affiliate.promotionChannel,
    socialLinks: affiliate.socialLinks,
    payoutMethod: affiliate.payoutMethod,
    createdAt: affiliate.createdAt,
    emailVerified: affiliate.emailVerified,
    installs: stats.installs,
    sessionsStarted: stats.sessionsStarted,
    sessionsCompleted: stats.sessionsCompleted,
    failedSessions: stats.failedSessions,
    paidUnlocks: stats.paidUnlocks,
    totalEarningsINR: affiliate.totalEarningsINR,
    paidOutINR: affiliate.paidOutINR,
    pendingINR,
    lastSettlementAt: affiliate.lastSettlementAt,
    lastPayout: lastPayoutRecord
      ? { amountINR: lastPayoutRecord.amountINR, paidAt: lastPayoutRecord.paidAt, note: lastPayoutRecord.note }
      : null,
  };
}

export function listAffiliatesForAdmin(): AdminAffiliateRow[] {
  const data = load();
  return Object.keys(data.affiliates)
    .map((id) => toAdminRow(data, id))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function affiliateDetailForAdmin(affiliateId: string): (AdminAffiliateRow & { payouts: PayoutRecord[] }) | null {
  const data = load();
  if (!data.affiliates[affiliateId]) return null;
  const row = toAdminRow(data, affiliateId);
  const affiliate = normalizeAffiliate(data.affiliates[affiliateId]);
  return { ...row, payouts: affiliate.payouts };
}

export function adminOverview() {
  const rows = listAffiliatesForAdmin();
  return rows.reduce(
    (acc, r) => ({
      totalAffiliates: acc.totalAffiliates + 1,
      pendingApprovals: acc.pendingApprovals + (r.status === "pending" ? 1 : 0),
      approved: acc.approved + (r.status === "approved" ? 1 : 0),
      rejected: acc.rejected + (r.status === "rejected" ? 1 : 0),
      installs: acc.installs + r.installs,
      sessionsStarted: acc.sessionsStarted + r.sessionsStarted,
      sessionsCompleted: acc.sessionsCompleted + r.sessionsCompleted,
      failedSessions: acc.failedSessions + r.failedSessions,
      paidUnlocks: acc.paidUnlocks + r.paidUnlocks,
      totalEarningsINR: parseFloat((acc.totalEarningsINR + r.totalEarningsINR).toFixed(2)),
      paidOutINR: parseFloat((acc.paidOutINR + r.paidOutINR).toFixed(2)),
      pendingINR: parseFloat((acc.pendingINR + r.pendingINR).toFixed(2)),
    }),
    {
      totalAffiliates: 0,
      pendingApprovals: 0,
      approved: 0,
      rejected: 0,
      installs: 0,
      sessionsStarted: 0,
      sessionsCompleted: 0,
      failedSessions: 0,
      paidUnlocks: 0,
      totalEarningsINR: 0,
      paidOutINR: 0,
      pendingINR: 0,
    }
  );
}

export function setAffiliateStatus(affiliateId: string, status: AffiliateStatus): { ok: boolean; reason?: string } {
  const data = load();
  const affiliate = data.affiliates[affiliateId];
  if (!affiliate) return { ok: false, reason: "not_found" };
  affiliate.status = status;
  save(data);
  return { ok: true };
}

export function recordPayout(
  affiliateId: string,
  input: { amountINR: number; paidAt: string; note: string; screenshotDataUrl: string | null }
): { ok: boolean; reason?: string } {
  const data = load();
  const affiliate = data.affiliates[affiliateId];
  if (!affiliate) return { ok: false, reason: "not_found" };
  if (!input.amountINR || input.amountINR <= 0) return { ok: false, reason: "invalid_amount" };

  if (!affiliate.payouts) affiliate.payouts = [];
  const record: PayoutRecord = {
    id: crypto.randomUUID(),
    amountINR: input.amountINR,
    paidAt: input.paidAt || new Date().toISOString().slice(0, 10),
    note: input.note ?? "",
    screenshotDataUrl: input.screenshotDataUrl ?? null,
    recordedAt: new Date().toISOString(),
  };
  affiliate.payouts.push(record);
  affiliate.paidOutINR = parseFloat((affiliate.paidOutINR + input.amountINR).toFixed(2));
  affiliate.lastSettlementAt = record.recordedAt;
  save(data);
  return { ok: true };
}

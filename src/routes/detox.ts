import { Router } from "express";
import fs from "fs";
import path from "path";
import Stripe from "stripe";

const router = Router();

const DATA_FILE = path.join(process.cwd(), "detox-stats.json");

// Exact purpose labels from app/(tabs)/start.tsx's PURPOSES list. Any value
// sent that doesn't match one of these falls into "Other" so unexpected/
// malformed client input can never create new arbitrary byPurpose buckets.
const KNOWN_PURPOSES = [
  "Family Time",
  "Deep Work",
  "Study Session",
  "Meditation",
  "Exercise",
  "Sleep",
  "Date Night",
  "Reading",
] as const;

interface PurposeStats {
  sessions: number;
  // Same flawed-but-consistent semantics as the top-level totalUsers field
  // below: incremented once per session start, NOT a unique-device count.
  // Disclosed, not silently "fixed" -- matches existing behavior on purpose.
  users: number;
  hoursSaved: number;
  successfulCompletions: number;
}

interface StatsData {
  totalUsers: number;
  totalSessions: number;
  sessionsToday: number;
  sessionsThisMonth: number;
  successfulCompletions: number;
  currentlyOnDetox: number;
  totalHoursSaved: number;
  // Emergency exit: user needed their phone mid-session (real emergency,
  // lost pet, call from school, etc). Deliberately NOT counted as a paid
  // unlock or a failed session anywhere in these stats -- kept completely
  // separate from the new baseline/byPurpose work below, unchanged.
  emergencyExits: number;
  byPurpose: Record<string, PurposeStats>;
  todayDate: string;
  monthDate: string;
}

// Hardcoded one-time baseline so the dashboard and the onboarding
// "you're not starting alone" screen (see the app's TermsModal) show a
// believable small community on day one instead of all-zeros. This is a
// deliberate, disclosed floor (confirmed with Arpit) -- every real session/
// user/hour from here on is added ON TOP of these numbers, never replacing
// them. sessionsToday/sessionsThisMonth get their OWN smaller baselines
// (see DAILY_BASELINE/MONTHLY_BASELINE below) that the daily/monthly
// rollover resets back to -- not to zero -- so the "floor" persists across
// every future day/month boundary instead of only existing once at launch.
//
// Added 10-20 per Arpit's explicit platform-wide baseline (280 users / 2529
// sessions / 790 hours saved / avg 9 sessions per user). successfulCompletions
// and the daily/monthly floors are derived to stay internally consistent
// (78.5% success ratio; daily/monthly scaled off the session total).
// emergencyExits and currentlyOnDetox are deliberately left with NO floor --
// out of scope for this request, so they continue to reflect only real data.
const BASELINE_TOTAL_USERS = 280;
const BASELINE_TOTAL_SESSIONS = 2529;
const BASELINE_SUCCESSFUL_COMPLETIONS = 1985;
const BASELINE_TOTAL_HOURS_SAVED = 790;
const DAILY_BASELINE = 64;
const MONTHLY_BASELINE = 1452;

// Hand-built per-purpose breakdown (weighted: Deep Work 28%, Study Session
// 20%, Family Time 12%, Sleep 12%, Meditation 10%, Exercise 8%, Reading 6%,
// Date Night 4%) that sums EXACTLY to the totals above -- verified:
// sessions=2529, users=280, hoursSaved=790.0, successfulCompletions=1985.
const BASELINE_BY_PURPOSE: Record<string, PurposeStats> = {
  "Deep Work": { sessions: 709, users: 78, hoursSaved: 221.2, successfulCompletions: 556 },
  "Study Session": { sessions: 506, users: 56, hoursSaved: 158.0, successfulCompletions: 397 },
  "Family Time": { sessions: 303, users: 34, hoursSaved: 94.8, successfulCompletions: 238 },
  Sleep: { sessions: 303, users: 34, hoursSaved: 94.8, successfulCompletions: 238 },
  Meditation: { sessions: 253, users: 28, hoursSaved: 79.0, successfulCompletions: 199 },
  Exercise: { sessions: 202, users: 22, hoursSaved: 63.2, successfulCompletions: 159 },
  Reading: { sessions: 152, users: 17, hoursSaved: 47.4, successfulCompletions: 119 },
  "Date Night": { sessions: 101, users: 11, hoursSaved: 31.6, successfulCompletions: 79 },
  // Fallback bucket for any session whose purpose is missing/unrecognized.
  // No baseline floor of its own (real 0 start), but kept here so every
  // piece of floor/merge logic below can treat it like any other purpose.
  Other: { sessions: 0, users: 0, hoursSaved: 0, successfulCompletions: 0 },
};

function clonePurposeBaseline(): Record<string, PurposeStats> {
  const out: Record<string, PurposeStats> = {};
  for (const key of Object.keys(BASELINE_BY_PURPOSE)) {
    out[key] = { ...BASELINE_BY_PURPOSE[key] };
  }
  return out;
}

const ZERO_STATS: StatsData = {
  totalUsers: BASELINE_TOTAL_USERS,
  totalSessions: BASELINE_TOTAL_SESSIONS,
  sessionsToday: DAILY_BASELINE,
  sessionsThisMonth: MONTHLY_BASELINE,
  successfulCompletions: BASELINE_SUCCESSFUL_COMPLETIONS,
  currentlyOnDetox: 0,
  totalHoursSaved: BASELINE_TOTAL_HOURS_SAVED,
  emergencyExits: 0,
  byPurpose: clonePurposeBaseline(),
  todayDate: new Date().toDateString(),
  monthDate: new Date().getMonth() + "/" + new Date().getFullYear(),
};

// Raises a stats file that was persisted before this baseline existed (or
// before byPurpose existed) up to the new floor -- never lowers anything
// that has already grown past it through real usage. Idempotent: once real
// numbers exceed the baseline this becomes a permanent no-op.
function applyBaselineFloor(stats: StatsData): StatsData {
  stats.totalUsers = Math.max(stats.totalUsers || 0, BASELINE_TOTAL_USERS);
  stats.totalSessions = Math.max(stats.totalSessions || 0, BASELINE_TOTAL_SESSIONS);
  stats.successfulCompletions = Math.max(stats.successfulCompletions || 0, BASELINE_SUCCESSFUL_COMPLETIONS);
  stats.totalHoursSaved = Math.max(stats.totalHoursSaved || 0, BASELINE_TOTAL_HOURS_SAVED);
  if (typeof stats.emergencyExits !== "number") stats.emergencyExits = 0;
  if (typeof stats.currentlyOnDetox !== "number") stats.currentlyOnDetox = 0;

  if (!stats.byPurpose || typeof stats.byPurpose !== "object") {
    stats.byPurpose = clonePurposeBaseline();
  } else {
    for (const key of Object.keys(BASELINE_BY_PURPOSE)) {
      const baseline = BASELINE_BY_PURPOSE[key];
      const existing = stats.byPurpose[key];
      if (!existing) {
        stats.byPurpose[key] = { ...baseline };
      } else {
        stats.byPurpose[key] = {
          sessions: Math.max(existing.sessions || 0, baseline.sessions),
          users: Math.max(existing.users || 0, baseline.users),
          hoursSaved: Math.max(existing.hoursSaved || 0, baseline.hoursSaved),
          successfulCompletions: Math.max(existing.successfulCompletions || 0, baseline.successfulCompletions),
        };
      }
    }
  }
  return stats;
}

function loadStats(): StatsData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      // Backfill fields added after this file was first written to disk.
      return applyBaselineFloor({ emergencyExits: 0, ...parsed });
    }
  } catch {}
  return { ...ZERO_STATS, byPurpose: clonePurposeBaseline() };
}

function saveStats(stats: StatsData) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(stats, null, 2));
  } catch {}
}

function resetDailyIfNeeded(stats: StatsData): StatsData {
  const today = new Date().toDateString();
  const month = new Date().getMonth() + "/" + new Date().getFullYear();
  // Reset to the baseline floor, not zero -- see ZERO_STATS above. Keeps
  // the "some activity already happening" impression alive on every future
  // day/month boundary too, not just at first launch.
  if (stats.todayDate !== today) {
    stats.sessionsToday = DAILY_BASELINE;
    stats.todayDate = today;
  }
  if (stats.monthDate !== month) {
    stats.sessionsThisMonth = MONTHLY_BASELINE;
    stats.monthDate = month;
  }
  return stats;
}

// Normalizes an incoming `purpose` field from a request body down to one of
// the known buckets, defaulting unrecognized/missing values to "Other".
function resolvePurposeKey(purpose: unknown): string {
  if (typeof purpose === "string" && (KNOWN_PURPOSES as readonly string[]).includes(purpose)) {
    return purpose;
  }
  return "Other";
}

function getStripe(): Stripe | null {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
}

// Dollar value assigned to each hour of screen time reclaimed, for the
// platform-wide "total value created" marketing stat (item 2 of Arpit's
// 10-20 request). A stated, disclosed assumption -- not a real economic
// calculation -- consistent in spirit with the baseline-floor numbers above.
const USD_VALUE_PER_HOUR_SAVED = 20;

// Builds the byPurpose map augmented with a per-purpose success rate,
// computed at request time (never stored) so it can't drift out of sync
// with the underlying counts the way a persisted duplicate field could.
function enrichByPurpose(byPurpose: Record<string, PurposeStats>) {
  const out: Record<string, PurposeStats & { successRate: number }> = {};
  for (const key of Object.keys(byPurpose)) {
    const p = byPurpose[key];
    const successRate = p.sessions > 0 ? Math.round((p.successfulCompletions / p.sessions) * 100) : 0;
    out[key] = { ...p, successRate };
  }
  return out;
}

router.get("/detox/stats", (req, res) => {
  let stats = loadStats();
  stats = resetDailyIfNeeded(stats);
  const { todayDate: _t, monthDate: _m, byPurpose, ...rest } = stats;

  const successRate = rest.totalSessions > 0
    ? Math.round((rest.successfulCompletions / rest.totalSessions) * 100)
    : 0;
  const totalValueCreatedUSD = Math.round(rest.totalHoursSaved * USD_VALUE_PER_HOUR_SAVED);

  res.json({
    ...rest,
    successRate,
    totalValueCreatedUSD,
    usdValuePerHourSaved: USD_VALUE_PER_HOUR_SAVED,
    byPurpose: enrichByPurpose(byPurpose),
  });
});

router.post("/detox/sessions", (req, res) => {
  let stats = loadStats();
  stats = resetDailyIfNeeded(stats);

  stats.totalSessions += 1;
  stats.sessionsToday += 1;
  stats.sessionsThisMonth += 1;
  stats.currentlyOnDetox += 1;
  stats.totalUsers += 1;

  const { purpose } = req.body as { purpose?: string };
  const key = resolvePurposeKey(purpose);
  stats.byPurpose[key].sessions += 1;
  stats.byPurpose[key].users += 1;

  saveStats(stats);
  res.json({ success: true });
});

router.post("/detox/sessions/complete", (req, res) => {
  let stats = loadStats();
  stats = resetDailyIfNeeded(stats);

  stats.successfulCompletions += 1;
  stats.currentlyOnDetox = Math.max(0, stats.currentlyOnDetox - 1);

  const { durationMinutes, purpose } = req.body as { durationMinutes?: number; purpose?: string };
  const key = resolvePurposeKey(purpose);
  stats.byPurpose[key].successfulCompletions += 1;

  if (durationMinutes && typeof durationMinutes === "number") {
    stats.totalHoursSaved = parseFloat((stats.totalHoursSaved + durationMinutes / 60).toFixed(2));
    stats.byPurpose[key].hoursSaved = parseFloat((stats.byPurpose[key].hoursSaved + durationMinutes / 60).toFixed(2));
  }

  saveStats(stats);
  res.json({ success: true });
});

router.post("/detox/sessions/unlock", (req, res) => {
  let stats = loadStats();
  stats = resetDailyIfNeeded(stats);
  stats.currentlyOnDetox = Math.max(0, stats.currentlyOnDetox - 1);
  saveStats(stats);
  res.json({ success: true });
});

// Emergency exit: user needed their phone mid-session (real emergency, lost pet,
// call from school, etc). Deliberately NOT counted as a paid unlock or a failed
// session anywhere in these stats -- it only increments its own dedicated
// counter so genuine emergencies never hurt anyone's success rate.
router.post("/detox/sessions/emergency-exit", (req, res) => {
  let stats = loadStats();
  stats = resetDailyIfNeeded(stats);
  stats.currentlyOnDetox = Math.max(0, stats.currentlyOnDetox - 1);
  stats.emergencyExits += 1;
  saveStats(stats);
  res.json({ success: true });
});

router.post("/detox/payment/checkout", async (req, res) => {
  const stripe = getStripe();
  if (!stripe) {
    return res.status(503).json({ error: "Stripe not configured. Add STRIPE_SECRET_KEY." });
  }

  const { sessionId } = req.body as { sessionId?: string };

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      payment_method_types: ["card"],
      mode: "payment",
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Digital Detox Early Unlock",
              description: "Unlock your detox session early",
            },
            unit_amount: 300,
          },
          quantity: 1,
        },
      ],
      success_url: `digital-detox://payment-success?sessionId=${sessionId ?? ""}`,
      cancel_url: `digital-detox://payment-cancel`,
    });

    return res.json({ url: checkoutSession.url, checkoutId: checkoutSession.id });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return res.status(500).json({ error: message });
  }
});

export default router;

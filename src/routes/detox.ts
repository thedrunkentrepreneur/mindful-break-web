import { Router } from "express";
import fs from "fs";
import path from "path";
import Stripe from "stripe";

const router = Router();

const DATA_FILE = path.join(process.cwd(), "detox-stats.json");

interface StatsData {
  totalUsers: number;
  totalSessions: number;
  sessionsToday: number;
  sessionsThisMonth: number;
  successfulCompletions: number;
  currentlyOnDetox: number;
  totalHoursSaved: number;
  emergencyExits: number;
  todayDate: string;
  monthDate: string;
}

const ZERO_STATS: StatsData = {
  totalUsers: 0,
  totalSessions: 0,
  sessionsToday: 0,
  sessionsThisMonth: 0,
  successfulCompletions: 0,
  currentlyOnDetox: 0,
  totalHoursSaved: 0,
  emergencyExits: 0,
  todayDate: new Date().toDateString(),
  monthDate: new Date().getMonth() + "/" + new Date().getFullYear(),
};

function loadStats(): StatsData {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf-8");
      const parsed = JSON.parse(raw);
      // Backfill fields added after this file was first written to disk.
      return { emergencyExits: 0, ...parsed };
    }
  } catch {}
  return { ...ZERO_STATS };
}

function saveStats(stats: StatsData) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(stats, null, 2));
  } catch {}
}

function resetDailyIfNeeded(stats: StatsData): StatsData {
  const today = new Date().toDateString();
  const month = new Date().getMonth() + "/" + new Date().getFullYear();
  if (stats.todayDate !== today) {
    stats.sessionsToday = 0;
    stats.todayDate = today;
  }
  if (stats.monthDate !== month) {
    stats.sessionsThisMonth = 0;
    stats.monthDate = month;
  }
  return stats;
}

function getStripe(): Stripe | null {
  const key = process.env["STRIPE_SECRET_KEY"];
  if (!key) return null;
  return new Stripe(key, { apiVersion: "2026-04-22.dahlia" });
}

router.get("/detox/stats", (req, res) => {
  let stats = loadStats();
  stats = resetDailyIfNeeded(stats);
  const { todayDate: _t, monthDate: _m, ...publicStats } = stats;
  res.json(publicStats);
});

router.post("/detox/sessions", (req, res) => {
  let stats = loadStats();
  stats = resetDailyIfNeeded(stats);

  stats.totalSessions += 1;
  stats.sessionsToday += 1;
  stats.sessionsThisMonth += 1;
  stats.currentlyOnDetox += 1;
  stats.totalUsers += 1;

  saveStats(stats);
  res.json({ success: true });
});

router.post("/detox/sessions/complete", (req, res) => {
  let stats = loadStats();
  stats = resetDailyIfNeeded(stats);

  stats.successfulCompletions += 1;
  stats.currentlyOnDetox = Math.max(0, stats.currentlyOnDetox - 1);

  const { durationMinutes } = req.body as { durationMinutes?: number };
  if (durationMinutes && typeof durationMinutes === "number") {
    stats.totalHoursSaved = parseFloat((stats.totalHoursSaved + durationMinutes / 60).toFixed(2));
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

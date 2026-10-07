import { Router, type IRouter } from "express";
import { attributeDevice, recordSessionEvent } from "../lib/referralStore";

const router: IRouter = Router();

// Called once per device install, right after the app resolves a Play
// Install Referrer link (or a manually typed code) -- see the app's
// lib/referral.ts. Unknown codes are reported back as a non-fatal "ok: true,
// not credited" so a typo in a code never shows the end user an error.
router.post("/referral/attribute", (req, res) => {
  const { deviceId, referralCode, source } = req.body as {
    deviceId?: string;
    referralCode?: string;
    source?: string;
  };
  if (!deviceId || !referralCode) {
    return res.status(400).json({ error: "deviceId and referralCode are required." });
  }
  const result = attributeDevice(deviceId, referralCode, source ?? "unknown");
  return res.json({ ok: true, credited: result.ok });
});

// Called on every session-started / session-completed / paid-unlock event.
// Safe no-op (still 200) for a device with no attribution -- raw app stats
// don't depend on referrals, only the affiliate commission math does.
router.post("/referral/session-event", (req, res) => {
  const { deviceId, outcome, amountPaid } = req.body as {
    deviceId?: string;
    referralCode?: string | null;
    outcome?: "started" | "completed" | "paid_unlock";
    amountPaid?: number | null;
  };
  if (!deviceId || !outcome) {
    return res.status(400).json({ error: "deviceId and outcome are required." });
  }
  recordSessionEvent(deviceId, outcome, amountPaid ?? null);
  return res.json({ ok: true });
});

export default router;

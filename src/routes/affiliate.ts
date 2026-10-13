import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  createAffiliate,
  loginAffiliate,
  affiliateFromToken,
  dashboardFor,
  markPaidOut,
  deleteAffiliate,
  type PayoutMethod,
} from "../lib/referralStore";

const router: IRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const affiliate = affiliateFromToken(token);
  if (!affiliate) return res.status(401).json({ error: "Not authenticated. Please log in again." });
  (req as Request & { affiliateId: string }).affiliateId = affiliate.id;
  return next();
}

function isValidPayoutMethod(m: unknown): m is PayoutMethod {
  if (!m || typeof m !== "object") return false;
  const method = m as Record<string, unknown>;
  if (method.type === "upi") return typeof method.upiId === "string" && method.upiId.trim().length > 0;
  if (method.type === "bank") {
    return (
      typeof method.accountName === "string" &&
      typeof method.accountNumber === "string" &&
      typeof method.ifscOrSwift === "string" &&
      typeof method.bankName === "string"
    );
  }
  return false;
}

// Self-serve affiliate signup -- no manual approval gate, the account and
// referral code/link are usable immediately. Keeps the signup funnel
// one-step, which matters more for a brand-new program than fraud control
// at this stage.
router.post("/affiliate/signup", (req, res) => {
  const { name, email, password, phone, country, currency, payoutMethod } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    phone?: string;
    country?: string;
    currency?: string;
    payoutMethod?: unknown;
  };

  if (!name || !email || !password) {
    return res.status(400).json({ error: "Name, email and password are required." });
  }
  if (!isValidPayoutMethod(payoutMethod)) {
    return res.status(400).json({
      error: "A valid payout method is required (UPI id, or bank account name/number/IFSC-or-SWIFT/bank name).",
    });
  }

  const result = createAffiliate({
    name,
    email,
    password,
    phone: phone ?? "",
    country: country ?? "",
    currency: currency ?? "USD",
    payoutMethod,
  });
  if ("error" in result) return res.status(400).json({ error: result.error });

  // Log in immediately after signup so the dashboard loads with zero extra
  // steps -- same reasoning as skipping the approval gate above.
  const login = loginAffiliate(email, password);
  if ("error" in login) return res.status(500).json({ error: "Account created but auto-login failed. Please log in." });

  return res.json({
    token: login.token,
    referralCode: result.affiliate.referralCode,
    referralLink: `https://play.google.com/store/apps/details?id=com.arpitagrawal.digitaldetox&referrer=${result.affiliate.referralCode}`,
  });
});

router.post("/affiliate/login", (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  const result = loginAffiliate(email, password);
  if ("error" in result) return res.status(401).json({ error: result.error });
  return res.json({
    token: result.token,
    referralCode: result.affiliate.referralCode,
    referralLink: `https://play.google.com/store/apps/details?id=com.arpitagrawal.digitaldetox&referrer=${result.affiliate.referralCode}`,
  });
});

router.get("/affiliate/dashboard", requireAuth, (req, res) => {
  const affiliateId = (req as Request & { affiliateId: string }).affiliateId;
  const dashboard = dashboardFor(affiliateId);
  if (!dashboard) return res.status(404).json({ error: "Affiliate not found." });
  return res.json(dashboard);
});

// Admin-only: Arpit marks a monthly payout as sent (after paying manually
// via UPI/bank transfer outside this system). Protected by a shared secret
// env var rather than a full admin login system -- there's exactly one
// admin today.
router.post("/affiliate/:id/mark-paid", (req, res) => {
  const adminSecret = process.env["ADMIN_SECRET"];
  if (!adminSecret || req.headers["x-admin-secret"] !== adminSecret) {
    return res.status(403).json({ error: "Not authorized." });
  }
  const { amountINR } = req.body as { amountINR?: number };
  if (typeof amountINR !== "number" || amountINR <= 0) {
    return res.status(400).json({ error: "amountINR must be a positive number." });
  }
  const result = markPaidOut(req.params.id, amountINR);
  if (!result.ok) return res.status(404).json({ error: "Affiliate not found." });
  return res.json({ ok: true });
});

// Admin-only: permanently delete an affiliate account (e.g. test/duplicate
// signups). Same shared-secret auth as mark-paid above -- see that comment.
router.delete("/affiliate/:id", (req, res) => {
  const adminSecret = process.env["ADMIN_SECRET"];
  if (!adminSecret || req.headers["x-admin-secret"] !== adminSecret) {
    return res.status(403).json({ error: "Not authorized." });
  }
  const result = deleteAffiliate(req.params.id);
  if (!result.ok) return res.status(404).json({ error: "Affiliate not found." });
  return res.json({ ok: true });
});

export default router;

import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  createAffiliate,
  loginAffiliate,
  affiliateFromToken,
  dashboardFor,
  markPaidOut,
  deleteAffiliate,
  verifyEmail,
  resendVerification,
  createPasswordResetToken,
  resetPassword,
  logHelpRequest,
  type PayoutMethod,
} from "../lib/referralStore";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendHelpRequestEmail,
} from "../lib/mailer";

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
  const { name, email, password, phone, country, currency, promotionChannel, payoutMethod } = req.body as {
    name?: string;
    email?: string;
    password?: string;
    phone?: string;
    country?: string;
    currency?: string;
    promotionChannel?: string;
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
    promotionChannel: promotionChannel ?? "",
    payoutMethod,
  });
  if ("error" in result) return res.status(400).json({ error: result.error });

  // Fire-and-forget verification email (fails gracefully if RESEND_API_KEY absent)
  sendVerificationEmail(result.affiliate.email, result.affiliate.name, result.verificationToken).catch(() => {});

  // No auto-login anymore: email verification is now a hard gate on login,
  // and a freshly created account is never verified yet, so logging in here
  // would always fail. Tell the user to check their inbox instead.
  return res.json({
    ok: true,
    requiresVerification: true,
    message: "Account created. Check your email to verify your address before logging in.",
  });
});

router.post("/affiliate/login", (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  const result = loginAffiliate(email, password);
  if ("error" in result) return res.status(401).json({ error: result.error, reason: result.reason });
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


// ---- Email verification -----------------------------------------------
router.get("/affiliate/verify-email", (req, res) => {
  const token = req.query["token"] as string | undefined;
  if (!token) return res.status(400).json({ error: "Missing token." });
  const result = verifyEmail(token);
  if (!result.ok) return res.status(400).json({ error: result.error });
  // Redirect to login with a success flag the login page can show
  return res.redirect("/login.html?verified=1");
});

// Re-send the verification email for an account that hasn't verified yet.
// Always responds with the same vague success message regardless of outcome
// (not-found, already-verified, or genuinely resent) to avoid leaking which
// emails have accounts -- same pattern as forgot-password below.
router.post("/affiliate/resend-verification", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: "Email is required." });
  const result = resendVerification(email);
  if (!("error" in result)) {
    await sendVerificationEmail(result.affiliate.email, result.affiliate.name, result.token).catch(() => {});
  }
  return res.json({ ok: true, message: "If that email has an unverified account, a new verification link has been sent." });
});

// ---- Forgot / reset password ------------------------------------------
router.post("/affiliate/forgot-password", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: "Email is required." });
  const result = createPasswordResetToken(email);
  if ("error" in result) {
    // Always respond with the same success message to prevent email enumeration
    return res.json({ ok: true, message: "If that email is registered, a reset link has been sent." });
  }
  sendPasswordResetEmail(result.affiliate.email, result.token).catch(() => {});
  return res.json({ ok: true, message: "If that email is registered, a reset link has been sent." });
});

router.post("/affiliate/reset-password", (req, res) => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };
  if (!token || !newPassword) return res.status(400).json({ error: "Token and new password are required." });
  const result = resetPassword(token, newPassword);
  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.json({ ok: true });
});

// ---- Request help (authenticated) -------------------------------------
router.post("/affiliate/request-help", requireAuth, async (req, res) => {
  const affiliateId = (req as import("express").Request & { affiliateId: string }).affiliateId;
  const { subject, message } = req.body as { subject?: string; message?: string };
  if (!message?.trim()) return res.status(400).json({ error: "Message is required." });
  logHelpRequest(affiliateId, subject ?? "General", message.trim());

  // Also email the admin (fire-and-forget)
  const { affiliateFromToken: _aff } = await import("../lib/referralStore");
  const affiliate = affiliateFromToken(
    ((req as import("express").Request & { headers: { authorization?: string } }).headers.authorization ?? "").slice(7)
  );
  if (affiliate) {
    sendHelpRequestEmail(
      { name: affiliate.name, email: affiliate.email },
      subject ?? "General",
      message.trim(),
    ).catch(() => {});
  }
  return res.json({ ok: true });
});

export default router;

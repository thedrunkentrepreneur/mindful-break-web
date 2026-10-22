import { Router, type IRouter, type Request, type Response, type NextFunction } from "express";
import {
  loginAdmin,
  adminFromToken,
  changeAdminPassword,
  createAdminPasswordResetToken,
  resetAdminPassword,
  adminOverview,
  listAffiliatesForAdmin,
  affiliateDetailForAdmin,
  setAffiliateStatus,
  recordPayout,
  type AffiliateStatus,
} from "../lib/referralStore";
import { sendAdminPasswordResetEmail } from "../lib/mailer";

// Admin dashboard API -- a completely separate auth namespace from the
// affiliate-facing routes in affiliate.ts (separate token type, separate
// "Bearer" header is the same shape but adminFromToken() checks a totally
// different store bucket). Only the two seeded emails
// (digitox007@gmail.com, arpitagrawal131@gmail.com) can ever use this --
// there is no signup endpoint here, deliberately.
const router: IRouter = Router();

function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  const admin = adminFromToken(token);
  if (!admin) return res.status(401).json({ error: "Not authenticated. Please log in again." });
  (req as Request & { adminEmail: string }).adminEmail = admin.email;
  return next();
}

router.post("/admin/login", (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) return res.status(400).json({ error: "Email and password are required." });
  const result = loginAdmin(email, password);
  if ("error" in result) return res.status(401).json({ error: result.error });
  return res.json({ token: result.token, email: result.email });
});

router.post("/admin/forgot-password", async (req, res) => {
  const { email } = req.body as { email?: string };
  if (!email) return res.status(400).json({ error: "Email is required." });
  const result = createAdminPasswordResetToken(email);
  // Always respond with the same success message to prevent email enumeration
  if (!("error" in result)) {
    sendAdminPasswordResetEmail(email.trim().toLowerCase(), result.token).catch(() => {});
  }
  return res.json({ ok: true, message: "If that email is a registered admin, a reset link has been sent." });
});

router.post("/admin/reset-password", (req, res) => {
  const { token, newPassword } = req.body as { token?: string; newPassword?: string };
  if (!token || !newPassword) return res.status(400).json({ error: "Token and new password are required." });
  const result = resetAdminPassword(token, newPassword);
  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.json({ ok: true });
});

router.post("/admin/change-password", requireAdminAuth, (req, res) => {
  const adminEmail = (req as Request & { adminEmail: string }).adminEmail;
  const { currentPassword, newPassword } = req.body as { currentPassword?: string; newPassword?: string };
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "Current password and new password are required." });
  }
  const result = changeAdminPassword(adminEmail, currentPassword, newPassword);
  if (!result.ok) return res.status(400).json({ error: result.error });
  return res.json({ ok: true });
});

// ---- Dashboards ---------------------------------------------------------

router.get("/admin/overview", requireAdminAuth, (_req, res) => {
  return res.json(adminOverview());
});

router.get("/admin/affiliates", requireAdminAuth, (_req, res) => {
  return res.json({ affiliates: listAffiliatesForAdmin() });
});

router.get("/admin/affiliates/:id", requireAdminAuth, (req, res) => {
  const detail = affiliateDetailForAdmin(req.params.id as string);
  if (!detail) return res.status(404).json({ error: "Affiliate not found." });
  return res.json(detail);
});

// Approve / reject / re-pend an affiliate's application.
router.post("/admin/affiliates/:id/status", requireAdminAuth, (req, res) => {
  const { status } = req.body as { status?: string };
  if (status !== "pending" && status !== "approved" && status !== "rejected") {
    return res.status(400).json({ error: 'status must be "pending", "approved", or "rejected".' });
  }
  const result = setAffiliateStatus(req.params.id as string, status as AffiliateStatus);
  if (!result.ok) return res.status(404).json({ error: "Affiliate not found." });
  return res.json({ ok: true });
});

// Record a manual payout Arpit made outside the app (UPI/bank transfer),
// with proof. Append-only on the store side -- this never edits or removes
// a prior payout record, see recordPayout() in referralStore.ts.
router.post("/admin/affiliates/:id/payout", requireAdminAuth, (req, res) => {
  const { amountINR, paidAt, note, screenshotDataUrl } = req.body as {
    amountINR?: number;
    paidAt?: string;
    note?: string;
    screenshotDataUrl?: string;
  };
  if (typeof amountINR !== "number" || amountINR <= 0) {
    return res.status(400).json({ error: "amountINR must be a positive number." });
  }
  const result = recordPayout(req.params.id as string, {
    amountINR,
    paidAt: paidAt ?? "",
    note: note ?? "",
    screenshotDataUrl: screenshotDataUrl ?? null,
  });
  if (!result.ok) return res.status(404).json({ error: "Affiliate not found." });
  return res.json({ ok: true });
});

export default router;

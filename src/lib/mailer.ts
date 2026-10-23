/**
 * Lightweight email sender using the Resend HTTP API.
 *
 * Requires one env var:  RESEND_API_KEY  (free tier at resend.com supports
 * 100 emails/day -- enough for verification and password resets at early
 * scale). Also needs RESEND_FROM_EMAIL (defaults to "Digitox
 * <noreply@digitox.club>" if not set, but digitox.club must first be
 * added + verified as a sending domain in the Resend dashboard, or every
 * send will be rejected).
 *
 * If RESEND_API_KEY is absent the functions return { ok: false,
 * skipped: true } without throwing -- features that depend on email degrade
 * gracefully to a "contact support" message instead of a hard error.
 */

const RESEND_API_URL = "https://api.resend.com/emails";

function apiKey(): string | null {
  return process.env["RESEND_API_KEY"] ?? null;
}

function fromAddress(): string {
  return process.env["RESEND_FROM_EMAIL"] ?? "Digitox <noreply@digitox.club>";
}

function siteBase(): string {
  return process.env["SITE_BASE_URL"] ?? "https://digitox.club";
}

export async function sendEmail(opts: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ ok: boolean; skipped?: boolean; error?: string }> {
  const key = apiKey();
  if (!key) return { ok: false, skipped: true };

  try {
    const resp = await fetch(RESEND_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      return { ok: false, error: body };
    }
    return { ok: true };
  } catch (err: unknown) {
    return { ok: false, error: err instanceof Error ? err.message : "send failed" };
  }
}

export async function sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
  const link = `${siteBase()}/verify-email.html?token=${token}`;
  await sendEmail({
    to,
    subject: "Verify your Mindful Break affiliate account",
    html: `
      <div style="font-family:sans-serif; max-width:520px; margin:0 auto;">
        <h2 style="color:#00d9a6;">Welcome, ${name}!</h2>
        <p>Thanks for joining the Mindful Break Affiliate Program. Click the button below to verify your email address.</p>
        <p style="text-align:center; margin:28px 0;">
          <a href="${link}" style="background:#00d9a6; color:#012b1e; padding:12px 28px; border-radius:100px; font-weight:700; text-decoration:none; display:inline-block;">Verify my email</a>
        </p>
        <p style="color:#888; font-size:13px;">Or paste this link in your browser:<br><a href="${link}">${link}</a></p>
        <p style="color:#888; font-size:12px;">If you didn't sign up, you can ignore this email.</p>
      </div>
    `,
  });
}

export async function sendPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${siteBase()}/forgot-password.html?token=${token}`;
  await sendEmail({
    to,
    subject: "Reset your Mindful Break affiliate password",
    html: `
      <div style="font-family:sans-serif; max-width:520px; margin:0 auto;">
        <h2 style="color:#00d9a6;">Password reset</h2>
        <p>We received a request to reset the password for this affiliate account. Click below to set a new password. This link expires in 1 hour.</p>
        <p style="text-align:center; margin:28px 0;">
          <a href="${link}" style="background:#00d9a6; color:#012b1e; padding:12px 28px; border-radius:100px; font-weight:700; text-decoration:none; display:inline-block;">Reset my password</a>
        </p>
        <p style="color:#888; font-size:13px;">Or paste this link:<br><a href="${link}">${link}</a></p>
        <p style="color:#888; font-size:12px;">If you didn't request this, you can safely ignore it. Your password has not changed.</p>
      </div>
    `,
  });
}

export async function sendAdminPasswordResetEmail(to: string, token: string): Promise<void> {
  const link = `${siteBase()}/admin-forgot-password.html?token=${token}`;
  await sendEmail({
    to,
    subject: "Reset your Digitox admin dashboard password",
    html: `
      <div style="font-family:sans-serif; max-width:520px; margin:0 auto;">
        <h2 style="color:#00d9a6;">Admin password reset</h2>
        <p>We received a request to reset the password for the Digitox admin dashboard. Click below to set a new password. This link expires in 1 hour.</p>
        <p style="text-align:center; margin:28px 0;">
          <a href="${link}" style="background:#00d9a6; color:#012b1e; padding:12px 28px; border-radius:100px; font-weight:700; text-decoration:none; display:inline-block;">Reset my password</a>
        </p>
        <p style="color:#888; font-size:13px;">Or paste this link:<br><a href="${link}">${link}</a></p>
        <p style="color:#888; font-size:12px;">If you didn't request this, you can safely ignore it. Your password has not changed.</p>
      </div>
    `,
  });
}

export async function sendHelpRequestEmail(
  from: { name: string; email: string },
  subject: string,
  message: string,
): Promise<void> {
  const adminEmail = process.env["ADMIN_EMAIL"] ?? "digitox007@gmail.com";
  await sendEmail({
    to: adminEmail,
    subject: `[Affiliate Help] ${subject} — from ${from.name}`,
    html: `
      <div style="font-family:sans-serif; max-width:520px; margin:0 auto;">
        <h2>Affiliate Help Request</h2>
        <table style="width:100%; border-collapse:collapse; font-size:14px;">
          <tr><td style="padding:6px 0; color:#888;">From</td><td>${from.name} &lt;${from.email}&gt;</td></tr>
          <tr><td style="padding:6px 0; color:#888;">Subject</td><td>${subject}</td></tr>
        </table>
        <div style="background:#f4f4f4; border-radius:8px; padding:16px; margin:16px 0; font-size:14px; white-space:pre-wrap;">${message}</div>
        <p style="font-size:12px; color:#888;">Reply directly to this email to respond to the affiliate.</p>
      </div>
    `,
  });
}

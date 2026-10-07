import { Router } from "express";

const router = Router();

router.get("/", (_req, res) => {
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Privacy Policy — Digitox</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0f0f0f;
      color: #e0e0e0;
      line-height: 1.8;
      padding: 40px 20px;
    }
    .container {
      max-width: 720px;
      margin: 0 auto;
    }
    h1 {
      font-size: 2rem;
      font-weight: 700;
      color: #ffffff;
      margin-bottom: 8px;
    }
    .subtitle {
      color: #888;
      font-size: 0.9rem;
      margin-bottom: 40px;
    }
    h2 {
      font-size: 1.1rem;
      font-weight: 600;
      color: #ffffff;
      margin-top: 32px;
      margin-bottom: 8px;
    }
    p {
      color: #c0c0c0;
      margin-bottom: 12px;
    }
    ul {
      padding-left: 20px;
      color: #c0c0c0;
      margin-bottom: 12px;
    }
    li { margin-bottom: 6px; }
    a { color: #6c63ff; text-decoration: none; }
    a:hover { text-decoration: underline; }
    .footer {
      margin-top: 60px;
      padding-top: 20px;
      border-top: 1px solid #222;
      color: #555;
      font-size: 0.85rem;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Privacy Policy</h1>
    <p class="subtitle">Digitox &nbsp;·&nbsp; Effective date: September 10, 2026</p>

    <p>
      Digitox ("we", "our", or "us") is a digital wellbeing application that
      helps you complete focused, device-detox sessions. We respect your privacy
      and collect only the information needed to operate the app and provide
      aggregate app statistics. This Privacy Policy explains what information is
      processed, why it is processed, and the choices available to you.
    </p>

    <h2>1. Information We Collect</h2>
    <p>Digitox is designed to collect minimal data:</p>
    <ul>
      <li><strong>Data stored on your device:</strong> Session names, purposes, planned durations, start times, completion status, early-unlock status, and personal progress totals are stored locally in the app.</li>
      <li><strong>Aggregate app activity:</strong> When a session starts or ends, the app may send an event to our server containing session-related values such as duration. We use these events only to update aggregate counters such as total sessions, completed sessions, and total hours saved. We do not use these events to create a personal account or profile.</li>
      <li><strong>Purchase information:</strong> If you buy an early unlock, Google Play Billing and RevenueCat process the transaction. We receive purchase status needed to grant the unlock, but we do not receive or store your card number, bank details, or other payment credentials.</li>
      <li><strong>Basic technical information:</strong> Google Play and RevenueCat may process app, device, and transaction identifiers as part of billing, fraud prevention, purchase verification, and entitlement management. Digitox does not use these identifiers for advertising or cross-app tracking.</li>
    </ul>

    <h2>2. Information We Do Not Collect</h2>
    <ul>
      <li>Digitox does not require you to create an account and does not ask for your name, email address, or phone number.</li>
      <li>Digitox does not access your contacts, camera, microphone, precise location, or files.</li>
      <li>Digitox does not read the content of other apps, messages, or websites.</li>
      <li>Digitox does not use your data for personalized advertising or sell your personal information.</li>
    </ul>

    <h2>3. How We Use Information</h2>
    <p>The limited information described above is used only to:</p>
    <ul>
      <li>Save and display your personal detox progress on your device</li>
      <li>Calculate aggregate community statistics displayed in the app</li>
      <li>Verify and deliver paid early unlocks</li>
      <li>Maintain, secure, and troubleshoot the app and its services</li>
    </ul>

    <h2>4. Screen Pinning and Device Features</h2>
    <p>
      Digitox may guide you to Android's built-in Screen Pinning feature. Screen
      Pinning is controlled by Android, not by Digitox. Digitox does not obtain
      your device PIN, password, biometric data, or other lock-screen
      credentials. You choose whether to enable Screen Pinning and can manage
      it in Android settings.
    </p>

    <h2>5. Third-Party Services</h2>
    <p>Digitox relies on the following services for specific functions:</p>
    <ul>
      <li><strong>Google Play Billing:</strong> Processes in-app purchases and provides purchase confirmation. See <a href="https://policies.google.com/privacy" target="_blank" rel="noopener noreferrer">Google's Privacy Policy</a>.</li>
      <li><strong>RevenueCat:</strong> Verifies and manages in-app purchase entitlements. See <a href="https://www.revenuecat.com/privacy" target="_blank" rel="noopener noreferrer">RevenueCat's Privacy Policy</a>.</li>
      <li><strong>Replit-hosted application services:</strong> Receive limited, non-account session events to maintain aggregate statistics. These services do not receive payment credentials.</li>
    </ul>

    <h2>6. Data Storage and Retention</h2>
    <p>
      Personal session history and personal progress are stored locally on your
      device. Digitox does not maintain a cloud account containing your personal
      session history. If you clear the app's storage or uninstall the app,
      local session data may be deleted.
    </p>
    <p>
      Our server retains aggregate counters needed to display community
      statistics. These counters are not linked to your name, email address, or
      an account. Purchase records and identifiers may be retained by Google
      Play and RevenueCat according to their policies and legal obligations.
    </p>

    <h2>7. Sharing and Disclosure</h2>
    <p>
      We do not sell personal information. We share or permit processing only
      with the service providers listed above when necessary to provide billing,
      purchase verification, hosting, security, or aggregate statistics. We may
      also disclose information when required by law, legal process, or to
      protect the rights, safety, and security of users and the service.
    </p>

    <h2>8. Security</h2>
    <p>
      We use reasonable administrative and technical measures to protect the
      limited information processed by Digitox. No method of storage or
      transmission is completely secure, so we cannot guarantee absolute
      security.
    </p>

    <h2>9. Your Choices and Privacy Requests</h2>
    <p>
      You may delete locally stored session data by clearing Digitox's app data
      or uninstalling the app. You may also stop sending new session events by
      stopping use of the app. For questions about data processed by Google Play
      or RevenueCat, you may need to contact those providers directly. To ask
      about information handled by Digitox, contact us using the address below.
    </p>

    <h2>10. Children's Privacy</h2>
    <p>
      Digitox is intended for adults and is not directed to children under 13.
      We do not knowingly collect personal information from children. If you
      believe a child has provided personal information to us, please contact us
      so we can review and delete it where appropriate.
    </p>

    <h2>11. Changes to This Policy</h2>
    <p>
      We may update this Privacy Policy when our practices or legal requirements
      change. We will post the updated policy at this same URL and change the
      effective date above.
    </p>

    <h2>12. Contact Us</h2>
    <p>
      If you have questions, privacy requests, or concerns about this policy,
      contact us at:<br />
      <a href="mailto:arpitagrawal131@gmail.com">arpitagrawal131@gmail.com</a>
    </p>

    <div class="footer">
      &copy; 2026 Digitox. All rights reserved.
    </div>
  </div>
</body>
</html>`);
});

export default router;

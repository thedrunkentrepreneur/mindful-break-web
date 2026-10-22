import app from "./app";
import { logger } from "./lib/logger";
import { seedAdminAccounts } from "./lib/referralStore";

// Idempotent -- creates the two admin accounts (digitox007@gmail.com,
// arpitagrawal131@gmail.com) with a shared default password if they don't
// exist yet. Safe to run on every boot; never touches an account that
// already exists, so a password change survives a redeploy/restart.
seedAdminAccounts();

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

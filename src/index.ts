import app from "./app";
import { logger } from "./lib/logger";
import { seedAdminAccounts, hydrateLocalFileFromDb } from "./lib/referralStore";

// Restore affiliate/payout data from Postgres BEFORE anything else runs,
// if the local file was just wiped by a fresh Render redeploy (no-op if
// DATABASE_URL isn't set, or if the local file already exists). Must
// complete before seedAdminAccounts()/app.listen() so no request can ever
// observe a half-restored or empty store.
await hydrateLocalFileFromDb();

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

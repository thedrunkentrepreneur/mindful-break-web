import { Pool } from "pg";
import { logger } from "./logger";

/**
 * Minimal Postgres mirror for referralStore.ts's StoreData blob.
 *
 * Does NOT replace the existing synchronous read-modify-write-per-call
 * pattern in referralStore.ts (every exported function there still calls
 * load()/save() exactly as before -- zero regression risk to that logic).
 * This is a thin persistence layer underneath it:
 *
 *  - At boot (see hydrateLocalFileFromDb() in referralStore.ts, called from
 *    index.ts before the server starts accepting traffic): if the local
 *    JSON file is missing (e.g. a fresh Render redeploy wiped the ephemeral
 *    disk) but a snapshot exists in Postgres, restore the local file from
 *    Postgres first.
 *  - On every save(), fire-and-forget mirror the full blob to Postgres
 *    (same "best effort, never blocks or throws" pattern already used for
 *    verification emails elsewhere in this codebase).
 *
 * No-ops cleanly if DATABASE_URL isn't set -- existing file-only behavior
 * is preserved exactly (local dev, or before a DB is provisioned).
 */

const connectionString = process.env["DATABASE_URL"];

export const dbEnabled = Boolean(connectionString);

const pool = connectionString
  ? new Pool({
      connectionString,
      // Neon (and most managed Postgres providers) terminate TLS with certs
      // that Node's default CA bundle doesn't always chain cleanly in
      // containerized environments. This store is a best-effort mirror of
      // non-secret data, not a security boundary, so we trade strict cert
      // verification for deploy reliability here.
      ssl: { rejectUnauthorized: false },
      max: 3,
    })
  : null;

let tableReadyPromise: Promise<void> | null = null;

function ensureTable(): Promise<void> {
  if (!pool) return Promise.resolve();
  if (!tableReadyPromise) {
    tableReadyPromise = pool
      .query(
        `CREATE TABLE IF NOT EXISTS store_data (
           id INT PRIMARY KEY DEFAULT 1,
           data JSONB NOT NULL,
           updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
         )`,
      )
      .then(() => undefined);
  }
  return tableReadyPromise;
}

/** Returns the saved snapshot (parsed JSON) or null if none/unavailable. */
export async function loadSnapshotFromDb(): Promise<unknown | null> {
  if (!pool) return null;
  try {
    await ensureTable();
    const result = await pool.query("SELECT data FROM store_data WHERE id = 1");
    return result.rows[0]?.data ?? null;
  } catch (err) {
    logger.error({ err }, "referralStore: failed to load snapshot from Postgres");
    return null;
  }
}

/** Fire-and-forget mirror -- never throws, never blocks the caller. */
export function persistSnapshotToDb(data: unknown): void {
  if (!pool) return;
  ensureTable()
    .then(() =>
      pool!.query(
        `INSERT INTO store_data (id, data, updated_at) VALUES (1, $1, now())
         ON CONFLICT (id) DO UPDATE SET data = $1, updated_at = now()`,
        [JSON.stringify(data)],
      ),
    )
    .catch((err) => {
      logger.error({ err }, "referralStore: failed to persist snapshot to Postgres");
    });
}

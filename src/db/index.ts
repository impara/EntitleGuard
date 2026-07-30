import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import * as schema from "./schema";

const DATA_DIR = path.join(process.cwd(), ".data");
const DB_PATH = process.env.ENTITLEGUARD_DB_PATH ?? path.join(DATA_DIR, "entitleguard.db");

function createDb() {
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("busy_timeout = 5000");
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      mrr_range TEXT NOT NULL,
      billing_platform TEXT NOT NULL,
      database_type TEXT,
      saas_category TEXT,
      customer_count TEXT,
      uses_usage_based_costs INTEGER,
      wants_monitoring INTEGER,
      beta_interests TEXT,
      request_type TEXT NOT NULL,
      consent_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      lead_id INTEGER,
      session_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      exposure_bucket TEXT NOT NULL,
      high_confidence_mismatches INTEGER NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      name TEXT NOT NULL,
      props TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS monitoring_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      schedule TEXT NOT NULL DEFAULT 'nightly',
      status TEXT NOT NULL DEFAULT 'active',
      paid_blocked_threshold INTEGER NOT NULL DEFAULT 1,
      drift_rate_increase_bps INTEGER NOT NULL DEFAULT 100,
      queue_age_threshold_hours INTEGER NOT NULL DEFAULT 168,
      reference_age_days INTEGER NOT NULL DEFAULT 28,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS monitoring_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'completed',
      started_at TEXT NOT NULL,
      completed_at TEXT NOT NULL,
      total_app_records INTEGER NOT NULL,
      total_stripe_records INTEGER NOT NULL,
      mismatch_count INTEGER NOT NULL,
      paid_blocked_count INTEGER NOT NULL,
      unpaid_active_count INTEGER NOT NULL,
      mismatch_rate_bps INTEGER NOT NULL,
      reference_run_id INTEGER,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS monitoring_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      fingerprint TEXT NOT NULL,
      category TEXT NOT NULL,
      direction TEXT,
      severity TEXT NOT NULL,
      first_seen_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      resolved_at TEXT,
      manual_override INTEGER NOT NULL DEFAULT 0,
      override_actor TEXT,
      override_reason TEXT,
      override_expires_at TEXT
    );
    CREATE TABLE IF NOT EXISTS monitoring_alerts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id INTEGER NOT NULL,
      run_id INTEGER NOT NULL,
      type TEXT NOT NULL,
      severity TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      dedupe_key TEXT NOT NULL,
      title TEXT NOT NULL,
      details TEXT NOT NULL,
      acknowledged_by TEXT,
      acknowledged_at TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS monitoring_findings_job_fingerprint_idx
      ON monitoring_findings(job_id, fingerprint);
    CREATE INDEX IF NOT EXISTS monitoring_findings_open_age_idx
      ON monitoring_findings(job_id, resolved_at, first_seen_at);
    CREATE INDEX IF NOT EXISTS monitoring_runs_job_completed_idx
      ON monitoring_runs(job_id, completed_at);
    CREATE INDEX IF NOT EXISTS monitoring_alerts_job_status_idx
      ON monitoring_alerts(job_id, status, created_at);
  `);
  return drizzle(sqlite, { schema });
}

declare global {
  var __entitleguardDb: ReturnType<typeof createDb> | undefined;
}

function getDb() {
  if (!globalThis.__entitleguardDb) {
    globalThis.__entitleguardDb = createDb();
  }
  return globalThis.__entitleguardDb;
}

/**
 * Lazy singleton (survives dev hot reloads). The connection is only opened on
 * first query, not at import time — `next build` imports API route modules in
 * parallel workers, and eager `CREATE TABLE` calls raced on the same file
 * (SQLITE_BUSY: "database is locked" during "Collecting page data").
 */
export const db = new Proxy({} as ReturnType<typeof createDb>, {
  get(_target, prop) {
    const real = getDb();
    const value = Reflect.get(real, prop, real);
    return typeof value === "function" ? value.bind(real) : value;
  },
});

export * from "./schema";

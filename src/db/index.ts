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

import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Server-side storage (PRD section 13): lead data, consent timestamp,
 * aggregated result summaries, and analytics events. Never raw CSV rows.
 */

export const leads = sqliteTable("leads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").notNull(),
  company: text("company").notNull(),
  role: text("role").notNull(),
  mrrRange: text("mrr_range").notNull(),
  billingPlatform: text("billing_platform").notNull(),
  databaseType: text("database_type"),
  saasCategory: text("saas_category"),
  customerCount: text("customer_count"),
  usesUsageBasedCosts: integer("uses_usage_based_costs", { mode: "boolean" }),
  wantsMonitoring: integer("wants_monitoring", { mode: "boolean" }),
  betaInterests: text("beta_interests"), // JSON string[]
  requestType: text("request_type").notNull(),
  consentAt: text("consent_at").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const auditSummaries = sqliteTable("audit_summaries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id"),
  sessionId: text("session_id").notNull(),
  /** aggregate counts + exposure bucket only — never identifiers */
  summary: text("summary").notNull(),
  exposureBucket: text("exposure_bucket").notNull(),
  highConfidenceMismatches: integer("high_confidence_mismatches").notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sessionId: text("session_id").notNull(),
  name: text("name").notNull(),
  props: text("props"), // JSON object of scalars only
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

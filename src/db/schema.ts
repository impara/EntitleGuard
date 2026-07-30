import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Server-side storage (PRD section 13): lead data, consent timestamp,
 * aggregated result summaries, analytics events, and monitoring-beta state.
 * Raw CSV rows are never stored.
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

export const monitoringJobs = sqliteTable("monitoring_jobs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  schedule: text("schedule").notNull().default("nightly"),
  status: text("status").notNull().default("active"),
  paidBlockedThreshold: integer("paid_blocked_threshold").notNull().default(1),
  /** Absolute mismatch-rate increase in basis points. 100 = 1 percentage point. */
  driftRateIncreaseBps: integer("drift_rate_increase_bps").notNull().default(100),
  queueAgeThresholdHours: integer("queue_age_threshold_hours").notNull().default(168),
  referenceAgeDays: integer("reference_age_days").notNull().default(28),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const monitoringRuns = sqliteTable("monitoring_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  source: text("source").notNull().default("manual"),
  status: text("status").notNull().default("completed"),
  startedAt: text("started_at").notNull(),
  completedAt: text("completed_at").notNull(),
  totalAppRecords: integer("total_app_records").notNull(),
  totalStripeRecords: integer("total_stripe_records").notNull(),
  mismatchCount: integer("mismatch_count").notNull(),
  paidBlockedCount: integer("paid_blocked_count").notNull(),
  unpaidActiveCount: integer("unpaid_active_count").notNull(),
  /** Mismatch ratio in basis points. 100 = 1%. */
  mismatchRateBps: integer("mismatch_rate_bps").notNull(),
  referenceRunId: integer("reference_run_id"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const monitoringFindings = sqliteTable("monitoring_findings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  /** Stable pseudonymous hash; never store a raw customer or user identifier. */
  fingerprint: text("fingerprint").notNull(),
  category: text("category").notNull(),
  direction: text("direction"),
  severity: text("severity").notNull(),
  firstSeenAt: text("first_seen_at").notNull(),
  lastSeenAt: text("last_seen_at").notNull(),
  resolvedAt: text("resolved_at"),
  manualOverride: integer("manual_override", { mode: "boolean" }).notNull().default(false),
  overrideActor: text("override_actor"),
  overrideReason: text("override_reason"),
  overrideExpiresAt: text("override_expires_at"),
});

export const monitoringAlerts = sqliteTable("monitoring_alerts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobId: integer("job_id").notNull(),
  runId: integer("run_id").notNull(),
  type: text("type").notNull(),
  severity: text("severity").notNull(),
  status: text("status").notNull().default("open"),
  dedupeKey: text("dedupe_key").notNull(),
  title: text("title").notNull(),
  details: text("details").notNull(),
  acknowledgedBy: text("acknowledged_by"),
  acknowledgedAt: text("acknowledged_at"),
  resolvedAt: text("resolved_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type MonitoringAlertType = "paid_blocked" | "drift" | "queue_age";
export type MonitoringAlertSeverity = "critical" | "warning";
export type MonitoringAlertStatus = "open" | "acknowledged" | "resolved";
export type MonitoringFindingCategory = "A" | "B" | "C" | "D" | "E";
export type MonitoringFindingDirection = "grant" | "revoke";
export type MonitoringFindingSeverity = "high" | "medium" | "low";

export interface MonitoringRunSnapshot {
  id?: number | string;
  completedAt: string;
  totalAppRecords: number;
  totalStripeRecords: number;
  mismatchCount: number;
  paidBlockedCount: number;
  unpaidActiveCount: number;
  /** Ratio from 0 to 1. */
  mismatchRate: number;
}

export interface MonitoringAlertConfig {
  /** A single paid-but-blocked customer is critical by default. */
  paidBlockedThreshold: number;
  /** Absolute increase in mismatch ratio, e.g. 0.01 = 1 percentage point. */
  driftRateIncreaseThreshold: number;
  queueAgeThresholdDays: number;
  /** Fixed historical target; 28 days preserves weekday. */
  referenceAgeDays: number;
  /** Search tolerance around the fixed target, while retaining the same weekday. */
  referenceToleranceDays: number;
}

export interface MonitoringAlertCandidate {
  type: MonitoringAlertType;
  severity: MonitoringAlertSeverity;
  dedupeKey: string;
  title: string;
  message: string;
  currentValue: number;
  threshold: number;
  referenceValue?: number;
}

export interface EvaluateMonitoringAlertsInput {
  run: MonitoringRunSnapshot;
  referenceRun?: MonitoringRunSnapshot | null;
  oldestUnresolvedFirstSeenAt?: string | null;
  now?: string | Date;
  config?: Partial<MonitoringAlertConfig>;
}

/**
 * A caller must hash or HMAC its own stable entitlement identity before
 * ingestion. Raw customer emails, Stripe IDs, user IDs, and CSV rows are not accepted.
 */
export interface MonitoringFindingInput {
  fingerprint: string;
  category: MonitoringFindingCategory;
  direction?: MonitoringFindingDirection | null;
  severity: MonitoringFindingSeverity;
  manualOverride?: boolean;
  overrideActor?: string | null;
  overrideReason?: string | null;
  overrideExpiresAt?: string | null;
}

export interface IngestMonitoringRunInput {
  jobId: number;
  idempotencyKey: string;
  source?: "manual" | "api" | "scheduled";
  /** Required because absence is interpreted as resolution. Partial snapshots are unsafe. */
  completeSnapshot: true;
  startedAt: string;
  completedAt: string;
  totalAppRecords: number;
  totalStripeRecords: number;
  findings: MonitoringFindingInput[];
}

export interface MonitoringAlertState {
  id: number;
  type: MonitoringAlertType;
  severity: MonitoringAlertSeverity;
  status: MonitoringAlertStatus;
  occurrenceCount: number;
}

export interface IngestMonitoringRunResult {
  runId: number;
  idempotent: boolean;
  referenceRunId: number | null;
  findings: {
    created: number;
    recurring: number;
    reopened: number;
    resolved: number;
    open: number;
  };
  alerts: {
    created: number;
    deduplicated: number;
    resolved: number;
    active: MonitoringAlertState[];
  };
}
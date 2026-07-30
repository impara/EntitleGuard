export type MonitoringAlertType = "paid_blocked" | "drift" | "queue_age";
export type MonitoringAlertSeverity = "critical" | "warning";

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

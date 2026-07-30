import type {
  EvaluateMonitoringAlertsInput,
  MonitoringAlertCandidate,
  MonitoringAlertConfig,
  MonitoringRunSnapshot,
} from "./types";

const DAY_MS = 24 * 60 * 60 * 1000;

export const DEFAULT_MONITORING_ALERT_CONFIG: MonitoringAlertConfig = {
  paidBlockedThreshold: 1,
  driftRateIncreaseThreshold: 0.01,
  queueAgeThresholdDays: 7,
  referenceAgeDays: 28,
  referenceToleranceDays: 7,
};

function validDate(value: string | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return count === 1 ? singular : pluralForm;
}

/**
 * Select one fixed historical comparison run rather than a rolling average.
 * The target is normally the same weekday four weeks earlier. Candidates must
 * share the current run's UTC weekday and fall inside the configured age band.
 */
export function selectFixedReferenceRun(
  runs: MonitoringRunSnapshot[],
  currentCompletedAt: string | Date,
  config: Pick<MonitoringAlertConfig, "referenceAgeDays" | "referenceToleranceDays"> =
    DEFAULT_MONITORING_ALERT_CONFIG,
): MonitoringRunSnapshot | null {
  const current = validDate(currentCompletedAt);
  if (!current) return null;

  const minimumAge = config.referenceAgeDays - config.referenceToleranceDays;
  const maximumAge = config.referenceAgeDays + config.referenceToleranceDays;
  const currentWeekday = current.getUTCDay();

  const eligible = runs
    .map((run) => ({ run, completedAt: validDate(run.completedAt) }))
    .filter(
      (candidate): candidate is { run: MonitoringRunSnapshot; completedAt: Date } =>
        candidate.completedAt !== null,
    )
    .map((candidate) => ({
      ...candidate,
      ageDays: (current.getTime() - candidate.completedAt.getTime()) / DAY_MS,
    }))
    .filter(
      ({ completedAt, ageDays }) =>
        ageDays > 0 &&
        ageDays >= minimumAge &&
        ageDays <= maximumAge &&
        completedAt.getUTCDay() === currentWeekday,
    )
    .sort(
      (a, b) =>
        Math.abs(a.ageDays - config.referenceAgeDays) -
          Math.abs(b.ageDays - config.referenceAgeDays) ||
        b.completedAt.getTime() - a.completedAt.getTime(),
    );

  return eligible[0]?.run ?? null;
}

export function evaluateMonitoringAlerts({
  run,
  referenceRun,
  oldestUnresolvedFirstSeenAt,
  now = run.completedAt,
  config: overrides,
}: EvaluateMonitoringAlertsInput): MonitoringAlertCandidate[] {
  const config = { ...DEFAULT_MONITORING_ALERT_CONFIG, ...overrides };
  const alerts: MonitoringAlertCandidate[] = [];

  if (run.paidBlockedCount >= config.paidBlockedThreshold) {
    alerts.push({
      type: "paid_blocked",
      severity: "critical",
      dedupeKey: "paid_blocked",
      title: "Paying customer blocked",
      message: `${run.paidBlockedCount} paying ${plural(
        run.paidBlockedCount,
        "customer",
      )} cannot access the product. Acknowledge and investigate immediately.`,
      currentValue: run.paidBlockedCount,
      threshold: config.paidBlockedThreshold,
    });
  }

  if (referenceRun) {
    const increase = run.mismatchRate - referenceRun.mismatchRate;
    if (increase >= config.driftRateIncreaseThreshold) {
      alerts.push({
        type: "drift",
        severity: "warning",
        dedupeKey: "drift",
        title: "Mismatch rate increased",
        message: `Mismatch rate increased by ${(increase * 100).toFixed(
          2,
        )} percentage points versus the fixed historical reference run.`,
        currentValue: run.mismatchRate,
        threshold: config.driftRateIncreaseThreshold,
        referenceValue: referenceRun.mismatchRate,
      });
    }
  }

  const nowDate = validDate(now);
  const firstSeen = oldestUnresolvedFirstSeenAt
    ? validDate(oldestUnresolvedFirstSeenAt)
    : null;
  if (nowDate && firstSeen && firstSeen.getTime() <= nowDate.getTime()) {
    const queueAgeDays = (nowDate.getTime() - firstSeen.getTime()) / DAY_MS;
    if (queueAgeDays >= config.queueAgeThresholdDays) {
      alerts.push({
        type: "queue_age",
        severity: "warning",
        dedupeKey: "queue_age",
        title: "Mismatch queue is aging",
        message: `The oldest unresolved mismatch is ${Math.floor(
          queueAgeDays,
        )} days old. This indicates that findings may not be actively triaged.`,
        currentValue: queueAgeDays,
        threshold: config.queueAgeThresholdDays,
      });
    }
  }

  return alerts;
}

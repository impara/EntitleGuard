/** Nightly cadence plus a 12-hour operational grace window. */
export const MONITORING_MAX_AGE_HOURS = 36;
export const MONITORING_CLOCK_SKEW_MS = 5 * 60 * 1_000;
const STALLED_EXECUTION_MS = 60 * 60 * 1_000;

export interface SnapshotMetadata {
  startedAt: string;
  completedAt: string;
  totalAppRecords: number;
  totalStripeRecords: number;
}

/** Compare instants, not lexicographic ISO strings (legacy rows may contain offsets). */
export function snapshotIsStale(current: SnapshotMetadata, previous: SnapshotMetadata): boolean {
  return (
    Date.parse(current.completedAt) <= Date.parse(previous.completedAt) ||
    Date.parse(current.startedAt) < Date.parse(previous.startedAt)
  );
}

export function sourceCountCollapsed(previous: number, current: number): boolean {
  // Always protect a populated source becoming empty. For nonempty sources, an
  // 80%+ drop from at least ten records requires explicit operator confirmation.
  return previous > 0 && (current === 0 || (previous >= 10 && current <= previous / 5));
}

/** Missing legacy membership is deliberately treated as unacknowledged once. */
export function hasNewFindingIncidents(details: string, current: readonly string[]): boolean {
  try {
    const parsed: unknown = JSON.parse(details);
    if (parsed === null || typeof parsed !== "object" || !("findingIncidents" in parsed)) {
      return true;
    }
    const previous: unknown = parsed.findingIncidents;
    if (!Array.isArray(previous) || !previous.every((item) => typeof item === "string")) {
      return true;
    }
    const known = new Set<string>(previous);
    return current.some((incident) => !known.has(incident));
  } catch {
    return true;
  }
}

export type MonitoringDataStatus = "fresh" | "stale" | "failed" | "no_data" | "paused";

export interface MonitoringDataHealth {
  status: MonitoringDataStatus;
  lastSuccessAt: string | null;
  maxAgeHours: number;
}

interface HealthRun {
  id: number;
  status: string;
  completedAt: string;
}

interface HealthExecution {
  status: string;
  startedAt: string;
  completedAt: string | null;
  updatedAt: string;
  runId: number | null;
}

/** Pipeline health is independent of whether known access incidents are open. */
export function monitoringDataHealth(
  jobStatus: string,
  latestRun: HealthRun | null,
  execution: HealthExecution | null,
  now: Date,
): MonitoringDataHealth {
  const result = (status: MonitoringDataStatus): MonitoringDataHealth => ({
    status,
    lastSuccessAt: latestRun?.completedAt ?? null,
    maxAgeHours: MONITORING_MAX_AGE_HOURS,
  });
  if (jobStatus === "paused") return result("paused");
  const nowMs = now.getTime();
  const completedMs = latestRun ? Date.parse(latestRun.completedAt) : null;
  if (
    !Number.isFinite(nowMs) ||
    (latestRun !== null &&
      (latestRun.status !== "completed" ||
        !Number.isFinite(completedMs) ||
        completedMs! > nowMs + MONITORING_CLOCK_SKEW_MS))
  ) {
    return result("failed");
  }

  if (execution) {
    const attemptMs = Date.parse(execution.completedAt ?? execution.updatedAt);
    const startedMs = Date.parse(execution.startedAt);
    const appliesToLatest =
      completedMs === null ||
      attemptMs >= completedMs ||
      (latestRun !== null && execution.runId === latestRun.id);
    if (appliesToLatest && execution.status === "failed") return result("failed");
    if (
      execution.status === "running" &&
      nowMs - startedMs >= STALLED_EXECUTION_MS &&
      (completedMs === null || startedMs >= completedMs)
    ) {
      return result("failed");
    }
  }

  if (completedMs === null) return result("no_data");
  return result(nowMs - completedMs >= MONITORING_MAX_AGE_HOURS * 3_600_000 ? "stale" : "fresh");
}

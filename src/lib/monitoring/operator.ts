import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db as defaultDb,
  monitoringAlerts,
  monitoringFindings,
  monitoringJobs,
  monitoringRuns,
  type DatabaseClient,
} from "../../db";
import type {
  MonitoringAlertSeverity,
  MonitoringAlertStatus,
  MonitoringAlertType,
  MonitoringFindingCategory,
} from "./types";

export type MonitoringJobStatus = "active" | "paused";
export type MonitoringJobSchedule = "nightly" | "manual";
export type MonitoringJobHealth = "critical" | "warning" | "healthy" | "no_data" | "paused";

export interface MonitoringJobConfig {
  id: number;
  name: string;
  schedule: MonitoringJobSchedule;
  status: MonitoringJobStatus;
  paidBlockedThreshold: number;
  driftRateIncreaseBps: number;
  queueAgeThresholdHours: number;
  referenceAgeDays: number;
  referenceToleranceDays: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreateMonitoringJobInput {
  name: string;
  schedule?: MonitoringJobSchedule;
  status?: MonitoringJobStatus;
  paidBlockedThreshold?: number;
  driftRateIncreaseBps?: number;
  queueAgeThresholdHours?: number;
  referenceAgeDays?: number;
  referenceToleranceDays?: number;
}

export type UpdateMonitoringJobInput = Partial<CreateMonitoringJobInput>;

export interface MonitoringRunView {
  id: number;
  source: string;
  status: string;
  startedAt: string;
  completedAt: string;
  totalAppRecords: number;
  totalStripeRecords: number;
  mismatchCount: number;
  paidBlockedCount: number;
  unpaidActiveCount: number;
  mismatchRate: number;
  referenceRunId: number | null;
}

export interface MonitoringAlertView {
  id: number;
  type: MonitoringAlertType;
  severity: MonitoringAlertSeverity;
  status: MonitoringAlertStatus;
  title: string;
  details: Record<string, unknown> | null;
  occurrenceCount: number;
  firstTriggeredAt: string | null;
  lastTriggeredAt: string | null;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
}

export interface MonitoringFindingSummary {
  open: number;
  actionable: number;
  activeOverrides: number;
  oldestActionableFirstSeenAt: string | null;
  actionableByCategory: Record<MonitoringFindingCategory, number>;
}

export interface MonitoringJobOverview {
  job: MonitoringJobConfig;
  health: MonitoringJobHealth;
  latestRun: MonitoringRunView | null;
  activeAlertCounts: {
    critical: number;
    warning: number;
  };
  findings: MonitoringFindingSummary;
}

export interface MonitoringJobDetail extends MonitoringJobOverview {
  recentRuns: MonitoringRunView[];
  activeAlerts: MonitoringAlertView[];
}

export type MonitoringJobErrorCode = "JOB_NOT_FOUND" | "INVALID_JOB";

export class MonitoringJobError extends Error {
  constructor(
    public readonly code: MonitoringJobErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MonitoringJobError";
  }
}

const DEFAULTS = {
  schedule: "nightly" as const,
  status: "active" as const,
  paidBlockedThreshold: 1,
  driftRateIncreaseBps: 100,
  queueAgeThresholdHours: 168,
  referenceAgeDays: 28,
  referenceToleranceDays: 7,
};

function assertIntegerRange(value: number, field: string, minimum: number, maximum: number): void {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new MonitoringJobError(
      "INVALID_JOB",
      `${field} must be an integer between ${minimum} and ${maximum}`,
    );
  }
}

function validateJobValues(
  input: Partial<CreateMonitoringJobInput>,
  partial: boolean,
): void {
  if (!partial || input.name !== undefined) {
    const name = input.name?.trim() ?? "";
    if (!name || name.length > 200) {
      throw new MonitoringJobError("INVALID_JOB", "name must be between 1 and 200 characters");
    }
  }

  if (input.schedule !== undefined && input.schedule !== "nightly" && input.schedule !== "manual") {
    throw new MonitoringJobError("INVALID_JOB", "schedule must be nightly or manual");
  }
  if (input.status !== undefined && input.status !== "active" && input.status !== "paused") {
    throw new MonitoringJobError("INVALID_JOB", "status must be active or paused");
  }
  if (input.paidBlockedThreshold !== undefined) {
    assertIntegerRange(input.paidBlockedThreshold, "paidBlockedThreshold", 1, 1_000);
  }
  if (input.driftRateIncreaseBps !== undefined) {
    assertIntegerRange(input.driftRateIncreaseBps, "driftRateIncreaseBps", 1, 10_000);
  }
  if (input.queueAgeThresholdHours !== undefined) {
    assertIntegerRange(input.queueAgeThresholdHours, "queueAgeThresholdHours", 1, 8_760);
  }
  if (input.referenceAgeDays !== undefined) {
    assertIntegerRange(input.referenceAgeDays, "referenceAgeDays", 7, 365);
  }
  if (input.referenceToleranceDays !== undefined) {
    assertIntegerRange(input.referenceToleranceDays, "referenceToleranceDays", 0, 28);
  }
}

function rowToJob(row: typeof monitoringJobs.$inferSelect): MonitoringJobConfig {
  return {
    id: row.id,
    name: row.name,
    schedule: row.schedule as MonitoringJobSchedule,
    status: row.status as MonitoringJobStatus,
    paidBlockedThreshold: row.paidBlockedThreshold,
    driftRateIncreaseBps: row.driftRateIncreaseBps,
    queueAgeThresholdHours: row.queueAgeThresholdHours,
    referenceAgeDays: row.referenceAgeDays,
    referenceToleranceDays: row.referenceToleranceDays,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function rowToRun(row: typeof monitoringRuns.$inferSelect): MonitoringRunView {
  return {
    id: row.id,
    source: row.source,
    status: row.status,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    totalAppRecords: row.totalAppRecords,
    totalStripeRecords: row.totalStripeRecords,
    mismatchCount: row.mismatchCount,
    paidBlockedCount: row.paidBlockedCount,
    unpaidActiveCount: row.unpaidActiveCount,
    mismatchRate: row.mismatchRateBps / 10_000,
    referenceRunId: row.referenceRunId,
  };
}

function parseAlertDetails(value: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function rowToAlert(row: typeof monitoringAlerts.$inferSelect): MonitoringAlertView {
  return {
    id: row.id,
    type: row.type as MonitoringAlertType,
    severity: row.severity as MonitoringAlertSeverity,
    status: row.status as MonitoringAlertStatus,
    title: row.title,
    details: parseAlertDetails(row.details),
    occurrenceCount: row.occurrenceCount,
    firstTriggeredAt: row.firstTriggeredAt,
    lastTriggeredAt: row.lastTriggeredAt,
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedAt: row.acknowledgedAt,
  };
}

function isActiveOverride(
  finding: Pick<typeof monitoringFindings.$inferSelect, "manualOverride" | "overrideExpiresAt">,
  now: Date,
): boolean {
  if (!finding.manualOverride) return false;
  if (!finding.overrideExpiresAt) return true;
  const expiresAt = new Date(finding.overrideExpiresAt);
  return !Number.isNaN(expiresAt.getTime()) && expiresAt.getTime() > now.getTime();
}

function findingSummary(
  rows: Array<typeof monitoringFindings.$inferSelect>,
  now: Date,
): MonitoringFindingSummary {
  const actionableByCategory: Record<MonitoringFindingCategory, number> = {
    A: 0,
    B: 0,
    C: 0,
    D: 0,
    E: 0,
  };
  let activeOverrides = 0;
  let oldestActionable: string | null = null;

  for (const row of rows) {
    if (isActiveOverride(row, now)) {
      activeOverrides += 1;
      continue;
    }

    const category = row.category as MonitoringFindingCategory;
    actionableByCategory[category] += 1;
    if (oldestActionable === null || row.firstSeenAt < oldestActionable) {
      oldestActionable = row.firstSeenAt;
    }
  }

  const actionable = Object.values(actionableByCategory).reduce((total, count) => total + count, 0);
  return {
    open: rows.length,
    actionable,
    activeOverrides,
    oldestActionableFirstSeenAt: oldestActionable,
    actionableByCategory,
  };
}

function healthFor(
  job: MonitoringJobConfig,
  latestRun: MonitoringRunView | null,
  alerts: MonitoringAlertView[],
): MonitoringJobHealth {
  if (job.status === "paused") return "paused";
  if (alerts.some((alert) => alert.severity === "critical")) return "critical";
  if (alerts.some((alert) => alert.severity === "warning")) return "warning";
  return latestRun ? "healthy" : "no_data";
}

function loadJob(database: DatabaseClient, jobId: number): typeof monitoringJobs.$inferSelect {
  const row = database
    .select()
    .from(monitoringJobs)
    .where(eq(monitoringJobs.id, jobId))
    .get();
  if (!row) {
    throw new MonitoringJobError("JOB_NOT_FOUND", `monitoring job ${jobId} was not found`);
  }
  return row;
}

export function createMonitoringJob(
  input: CreateMonitoringJobInput,
  database: DatabaseClient = defaultDb,
): MonitoringJobConfig {
  validateJobValues(input, false);
  const now = new Date().toISOString();
  const referenceAgeDays = input.referenceAgeDays ?? DEFAULTS.referenceAgeDays;
  const referenceToleranceDays = input.referenceToleranceDays ?? DEFAULTS.referenceToleranceDays;
  if (referenceToleranceDays >= referenceAgeDays) {
    throw new MonitoringJobError(
      "INVALID_JOB",
      "referenceToleranceDays must be smaller than referenceAgeDays",
    );
  }

  const inserted = database
    .insert(monitoringJobs)
    .values({
      name: input.name.trim(),
      schedule: input.schedule ?? DEFAULTS.schedule,
      status: input.status ?? DEFAULTS.status,
      paidBlockedThreshold: input.paidBlockedThreshold ?? DEFAULTS.paidBlockedThreshold,
      driftRateIncreaseBps: input.driftRateIncreaseBps ?? DEFAULTS.driftRateIncreaseBps,
      queueAgeThresholdHours: input.queueAgeThresholdHours ?? DEFAULTS.queueAgeThresholdHours,
      referenceAgeDays,
      referenceToleranceDays,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  return rowToJob(inserted);
}

export function updateMonitoringJob(
  jobId: number,
  input: UpdateMonitoringJobInput,
  database: DatabaseClient = defaultDb,
): MonitoringJobConfig {
  if (!Number.isInteger(jobId) || jobId <= 0) {
    throw new MonitoringJobError("INVALID_JOB", "jobId must be a positive integer");
  }
  if (Object.keys(input).length === 0) {
    throw new MonitoringJobError("INVALID_JOB", "at least one job field must be supplied");
  }
  validateJobValues(input, true);

  const existing = loadJob(database, jobId);
  const referenceAgeDays = input.referenceAgeDays ?? existing.referenceAgeDays;
  const referenceToleranceDays = input.referenceToleranceDays ?? existing.referenceToleranceDays;
  if (referenceToleranceDays >= referenceAgeDays) {
    throw new MonitoringJobError(
      "INVALID_JOB",
      "referenceToleranceDays must be smaller than referenceAgeDays",
    );
  }

  const updated = database
    .update(monitoringJobs)
    .set({
      ...(input.name !== undefined ? { name: input.name.trim() } : {}),
      ...(input.schedule !== undefined ? { schedule: input.schedule } : {}),
      ...(input.status !== undefined ? { status: input.status } : {}),
      ...(input.paidBlockedThreshold !== undefined
        ? { paidBlockedThreshold: input.paidBlockedThreshold }
        : {}),
      ...(input.driftRateIncreaseBps !== undefined
        ? { driftRateIncreaseBps: input.driftRateIncreaseBps }
        : {}),
      ...(input.queueAgeThresholdHours !== undefined
        ? { queueAgeThresholdHours: input.queueAgeThresholdHours }
        : {}),
      ...(input.referenceAgeDays !== undefined ? { referenceAgeDays: input.referenceAgeDays } : {}),
      ...(input.referenceToleranceDays !== undefined
        ? { referenceToleranceDays: input.referenceToleranceDays }
        : {}),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(monitoringJobs.id, jobId))
    .returning()
    .get();

  return rowToJob(updated);
}

export function getMonitoringJobDetail(
  jobId: number,
  database: DatabaseClient = defaultDb,
  options: { recentRunLimit?: number; now?: Date } = {},
): MonitoringJobDetail {
  const recentRunLimit = options.recentRunLimit ?? 30;
  assertIntegerRange(recentRunLimit, "recentRunLimit", 1, 100);
  const now = options.now ?? new Date();
  const job = rowToJob(loadJob(database, jobId));

  const recentRuns = database
    .select()
    .from(monitoringRuns)
    .where(eq(monitoringRuns.jobId, jobId))
    .orderBy(desc(monitoringRuns.completedAt))
    .limit(recentRunLimit)
    .all()
    .map(rowToRun);

  const activeAlerts = database
    .select()
    .from(monitoringAlerts)
    .where(
      and(
        eq(monitoringAlerts.jobId, jobId),
        inArray(monitoringAlerts.status, ["open", "acknowledged"]),
      ),
    )
    .orderBy(desc(monitoringAlerts.lastTriggeredAt), desc(monitoringAlerts.createdAt))
    .all()
    .map(rowToAlert);

  const openFindings = database
    .select()
    .from(monitoringFindings)
    .where(and(eq(monitoringFindings.jobId, jobId), isNull(monitoringFindings.resolvedAt)))
    .all();

  const latestRun = recentRuns[0] ?? null;
  const activeAlertCounts = {
    critical: activeAlerts.filter((alert) => alert.severity === "critical").length,
    warning: activeAlerts.filter((alert) => alert.severity === "warning").length,
  };

  return {
    job,
    health: healthFor(job, latestRun, activeAlerts),
    latestRun,
    activeAlertCounts,
    findings: findingSummary(openFindings, now),
    recentRuns,
    activeAlerts,
  };
}

export function listMonitoringJobOverviews(
  database: DatabaseClient = defaultDb,
  now: Date = new Date(),
): MonitoringJobOverview[] {
  return database
    .select({ id: monitoringJobs.id })
    .from(monitoringJobs)
    .orderBy(desc(monitoringJobs.createdAt))
    .all()
    .map(({ id }) => {
      const detail = getMonitoringJobDetail(id, database, { recentRunLimit: 1, now });
      return {
        job: detail.job,
        health: detail.health,
        latestRun: detail.latestRun,
        activeAlertCounts: detail.activeAlertCounts,
        findings: detail.findings,
      };
    });
}

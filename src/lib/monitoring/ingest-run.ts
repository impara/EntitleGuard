import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import {
  db as defaultDb,
  monitoringAlerts,
  monitoringFindingObservations,
  monitoringFindings,
  monitoringJobs,
  monitoringRuns,
  type DatabaseClient,
} from "../../db";
import { evaluateMonitoringAlerts, selectFixedReferenceRun } from "./evaluate-alerts";
import type {
  IngestMonitoringRunInput,
  IngestMonitoringRunResult,
  MonitoringAlertState,
  MonitoringAlertStatus,
  MonitoringAlertType,
  MonitoringFindingInput,
  MonitoringRunSnapshot,
} from "./types";

const ACTIVE_ALERT_STATUSES = ["open", "acknowledged"] as const;
const SHA256_HEX = /^[a-f0-9]{64}$/i;

export type MonitoringIngestErrorCode =
  | "JOB_NOT_FOUND"
  | "JOB_INACTIVE"
  | "INVALID_RUN"
  | "INVALID_FINDING";

export class MonitoringIngestError extends Error {
  constructor(
    public readonly code: MonitoringIngestErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "MonitoringIngestError";
  }
}

function parseDate(value: string, field: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new MonitoringIngestError("INVALID_RUN", `${field} must be a valid timestamp`);
  }
  return parsed;
}

function validateInput(input: IngestMonitoringRunInput): void {
  if (!Number.isInteger(input.jobId) || input.jobId <= 0) {
    throw new MonitoringIngestError("INVALID_RUN", "jobId must be a positive integer");
  }
  if (!input.idempotencyKey.trim()) {
    throw new MonitoringIngestError("INVALID_RUN", "idempotencyKey is required");
  }
  if (input.totalAppRecords < 0 || input.totalStripeRecords < 0) {
    throw new MonitoringIngestError("INVALID_RUN", "record counts cannot be negative");
  }

  const startedAt = parseDate(input.startedAt, "startedAt");
  const completedAt = parseDate(input.completedAt, "completedAt");
  if (completedAt.getTime() < startedAt.getTime()) {
    throw new MonitoringIngestError("INVALID_RUN", "completedAt cannot be before startedAt");
  }
  if (input.findings.length > 0 && input.totalAppRecords === 0 && input.totalStripeRecords === 0) {
    throw new MonitoringIngestError(
      "INVALID_RUN",
      "a run with findings must include at least one source record",
    );
  }

  const fingerprints = new Set<string>();
  for (const finding of input.findings) {
    const fingerprint = finding.fingerprint.toLowerCase();
    if (!SHA256_HEX.test(fingerprint)) {
      throw new MonitoringIngestError(
        "INVALID_FINDING",
        "finding fingerprints must be 64-character SHA-256/HMAC hex values",
      );
    }
    if (fingerprints.has(fingerprint)) {
      throw new MonitoringIngestError(
        "INVALID_FINDING",
        `duplicate finding fingerprint in run: ${fingerprint}`,
      );
    }
    fingerprints.add(fingerprint);

    if (finding.overrideExpiresAt) {
      const expiresAt = new Date(finding.overrideExpiresAt);
      if (Number.isNaN(expiresAt.getTime())) {
        throw new MonitoringIngestError(
          "INVALID_FINDING",
          "overrideExpiresAt must be a valid timestamp",
        );
      }
    }
  }
}

function activeManualOverride(
  finding: Pick<MonitoringFindingInput, "manualOverride" | "overrideExpiresAt">,
  at: Date,
): boolean {
  if (!finding.manualOverride) return false;
  if (!finding.overrideExpiresAt) return true;
  return new Date(finding.overrideExpiresAt).getTime() > at.getTime();
}

function mismatchRateBps(
  mismatchCount: number,
  totalAppRecords: number,
  totalStripeRecords: number,
): number {
  const denominator = Math.max(totalAppRecords, totalStripeRecords, mismatchCount, 1);
  return Math.round((mismatchCount / denominator) * 10_000);
}

function alertState(row: {
  id: number;
  type: string;
  severity: string;
  status: string;
  occurrenceCount: number;
}): MonitoringAlertState {
  return {
    id: row.id,
    type: row.type as MonitoringAlertType,
    severity: row.severity as MonitoringAlertState["severity"],
    status: row.status as MonitoringAlertStatus,
    occurrenceCount: row.occurrenceCount,
  };
}

function loadActiveAlerts(database: DatabaseClient, jobId: number): MonitoringAlertState[] {
  return database
    .select({
      id: monitoringAlerts.id,
      type: monitoringAlerts.type,
      severity: monitoringAlerts.severity,
      status: monitoringAlerts.status,
      occurrenceCount: monitoringAlerts.occurrenceCount,
    })
    .from(monitoringAlerts)
    .where(
      and(
        eq(monitoringAlerts.jobId, jobId),
        inArray(monitoringAlerts.status, [...ACTIVE_ALERT_STATUSES]),
      ),
    )
    .orderBy(desc(monitoringAlerts.createdAt))
    .all()
    .map(alertState);
}

function idempotentResult(
  database: DatabaseClient,
  run: { id: number; jobId: number; referenceRunId: number | null },
): IngestMonitoringRunResult {
  const openFindingCount = database
    .select({ id: monitoringFindings.id })
    .from(monitoringFindings)
    .where(and(eq(monitoringFindings.jobId, run.jobId), isNull(monitoringFindings.resolvedAt)))
    .all().length;

  return {
    runId: run.id,
    idempotent: true,
    referenceRunId: run.referenceRunId,
    findings: { created: 0, recurring: 0, reopened: 0, resolved: 0, open: openFindingCount },
    alerts: {
      created: 0,
      deduplicated: 0,
      resolved: 0,
      active: loadActiveAlerts(database, run.jobId),
    },
  };
}

/**
 * Persist one completed read-only monitoring run atomically.
 *
 * - run ingestion is idempotent per job
 * - finding rows model the current incident, while observations retain history
 * - findings absent from the new run are resolved
 * - active alert incidents are deduplicated by job + rule key
 * - cleared alert incidents are resolved and can open as a new incident later
 */
export function ingestMonitoringRun(
  input: IngestMonitoringRunInput,
  database: DatabaseClient = defaultDb,
): IngestMonitoringRunResult {
  validateInput(input);

  const existingRun = database
    .select({
      id: monitoringRuns.id,
      jobId: monitoringRuns.jobId,
      referenceRunId: monitoringRuns.referenceRunId,
    })
    .from(monitoringRuns)
    .where(
      and(
        eq(monitoringRuns.jobId, input.jobId),
        eq(monitoringRuns.ingestKey, input.idempotencyKey),
      ),
    )
    .get();
  if (existingRun) return idempotentResult(database, existingRun);

  const job = database
    .select()
    .from(monitoringJobs)
    .where(eq(monitoringJobs.id, input.jobId))
    .get();
  if (!job) {
    throw new MonitoringIngestError("JOB_NOT_FOUND", `monitoring job ${input.jobId} was not found`);
  }
  if (job.status !== "active") {
    throw new MonitoringIngestError("JOB_INACTIVE", `monitoring job ${input.jobId} is not active`);
  }

  const completedAtDate = parseDate(input.completedAt, "completedAt");
  const actionableFindings = input.findings.filter(
    (finding) => !activeManualOverride(finding, completedAtDate),
  );
  const currentSnapshot: MonitoringRunSnapshot = {
    completedAt: input.completedAt,
    totalAppRecords: input.totalAppRecords,
    totalStripeRecords: input.totalStripeRecords,
    mismatchCount: actionableFindings.length,
    paidBlockedCount: actionableFindings.filter((finding) => finding.category === "B").length,
    unpaidActiveCount: actionableFindings.filter((finding) => finding.category === "A").length,
    mismatchRate:
      mismatchRateBps(
        actionableFindings.length,
        input.totalAppRecords,
        input.totalStripeRecords,
      ) / 10_000,
  };

  return database.transaction((tx) => {
    const historicalRuns = tx
      .select({
        id: monitoringRuns.id,
        completedAt: monitoringRuns.completedAt,
        totalAppRecords: monitoringRuns.totalAppRecords,
        totalStripeRecords: monitoringRuns.totalStripeRecords,
        mismatchCount: monitoringRuns.mismatchCount,
        paidBlockedCount: monitoringRuns.paidBlockedCount,
        unpaidActiveCount: monitoringRuns.unpaidActiveCount,
        mismatchRateBps: monitoringRuns.mismatchRateBps,
      })
      .from(monitoringRuns)
      .where(eq(monitoringRuns.jobId, input.jobId))
      .orderBy(desc(monitoringRuns.completedAt))
      .limit(100)
      .all()
      .map<MonitoringRunSnapshot>((run) => ({
        id: run.id,
        completedAt: run.completedAt,
        totalAppRecords: run.totalAppRecords,
        totalStripeRecords: run.totalStripeRecords,
        mismatchCount: run.mismatchCount,
        paidBlockedCount: run.paidBlockedCount,
        unpaidActiveCount: run.unpaidActiveCount,
        mismatchRate: run.mismatchRateBps / 10_000,
      }));

    const referenceRun = selectFixedReferenceRun(historicalRuns, input.completedAt, {
      referenceAgeDays: job.referenceAgeDays,
      referenceToleranceDays: job.referenceToleranceDays,
    });
    const referenceRunId = referenceRun?.id == null ? null : Number(referenceRun.id);

    const insertedRun = tx
      .insert(monitoringRuns)
      .values({
        jobId: input.jobId,
        ingestKey: input.idempotencyKey,
        source: input.source ?? "api",
        status: "completed",
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        totalAppRecords: input.totalAppRecords,
        totalStripeRecords: input.totalStripeRecords,
        mismatchCount: currentSnapshot.mismatchCount,
        paidBlockedCount: currentSnapshot.paidBlockedCount,
        unpaidActiveCount: currentSnapshot.unpaidActiveCount,
        mismatchRateBps: Math.round(currentSnapshot.mismatchRate * 10_000),
        referenceRunId,
      })
      .returning({ id: monitoringRuns.id })
      .get();
    const runId = insertedRun.id;

    const existingFindings = tx
      .select()
      .from(monitoringFindings)
      .where(eq(monitoringFindings.jobId, input.jobId))
      .all();
    const findingsByFingerprint = new Map(
      existingFindings.map((finding) => [finding.fingerprint, finding] as const),
    );
    const observedFingerprints = new Set<string>();

    let createdFindings = 0;
    let recurringFindings = 0;
    let reopenedFindings = 0;

    for (const suppliedFinding of input.findings) {
      const finding = {
        ...suppliedFinding,
        fingerprint: suppliedFinding.fingerprint.toLowerCase(),
      };
      observedFingerprints.add(finding.fingerprint);
      const existing = findingsByFingerprint.get(finding.fingerprint);
      let findingId: number;

      if (!existing) {
        const inserted = tx
          .insert(monitoringFindings)
          .values({
            jobId: input.jobId,
            fingerprint: finding.fingerprint,
            category: finding.category,
            direction: finding.direction ?? null,
            severity: finding.severity,
            firstSeenAt: input.completedAt,
            lastSeenAt: input.completedAt,
            firstSeenRunId: runId,
            lastSeenRunId: runId,
            resolvedAt: null,
            resolvedRunId: null,
            manualOverride: finding.manualOverride ?? false,
            overrideActor: finding.overrideActor ?? null,
            overrideReason: finding.overrideReason ?? null,
            overrideExpiresAt: finding.overrideExpiresAt ?? null,
          })
          .returning({ id: monitoringFindings.id })
          .get();
        findingId = inserted.id;
        createdFindings += 1;
      } else {
        findingId = existing.id;
        const reappeared = existing.resolvedAt !== null;
        tx.update(monitoringFindings)
          .set({
            category: finding.category,
            direction: finding.direction ?? null,
            severity: finding.severity,
            firstSeenAt: reappeared ? input.completedAt : existing.firstSeenAt,
            firstSeenRunId: reappeared ? runId : existing.firstSeenRunId,
            lastSeenAt: input.completedAt,
            lastSeenRunId: runId,
            resolvedAt: null,
            resolvedRunId: null,
            manualOverride: finding.manualOverride ?? false,
            overrideActor: finding.overrideActor ?? null,
            overrideReason: finding.overrideReason ?? null,
            overrideExpiresAt: finding.overrideExpiresAt ?? null,
          })
          .where(eq(monitoringFindings.id, existing.id))
          .run();
        if (reappeared) reopenedFindings += 1;
        else recurringFindings += 1;
      }

      tx.insert(monitoringFindingObservations)
        .values({ runId, findingId, observedAt: input.completedAt })
        .run();
    }

    let resolvedFindings = 0;
    for (const finding of existingFindings) {
      if (finding.resolvedAt === null && !observedFingerprints.has(finding.fingerprint)) {
        tx.update(monitoringFindings)
          .set({ resolvedAt: input.completedAt, resolvedRunId: runId })
          .where(eq(monitoringFindings.id, finding.id))
          .run();
        resolvedFindings += 1;
      }
    }

    const openFindings = tx
      .select()
      .from(monitoringFindings)
      .where(and(eq(monitoringFindings.jobId, input.jobId), isNull(monitoringFindings.resolvedAt)))
      .all();
    const queueFindings = openFindings.filter(
      (finding) =>
        !activeManualOverride(
          {
            manualOverride: finding.manualOverride,
            overrideExpiresAt: finding.overrideExpiresAt,
          },
          completedAtDate,
        ),
    );
    const oldestUnresolvedFirstSeenAt = queueFindings
      .map((finding) => finding.firstSeenAt)
      .sort()[0] ?? null;

    const alertCandidates = evaluateMonitoringAlerts({
      run: { ...currentSnapshot, id: runId },
      referenceRun,
      oldestUnresolvedFirstSeenAt,
      now: input.completedAt,
      config: {
        paidBlockedThreshold: job.paidBlockedThreshold,
        driftRateIncreaseThreshold: job.driftRateIncreaseBps / 10_000,
        queueAgeThresholdDays: job.queueAgeThresholdHours / 24,
        referenceAgeDays: job.referenceAgeDays,
        referenceToleranceDays: job.referenceToleranceDays,
      },
    });

    const activeAlerts = tx
      .select()
      .from(monitoringAlerts)
      .where(
        and(
          eq(monitoringAlerts.jobId, input.jobId),
          inArray(monitoringAlerts.status, [...ACTIVE_ALERT_STATUSES]),
        ),
      )
      .all();
    const activeAlertsByKey = new Map(
      activeAlerts.map((alert) => [alert.dedupeKey, alert] as const),
    );
    const triggeredKeys = new Set(alertCandidates.map((candidate) => candidate.dedupeKey));

    let createdAlerts = 0;
    let deduplicatedAlerts = 0;
    for (const candidate of alertCandidates) {
      const activeAlert = activeAlertsByKey.get(candidate.dedupeKey);
      if (activeAlert) {
        tx.update(monitoringAlerts)
          .set({
            lastRunId: runId,
            severity: candidate.severity,
            title: candidate.title,
            details: JSON.stringify(candidate),
            occurrenceCount: activeAlert.occurrenceCount + 1,
            lastTriggeredAt: input.completedAt,
            updatedAt: input.completedAt,
          })
          .where(eq(monitoringAlerts.id, activeAlert.id))
          .run();
        deduplicatedAlerts += 1;
      } else {
        tx.insert(monitoringAlerts)
          .values({
            jobId: input.jobId,
            runId,
            lastRunId: runId,
            resolvedRunId: null,
            type: candidate.type,
            severity: candidate.severity,
            status: "open",
            dedupeKey: candidate.dedupeKey,
            title: candidate.title,
            details: JSON.stringify(candidate),
            occurrenceCount: 1,
            firstTriggeredAt: input.completedAt,
            lastTriggeredAt: input.completedAt,
            resolvedAt: null,
            createdAt: input.completedAt,
            updatedAt: input.completedAt,
          })
          .run();
        createdAlerts += 1;
      }
    }

    let resolvedAlerts = 0;
    for (const alert of activeAlerts) {
      if (!triggeredKeys.has(alert.dedupeKey)) {
        tx.update(monitoringAlerts)
          .set({
            status: "resolved",
            resolvedAt: input.completedAt,
            resolvedRunId: runId,
            updatedAt: input.completedAt,
          })
          .where(eq(monitoringAlerts.id, alert.id))
          .run();
        resolvedAlerts += 1;
      }
    }

    const resultingActiveAlerts = tx
      .select({
        id: monitoringAlerts.id,
        type: monitoringAlerts.type,
        severity: monitoringAlerts.severity,
        status: monitoringAlerts.status,
        occurrenceCount: monitoringAlerts.occurrenceCount,
      })
      .from(monitoringAlerts)
      .where(
        and(
          eq(monitoringAlerts.jobId, input.jobId),
          inArray(monitoringAlerts.status, [...ACTIVE_ALERT_STATUSES]),
        ),
      )
      .orderBy(desc(monitoringAlerts.createdAt))
      .all()
      .map(alertState);

    return {
      runId,
      idempotent: false,
      referenceRunId,
      findings: {
        created: createdFindings,
        recurring: recurringFindings,
        reopened: reopenedFindings,
        resolved: resolvedFindings,
        open: openFindings.length,
      },
      alerts: {
        created: createdAlerts,
        deduplicated: deduplicatedAlerts,
        resolved: resolvedAlerts,
        active: resultingActiveAlerts,
      },
    };
  });
}
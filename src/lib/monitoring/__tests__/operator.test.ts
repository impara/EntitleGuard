import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeDatabase, type DatabaseClient } from "../../../db";
import { ingestMonitoringRun } from "../ingest-run";
import {
  createMonitoringJob,
  getMonitoringJobDetail,
  listMonitoringJobOverviews,
  MonitoringJobError,
  updateMonitoringJob,
} from "../operator";

function fingerprint(character: string): string {
  return character.repeat(64);
}

describe("monitoring operator model", () => {
  let sqlite: Database.Database;
  let database: DatabaseClient;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    database = initializeDatabase(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("bootstraps and configures a monitoring job", () => {
    const created = createMonitoringJob({ name: "Design partner" }, database);

    expect(created).toMatchObject({
      name: "Design partner",
      schedule: "nightly",
      status: "active",
      paidBlockedThreshold: 1,
      driftRateIncreaseBps: 100,
      queueAgeThresholdHours: 168,
      referenceAgeDays: 28,
      referenceToleranceDays: 7,
    });
    expect(getMonitoringJobDetail(created.id, database)).toMatchObject({
      health: "no_data",
      latestRun: null,
      activeAlerts: [],
      recentRuns: [],
    });

    const updated = updateMonitoringJob(
      created.id,
      {
        name: "Partner production",
        schedule: "manual",
        status: "paused",
        queueAgeThresholdHours: 48,
        referenceAgeDays: 35,
        referenceToleranceDays: 7,
      },
      database,
    );

    expect(updated).toMatchObject({
      name: "Partner production",
      schedule: "manual",
      status: "paused",
      queueAgeThresholdHours: 48,
      referenceAgeDays: 35,
      referenceToleranceDays: 7,
    });
    expect(listMonitoringJobOverviews(database)[0]).toMatchObject({ health: "paused" });
  });

  it("returns an aggregate critical operator view without exposing finding fingerprints", () => {
    const job = createMonitoringJob({ name: "Production" }, database);
    const secretFingerprint = fingerprint("a");

    ingestMonitoringRun(
      {
        jobId: job.id,
        idempotencyKey: "critical-1",
        source: "api",
        completeSnapshot: true,
        startedAt: "2026-08-01T00:00:00.000Z",
        completedAt: "2026-08-01T00:01:00.000Z",
        totalAppRecords: 100,
        totalStripeRecords: 100,
        findings: [
          {
            fingerprint: secretFingerprint,
            category: "B",
            direction: "grant",
            severity: "high",
          },
        ],
      },
      database,
    );

    const detail = getMonitoringJobDetail(job.id, database, {
      now: new Date("2026-08-01T00:02:00.000Z"),
    });

    expect(detail).toMatchObject({
      health: "critical",
      activeAlertCounts: { critical: 1, warning: 0 },
      findings: {
        open: 1,
        actionable: 1,
        activeOverrides: 0,
        actionableByCategory: { A: 0, B: 1, C: 0, D: 0, E: 0 },
      },
    });
    expect(detail.latestRun).toMatchObject({ paidBlockedCount: 1, mismatchCount: 1 });
    expect(detail.activeAlerts[0]).toMatchObject({
      type: "paid_blocked",
      severity: "critical",
      status: "open",
      occurrenceCount: 1,
    });
    expect(JSON.stringify(detail)).not.toContain(secretFingerprint);
  });

  it("reports active override provenance as non-actionable aggregate state", () => {
    const job = createMonitoringJob({ name: "Overrides" }, database);

    ingestMonitoringRun(
      {
        jobId: job.id,
        idempotencyKey: "override-1",
        completeSnapshot: true,
        startedAt: "2026-08-01T00:00:00.000Z",
        completedAt: "2026-08-01T00:01:00.000Z",
        totalAppRecords: 20,
        totalStripeRecords: 20,
        findings: [
          {
            fingerprint: fingerprint("b"),
            category: "E",
            severity: "low",
            manualOverride: true,
            overrideActor: "support@example.invalid",
            overrideReason: "Contractual extension",
            overrideExpiresAt: "2026-09-01T00:00:00.000Z",
          },
        ],
      },
      database,
    );

    const detail = getMonitoringJobDetail(job.id, database, {
      now: new Date("2026-08-02T00:00:00.000Z"),
    });

    expect(detail.health).toBe("healthy");
    expect(detail.findings).toEqual({
      open: 1,
      actionable: 0,
      activeOverrides: 1,
      oldestActionableFirstSeenAt: null,
      actionableByCategory: { A: 0, B: 0, C: 0, D: 0, E: 0 },
    });
  });

  it("rejects unsafe or internally inconsistent job configuration", () => {
    expect(() =>
      createMonitoringJob(
        { name: "Bad baseline", referenceAgeDays: 7, referenceToleranceDays: 7 },
        database,
      ),
    ).toThrow(MonitoringJobError);
    expect(() => updateMonitoringJob(999, {}, database)).toThrow("at least one job field");
  });
});

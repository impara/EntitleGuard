import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  initializeDatabase,
  monitoringAlerts,
  monitoringFindingObservations,
  monitoringFindings,
  monitoringJobs,
  monitoringRuns,
  type DatabaseClient,
} from "../../../db";
import { ingestMonitoringRun } from "../ingest-run";
import type { IngestMonitoringRunInput, MonitoringFindingInput } from "../types";

function fingerprint(character: string): string {
  return character.repeat(64);
}

function finding(
  value: string,
  category: MonitoringFindingInput["category"],
  extra: Partial<MonitoringFindingInput> = {},
): MonitoringFindingInput {
  return {
    fingerprint: fingerprint(value),
    category,
    severity: category === "A" || category === "B" ? "high" : "medium",
    direction: category === "A" ? "revoke" : category === "B" ? "grant" : null,
    ...extra,
  };
}

describe("monitoring run ingestion", () => {
  let sqlite: Database.Database;
  let database: DatabaseClient;
  let jobId: number;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    database = initializeDatabase(sqlite);
    jobId = database
      .insert(monitoringJobs)
      .values({ name: "Design partner" })
      .returning({ id: monitoringJobs.id })
      .get().id;
  });

  afterEach(() => {
    sqlite.close();
  });

  it("persists finding lifecycle, deduplicates active alerts, and is idempotent", () => {
    const first = ingestMonitoringRun(
      {
        jobId,
        idempotencyKey: "run-1",
        startedAt: "2026-07-01T00:00:00.000Z",
        completedAt: "2026-07-01T00:01:00.000Z",
        totalAppRecords: 10,
        totalStripeRecords: 10,
        findings: [finding("a", "B")],
      },
      database,
    );

    expect(first.idempotent).toBe(false);
    expect(first.findings).toMatchObject({ created: 1, recurring: 0, reopened: 0, open: 1 });
    expect(first.alerts.created).toBe(1);
    expect(first.alerts.active).toHaveLength(1);
    expect(first.alerts.active[0]).toMatchObject({ type: "paid_blocked", occurrenceCount: 1 });

    const secondInput: IngestMonitoringRunInput = {
      jobId,
      idempotencyKey: "run-2",
      startedAt: "2026-07-02T00:00:00.000Z",
      completedAt: "2026-07-02T00:01:00.000Z",
      totalAppRecords: 10,
      totalStripeRecords: 10,
      findings: [finding("a", "B")],
    };
    const second = ingestMonitoringRun(secondInput, database);

    expect(second.findings).toMatchObject({ created: 0, recurring: 1, reopened: 0, resolved: 0 });
    expect(second.alerts).toMatchObject({ created: 0, deduplicated: 1, resolved: 0 });
    expect(second.alerts.active[0]).toMatchObject({ type: "paid_blocked", occurrenceCount: 2 });
    expect(database.select().from(monitoringAlerts).all()).toHaveLength(1);
    expect(database.select().from(monitoringFindingObservations).all()).toHaveLength(2);

    const replay = ingestMonitoringRun(secondInput, database);
    expect(replay.idempotent).toBe(true);
    expect(database.select().from(monitoringRuns).all()).toHaveLength(2);
    expect(database.select().from(monitoringFindingObservations).all()).toHaveLength(2);

    const cleared = ingestMonitoringRun(
      {
        jobId,
        idempotencyKey: "run-3",
        startedAt: "2026-07-03T00:00:00.000Z",
        completedAt: "2026-07-03T00:01:00.000Z",
        totalAppRecords: 10,
        totalStripeRecords: 10,
        findings: [],
      },
      database,
    );

    expect(cleared.findings).toMatchObject({ resolved: 1, open: 0 });
    expect(cleared.alerts).toMatchObject({ resolved: 1, active: [] });
    expect(database.select().from(monitoringFindings).get()?.resolvedAt).toBe(
      "2026-07-03T00:01:00.000Z",
    );
    expect(database.select().from(monitoringAlerts).get()?.status).toBe("resolved");

    const reappeared = ingestMonitoringRun(
      {
        jobId,
        idempotencyKey: "run-4",
        startedAt: "2026-07-04T00:00:00.000Z",
        completedAt: "2026-07-04T00:01:00.000Z",
        totalAppRecords: 10,
        totalStripeRecords: 10,
        findings: [finding("a", "B")],
      },
      database,
    );

    expect(reappeared.findings).toMatchObject({ reopened: 1, open: 1 });
    expect(reappeared.alerts.created).toBe(1);
    expect(database.select().from(monitoringAlerts).all()).toHaveLength(2);
    expect(
      database
        .select()
        .from(monitoringFindings)
        .where(eq(monitoringFindings.jobId, jobId))
        .get()?.firstSeenAt,
    ).toBe("2026-07-04T00:01:00.000Z");
  });

  it("selects a fixed historical run and persists a drift alert", () => {
    const baseline = ingestMonitoringRun(
      {
        jobId,
        idempotencyKey: "baseline",
        startedAt: "2026-06-03T00:00:00.000Z",
        completedAt: "2026-06-03T00:01:00.000Z",
        totalAppRecords: 100,
        totalStripeRecords: 100,
        findings: [finding("1", "A")],
      },
      database,
    );

    const current = ingestMonitoringRun(
      {
        jobId,
        idempotencyKey: "current",
        startedAt: "2026-07-01T00:00:00.000Z",
        completedAt: "2026-07-01T00:01:00.000Z",
        totalAppRecords: 100,
        totalStripeRecords: 100,
        findings: [finding("2", "A"), finding("3", "A"), finding("4", "A")],
      },
      database,
    );

    expect(current.referenceRunId).toBe(baseline.runId);
    expect(current.alerts.active).toEqual([
      expect.objectContaining({ type: "drift", status: "open", occurrenceCount: 1 }),
    ]);
    expect(
      database
        .select()
        .from(monitoringRuns)
        .where(eq(monitoringRuns.id, current.runId))
        .get()?.referenceRunId,
    ).toBe(baseline.runId);
  });

  it("keeps active manual overrides out of drift and queue-age alerts", () => {
    ingestMonitoringRun(
      {
        jobId,
        idempotencyKey: "override-1",
        startedAt: "2026-05-01T00:00:00.000Z",
        completedAt: "2026-05-01T00:01:00.000Z",
        totalAppRecords: 10,
        totalStripeRecords: 10,
        findings: [
          finding("b", "E", {
            manualOverride: true,
            overrideActor: "support@example.invalid",
            overrideReason: "Contractual access extension",
          }),
        ],
      },
      database,
    );

    const current = ingestMonitoringRun(
      {
        jobId,
        idempotencyKey: "override-2",
        startedAt: "2026-06-12T00:00:00.000Z",
        completedAt: "2026-06-12T00:01:00.000Z",
        totalAppRecords: 10,
        totalStripeRecords: 10,
        findings: [
          finding("b", "E", {
            manualOverride: true,
            overrideActor: "support@example.invalid",
            overrideReason: "Contractual access extension",
          }),
        ],
      },
      database,
    );

    expect(current.alerts.active).toEqual([]);
    expect(
      database
        .select()
        .from(monitoringRuns)
        .where(eq(monitoringRuns.id, current.runId))
        .get()?.mismatchCount,
    ).toBe(0);
  });
});
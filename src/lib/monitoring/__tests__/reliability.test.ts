import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  initializeDatabase,
  monitoringAlerts,
  monitoringFindings,
  monitoringRuns,
  monitoringScheduleExecutions,
  type DatabaseClient,
} from "../../../db";
import { ingestMonitoringRun } from "../ingest-run";
import { createMonitoringJob, getMonitoringJobDetail } from "../operator";
import {
  hasNewFindingIncidents,
  monitoringDataHealth,
  snapshotIsStale,
  sourceCountCollapsed,
} from "../reliability";
import { runNightlyMonitoring } from "../scheduler";
import type { IngestMonitoringRunInput, MonitoringFindingInput } from "../types";

const account = (id: string, extra: Partial<MonitoringFindingInput> = {}): MonitoringFindingInput => ({
  fingerprint: id.repeat(64), category: "B", severity: "high", direction: "grant", ...extra,
});

const snapshot = (day: number, extra: Partial<IngestMonitoringRunInput> = {}): IngestMonitoringRunInput => ({
  jobId: 1,
  idempotencyKey: `run-${day}`,
  completeSnapshot: true,
  startedAt: `2026-08-${String(day).padStart(2, "0")}T00:00:00.000Z`,
  completedAt: `2026-08-${String(day).padStart(2, "0")}T00:01:00.000Z`,
  totalAppRecords: 100,
  totalStripeRecords: 100,
  findings: [account("a")],
  ...extra,
});

describe("monitoring reliability guards", () => {
  it.each([
    [100, 0, true], [1, 0, true], [100, 20, true], [10, 2, true],
    [100, 21, false], [9, 1, false], [0, 0, false], [100, 101, false],
  ])("source-count change %s -> %s is suspicious: %s", (previous, current, expected) => {
    expect(sourceCountCollapsed(previous as number, current as number)).toBe(expected);
  });

  it("compares instants across offsets and catches older acquisition starts", () => {
    const previous = snapshot(2);
    expect(snapshotIsStale({ ...snapshot(2), completedAt: "2026-08-01T20:02:00-04:00" }, previous)).toBe(false);
    expect(snapshotIsStale({ ...snapshot(3), startedAt: snapshot(1).startedAt }, previous)).toBe(true);
    expect(snapshotIsStale(previous, previous)).toBe(true);
  });

  it("does not confuse a same-size replacement or a reopened finding with a known incident", () => {
    const details = JSON.stringify({ findingIncidents: ["1:10", "2:10"] });
    expect(hasNewFindingIncidents(details, ["2:10", "1:10"])).toBe(false);
    expect(hasNewFindingIncidents(details, ["1:10"])).toBe(false);
    expect(hasNewFindingIncidents(details, ["1:10", "3:12"])).toBe(true);
    expect(hasNewFindingIncidents(details, ["1:20", "2:10"])).toBe(true);
  });

  it.each(["{}", "null", "bad JSON", '{"findingIncidents":[123]}'])(
    "does not let legacy or corrupt membership suppress an alert: %s", (details) => {
      expect(hasNewFindingIncidents(details, ["1:10"])).toBe(true);
    },
  );

  it("distinguishes no data, paused, fresh, stale, invalid, and future observations", () => {
    const run = { id: 1, status: "completed", completedAt: "2026-08-01T00:00:00.000Z" };
    expect(monitoringDataHealth("active", null, null, new Date(run.completedAt)).status).toBe("no_data");
    expect(monitoringDataHealth("paused", null, null, new Date(run.completedAt)).status).toBe("paused");
    expect(monitoringDataHealth("active", run, null, new Date("2026-08-02T11:59:59Z")).status).toBe("fresh");
    expect(monitoringDataHealth("active", run, null, new Date("2026-08-02T12:00:00Z")).status).toBe("stale");
    expect(monitoringDataHealth("active", run, null, new Date("2026-07-31T00:00:00Z")).status).toBe("failed");
    expect(monitoringDataHealth("active", { ...run, completedAt: "bad" }, null, new Date()).status).toBe("failed");
  });

  it("reports delivery failures and stalled executions, and recovers after a newer successful run", () => {
    const run = { id: 1, status: "completed", completedAt: "2026-08-01T00:00:00Z" };
    const execution = {
      status: "failed", runId: 1, startedAt: "2026-08-01T00:01:00Z",
      completedAt: "2026-08-01T00:02:00Z", updatedAt: "2026-08-01T00:02:00Z",
    };
    const now = new Date("2026-08-01T03:00:00Z");
    expect(monitoringDataHealth("active", run, execution, now).status).toBe("failed");
    expect(monitoringDataHealth("active", run, { ...execution, status: "running", completedAt: null }, now).status).toBe("failed");
    expect(monitoringDataHealth("active", { ...run, id: 2, completedAt: "2026-08-01T02:00:00Z" }, execution, now).status).toBe("fresh");
  });
});

describe("monitoring reliability persistence", () => {
  let sqlite: Database.Database;
  let database: DatabaseClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-10T03:00:00.000Z"));
    sqlite = new Database(":memory:");
    database = initializeDatabase(sqlite);
    createMonitoringJob({ name: "Reliability partner" }, database);
  });

  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
  });

  function acknowledge(id: number) {
    database.update(monitoringAlerts).set({
      status: "acknowledged", acknowledgedBy: "support", acknowledgedAt: "2026-08-01T02:00:00Z",
      acknowledgementNote: "Investigating the displayed accounts",
    }).where(eq(monitoringAlerts.id, id)).run();
  }

  it.each([
    { name: "an additional account", next: [account("a"), account("b")] },
    { name: "a same-count replacement", next: [account("b")] },
  ])("opens a new alert for $name without erasing the old acknowledgement", ({ next }) => {
    const first = ingestMonitoringRun(snapshot(1), database);
    const oldId = first.alerts.active[0].id;
    acknowledge(oldId);
    const nextInput = snapshot(2, { findings: next });
    const second = ingestMonitoringRun(nextInput, database);
    expect(second.alerts).toMatchObject({ created: 1, resolved: 1 });
    expect(second.alerts.active).toHaveLength(1);
    expect(second.alerts.active[0]).toMatchObject({ status: "open", occurrenceCount: 1 });
    expect(second.alerts.active[0].id).not.toBe(oldId);
    expect(database.select().from(monitoringAlerts).where(eq(monitoringAlerts.id, oldId)).get()).toMatchObject({
      status: "resolved", acknowledgedBy: "support", acknowledgementNote: "Investigating the displayed accounts",
    });
    expect(ingestMonitoringRun(nextInput, database).idempotent).toBe(true);
    expect(database.select().from(monitoringAlerts).all()).toHaveLength(2);
  });

  it("also rotates an open incident so an old UI cannot acknowledge newly added accounts", () => {
    const first = ingestMonitoringRun(snapshot(1), database);
    const second = ingestMonitoringRun(snapshot(2, { findings: [account("a"), account("b")] }), database);
    expect(second.alerts.active[0].id).not.toBe(first.alerts.active[0].id);
    expect(second.alerts.active[0].status).toBe("open");
    expect(database.select().from(monitoringFindings).all().every((finding) => finding.resolvedAt === null)).toBe(true);
  });

  it("keeps acknowledgement for unchanged/shrinking membership, but not a reopened account", () => {
    const first = ingestMonitoringRun(snapshot(1, { findings: [account("a"), account("b")] }), database);
    const id = first.alerts.active[0].id;
    acknowledge(id);
    const same = ingestMonitoringRun(snapshot(2, { findings: [account("b"), account("a")] }), database);
    expect(same.alerts.active[0]).toMatchObject({ id, status: "acknowledged" });
    const shrinking = ingestMonitoringRun(snapshot(3), database);
    expect(shrinking.alerts.active[0]).toMatchObject({ id, status: "acknowledged" });
    const reopened = ingestMonitoringRun(snapshot(4, { findings: [account("a"), account("b")] }), database);
    expect(reopened.findings.reopened).toBe(1);
    expect(reopened.alerts.active[0].status).toBe("open");
    expect(reopened.alerts.active[0].id).not.toBe(id);
  });

  it("alerts when an override expires instead of inheriting another account's acknowledgement", () => {
    const findings = [account("a"), account("b", { manualOverride: true, overrideExpiresAt: "2026-08-02T00:00:00Z" })];
    const first = ingestMonitoringRun(snapshot(1, { findings }), database);
    acknowledge(first.alerts.active[0].id);
    const second = ingestMonitoringRun(snapshot(2, { findings }), database);
    expect(second.alerts.active[0].status).toBe("open");
    expect(second.alerts.created).toBe(1);
  });

  it("upgrades legacy alert membership once and does not expose fingerprints in the operator response", () => {
    const first = ingestMonitoringRun(snapshot(1), database);
    acknowledge(first.alerts.active[0].id);
    database.update(monitoringAlerts).set({ details: "{}" }).where(eq(monitoringAlerts.id, first.alerts.active[0].id)).run();
    const upgraded = ingestMonitoringRun(snapshot(2), database);
    expect(upgraded.alerts.created).toBe(1);
    const repeated = ingestMonitoringRun(snapshot(3), database);
    expect(repeated.alerts.created).toBe(0);
    expect(JSON.stringify(getMonitoringJobDetail(1, database))).not.toContain("a".repeat(64));
  });

  it.each([
    { name: "an older completion", incoming: snapshot(1, { idempotencyKey: "old", findings: [] }) },
    { name: "an equal completion", incoming: snapshot(2, { idempotencyKey: "same-time", findings: [] }) },
    { name: "an older acquisition with a later finish", incoming: snapshot(3, { startedAt: snapshot(1).startedAt, findings: [] }) },
  ])("rejects $name without resolving or inserting anything", ({ incoming }) => {
    ingestMonitoringRun(snapshot(2), database);
    const findings = database.select().from(monitoringFindings).all();
    const alerts = database.select().from(monitoringAlerts).all();
    expect(() => ingestMonitoringRun(incoming, database)).toThrow("snapshot must be newer");
    expect(database.select().from(monitoringFindings).all()).toEqual(findings);
    expect(database.select().from(monitoringAlerts).all()).toEqual(alerts);
    expect(database.select().from(monitoringRuns).all()).toHaveLength(1);
  });

  it.each([
    { totalAppRecords: 0, totalStripeRecords: 0 },
    { totalAppRecords: 0, totalStripeRecords: 100 },
    { totalAppRecords: 100, totalStripeRecords: 0 },
    { totalAppRecords: 20, totalStripeRecords: 100 },
  ])("rejects suspicious source counts %j without clearing current findings", (counts) => {
    ingestMonitoringRun(snapshot(1), database);
    expect(() => ingestMonitoringRun(snapshot(2, { ...counts, findings: [] }), database)).toThrow("source count collapsed");
    expect(database.select().from(monitoringRuns).all()).toHaveLength(1);
    expect(database.select().from(monitoringFindings).get()?.resolvedAt).toBeNull();
    expect(database.select().from(monitoringAlerts).get()?.status).toBe("open");
  });

  it("accepts a confirmed legitimate empty snapshot and still permits older idempotent retries", () => {
    const firstInput = snapshot(1);
    ingestMonitoringRun(firstInput, database);
    const result = ingestMonitoringRun(snapshot(2, {
      totalAppRecords: 0, totalStripeRecords: 0, findings: [], allowSourceCountDrop: true,
    }), database);
    expect(result.findings).toMatchObject({ resolved: 1, open: 0 });
    expect(ingestMonitoringRun(firstInput, database).idempotent).toBe(true);
    expect(database.select().from(monitoringFindings).get()?.resolvedAt).toBe(snapshot(2).completedAt);
  });

  it("normalizes offset-bearing timestamps before storage", () => {
    ingestMonitoringRun(snapshot(1, {
      startedAt: "2026-08-01T02:00:00+02:00", completedAt: "2026-08-01T02:01:00+02:00",
    }), database);
    expect(database.select().from(monitoringRuns).get()).toMatchObject({
      startedAt: snapshot(1).startedAt, completedAt: snapshot(1).completedAt,
    });
  });

  it("orders legacy offset-bearing runs chronologically, not lexicographically", () => {
    ingestMonitoringRun(snapshot(1), database);
    database.update(monitoringRuns).set({
      startedAt: "2026-08-01T23:00:00-07:00", completedAt: "2026-08-01T23:01:00-07:00",
    }).where(eq(monitoringRuns.id, 1)).run();
    expect(() => ingestMonitoringRun(snapshot(2), database)).toThrow("snapshot must be newer");
  });

  it.each([-1, 0.5, NaN, Infinity])("rejects invalid internal record count %s", (count) => {
    expect(() => ingestMonitoringRun(snapshot(1, { totalAppRecords: count }), database)).toThrow("safe integers");
    expect(database.select().from(monitoringRuns).all()).toHaveLength(0);
  });

  it("validates completeness and future timestamps at the service boundary too", () => {
    expect(() => ingestMonitoringRun({ ...snapshot(1), completeSnapshot: false } as unknown as IngestMonitoringRunInput, database)).toThrow("completeSnapshot");
    expect(() => ingestMonitoringRun(snapshot(1, { completedAt: new Date(Date.now() + 600_000).toISOString() }), database)).toThrow("future");
  });

  it("shows stale/failed monitoring separately from access-alert severity", () => {
    ingestMonitoringRun(snapshot(1, { findings: [] }), database);
    expect(getMonitoringJobDetail(1, database, { now: new Date("2026-08-03T00:00:00Z") })).toMatchObject({
      health: "stale", dataHealth: { status: "stale" },
    });
    const critical = ingestMonitoringRun(snapshot(2), database);
    expect(getMonitoringJobDetail(1, database, { now: new Date("2026-08-05T00:00:00Z") })).toMatchObject({
      health: "critical", dataHealth: { status: "stale" },
    });
    database.insert(monitoringScheduleExecutions).values({
      jobId: 1, scheduleKey: "2026-08-02", status: "failed", startedAt: "2026-08-02T03:00:00Z",
      completedAt: "2026-08-02T03:01:00Z", updatedAt: "2026-08-02T03:01:00Z", runId: critical.runId,
    }).run();
    expect(getMonitoringJobDetail(1, database, { now: new Date("2026-08-02T04:00:00Z") }).dataHealth.status).toBe("failed");
  });

  it("delivers a new account alert after acknowledgement and records a rejected scheduled snapshot as failed", async () => {
    let current = snapshot(1);
    const sent = vi.fn(async () => ({ id: "message" }));
    const config = {
      sourceUrl: "https://source.example.invalid/snapshot", alertTo: ["ops@example.invalid"],
      alertFrom: "alerts@example.invalid", resendApiKey: "test-only",
    };
    const fetchSource = (async () => Response.json({
      completeSnapshot: true, startedAt: current.startedAt, completedAt: current.completedAt,
      totalAppRecords: current.totalAppRecords, totalStripeRecords: current.totalStripeRecords,
      findings: current.findings,
    })) as typeof fetch;
    const run = async (day: number) => {
      const now = new Date(`2026-08-0${day}T03:00:00.000Z`);
      vi.setSystemTime(now);
      return runNightlyMonitoring(config, database, { now, fetch: fetchSource, sendEmail: sent });
    };
    const first = await run(1);
    expect(first.completed).toBe(1);
    acknowledge(database.select().from(monitoringAlerts).get()!.id);
    current = snapshot(2, { findings: [account("a"), account("b")] });
    const second = await run(2);
    expect(second.jobs[0].alertsDelivered).toBe(1);
    expect(sent).toHaveBeenCalledTimes(2);
    current = snapshot(3, { totalAppRecords: 0, totalStripeRecords: 0, findings: [] });
    expect((await run(3)).failed).toBe(1);
    expect(database.select().from(monitoringRuns).all()).toHaveLength(2);
    expect(database.select().from(monitoringFindings).all().every((finding) => finding.resolvedAt === null)).toBe(true);
    expect(getMonitoringJobDetail(1, database).dataHealth.status).toBe("failed");
  });
});

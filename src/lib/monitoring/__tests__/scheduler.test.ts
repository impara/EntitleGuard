import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  initializeDatabase,
  monitoringAlertNotifications,
  monitoringAlerts,
  monitoringRuns,
  monitoringScheduleExecutions,
  type DatabaseClient,
} from "../../../db";
import { createMonitoringJob } from "../operator";
import { runNightlyMonitoring, type MonitoringSchedulerConfig } from "../scheduler";

function fingerprint(character: string): string {
  return character.repeat(64);
}

function snapshot() {
  return {
    completeSnapshot: true,
    startedAt: "2026-08-01T00:00:00.000Z",
    completedAt: "2026-08-01T00:00:12.000Z",
    totalAppRecords: 100,
    totalStripeRecords: 100,
    findings: [
      {
        fingerprint: fingerprint("a"),
        category: "B",
        direction: "grant",
        severity: "high",
      },
    ],
  } as const;
}

const config: MonitoringSchedulerConfig = {
  sourceUrl: "https://source.example.invalid/nightly",
  sourceToken: "source-secret",
  alertTo: ["owner@example.invalid"],
  alertFrom: "EntitleGuard <alerts@example.invalid>",
  resendApiKey: "resend-secret",
  publicUrl: "https://entitleguard.example.invalid",
};

describe("nightly monitoring scheduler", () => {
  let sqlite: Database.Database;
  let database: DatabaseClient;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    database = initializeDatabase(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  it("claims each UTC date once and repeats critical email until acknowledgement", async () => {
    const job = createMonitoringJob({ name: "Production" }, database);
    const calls: string[] = [];
    const fakeFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url === config.sourceUrl) {
        expect(init?.headers).toMatchObject({ Authorization: "Bearer source-secret" });
        return Response.json(snapshot());
      }
      if (url === "https://api.resend.com/emails") {
        const body = JSON.parse(String(init?.body)) as { subject: string; to: string[] };
        expect(body.subject).toContain("Paying customer blocked");
        expect(body.to).toEqual(["owner@example.invalid"]);
        return Response.json({ id: `email-${calls.length}` });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;

    const first = await runNightlyMonitoring(config, database, {
      now: new Date("2026-08-01T03:00:00.000Z"),
      fetch: fakeFetch,
    });
    expect(first).toMatchObject({ completed: 1, skipped: 0, failed: 0 });
    expect(first.jobs[0]).toMatchObject({ status: "completed", alertsDelivered: 1 });
    expect(calls).toHaveLength(2);

    const duplicate = await runNightlyMonitoring(config, database, {
      now: new Date("2026-08-01T20:00:00.000Z"),
      fetch: fakeFetch,
    });
    expect(duplicate).toMatchObject({ completed: 0, skipped: 1, failed: 0 });
    expect(calls).toHaveLength(2);

    const secondDay = await runNightlyMonitoring(config, database, {
      now: new Date("2026-08-02T03:00:00.000Z"),
      fetch: fakeFetch,
    });
    expect(secondDay.jobs[0]).toMatchObject({ status: "completed", alertsDelivered: 1 });
    expect(calls).toHaveLength(4);
    expect(database.select().from(monitoringAlerts).get()).toMatchObject({ occurrenceCount: 2 });
    expect(database.select().from(monitoringAlertNotifications).all()).toHaveLength(2);

    const alertId = database.select().from(monitoringAlerts).get()!.id;
    database
      .update(monitoringAlerts)
      .set({
        status: "acknowledged",
        acknowledgedBy: "operator@example.invalid",
        acknowledgedAt: "2026-08-02T05:00:00.000Z",
      })
      .where(eq(monitoringAlerts.id, alertId))
      .run();

    const acknowledgedDay = await runNightlyMonitoring(config, database, {
      now: new Date("2026-08-03T03:00:00.000Z"),
      fetch: fakeFetch,
    });
    expect(acknowledgedDay.jobs[0]).toMatchObject({ status: "completed", alertsDelivered: 0 });
    expect(calls).toHaveLength(5);
    expect(database.select().from(monitoringScheduleExecutions).all()).toHaveLength(3);
  });

  it("retries a failed email without duplicating the monitoring run", async () => {
    createMonitoringJob({ name: "Retry partner" }, database);
    let emailAttempts = 0;
    const fakeFetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === config.sourceUrl) return Response.json(snapshot());
      if (url === "https://api.resend.com/emails") {
        emailAttempts += 1;
        if (emailAttempts === 1) return new Response("temporary outage", { status: 503 });
        return Response.json({ id: "email-retried" });
      }
      throw new Error(`Unexpected URL ${url}`);
    }) as typeof fetch;
    const now = new Date("2026-08-04T03:00:00.000Z");

    const failed = await runNightlyMonitoring(config, database, { now, fetch: fakeFetch });
    expect(failed).toMatchObject({ completed: 0, failed: 1 });
    expect(database.select().from(monitoringRuns).all()).toHaveLength(1);
    expect(database.select().from(monitoringAlertNotifications).get()).toMatchObject({
      status: "failed",
      attemptCount: 1,
    });

    const retried = await runNightlyMonitoring(config, database, { now, fetch: fakeFetch });
    expect(retried).toMatchObject({ completed: 1, failed: 0 });
    expect(database.select().from(monitoringRuns).all()).toHaveLength(1);
    expect(database.select().from(monitoringAlertNotifications).get()).toMatchObject({
      status: "delivered",
      attemptCount: 2,
      providerMessageId: "email-retried",
    });
    expect(database.select().from(monitoringScheduleExecutions).get()).toMatchObject({
      status: "completed",
      attemptCount: 2,
    });
  });

  it("rejects partial or malformed source snapshots before ingestion", async () => {
    createMonitoringJob({ name: "Unsafe source" }, database);
    const fakeFetch = (async () =>
      Response.json({
        completeSnapshot: false,
        totalAppRecords: 100,
        totalStripeRecords: 100,
        findings: [],
      })) as typeof fetch;

    const result = await runNightlyMonitoring(config, database, {
      now: new Date("2026-08-05T03:00:00.000Z"),
      fetch: fakeFetch,
    });

    expect(result).toMatchObject({ completed: 0, failed: 1 });
    expect(result.jobs[0].reason).toContain("invalid complete snapshot");
    expect(database.select().from(monitoringRuns).all()).toHaveLength(0);
    expect(database.select().from(monitoringAlertNotifications).all()).toHaveLength(0);
  });
});

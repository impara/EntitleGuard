import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initializeDatabase, type DatabaseClient } from "../../../db";
import { ingestMonitoringRun } from "../ingest-run";
import { createMonitoringJob } from "../operator";
import {
  listRecentMonitoringAlerts,
  MonitoringAlertActionError,
  transitionMonitoringAlert,
} from "../alert-actions";

function fingerprint(character: string): string {
  return character.repeat(64);
}

describe("monitoring alert actions", () => {
  let sqlite: Database.Database;
  let database: DatabaseClient;

  beforeEach(() => {
    sqlite = new Database(":memory:");
    database = initializeDatabase(sqlite);
  });

  afterEach(() => {
    sqlite.close();
  });

  function openCriticalAlert(): { jobId: number; alertId: number } {
    const job = createMonitoringJob({ name: "Production" }, database);
    const result = ingestMonitoringRun(
      {
        jobId: job.id,
        idempotencyKey: "critical-run",
        completeSnapshot: true,
        startedAt: "2026-08-01T00:00:00.000Z",
        completedAt: "2026-08-01T00:01:00.000Z",
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
      },
      database,
    );

    return { jobId: job.id, alertId: result.alerts.active[0].id };
  }

  it("acknowledges and resolves an alert with actor, time, and notes", () => {
    const { jobId, alertId } = openCriticalAlert();

    const acknowledged = transitionMonitoringAlert(
      alertId,
      {
        action: "acknowledge",
        actor: "on-call@example.invalid",
        note: "Investigating the access path",
        now: "2026-08-01T00:05:00.000Z",
      },
      database,
    );

    expect(acknowledged).toMatchObject({
      idempotent: false,
      alert: {
        status: "acknowledged",
        acknowledgedBy: "on-call@example.invalid",
        acknowledgedAt: "2026-08-01T00:05:00.000Z",
        acknowledgementNote: "Investigating the access path",
      },
    });

    const repeatedAcknowledgement = transitionMonitoringAlert(
      alertId,
      {
        action: "acknowledge",
        actor: "someone-else@example.invalid",
        now: "2026-08-01T00:06:00.000Z",
      },
      database,
    );
    expect(repeatedAcknowledgement.idempotent).toBe(true);
    expect(repeatedAcknowledgement.alert.acknowledgedBy).toBe("on-call@example.invalid");

    const resolved = transitionMonitoringAlert(
      alertId,
      {
        action: "resolve",
        actor: "owner@example.invalid",
        note: "Entitlement row repaired and verified",
        now: "2026-08-01T00:10:00.000Z",
      },
      database,
    );

    expect(resolved).toMatchObject({
      idempotent: false,
      alert: {
        status: "resolved",
        resolvedBy: "owner@example.invalid",
        resolvedAt: "2026-08-01T00:10:00.000Z",
        resolutionNote: "Entitlement row repaired and verified",
      },
    });
    expect(
      transitionMonitoringAlert(
        alertId,
        {
          action: "resolve",
          actor: "owner@example.invalid",
          now: "2026-08-01T00:11:00.000Z",
        },
        database,
      ).idempotent,
    ).toBe(true);

    const history = listRecentMonitoringAlerts(jobId, database);
    expect(history[0]).toMatchObject({
      id: alertId,
      status: "resolved",
      acknowledgedBy: "on-call@example.invalid",
      resolvedBy: "owner@example.invalid",
    });
  });

  it("rejects acknowledging a resolved incident and invalid provenance", () => {
    const { alertId } = openCriticalAlert();
    transitionMonitoringAlert(
      alertId,
      { action: "resolve", actor: "owner", now: "2026-08-01T00:10:00.000Z" },
      database,
    );

    expect(() =>
      transitionMonitoringAlert(
        alertId,
        { action: "acknowledge", actor: "owner" },
        database,
      ),
    ).toThrow(MonitoringAlertActionError);

    expect(() =>
      transitionMonitoringAlert(
        0,
        { action: "acknowledge", actor: "owner" },
        database,
      ),
    ).toThrow("positive integer");

    expect(() =>
      transitionMonitoringAlert(
        alertId,
        { action: "resolve", actor: "   " },
        database,
      ),
    ).toThrow("actor");
  });
});

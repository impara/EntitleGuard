import { describe, expect, it } from "vitest";
import { evaluateMonitoringAlerts, selectFixedReferenceRun } from "../evaluate-alerts";
import type { MonitoringRunSnapshot } from "../types";

function run(overrides: Partial<MonitoringRunSnapshot> = {}): MonitoringRunSnapshot {
  return {
    completedAt: "2026-07-30T06:00:00.000Z",
    totalAppRecords: 100,
    totalStripeRecords: 100,
    mismatchCount: 0,
    paidBlockedCount: 0,
    unpaidActiveCount: 0,
    mismatchRate: 0,
    ...overrides,
  };
}

describe("monitoring alert evaluation", () => {
  it("pages when one paying customer is blocked", () => {
    const alerts = evaluateMonitoringAlerts({
      run: run({ paidBlockedCount: 1, mismatchCount: 1, mismatchRate: 0.01 }),
    });

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "paid_blocked",
          severity: "critical",
          currentValue: 1,
          threshold: 1,
        }),
      ]),
    );
  });

  it("does not create a paid-blocked alert when the count is zero", () => {
    const alerts = evaluateMonitoringAlerts({ run: run() });
    expect(alerts.some((alert) => alert.type === "paid_blocked")).toBe(false);
  });

  it("selects a same-weekday fixed reference rather than a recent rolling point", () => {
    const reference = selectFixedReferenceRun(
      [
        run({ id: "yesterday", completedAt: "2026-07-29T06:00:00.000Z", mismatchRate: 0.04 }),
        run({ id: "fixed", completedAt: "2026-07-02T06:00:00.000Z", mismatchRate: 0.01 }),
        run({ id: "wrong-weekday", completedAt: "2026-07-03T06:00:00.000Z", mismatchRate: 0.005 }),
      ],
      "2026-07-30T06:00:00.000Z",
    );

    expect(reference?.id).toBe("fixed");
  });

  it("alerts when mismatch rate rises above the fixed reference threshold", () => {
    const alerts = evaluateMonitoringAlerts({
      run: run({ mismatchCount: 4, mismatchRate: 0.04 }),
      referenceRun: run({
        id: "reference",
        completedAt: "2026-07-02T06:00:00.000Z",
        mismatchCount: 1,
        mismatchRate: 0.01,
      }),
      config: { driftRateIncreaseThreshold: 0.02 },
    });

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "drift",
          severity: "warning",
          currentValue: 0.04,
          referenceValue: 0.01,
          threshold: 0.02,
        }),
      ]),
    );
  });

  it("alerts when the oldest unresolved mismatch exceeds the queue-age threshold", () => {
    const alerts = evaluateMonitoringAlerts({
      run: run(),
      oldestUnresolvedFirstSeenAt: "2026-07-15T06:00:00.000Z",
      config: { queueAgeThresholdDays: 7 },
    });

    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "queue_age",
          severity: "warning",
          currentValue: 15,
          threshold: 7,
        }),
      ]),
    );
  });
});

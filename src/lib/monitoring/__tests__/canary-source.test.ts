import { describe, expect, it } from "vitest";
import { canarySnapshot } from "../canary-source";

const NOW = new Date("2026-08-01T03:00:00.000Z");

describe("production canary source", () => {
  it("returns a complete healthy pseudonymous snapshot by default", () => {
    expect(canarySnapshot("healthy", "source-secret", NOW)).toEqual({
      completeSnapshot: true,
      startedAt: NOW.toISOString(),
      completedAt: NOW.toISOString(),
      totalAppRecords: 1,
      totalStripeRecords: 1,
      findings: [],
    });
  });

  it("can produce one deterministic paid-blocked finding for an approved alert test", () => {
    const first = canarySnapshot("paid_blocked", "source-secret", NOW);
    const second = canarySnapshot("paid_blocked", "source-secret", NOW);

    expect(first.findings).toHaveLength(1);
    expect(first.findings[0]).toMatchObject({
      category: "B",
      direction: "grant",
      severity: "high",
    });
    expect(first.findings[0].fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(second.findings[0].fingerprint).toBe(first.findings[0].fingerprint);
    expect(JSON.stringify(first)).not.toContain("source-secret");
  });
});

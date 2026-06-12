import { describe, expect, it } from "vitest";
import { estimateLeakage } from "../leakage";
import { maskEmail, maskId } from "../mask";
import type { Issue } from "../types";

function issue(overrides: Partial<Issue>): Issue {
  return {
    id: "A-1",
    category: "A",
    severity: "high",
    confidence: "high",
    explanation: "",
    maskedEmail: null,
    maskedCustomerId: null,
    maskedUserId: null,
    stripeStatus: "canceled",
    appStatus: "active",
    plan: null,
    estimatedMonthlyValue: null,
    matchTier: "customer_id",
    ...overrides,
  };
}

describe("estimateLeakage", () => {
  it("sums mapped per-account values, monthly and annualized", () => {
    const result = estimateLeakage([
      issue({ estimatedMonthlyValue: 49 }),
      issue({ estimatedMonthlyValue: 99 }),
    ]);
    expect(result.unpaidActiveCount).toBe(2);
    expect(result.estimatedMonthly).toBe(148);
    expect(result.estimatedAnnual).toBe(1776);
    expect(result.usedFallbackValue).toBe(false);
  });

  it("uses the fallback value when no per-account value exists", () => {
    const result = estimateLeakage([issue({}), issue({ estimatedMonthlyValue: 49 })], 60);
    expect(result.estimatedMonthly).toBe(109);
    expect(result.usedFallbackValue).toBe(true);
    expect(result.unvaluedAccounts).toBe(0);
  });

  it("excludes unvalued accounts from totals instead of inventing numbers", () => {
    const result = estimateLeakage([issue({}), issue({ estimatedMonthlyValue: 49 })]);
    expect(result.estimatedMonthly).toBe(49);
    expect(result.unvaluedAccounts).toBe(1);
  });

  it("only counts category A with high/medium confidence", () => {
    const result = estimateLeakage([
      issue({ estimatedMonthlyValue: 49 }),
      issue({ confidence: "needs_review", estimatedMonthlyValue: 500 }),
      issue({ category: "B", estimatedMonthlyValue: 500 }),
      issue({ category: "D", estimatedMonthlyValue: 500 }),
    ]);
    expect(result.unpaidActiveCount).toBe(1);
    expect(result.estimatedMonthly).toBe(49);
  });

  it("returns zeros for a clean audit", () => {
    const result = estimateLeakage([]);
    expect(result.unpaidActiveCount).toBe(0);
    expect(result.estimatedMonthly).toBe(0);
    expect(result.estimatedAnnual).toBe(0);
  });
});

describe("masking", () => {
  it("masks emails keeping first char and domain", () => {
    expect(maskEmail("john@acme.com")).toBe("j***@acme.com");
    expect(maskEmail("a@b.io")).toBe("a***@b.io");
    expect(maskEmail(null)).toBeNull();
    expect(maskEmail("not-an-email")).toBe("***");
  });

  it("masks ids keeping prefix and suffix", () => {
    expect(maskId("cus_9XKd72bQ4f")).toBe("cus_9X…4f");
    expect(maskId("u12")).toBe("u1…");
    expect(maskId(null)).toBeNull();
  });
});

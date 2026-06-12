import { describe, expect, it } from "vitest";
import { classifyIssues } from "../classify";
import type {
  MatchResult,
  MatchedPair,
  NormalizedAppRecord,
  NormalizedStripeRecord,
} from "../types";

let rowCounter = 0;

function stripeRecord(overrides: Partial<NormalizedStripeRecord>): NormalizedStripeRecord {
  rowCounter += 1;
  return {
    rowIndex: rowCounter,
    customerId: "cus_TEST",
    subscriptionId: null,
    email: "user@acme.com",
    normalizedEmail: "user@acme.com",
    rawStatus: "active",
    billingState: "PAID",
    plan: "Pro",
    monthlyValue: 49,
    currency: "usd",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: null,
    ...overrides,
  };
}

function appRecord(overrides: Partial<NormalizedAppRecord>): NormalizedAppRecord {
  rowCounter += 1;
  return {
    rowIndex: rowCounter,
    userId: `u${rowCounter}`,
    stripeCustomerId: "cus_TEST",
    email: "user@acme.com",
    normalizedEmail: "user@acme.com",
    rawStatus: "active",
    rawAccessFlag: "true",
    accessState: "ACCESS_ON",
    internalConflict: false,
    plan: "pro",
    role: "member",
    looksInternal: false,
    looksFreePlan: false,
    ...overrides,
  };
}

function pair(
  stripe: NormalizedStripeRecord,
  app: NormalizedAppRecord,
  overrides: Partial<MatchedPair> = {},
): MatchedPair {
  return { stripe, app, tier: "customer_id", confidence: "high", collision: false, ...overrides };
}

function result(partial: Partial<MatchResult>): MatchResult {
  return { matches: [], unmatchedApp: [], unmatchedStripe: [], ...partial };
}

describe("classifyIssues", () => {
  it("flags Category A: unpaid in Stripe but active in app", () => {
    const issues = classifyIssues(
      result({
        matches: [
          pair(
            stripeRecord({ rawStatus: "canceled", billingState: "UNPAID" }),
            appRecord({ accessState: "ACCESS_ON" }),
          ),
        ],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe("A");
    expect(issues[0].severity).toBe("high");
    expect(issues[0].confidence).toBe("high");
    expect(issues[0].estimatedMonthlyValue).toBe(49);
  });

  it("flags Category B: paid in Stripe but blocked in app", () => {
    const issues = classifyIssues(
      result({
        matches: [
          pair(
            stripeRecord({ rawStatus: "active", billingState: "PAID" }),
            appRecord({ rawStatus: "blocked", rawAccessFlag: "false", accessState: "ACCESS_OFF" }),
          ),
        ],
      }),
    );
    expect(issues[0].category).toBe("B");
    expect(issues[0].severity).toBe("high");
  });

  it("produces no issue when states agree", () => {
    const issues = classifyIssues(
      result({
        matches: [
          pair(stripeRecord({ billingState: "PAID" }), appRecord({ accessState: "ACCESS_ON" })),
          pair(
            stripeRecord({ rawStatus: "canceled", billingState: "UNPAID" }),
            appRecord({ rawStatus: "disabled", rawAccessFlag: "false", accessState: "ACCESS_OFF" }),
          ),
        ],
      }),
    );
    expect(issues).toHaveLength(0);
  });

  it("demotes unpaid-active internal accounts to Category E", () => {
    const issues = classifyIssues(
      result({
        matches: [
          pair(
            stripeRecord({ rawStatus: "canceled", billingState: "UNPAID" }),
            appRecord({ role: "admin", looksInternal: true }),
          ),
        ],
      }),
    );
    expect(issues[0].category).toBe("E");
    expect(issues[0].confidence).toBe("needs_review");
  });

  it("flags unknown statuses as Category E, never high confidence", () => {
    const issues = classifyIssues(
      result({
        matches: [
          pair(
            stripeRecord({ rawStatus: "custom_state", billingState: "UNKNOWN" }),
            appRecord({ accessState: "ACCESS_ON" }),
          ),
        ],
      }),
    );
    expect(issues[0].category).toBe("E");
    expect(issues[0].confidence).toBe("needs_review");
  });

  it("demotes internally conflicting app records to Category E instead of A", () => {
    const issues = classifyIssues(
      result({
        matches: [
          pair(
            stripeRecord({ rawStatus: "canceled", billingState: "UNPAID" }),
            appRecord({
              rawStatus: "canceled",
              rawAccessFlag: "true",
              accessState: "ACCESS_ON",
              internalConflict: true,
            }),
          ),
        ],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe("E");
    expect(issues[0].severity).toBe("medium");
    expect(issues[0].confidence).toBe("needs_review");
    expect(issues[0].explanation).toContain("disagrees with itself");
  });

  it("flags internally conflicting unmatched app records as Category E", () => {
    const issues = classifyIssues(
      result({
        unmatchedApp: [
          appRecord({
            stripeCustomerId: null,
            rawStatus: "active",
            rawAccessFlag: "false",
            accessState: "ACCESS_OFF",
            internalConflict: true,
          }),
        ],
      }),
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].category).toBe("E");
    expect(issues[0].confidence).toBe("needs_review");
  });

  it("flags collisions as Category E", () => {
    const issues = classifyIssues(
      result({
        matches: [
          pair(stripeRecord({ billingState: "UNPAID", rawStatus: "canceled" }), appRecord({}), {
            collision: true,
            confidence: "needs_review",
          }),
        ],
      }),
    );
    expect(issues[0].category).toBe("E");
  });

  it("flags Category C: active app user with no billing reference", () => {
    const issues = classifyIssues(
      result({
        unmatchedApp: [appRecord({ stripeCustomerId: null, plan: "pro" })],
      }),
    );
    expect(issues[0].category).toBe("C");
    expect(issues[0].severity).toBe("medium");
  });

  it("treats free-plan users without billing reference as Category E (low)", () => {
    const issues = classifyIssues(
      result({
        unmatchedApp: [appRecord({ stripeCustomerId: null, plan: "free", looksFreePlan: true })],
      }),
    );
    expect(issues[0].category).toBe("E");
    expect(issues[0].severity).toBe("low");
  });

  it("ignores disabled app users without billing reference", () => {
    const issues = classifyIssues(
      result({
        unmatchedApp: [
          appRecord({ stripeCustomerId: null, rawAccessFlag: "false", accessState: "ACCESS_OFF" }),
        ],
      }),
    );
    expect(issues).toHaveLength(0);
  });

  it("flags Category D: paying Stripe customer with no app account", () => {
    const issues = classifyIssues(
      result({
        unmatchedStripe: [stripeRecord({ billingState: "PAID", rawStatus: "active" })],
      }),
    );
    expect(issues[0].category).toBe("D");
  });

  it("ignores canceled Stripe customers with no app account", () => {
    const issues = classifyIssues(
      result({
        unmatchedStripe: [stripeRecord({ billingState: "UNPAID", rawStatus: "canceled" })],
      }),
    );
    expect(issues).toHaveLength(0);
  });

  it("masks identifiers in every issue", () => {
    const issues = classifyIssues(
      result({
        matches: [
          pair(
            stripeRecord({ rawStatus: "canceled", billingState: "UNPAID", customerId: "cus_9XKd72bQ4f" }),
            appRecord({ email: "john@acme.com" }),
          ),
        ],
      }),
    );
    expect(issues[0].maskedEmail).toBe("j***@acme.com");
    expect(issues[0].maskedCustomerId).toBe("cus_9X…4f");
    expect(issues[0].maskedEmail).not.toContain("john@");
  });

  it("sorts issues by severity then confidence", () => {
    const issues = classifyIssues(
      result({
        unmatchedApp: [appRecord({ stripeCustomerId: null, plan: "pro" })],
        matches: [
          pair(
            stripeRecord({ rawStatus: "canceled", billingState: "UNPAID" }),
            appRecord({ accessState: "ACCESS_ON" }),
          ),
        ],
      }),
    );
    expect(issues[0].severity).toBe("high");
    expect(issues[1].severity).toBe("medium");
  });
});

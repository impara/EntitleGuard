import { describe, expect, it } from "vitest";
import { collapseStripeRecords, matchRecords } from "../match";
import type { NormalizedAppRecord, NormalizedStripeRecord } from "../types";

let rowCounter = 0;

function stripeRecord(overrides: Partial<NormalizedStripeRecord>): NormalizedStripeRecord {
  rowCounter += 1;
  return {
    rowIndex: rowCounter,
    customerId: null,
    subscriptionId: null,
    email: null,
    normalizedEmail: null,
    rawStatus: "active",
    billingState: "PAID",
    plan: null,
    monthlyValue: null,
    currency: null,
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
    stripeCustomerId: null,
    email: null,
    normalizedEmail: null,
    rawStatus: "active",
    rawAccessFlag: null,
    accessState: "ACCESS_ON",
    internalConflict: false,
    plan: null,
    role: null,
    looksInternal: false,
    looksFreePlan: false,
    ...overrides,
  };
}

describe("matchRecords", () => {
  it("matches by Stripe customer ID with high confidence", () => {
    const result = matchRecords(
      [stripeRecord({ customerId: "cus_A", email: "other@x.com" })],
      [appRecord({ stripeCustomerId: "cus_A", email: "different@y.com" })],
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].tier).toBe("customer_id");
    expect(result.matches[0].confidence).toBe("high");
    expect(result.unmatchedApp).toHaveLength(0);
    expect(result.unmatchedStripe).toHaveLength(0);
  });

  it("prefers customer ID over email", () => {
    const byId = appRecord({ stripeCustomerId: "cus_A" });
    const byEmail = appRecord({ email: "a@x.com" });
    const result = matchRecords(
      [stripeRecord({ customerId: "cus_A", email: "a@x.com" })],
      [byEmail, byId],
    );
    expect(result.matches[0].tier).toBe("customer_id");
    expect(result.matches[0].app.rowIndex).toBe(byId.rowIndex);
  });

  it("falls back to exact email (case-insensitive)", () => {
    const result = matchRecords(
      [stripeRecord({ email: "John@Acme.com" })],
      [appRecord({ email: "john@acme.com" })],
    );
    expect(result.matches[0].tier).toBe("email_exact");
    expect(result.matches[0].confidence).toBe("high");
  });

  it("falls back to normalized email with medium confidence", () => {
    const result = matchRecords(
      [stripeRecord({ email: "john+stripe@acme.com", normalizedEmail: "john@acme.com" })],
      [appRecord({ email: "john@acme.com", normalizedEmail: "john@acme.com" })],
    );
    expect(result.matches[0].tier).toBe("email_normalized");
    expect(result.matches[0].confidence).toBe("medium");
  });

  it("demotes collisions to needs_review", () => {
    const result = matchRecords(
      [stripeRecord({ customerId: "cus_A" })],
      [appRecord({ stripeCustomerId: "cus_A" }), appRecord({ stripeCustomerId: "cus_A" })],
    );
    expect(result.matches[0].collision).toBe(true);
    expect(result.matches[0].confidence).toBe("needs_review");
    // both colliding app records are considered consumed
    expect(result.unmatchedApp).toHaveLength(0);
  });

  it("matches subscription IDs stored in the app billing reference column", () => {
    const result = matchRecords(
      [stripeRecord({ subscriptionId: "sub_9" })],
      [appRecord({ stripeCustomerId: "sub_9" })],
    );
    expect(result.matches[0].tier).toBe("subscription_id");
    expect(result.matches[0].confidence).toBe("high");
  });

  it("reports unmatched records on both sides", () => {
    const result = matchRecords(
      [stripeRecord({ customerId: "cus_A" }), stripeRecord({ customerId: "cus_B" })],
      [appRecord({ stripeCustomerId: "cus_A" }), appRecord({ stripeCustomerId: "cus_Z" })],
    );
    expect(result.matches).toHaveLength(1);
    expect(result.unmatchedStripe.map((s) => s.customerId)).toEqual(["cus_B"]);
    expect(result.unmatchedApp.map((a) => a.stripeCustomerId)).toEqual(["cus_Z"]);
  });
});

describe("collapseStripeRecords", () => {
  it("keeps the live subscription when a customer also has a canceled one", () => {
    const canceled = stripeRecord({
      customerId: "cus_A",
      subscriptionId: "sub_old",
      rawStatus: "canceled",
      billingState: "UNPAID",
    });
    const active = stripeRecord({
      customerId: "cus_A",
      subscriptionId: "sub_new",
      rawStatus: "active",
      billingState: "PAID",
    });
    const collapsed = collapseStripeRecords([canceled, active]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].subscriptionId).toBe("sub_new");
  });

  it("ranks within unpaid states: past_due beats canceled", () => {
    const collapsed = collapseStripeRecords([
      stripeRecord({ customerId: "cus_A", rawStatus: "canceled", billingState: "UNPAID" }),
      stripeRecord({ customerId: "cus_A", rawStatus: "past_due", billingState: "UNPAID" }),
    ]);
    expect(collapsed).toHaveLength(1);
    expect(collapsed[0].rawStatus).toBe("past_due");
  });

  it("prefers UNKNOWN status over UNPAID so it degrades to review, not a false leak", () => {
    const collapsed = collapseStripeRecords([
      stripeRecord({ customerId: "cus_A", rawStatus: "canceled", billingState: "UNPAID" }),
      stripeRecord({ customerId: "cus_A", rawStatus: "custom_state", billingState: "UNKNOWN" }),
    ]);
    expect(collapsed[0].rawStatus).toBe("custom_state");
  });

  it("breaks status ties on the later current period end", () => {
    const collapsed = collapseStripeRecords([
      stripeRecord({
        customerId: "cus_A",
        subscriptionId: "sub_old",
        currentPeriodEnd: "2026-01-01",
      }),
      stripeRecord({
        customerId: "cus_A",
        subscriptionId: "sub_new",
        currentPeriodEnd: "2026-06-01",
      }),
    ]);
    expect(collapsed[0].subscriptionId).toBe("sub_new");
  });

  it("passes records without a customer ID through untouched", () => {
    const collapsed = collapseStripeRecords([
      stripeRecord({ customerId: null, email: "a@x.com" }),
      stripeRecord({ customerId: null, email: "b@y.com" }),
    ]);
    expect(collapsed).toHaveLength(2);
  });

  it("preserves the file order of each customer's first appearance", () => {
    const collapsed = collapseStripeRecords([
      stripeRecord({ customerId: "cus_B", rawStatus: "canceled", billingState: "UNPAID" }),
      stripeRecord({ customerId: "cus_A" }),
      stripeRecord({ customerId: "cus_B", rawStatus: "active", billingState: "PAID" }),
    ]);
    expect(collapsed.map((r) => r.customerId)).toEqual(["cus_B", "cus_A"]);
    expect(collapsed[0].rawStatus).toBe("active");
  });
});

describe("matchRecords with multi-subscription customers", () => {
  it("does not surface a canceled duplicate as a match or as unmatched", () => {
    const result = matchRecords(
      [
        stripeRecord({ customerId: "cus_A", rawStatus: "canceled", billingState: "UNPAID" }),
        stripeRecord({ customerId: "cus_A", rawStatus: "active", billingState: "PAID" }),
      ],
      [appRecord({ stripeCustomerId: "cus_A" })],
    );
    expect(result.matches).toHaveLength(1);
    expect(result.matches[0].stripe.billingState).toBe("PAID");
    expect(result.unmatchedStripe).toHaveLength(0);
  });
});

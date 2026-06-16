import { describe, expect, it } from "vitest";
import { parseCsvText } from "../csv";
import { detectAppMapping, detectStripeMapping } from "../detect";
import { runAudit } from "../index";
import type { ParsedCsv, ProgressUpdate } from "../types";

const STRIPE_CSV = [
  "Customer ID,Customer Email,Subscription ID,Status,Plan,Amount,Currency",
  "cus_AAA,alice@acme.com,sub_1,active,Pro,49.00,usd",
  "cus_BBB,bob@beta.io,sub_2,canceled,Pro,49.00,usd", // unpaid but active in app -> A
  "cus_CCC,carol@gamma.dev,sub_3,past_due,Scale,149.00,usd", // unpaid but active -> A
  "cus_DDD,dan@delta.co,sub_4,active,Pro,49.00,usd", // paid but blocked in app -> B
  "cus_EEE,eve@epsilon.app,sub_5,active,Scale,149.00,usd", // no app record -> D
  "cus_FFF,frank@zeta.net,sub_6,canceled,Pro,49.00,usd", // canceled & disabled -> consistent
].join("\n");

const APP_CSV = [
  "user_id,email,stripe_customer_id,status,plan,access_enabled,role",
  "u1,alice@acme.com,cus_AAA,active,pro,true,member",
  "u2,bob@beta.io,cus_BBB,active,pro,true,member",
  "u3,carol@gamma.dev,cus_CCC,active,scale,true,member",
  "u4,dan@delta.co,cus_DDD,blocked,pro,false,member",
  "u5,frank@zeta.net,cus_FFF,inactive,free,false,member",
  "u6,grace@eta.org,,active,pro,true,member", // active, no billing ref -> C
  "u7,henry@theta.io,,active,free,true,member", // free plan, no billing ref -> E low
].join("\n");

function parse(text: string, name: string): ParsedCsv {
  const result = parseCsvText(text, name);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe("runAudit end-to-end", () => {
  const stripe = parse(STRIPE_CSV, "stripe.csv");
  const app = parse(APP_CSV, "app.csv");
  const { mapping: stripeMapping } = detectStripeMapping(stripe);
  const { mapping: appMapping } = detectAppMapping(app);

  it("auto-detects all key columns", () => {
    expect(stripeMapping.customerId).toBe("Customer ID");
    expect(stripeMapping.status).toBe("Status");
    expect(appMapping.stripeCustomerId).toBe("stripe_customer_id");
    expect(appMapping.accessEnabled).toBe("access_enabled");
  });

  it("produces the expected summary", () => {
    const result = runAudit({ stripe, app, stripeMapping, appMapping });
    const s = result.summary;

    expect(s.totalStripeRecords).toBe(6);
    expect(s.totalAppRecords).toBe(7);
    expect(s.matchedRecords).toBe(5);
    expect(s.unmatchedStripeCustomers).toBe(1);
    expect(s.unmatchedAppUsers).toBe(2);

    expect(s.unpaidActiveCount).toBe(2); // bob + carol
    expect(s.paidBlockedCount).toBe(1); // dan
    expect(s.missingBillingLinkCount).toBe(1); // grace
    expect(s.orphanedStripeCount).toBe(1); // eve
    expect(s.ambiguousCount).toBe(1); // henry (free plan, flagged for completeness)

    expect(s.leakage.unpaidActiveCount).toBe(2);
    expect(s.leakage.estimatedMonthly).toBe(198); // 49 + 149
    expect(s.leakage.estimatedAnnual).toBe(2376);
    expect(s.dataQualityScore).toBeGreaterThan(70);
  });

  it("reports progress phases in order and never leaks raw identifiers", () => {
    const updates: ProgressUpdate[] = [];
    const result = runAudit({ stripe, app, stripeMapping, appMapping }, (u) => updates.push(u));

    expect(updates.map((u) => u.phase)).toEqual([
      "normalizing",
      "matching",
      "classifying",
      "estimating",
      "done",
    ]);

    const serialized = JSON.stringify(result.issues);
    expect(serialized).not.toContain("bob@beta.io");
    expect(serialized).not.toContain("cus_BBB\"");
    expect(serialized).toContain("b***@beta.io");
  });

  it("includes recommended actions referencing findings", () => {
    const result = runAudit({ stripe, app, stripeMapping, appMapping });
    expect(result.recommendedActions.some((a) => a.includes("unpaid"))).toBe(true);
    expect(result.recommendedActions.some((a) => a.toLowerCase().includes("override"))).toBe(
      true,
    );
    expect(result.recommendedActions.some((a) => a.toLowerCase().includes("recurring"))).toBe(
      true,
    );
  });

  it("collapses cancel+resubscribe customers and flags self-contradicting app rows", () => {
    const multiStripe = parse(
      [
        "Customer ID,Customer Email,Subscription ID,Status,Plan,Amount,Currency",
        "cus_RES,rita@resub.io,sub_old,canceled,Pro,49.00,usd", // superseded by sub_new
        "cus_RES,rita@resub.io,sub_new,active,Pro,49.00,usd",
        "cus_CON,carl@conflict.dev,sub_7,canceled,Pro,49.00,usd", // app row contradicts itself
      ].join("\n"),
      "stripe-multi.csv",
    );
    const multiApp = parse(
      [
        "user_id,email,stripe_customer_id,status,plan,access_enabled,role",
        "u8,rita@resub.io,cus_RES,active,pro,true,member",
        "u9,carl@conflict.dev,cus_CON,canceled,pro,true,member",
      ].join("\n"),
      "app-multi.csv",
    );
    const result = runAudit({
      stripe: multiStripe,
      app: multiApp,
      stripeMapping: detectStripeMapping(multiStripe).mapping,
      appMapping: detectAppMapping(multiApp).mapping,
    });

    // Rita resubscribed: her canceled row must not count as a leak.
    expect(result.summary.unpaidActiveCount).toBe(0);
    expect(result.summary.unmatchedStripeCustomers).toBe(0);

    // Carl's flag and status disagree: surfaced as ambiguous, never category A.
    expect(result.summary.ambiguousCount).toBe(1);
    const conflict = result.issues.find((i) => i.category === "E");
    expect(conflict?.explanation).toContain("disagrees with itself");
    expect(conflict?.confidence).toBe("needs_review");
  });

  it("applies a fallback monthly value when MRR is unmapped", () => {
    const noMrrMapping = { ...stripeMapping };
    delete noMrrMapping.mrr;
    const result = runAudit({
      stripe,
      app,
      stripeMapping: noMrrMapping,
      appMapping,
      options: { fallbackMonthlyValue: 100 },
    });
    expect(result.summary.leakage.estimatedMonthly).toBe(200);
    expect(result.summary.leakage.usedFallbackValue).toBe(true);
  });
});

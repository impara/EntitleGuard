import { describe, expect, it } from "vitest";
import { classifyIssues } from "../classify";
import { detectAppMapping } from "../detect";
import { normalizeAppRecords, normalizeStripeRecords } from "../normalize";
import type { ParsedCsv } from "../types";

function parsedCsv(
  headers: string[],
  rows: Record<string, string>[],
  fileName: string,
): ParsedCsv {
  return {
    fileName,
    headers,
    rows,
    rowCount: rows.length,
    delimiter: ",",
    warnings: [],
  };
}

describe("manual override reconciliation", () => {
  it("detects and normalizes explicit override columns", () => {
    const csv = parsedCsv(
      [
        "user_id",
        "stripe_customer_id",
        "status",
        "access_enabled",
        "manual_access_override",
        "manual_override_reason",
      ],
      [
        {
          user_id: "u_1",
          stripe_customer_id: "cus_1",
          status: "active",
          access_enabled: "true",
          manual_access_override: "true",
          manual_override_reason: "Customer success comp",
        },
      ],
      "app.csv",
    );

    const { mapping } = detectAppMapping(csv);
    expect(mapping.manualOverride).toBe("manual_access_override");
    expect(mapping.overrideReason).toBe("manual_override_reason");

    const [record] = normalizeAppRecords(csv, mapping);
    expect(record.manualOverride).toBe(true);
    expect(record.overrideReason).toBe("Customer success comp");
  });

  it("preserves an explicit revoke-direction override instead of counting leakage", () => {
    const appCsv = parsedCsv(
      [
        "user_id",
        "stripe_customer_id",
        "status",
        "access_enabled",
        "manual_access_override",
        "manual_override_reason",
      ],
      [
        {
          user_id: "u_1",
          stripe_customer_id: "cus_1",
          status: "active",
          access_enabled: "true",
          manual_access_override: "yes",
          manual_override_reason: "Contractual extension",
        },
      ],
      "app.csv",
    );
    const stripeCsv = parsedCsv(
      ["customer_id", "status", "amount"],
      [{ customer_id: "cus_1", status: "canceled", amount: "79" }],
      "stripe.csv",
    );

    const [app] = normalizeAppRecords(appCsv, detectAppMapping(appCsv).mapping);
    const [stripe] = normalizeStripeRecords(stripeCsv, {
      customerId: "customer_id",
      status: "status",
      mrr: "amount",
    });

    const [issue] = classifyIssues({
      matches: [{ stripe, app, tier: "customer_id", confidence: "high", collision: false }],
      unmatchedApp: [],
      unmatchedStripe: [],
    });

    expect(issue.category).toBe("E");
    expect(issue.reconciliationDirection).toBe("revoke");
    expect(issue.manualOverride).toBe(true);
    expect(issue.overrideReason).toBe("Contractual extension");
    expect(issue.estimatedMonthlyValue).toBeNull();
    expect(issue.explanation).toContain("preserve");
  });

  it("labels ordinary A/B mismatches with revoke and grant directions", () => {
    const appCsv = parsedCsv(
      ["user_id", "stripe_customer_id", "status", "access_enabled"],
      [
        {
          user_id: "u_1",
          stripe_customer_id: "cus_1",
          status: "active",
          access_enabled: "true",
        },
      ],
      "app.csv",
    );
    const [app] = normalizeAppRecords(appCsv, detectAppMapping(appCsv).mapping);

    const canceledStripe = normalizeStripeRecords(
      parsedCsv(
        ["customer_id", "status", "amount"],
        [{ customer_id: "cus_1", status: "canceled", amount: "79" }],
        "stripe.csv",
      ),
      { customerId: "customer_id", status: "status", mrr: "amount" },
    )[0];

    const [revokeIssue] = classifyIssues({
      matches: [
        {
          stripe: canceledStripe,
          app,
          tier: "customer_id",
          confidence: "high",
          collision: false,
        },
      ],
      unmatchedApp: [],
      unmatchedStripe: [],
    });
    expect(revokeIssue.category).toBe("A");
    expect(revokeIssue.reconciliationDirection).toBe("revoke");

    const paidStripe = { ...canceledStripe, rawStatus: "active", billingState: "PAID" as const };
    const blockedApp = {
      ...app,
      rawStatus: "blocked",
      rawAccessFlag: "false",
      accessState: "ACCESS_OFF" as const,
      internalConflict: false,
    };
    const [grantIssue] = classifyIssues({
      matches: [
        {
          stripe: paidStripe,
          app: blockedApp,
          tier: "customer_id",
          confidence: "high",
          collision: false,
        },
      ],
      unmatchedApp: [],
      unmatchedStripe: [],
    });
    expect(grantIssue.category).toBe("B");
    expect(grantIssue.reconciliationDirection).toBe("grant");
  });
});

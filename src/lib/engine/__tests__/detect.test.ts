import { describe, expect, it } from "vitest";
import { parseCsvText } from "../csv";
import { detectAppMapping, detectStripeMapping } from "../detect";
import type { ParsedCsv } from "../types";

function csv(text: string): ParsedCsv {
  const result = parseCsvText(text, "fixture.csv");
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe("detectStripeMapping", () => {
  it("detects standard Stripe export columns", () => {
    const parsed = csv(
      [
        "Customer ID,Customer Email,Subscription ID,Status,Plan,Amount,Currency",
        "cus_ABC123,a@example.com,sub_XYZ789,active,Pro,49.00,usd",
      ].join("\n"),
    );
    const { mapping } = detectStripeMapping(parsed);
    expect(mapping.customerId).toBe("Customer ID");
    expect(mapping.email).toBe("Customer Email");
    expect(mapping.subscriptionId).toBe("Subscription ID");
    expect(mapping.status).toBe("Status");
    expect(mapping.plan).toBe("Plan");
    expect(mapping.mrr).toBe("Amount");
    expect(mapping.currency).toBe("Currency");
  });

  it("uses value sniffing for cus_ prefixes when headers are unhelpful", () => {
    const parsed = csv(
      ["ref,contact,state", "cus_ABC123,a@example.com,active", "cus_DEF456,b@example.com,canceled"].join(
        "\n",
      ),
    );
    const { mapping, suggestions } = detectStripeMapping(parsed);
    expect(mapping.customerId).toBe("ref");
    expect(mapping.email).toBe("contact");
    const idSuggestion = suggestions.find((s) => s.field === "customerId");
    expect(idSuggestion).toBeDefined();
  });

  it("does not assign the same column twice", () => {
    const parsed = csv(["customer,status", "cus_A,active"].join("\n"));
    const { mapping } = detectStripeMapping(parsed);
    const assigned = Object.values(mapping);
    expect(new Set(assigned).size).toBe(assigned.length);
  });
});

describe("detectAppMapping", () => {
  it("detects common app export columns", () => {
    const parsed = csv(
      [
        "user_id,email,stripe_customer_id,subscription_status,plan,access_enabled,role",
        "u1,a@example.com,cus_ABC,active,pro,true,member",
      ].join("\n"),
    );
    const { mapping } = detectAppMapping(parsed);
    expect(mapping.userId).toBe("user_id");
    expect(mapping.email).toBe("email");
    expect(mapping.stripeCustomerId).toBe("stripe_customer_id");
    expect(mapping.status).toBe("subscription_status");
    expect(mapping.plan).toBe("plan");
    expect(mapping.accessEnabled).toBe("access_enabled");
    expect(mapping.role).toBe("role");
  });

  it("reports confidence per suggestion", () => {
    const parsed = csv(["email,active", "a@example.com,true"].join("\n"));
    const { suggestions } = detectAppMapping(parsed);
    for (const s of suggestions) {
      expect(s.confidence).toBeGreaterThan(0);
      expect(s.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("returns no mapping for unrecognizable columns", () => {
    const parsed = csv(["foo,bar", "1,2"].join("\n"));
    const { mapping } = detectAppMapping(parsed);
    expect(Object.keys(mapping).length).toBe(0);
  });
});

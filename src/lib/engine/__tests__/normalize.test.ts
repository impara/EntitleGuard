import { describe, expect, it } from "vitest";
import {
  detectAccessConflict,
  emailKey,
  normalizeAccessState,
  normalizeBillingStatus,
  normalizedEmailKey,
  parseMonetaryValue,
} from "../normalize";

describe("normalizeBillingStatus", () => {
  it("maps paid statuses", () => {
    expect(normalizeBillingStatus("active")).toBe("PAID");
    expect(normalizeBillingStatus("Trialing")).toBe("PAID");
    expect(normalizeBillingStatus(" PAID ")).toBe("PAID");
  });

  it("maps unpaid statuses", () => {
    expect(normalizeBillingStatus("canceled")).toBe("UNPAID");
    expect(normalizeBillingStatus("cancelled")).toBe("UNPAID");
    expect(normalizeBillingStatus("past_due")).toBe("UNPAID");
    expect(normalizeBillingStatus("unpaid")).toBe("UNPAID");
    expect(normalizeBillingStatus("incomplete_expired")).toBe("UNPAID");
  });

  it("keeps custom labels UNKNOWN (never high confidence)", () => {
    expect(normalizeBillingStatus("custom_enterprise")).toBe("UNKNOWN");
    expect(normalizeBillingStatus("")).toBe("UNKNOWN");
    expect(normalizeBillingStatus(null)).toBe("UNKNOWN");
  });
});

describe("normalizeAccessState", () => {
  it("prefers the explicit access flag", () => {
    expect(normalizeAccessState("blocked", "true")).toBe("ACCESS_ON");
    expect(normalizeAccessState("active", "false")).toBe("ACCESS_OFF");
  });

  it("falls back to textual status", () => {
    expect(normalizeAccessState("active", null)).toBe("ACCESS_ON");
    expect(normalizeAccessState("blocked", null)).toBe("ACCESS_OFF");
    expect(normalizeAccessState("suspended", null)).toBe("ACCESS_OFF");
  });

  it("handles boolean variants", () => {
    expect(normalizeAccessState(null, "1")).toBe("ACCESS_ON");
    expect(normalizeAccessState(null, "0")).toBe("ACCESS_OFF");
    expect(normalizeAccessState(null, "Yes")).toBe("ACCESS_ON");
    expect(normalizeAccessState(null, "disabled")).toBe("ACCESS_OFF");
  });

  it("returns UNKNOWN for unrecognized values", () => {
    expect(normalizeAccessState("weird_state", null)).toBe("UNKNOWN");
    expect(normalizeAccessState(null, null)).toBe("UNKNOWN");
    expect(normalizeAccessState(null, "maybe")).toBe("UNKNOWN");
  });
});

describe("detectAccessConflict", () => {
  it("flags a true flag contradicted by an inactive status", () => {
    expect(detectAccessConflict("canceled", "true")).toBe(true);
    expect(detectAccessConflict("blocked", "1")).toBe(true);
  });

  it("flags a false flag contradicted by an active status", () => {
    expect(detectAccessConflict("active", "false")).toBe(true);
    expect(detectAccessConflict("subscribed", "0")).toBe(true);
  });

  it("does not flag agreeing columns", () => {
    expect(detectAccessConflict("active", "true")).toBe(false);
    expect(detectAccessConflict("blocked", "false")).toBe(false);
  });

  it("does not flag when either side is missing or unrecognized", () => {
    expect(detectAccessConflict(null, "true")).toBe(false);
    expect(detectAccessConflict("active", null)).toBe(false);
    expect(detectAccessConflict("custom_state", "true")).toBe(false);
    expect(detectAccessConflict("active", "maybe")).toBe(false);
  });
});

describe("email keys", () => {
  it("lowercases and trims for the exact tier", () => {
    expect(emailKey("  John@Acme.COM ")).toBe("john@acme.com");
  });

  it("rejects non-emails", () => {
    expect(emailKey("not-an-email")).toBeNull();
    expect(emailKey(null)).toBeNull();
  });

  it("strips +tags for the normalized tier", () => {
    expect(normalizedEmailKey("john+billing@acme.com")).toBe("john@acme.com");
    expect(normalizedEmailKey("john@acme.com")).toBe("john@acme.com");
  });
});

describe("parseMonetaryValue", () => {
  it("parses plain and formatted amounts", () => {
    expect(parseMonetaryValue("49")).toBe(49);
    expect(parseMonetaryValue("$49.00")).toBe(49);
    expect(parseMonetaryValue("1,234.56")).toBe(1234.56);
    expect(parseMonetaryValue("49.00 USD")).toBe(49);
  });

  it("parses EU decimal commas", () => {
    expect(parseMonetaryValue("49,50")).toBe(49.5);
    expect(parseMonetaryValue("1.234,56")).toBe(1234.56);
  });

  it("rejects garbage and non-positive values", () => {
    expect(parseMonetaryValue("n/a")).toBeNull();
    expect(parseMonetaryValue("0")).toBeNull();
    expect(parseMonetaryValue("-10")).toBeNull();
    expect(parseMonetaryValue(null)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  isSyntheticLead,
  summarizeAuditModes,
  summarizeFunnel,
  summarizeTrafficSources,
  type AdminEventRow,
} from "../admin-analytics";

const event = (
  sessionId: string,
  name: string,
  props?: Record<string, string | number | boolean>,
): AdminEventRow => ({ sessionId, name, props: props ? JSON.stringify(props) : null });

describe("admin analytics hygiene", () => {
  it("separates the known E2E lead without treating normal Amer Tech addresses as synthetic", () => {
    expect(isSyntheticLead({
      email: "e2e-test@amertech.online",
      company: "e2e-test.example",
      role: "E2E test (automated)",
    })).toBe(true);
    expect(isSyntheticLead({
      email: "founder@amertech.online",
      company: "Amer Tech",
      role: "Founder",
    })).toBe(false);
  });

  it("reports both raw events and unique sessions while excluding linked synthetic sessions", () => {
    const rows = [
      event("real-1", "landing_page_viewed"),
      event("real-1", "landing_page_viewed"),
      event("real-2", "landing_page_viewed"),
      event("synthetic", "landing_page_viewed"),
    ];
    expect(summarizeFunnel(rows, new Set(["synthetic"]))).toEqual([
      { name: "landing_page_viewed", eventCount: 3, sessionCount: 2 },
    ]);
  });

  it("separates completed demo audits from uploaded or historically unclassified audits", () => {
    const rows = [
      event("demo-old", "demo_mode_started"),
      event("demo-old", "audit_completed"),
      event("demo-new", "audit_completed", { mode: "demo" }),
      event("uploaded", "audit_completed", { mode: "uploaded" }),
      event("historical", "audit_completed"),
      event("synthetic", "audit_completed", { mode: "uploaded" }),
    ];
    expect(summarizeAuditModes(rows, new Set(["synthetic"]))).toEqual({
      demoSessions: 2,
      uploadedOrUnknownSessions: 2,
    });
  });

  it("separates known unverified referrers and counts sessions rather than only hits", () => {
    const rows = [
      event("a", "landing_page_viewed", { referrer: "http://roozzy.com/" }),
      event("a", "landing_page_viewed", { referrer: "http://roozzy.com/" }),
      event("b", "landing_page_viewed", { ref: "reddit-sideproject" }),
      event("c", "landing_page_viewed"),
    ];
    const result = summarizeTrafficSources(rows, new Set());
    expect(result.find((row) => row.source === "http://roozzy.com/")).toMatchObject({
      eventCount: 2,
      sessionCount: 1,
      unverified: true,
    });
    expect(result.find((row) => row.source === "reddit-sideproject")?.unverified).toBe(false);
  });
});

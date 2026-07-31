import { createHmac } from "node:crypto";

export type CanaryMode = "healthy" | "paid_blocked";

export function canarySnapshot(mode: CanaryMode, secret: string, now = new Date()) {
  const timestamp = now.toISOString();
  const findings =
    mode === "paid_blocked"
      ? [
          {
            fingerprint: createHmac("sha256", secret)
              .update("entitleguard-production-canary-paid-blocked")
              .digest("hex"),
            category: "B" as const,
            direction: "grant" as const,
            severity: "high" as const,
          },
        ]
      : [];

  return {
    completeSnapshot: true as const,
    startedAt: timestamp,
    completedAt: timestamp,
    totalAppRecords: 1,
    totalStripeRecords: 1,
    findings,
  };
}

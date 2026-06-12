import { maskEmail, maskId } from "./mask";
import type {
  Issue,
  MatchResult,
  MatchedPair,
  NormalizedAppRecord,
  NormalizedStripeRecord,
} from "./types";

/**
 * Mismatch classification (FR5, PRD sections 8 and 18).
 *
 *  A — Unpaid but active      (Stripe UNPAID, app ACCESS_ON)        high severity
 *  B — Paid but blocked       (Stripe PAID, app ACCESS_OFF)         high severity
 *  C — Missing billing link   (app user, no billing ref, access on) medium severity
 *  D — Orphaned Stripe sub    (paying Stripe customer, no app user) medium severity
 *  E — Ambiguous state        (unknown statuses, collisions, internal accounts)
 */

let issueCounter = 0;
function nextId(category: string): string {
  issueCounter += 1;
  return `${category}-${issueCounter}`;
}

/** Reset between audits so ids stay stable per run. */
export function resetIssueIds(): void {
  issueCounter = 0;
}

function baseIssue(
  stripe: NormalizedStripeRecord | null,
  app: NormalizedAppRecord | null,
): Pick<
  Issue,
  | "maskedEmail"
  | "maskedCustomerId"
  | "maskedUserId"
  | "stripeStatus"
  | "appStatus"
  | "plan"
> {
  return {
    maskedEmail: maskEmail(app?.email ?? stripe?.email ?? null),
    maskedCustomerId: maskId(stripe?.customerId ?? app?.stripeCustomerId ?? null),
    maskedUserId: maskId(app?.userId ?? null),
    stripeStatus: stripe?.rawStatus ?? null,
    appStatus: app?.rawStatus ?? app?.rawAccessFlag ?? null,
    plan: app?.plan ?? stripe?.plan ?? null,
  };
}

function classifyMatch(pair: MatchedPair): Issue | null {
  const { stripe, app, confidence, tier, collision } = pair;

  if (collision) {
    return {
      id: nextId("E"),
      category: "E",
      severity: "low",
      confidence: "needs_review",
      explanation:
        "Multiple app records matched the same billing identifier. Review which account actually owns this subscription.",
      ...baseIssue(stripe, app),
      estimatedMonthlyValue: null,
      matchTier: tier,
    };
  }

  // The app's own columns contradict each other. The audit cannot know which
  // column the access check actually reads, so any A/B verdict here would be
  // a guess — surface the contradiction itself instead.
  if (app.internalConflict) {
    return {
      id: nextId("E"),
      category: "E",
      severity: "medium",
      confidence: "needs_review",
      explanation: `The app export disagrees with itself: the access flag says "${app.rawAccessFlag}" but the status column says "${app.rawStatus}" (Stripe shows "${stripe.rawStatus}"). Confirm which column your access check actually reads before acting on this account.`,
      ...baseIssue(stripe, app),
      estimatedMonthlyValue: null,
      matchTier: tier,
    };
  }

  if (stripe.billingState === "UNPAID" && app.accessState === "ACCESS_ON") {
    if (app.looksInternal) {
      return {
        id: nextId("E"),
        category: "E",
        severity: "low",
        confidence: "needs_review",
        explanation: `Stripe shows "${stripe.rawStatus}" but the app account is active. The account looks internal/admin ("${app.role}"), so this may be intentional.`,
        ...baseIssue(stripe, app),
        estimatedMonthlyValue: null,
        matchTier: tier,
      };
    }
    return {
      id: nextId("A"),
      category: "A",
      severity: "high",
      confidence,
      explanation: `Stripe shows this subscription as "${stripe.rawStatus}" but the app still grants access${app.plan ? ` on plan "${app.plan}"` : ""}. Potential unpaid usage.`,
      ...baseIssue(stripe, app),
      estimatedMonthlyValue: stripe.monthlyValue,
      matchTier: tier,
    };
  }

  if (stripe.billingState === "PAID" && app.accessState === "ACCESS_OFF") {
    return {
      id: nextId("B"),
      category: "B",
      severity: "high",
      confidence,
      explanation: `Stripe shows an active/paid subscription ("${stripe.rawStatus}") but the app marks this account as "${app.rawStatus ?? app.rawAccessFlag}". A paying customer may be blocked.`,
      ...baseIssue(stripe, app),
      estimatedMonthlyValue: null,
      matchTier: tier,
    };
  }

  if (
    (stripe.billingState === "UNKNOWN" && app.accessState !== "UNKNOWN") ||
    (app.accessState === "UNKNOWN" && stripe.billingState !== "UNKNOWN")
  ) {
    const unknownSide =
      stripe.billingState === "UNKNOWN"
        ? `Stripe status "${stripe.rawStatus ?? "(empty)"}"`
        : `app status "${app.rawStatus ?? app.rawAccessFlag ?? "(empty)"}"`;
    return {
      id: nextId("E"),
      category: "E",
      severity: "low",
      confidence: "needs_review",
      explanation: `Could not interpret ${unknownSide}. Review this account manually before drawing conclusions.`,
      ...baseIssue(stripe, app),
      estimatedMonthlyValue: null,
      matchTier: tier,
    };
  }

  // States agree (or both unknown) — no issue.
  return null;
}

function classifyUnmatchedApp(app: NormalizedAppRecord): Issue | null {
  if (app.internalConflict) {
    return {
      id: nextId("E"),
      category: "E",
      severity: "medium",
      confidence: "needs_review",
      explanation: `The app export disagrees with itself: the access flag says "${app.rawAccessFlag}" but the status column says "${app.rawStatus}", and no matching Stripe record was found. Confirm which column your access check actually reads.`,
      ...baseIssue(null, app),
      estimatedMonthlyValue: null,
      matchTier: null,
    };
  }

  const hasBillingRef = app.stripeCustomerId !== null;

  if (hasBillingRef) {
    // App points at a Stripe customer that wasn't in the Stripe export.
    return {
      id: nextId("E"),
      category: "E",
      severity: "medium",
      confidence: "needs_review",
      explanation:
        "This app account references a Stripe customer ID that has no matching record in the Stripe export. The export may be partial, or the customer was deleted in Stripe.",
      ...baseIssue(null, app),
      estimatedMonthlyValue: null,
      matchTier: null,
    };
  }

  if (app.accessState !== "ACCESS_ON") return null; // disabled free user — fine
  if (app.looksFreePlan || app.looksInternal) {
    return {
      id: nextId("E"),
      category: "E",
      severity: "low",
      confidence: "needs_review",
      explanation: `Active app account with no billing reference, but it looks ${app.looksInternal ? "internal/admin" : "like a free plan"} — likely intentional. Flagged for completeness.`,
      ...baseIssue(null, app),
      estimatedMonthlyValue: null,
      matchTier: null,
    };
  }

  return {
    id: nextId("C"),
    category: "C",
    severity: "medium",
    confidence: "needs_review",
    explanation: `Active app account${app.plan ? ` on plan "${app.plan}"` : ""} with no Stripe customer ID or recognizable billing reference. May be a comped/internal account — confirm it is intentional.`,
    ...baseIssue(null, app),
    estimatedMonthlyValue: null,
    matchTier: null,
  };
}

function classifyUnmatchedStripe(stripe: NormalizedStripeRecord): Issue | null {
  if (stripe.billingState !== "PAID") return null; // canceled & gone — consistent
  return {
    id: nextId("D"),
    category: "D",
    severity: "medium",
    confidence: "medium",
    explanation: `Stripe shows an active/paying subscription ("${stripe.rawStatus}") but no matching app account was found. Possible deleted user, changed email, or failed provisioning — a paying customer may be unable to access the product.`,
    ...baseIssue(stripe, null),
    estimatedMonthlyValue: stripe.monthlyValue,
    matchTier: null,
  };
}

export function classifyIssues(matchResult: MatchResult): Issue[] {
  resetIssueIds();
  const issues: Issue[] = [];

  for (const pair of matchResult.matches) {
    const issue = classifyMatch(pair);
    if (issue) issues.push(issue);
  }
  for (const app of matchResult.unmatchedApp) {
    const issue = classifyUnmatchedApp(app);
    if (issue) issues.push(issue);
  }
  for (const stripe of matchResult.unmatchedStripe) {
    const issue = classifyUnmatchedStripe(stripe);
    if (issue) issues.push(issue);
  }

  const severityRank: Record<Issue["severity"], number> = { high: 0, medium: 1, low: 2 };
  const confidenceRank: Record<Issue["confidence"], number> = {
    high: 0,
    medium: 1,
    needs_review: 2,
  };
  issues.sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      confidenceRank[a.confidence] - confidenceRank[b.confidence],
  );
  return issues;
}

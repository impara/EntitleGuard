import type { AppMapping, AuditSummary, ParsedCsv, StripeMapping } from "./types";

/**
 * Data quality score (PRD section 19 item 2): how complete the mapping and the
 * underlying data are. 0..100.
 *  - 60% weight: coverage of recommended field mappings
 *  - 40% weight: fill rate of mapped identifier/status cells
 */
export function computeDataQualityScore(
  stripe: ParsedCsv,
  app: ParsedCsv,
  stripeMapping: StripeMapping,
  appMapping: AppMapping,
): number {
  const recommendedStripe: (keyof StripeMapping)[] = [
    "customerId",
    "email",
    "status",
    "mrr",
    "plan",
  ];
  const recommendedApp: (keyof AppMapping)[] = [
    "userId",
    "email",
    "stripeCustomerId",
    "status",
    "accessEnabled",
  ];
  const mappedCount =
    recommendedStripe.filter((f) => stripeMapping[f]).length +
    recommendedApp.filter((f) => appMapping[f]).length;
  const mappingScore = mappedCount / (recommendedStripe.length + recommendedApp.length);

  const fillRates: number[] = [];
  const sampleFill = (csv: ParsedCsv, column: string | undefined) => {
    if (!column) return;
    const sample = csv.rows.slice(0, 500);
    const filled = sample.filter((r) => (r[column] ?? "").trim().length > 0).length;
    fillRates.push(filled / sample.length);
  };
  sampleFill(stripe, stripeMapping.customerId);
  sampleFill(stripe, stripeMapping.status);
  sampleFill(app, appMapping.email ?? appMapping.userId);
  sampleFill(app, appMapping.stripeCustomerId);
  const fillScore =
    fillRates.length > 0 ? fillRates.reduce((a, b) => a + b, 0) / fillRates.length : 0.5;

  return Math.round((mappingScore * 0.6 + fillScore * 0.4) * 100);
}

/** Recommended next actions (PRD section 19). */
export function buildRecommendedActions(summary: AuditSummary): string[] {
  const actions: string[] = [];
  if (summary.unpaidActiveCount > 0) {
    actions.push(
      `Review the ${summary.unpaidActiveCount} account(s) that appear unpaid in Stripe but still active in your app.`,
    );
    actions.push(
      "Check your webhook logs for failed customer.subscription.deleted / invoice.payment_failed events.",
    );
  }
  if (summary.paidBlockedCount > 0) {
    actions.push(
      `Investigate the ${summary.paidBlockedCount} paying customer(s) your app marks as blocked or inactive — churn risk.`,
    );
  }
  if (summary.missingBillingLinkCount > 0) {
    actions.push(
      `Confirm whether the ${summary.missingBillingLinkCount} active account(s) without a billing reference are intentionally comped.`,
    );
  }
  if (summary.orphanedStripeCount > 0) {
    actions.push(
      `Verify provisioning for the ${summary.orphanedStripeCount} paying Stripe customer(s) with no matching app account.`,
    );
  }
  if (summary.ambiguousCount > 0) {
    actions.push(
      `Manually review the ${summary.ambiguousCount} ambiguous case(s) the audit could not classify with confidence.`,
    );
  }
  if (actions.length === 0) {
    actions.push(
      "No drift detected in this export. Re-run the audit after your next deploy or billing change to keep it that way.",
    );
  } else {
    actions.push("Add a recurring reconciliation job — drift recurs with every deploy, webhook hiccup, and plan change.");
  }
  return actions;
}

/**
 * Suggested SQL reconciliation checks — part of the gated full report (the
 * research paper's "SQL patch scripts" deliverable). Templates the user adapts
 * to their schema; the audit never connects to a database.
 */
export const SQL_CHECKS: { title: string; sql: string }[] = [
  {
    title: "Unpaid in Stripe but active in your app",
    sql: `-- Adapt table/column names to your schema.
SELECT u.id, u.email, u.plan, u.access_enabled
FROM users u
JOIN stripe_subscriptions s ON s.customer_id = u.stripe_customer_id
WHERE s.status IN ('canceled', 'unpaid', 'past_due', 'incomplete_expired')
  AND u.access_enabled = true;`,
  },
  {
    title: "Paid in Stripe but blocked in your app",
    sql: `SELECT u.id, u.email, u.status
FROM users u
JOIN stripe_subscriptions s ON s.customer_id = u.stripe_customer_id
WHERE s.status IN ('active', 'trialing')
  AND (u.access_enabled = false OR u.status IN ('blocked', 'inactive', 'disabled'));`,
  },
  {
    title: "Active users with no billing reference",
    sql: `SELECT u.id, u.email, u.plan
FROM users u
WHERE u.access_enabled = true
  AND (u.stripe_customer_id IS NULL OR u.stripe_customer_id = '')
  AND u.plan NOT IN ('free', 'trial');`,
  },
  {
    title: "Stripe customers with no app account (export Stripe IDs first)",
    sql: `-- Load your Stripe customer export into a temp table, then:
SELECT s.customer_id, s.email, s.status
FROM stripe_export s
LEFT JOIN users u ON u.stripe_customer_id = s.customer_id
WHERE u.id IS NULL AND s.status IN ('active', 'trialing');`,
  },
];

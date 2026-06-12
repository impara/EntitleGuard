import { classifyIssues } from "./classify";
import { estimateLeakage } from "./leakage";
import { matchRecords } from "./match";
import { normalizeAppRecords, normalizeStripeRecords } from "./normalize";
import { buildRecommendedActions, computeDataQualityScore } from "./report";
import type {
  AuditInput,
  AuditResult,
  AuditSummary,
  Issue,
  ProgressUpdate,
} from "./types";

export * from "./types";
export { parseCsvFile, parseCsvText, toCsv, MAX_FILE_BYTES } from "./csv";
export { detectAppMapping, detectStripeMapping } from "./detect";
export { maskEmail, maskId } from "./mask";
export { SQL_CHECKS } from "./report";

function countByCategory(issues: Issue[], category: Issue["category"]): number {
  return issues.filter((i) => i.category === category).length;
}

/**
 * Run the full local reconciliation (FR4). Synchronous pure function; the Web
 * Worker wrapper forwards `onProgress` updates to the UI.
 */
export function runAudit(
  input: AuditInput,
  onProgress?: (update: ProgressUpdate) => void,
): AuditResult {
  const { stripe, app, stripeMapping, appMapping, options } = input;

  onProgress?.({ phase: "normalizing", fraction: 0.1 });
  const stripeRecords = normalizeStripeRecords(stripe, stripeMapping);
  const appRecords = normalizeAppRecords(app, appMapping);

  onProgress?.({ phase: "matching", fraction: 0.4 });
  const matchResult = matchRecords(stripeRecords, appRecords);

  onProgress?.({ phase: "classifying", fraction: 0.7 });
  const issues = classifyIssues(matchResult);

  onProgress?.({ phase: "estimating", fraction: 0.9 });
  const leakage = estimateLeakage(issues, options?.fallbackMonthlyValue);

  const summary: AuditSummary = {
    totalAppRecords: app.rowCount,
    totalStripeRecords: stripe.rowCount,
    matchedRecords: matchResult.matches.length,
    unmatchedAppUsers: matchResult.unmatchedApp.length,
    unmatchedStripeCustomers: matchResult.unmatchedStripe.length,
    unpaidActiveCount: countByCategory(issues, "A"),
    paidBlockedCount: countByCategory(issues, "B"),
    missingBillingLinkCount: countByCategory(issues, "C"),
    orphanedStripeCount: countByCategory(issues, "D"),
    ambiguousCount: countByCategory(issues, "E"),
    highConfidenceMismatches: issues.filter((i) => i.confidence === "high").length,
    dataQualityScore: computeDataQualityScore(stripe, app, stripeMapping, appMapping),
    leakage,
  };

  onProgress?.({ phase: "done", fraction: 1 });
  return {
    summary,
    issues,
    recommendedActions: buildRecommendedActions(summary),
    completedAt: new Date().toISOString(),
  };
}

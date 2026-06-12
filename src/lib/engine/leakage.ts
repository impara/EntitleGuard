import type { Issue, LeakageEstimate } from "./types";

/**
 * Revenue leakage estimation (PRD section 9).
 *
 *   estimated monthly = sum of per-account monthly values for
 *                       unpaid-but-active accounts (category A,
 *                       high/medium confidence only)
 *   estimated annual  = monthly x 12
 *
 * Per-account value comes from the mapped Stripe MRR/amount column when
 * available, otherwise from the user-supplied fallback. Accounts with no
 * value at all are counted but excluded from the dollar totals — the tool
 * never invents numbers.
 */
export function estimateLeakage(
  issues: Issue[],
  fallbackMonthlyValue?: number,
): LeakageEstimate {
  const unpaidActive = issues.filter(
    (i) => i.category === "A" && i.confidence !== "needs_review",
  );

  let monthly = 0;
  let usedFallbackValue = false;
  let unvaluedAccounts = 0;

  for (const issue of unpaidActive) {
    if (issue.estimatedMonthlyValue !== null) {
      monthly += issue.estimatedMonthlyValue;
    } else if (fallbackMonthlyValue !== undefined && fallbackMonthlyValue > 0) {
      monthly += fallbackMonthlyValue;
      usedFallbackValue = true;
    } else {
      unvaluedAccounts += 1;
    }
  }

  const rounded = Math.round(monthly * 100) / 100;
  return {
    unpaidActiveCount: unpaidActive.length,
    estimatedMonthly: rounded,
    estimatedAnnual: Math.round(rounded * 12 * 100) / 100,
    usedFallbackValue,
    unvaluedAccounts,
  };
}

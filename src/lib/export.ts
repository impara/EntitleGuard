"use client";

import { CATEGORY_LABELS, toCsv } from "@/lib/engine";
import type { Issue } from "@/lib/engine";

/**
 * Local report export (FR9). Identifiers stay masked by default — the export
 * contains the mismatch summary, not raw billing data.
 */
export function buildMismatchCsv(issues: Issue[]): string {
  return toCsv(
    issues.map((issue) => ({
      category: `${issue.category} — ${CATEGORY_LABELS[issue.category]}`,
      severity: issue.severity,
      confidence: issue.confidence,
      email_masked: issue.maskedEmail,
      stripe_customer_id_masked: issue.maskedCustomerId,
      app_user_id_masked: issue.maskedUserId,
      stripe_status: issue.stripeStatus,
      app_status: issue.appStatus,
      plan: issue.plan,
      estimated_monthly_value: issue.estimatedMonthlyValue,
      explanation: issue.explanation,
    })),
  );
}

export function downloadTextFile(content: string, fileName: string, mime = "text/csv"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

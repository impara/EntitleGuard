"use client";

import type { AuditResult } from "@/lib/engine";
import { formatCount, formatUsd } from "@/lib/format";

function MetricCard({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "danger" | "warning" | "accent";
}) {
  const toneClass =
    tone === "danger"
      ? "text-danger"
      : tone === "warning"
        ? "text-warning"
        : tone === "accent"
          ? "text-accent"
          : "";
  return (
    <div className="rounded-xl border border-edge bg-surface p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums ${toneClass}`}>{value}</p>
    </div>
  );
}

export function SummaryDashboard({ result }: { result: AuditResult }) {
  const s = result.summary;
  const leak = s.leakage;
  const hasMismatches = s.unpaidActiveCount + s.paidBlockedCount > 0;

  const headline = hasMismatches
    ? `We found ${formatCount(s.unpaidActiveCount)} account(s) that appear unpaid in Stripe but active in your app${
        s.paidBlockedCount > 0
          ? `, and ${formatCount(s.paidBlockedCount)} paying customer(s) who appear blocked`
          : ""
      }.`
    : s.ambiguousCount + s.missingBillingLinkCount + s.orphanedStripeCount > 0
      ? "No high-severity drift detected, but some accounts need a manual look."
      : "No entitlement drift detected in these exports.";

  return (
    <div>
      <div
        className={`rounded-xl border p-6 ${
          hasMismatches ? "border-danger/40 bg-danger/5" : "border-accent/40 bg-accent/5"
        }`}
      >
        <p className="text-lg font-semibold leading-snug">{headline}</p>
        {leak.unpaidActiveCount > 0 && leak.estimatedMonthly > 0 && (
          <p className="mt-2 text-sm text-muted">
            Potential exposure:{" "}
            <span className="font-semibold text-foreground">
              {formatUsd(leak.estimatedMonthly)}/month
            </span>{" "}
            (~{formatUsd(leak.estimatedAnnual)}/year). This is an estimate based on your
            mapped values — accounts flagged here require review, not automatic action.
          </p>
        )}
        {leak.unpaidActiveCount > 0 && leak.estimatedMonthly === 0 && (
          <p className="mt-2 text-sm text-muted">
            No per-account value was available, so exposure is reported as account counts
            only. Map an MRR/amount column or set an average value to estimate dollars.
          </p>
        )}
        {leak.unvaluedAccounts > 0 && leak.estimatedMonthly > 0 && (
          <p className="mt-2 text-xs text-muted">
            {leak.unvaluedAccounts} flagged account(s) had no value and are excluded from the
            dollar estimate.
          </p>
        )}
        {s.unpaidActiveCount > 0 && s.paidBlockedCount > 0 && (
          <p className="mt-3 text-sm text-muted">
            These findings are not equally urgent: unpaid-but-active is usually silent and
            cost-facing; paid-but-blocked is customer-facing and likely to surface in support
            first.
          </p>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <MetricCard label="App records analyzed" value={formatCount(s.totalAppRecords)} />
        <MetricCard label="Stripe records analyzed" value={formatCount(s.totalStripeRecords)} />
        <MetricCard label="Matched records" value={formatCount(s.matchedRecords)} />
        <MetricCard label="Unmatched app users" value={formatCount(s.unmatchedAppUsers)} />
        <MetricCard
          label="Unmatched Stripe customers"
          value={formatCount(s.unmatchedStripeCustomers)}
        />
        <MetricCard
          label="Unpaid but active"
          value={formatCount(s.unpaidActiveCount)}
          tone={s.unpaidActiveCount > 0 ? "danger" : "accent"}
        />
        <MetricCard
          label="Paid but blocked"
          value={formatCount(s.paidBlockedCount)}
          tone={s.paidBlockedCount > 0 ? "danger" : "accent"}
        />
        <MetricCard
          label="Est. monthly exposure"
          value={leak.estimatedMonthly > 0 ? formatUsd(leak.estimatedMonthly) : "—"}
          tone={leak.estimatedMonthly > 0 ? "danger" : "default"}
        />
        <MetricCard
          label="Needs manual review"
          value={formatCount(s.ambiguousCount)}
          tone={s.ambiguousCount > 0 ? "warning" : "default"}
        />
        <MetricCard label="Data quality score" value={`${s.dataQualityScore}/100`} />
      </div>

      <div className="mt-6 rounded-xl border border-edge bg-surface p-5">
        <h3 className="font-semibold">Recommended next actions</h3>
        <ul className="mt-3 space-y-2">
          {result.recommendedActions.map((action) => (
            <li key={action} className="flex gap-2 text-sm text-muted">
              <span className="mt-0.5 text-accent">→</span>
              <span>{action}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

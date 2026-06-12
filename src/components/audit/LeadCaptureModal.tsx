"use client";

import { useState } from "react";
import { getSessionId, track } from "@/lib/analytics";
import type { AuditSummary } from "@/lib/engine";

export type LeadRequestType =
  | "full_report"
  | "mismatch_csv"
  | "paid_audit"
  | "monitoring_beta"
  | "review_call";

const REQUEST_TITLES: Record<LeadRequestType, string> = {
  full_report: "Get the full audit report",
  mismatch_csv: "Get the mismatch CSV",
  paid_audit: "Book the $150 leak audit (free if we find nothing)",
  monitoring_beta: "Join the $79/month continuous monitoring beta",
  review_call: "Book a 15-minute leak review",
};

const MRR_RANGES = [
  "Under $5k/month",
  "$5k-$15k/month",
  "$15k-$50k/month",
  "$50k-$150k/month",
  "$150k+/month",
];

const BILLING = ["Stripe", "Paddle", "Chargebee", "Recurly", "Lemon Squeezy", "Other"];
const DATABASES = ["PostgreSQL", "MySQL", "MongoDB", "Supabase", "Firebase", "DynamoDB", "Other"];

const BETA_OPTIONS: { id: string; label: string }[] = [
  { id: "daily_monitoring", label: "Daily monitoring" },
  { id: "slack_alerts", label: "Slack alerts" },
  { id: "postgres_agent", label: "Postgres read-only agent" },
  { id: "stripe_api", label: "Stripe API integration" },
  { id: "sql_remediation", label: "SQL remediation suggestions" },
  { id: "webhook_detection", label: "Webhook failure detection" },
  { id: "paid_audit_review", label: "Paid audit review" },
  { id: "not_interested", label: "Not interested" },
];

interface LeadCaptureModalProps {
  requestType: LeadRequestType;
  summary: AuditSummary;
  onClose: () => void;
  onSuccess: () => void;
}

const inputClass =
  "w-full rounded-md border border-edge bg-background px-3 py-2 text-sm outline-none focus:border-accent";

export function LeadCaptureModal({
  requestType,
  summary,
  onClose,
  onSuccess,
}: LeadCaptureModalProps) {
  const [email, setEmail] = useState("");
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [mrrRange, setMrrRange] = useState("");
  const [billingPlatform, setBillingPlatform] = useState("Stripe");
  const [databaseType, setDatabaseType] = useState("");
  const [betaInterests, setBetaInterests] = useState<string[]>([]);
  const [consent, setConsent] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const toggleInterest = (id: string) =>
    setBetaInterests((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id],
    );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!consent) {
      setError("Please confirm consent so we can send you the report.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: getSessionId(),
          email,
          company,
          role,
          mrrRange,
          billingPlatform,
          databaseType: databaseType || undefined,
          betaInterests: betaInterests.length > 0 ? betaInterests : undefined,
          wantsMonitoring: requestType === "monitoring_beta" || undefined,
          requestType,
          consent: true,
          summary: {
            totalAppRecords: summary.totalAppRecords,
            totalStripeRecords: summary.totalStripeRecords,
            matchedRecords: summary.matchedRecords,
            unpaidActiveCount: summary.unpaidActiveCount,
            paidBlockedCount: summary.paidBlockedCount,
            missingBillingLinkCount: summary.missingBillingLinkCount,
            orphanedStripeCount: summary.orphanedStripeCount,
            ambiguousCount: summary.ambiguousCount,
            highConfidenceMismatches: summary.highConfidenceMismatches,
            dataQualityScore: summary.dataQualityScore,
            estimatedMonthlyLeakage: summary.leakage.estimatedMonthly,
          },
        }),
      });
      if (!response.ok) {
        throw new Error("Submission failed. Please try again.");
      }
      track("full_report_requested", { requestType });
      if (requestType === "monitoring_beta") track("beta_signup_submitted");
      if (requestType === "review_call" || requestType === "paid_audit") track("call_booked");
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Submission failed. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-xl border border-edge bg-surface p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-semibold">{REQUEST_TITLES[requestType]}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted hover:text-foreground"
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <p className="mt-2 text-sm text-muted">
          Your CSV files stay in your browser. We only receive your contact details and the
          aggregated audit summary shown below — never customer rows or identifiers.
        </p>

        <form onSubmit={handleSubmit} className="mt-5 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="lead-email" className="mb-1 block text-sm">
                Work email <span className="text-danger">*</span>
              </label>
              <input
                id="lead-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="you@company.com"
              />
            </div>
            <div>
              <label htmlFor="lead-company" className="mb-1 block text-sm">
                Company / domain <span className="text-danger">*</span>
              </label>
              <input
                id="lead-company"
                required
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                className={inputClass}
                placeholder="acme.com"
              />
            </div>
            <div>
              <label htmlFor="lead-role" className="mb-1 block text-sm">
                Role <span className="text-danger">*</span>
              </label>
              <input
                id="lead-role"
                required
                value={role}
                onChange={(e) => setRole(e.target.value)}
                className={inputClass}
                placeholder="CTO, founder, backend lead…"
              />
            </div>
            <div>
              <label htmlFor="lead-mrr" className="mb-1 block text-sm">
                Approximate MRR <span className="text-danger">*</span>
              </label>
              <select
                id="lead-mrr"
                required
                value={mrrRange}
                onChange={(e) => setMrrRange(e.target.value)}
                className={inputClass}
              >
                <option value="">Select…</option>
                {MRR_RANGES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="lead-billing" className="mb-1 block text-sm">
                Billing platform <span className="text-danger">*</span>
              </label>
              <select
                id="lead-billing"
                required
                value={billingPlatform}
                onChange={(e) => setBillingPlatform(e.target.value)}
                className={inputClass}
              >
                {BILLING.map((b) => (
                  <option key={b} value={b}>
                    {b}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="lead-db" className="mb-1 block text-sm">
                Database <span className="ml-1 text-[10px] uppercase text-muted">optional</span>
              </label>
              <select
                id="lead-db"
                value={databaseType}
                onChange={(e) => setDatabaseType(e.target.value)}
                className={inputClass}
              >
                <option value="">Select…</option>
                {DATABASES.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm">What would you want next?</legend>
            <div className="flex flex-wrap gap-2">
              {BETA_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => toggleInterest(option.id)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    betaInterests.includes(option.id)
                      ? "border-accent bg-accent/15 text-accent"
                      : "border-edge text-muted hover:border-accent/50"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="rounded-lg border border-edge bg-background/60 p-3 text-xs text-muted">
            <p className="font-medium text-foreground">What we will receive:</p>
            <p className="mt-1">
              Contact details above + aggregate counts only (e.g. “{summary.unpaidActiveCount}{" "}
              unpaid-but-active, {summary.highConfidenceMismatches} high-confidence mismatches,
              data quality {summary.dataQualityScore}/100”). No emails, IDs, or CSV rows.
            </p>
          </div>

          <label className="flex items-start gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
              className="mt-0.5 accent-[var(--accent)]"
            />
            <span>
              I agree that EntitleGuard may store my contact details and the aggregated audit
              summary to send me the report and follow up about entitlement monitoring.
            </span>
          </label>

          {error && <p className="text-sm text-danger">{error}</p>}

          <button
            type="submit"
            disabled={submitting}
            className="w-full rounded-lg bg-accent-strong px-4 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {submitting ? "Submitting…" : REQUEST_TITLES[requestType]}
          </button>
        </form>
      </div>
    </div>
  );
}

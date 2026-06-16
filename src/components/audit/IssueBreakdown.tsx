"use client";

import { useState } from "react";
import { CATEGORY_LABELS } from "@/lib/engine";
import type { Issue, IssueCategory } from "@/lib/engine";
import { formatUsd } from "@/lib/format";

const CATEGORY_ORDER: IssueCategory[] = ["A", "B", "D", "C", "E"];

const CATEGORY_DESCRIPTIONS: Record<IssueCategory, string> = {
  A: "Stripe shows canceled/unpaid/past-due, but your app still grants access. Silent cost risk — the user keeps consuming API/compute without opening a ticket.",
  B: "Stripe shows paying customers, but your app blocks or disables them. Urgent customer-facing risk — likely to contact support within minutes.",
  C: "Active app accounts with no Stripe billing reference. Often comped/internal accounts — confirm they are intentional.",
  D: "Paying Stripe customers with no matching app account. Possible failed provisioning or deleted users.",
  E: "Cases the audit could not classify with confidence. Review manually before drawing conclusions.",
};

const SEVERITY_BADGE: Record<Issue["severity"], string> = {
  high: "bg-danger/15 text-danger",
  medium: "bg-warning/15 text-warning",
  low: "bg-edge text-muted",
};

const CONFIDENCE_LABEL: Record<Issue["confidence"], string> = {
  high: "High confidence",
  medium: "Medium confidence",
  needs_review: "Needs review",
};

const PREVIEW_LIMIT = 25;

function CategorySection({ category, issues }: { category: IssueCategory; issues: Issue[] }) {
  const [open, setOpen] = useState(category === "A" || category === "B");
  const shown = issues.slice(0, PREVIEW_LIMIT);

  return (
    <div className="rounded-xl border border-edge bg-surface">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 p-4 text-left"
      >
        <div className="flex items-center gap-3">
          <span
            className={`rounded-md px-2 py-0.5 text-xs font-semibold ${SEVERITY_BADGE[issues[0].severity]}`}
          >
            {issues.length}
          </span>
          <div>
            <p className="font-medium">
              Category {category} — {CATEGORY_LABELS[category]}
            </p>
            <p className="mt-0.5 text-xs text-muted">{CATEGORY_DESCRIPTIONS[category]}</p>
          </div>
        </div>
        <span className="text-muted">{open ? "−" : "+"}</span>
      </button>

      {open && (
        <div className="overflow-x-auto border-t border-edge px-4 pb-4">
          <table className="mt-3 w-full text-left text-xs">
            <thead>
              <tr className="text-muted">
                <th className="py-1.5 pr-4 font-medium">Email</th>
                <th className="py-1.5 pr-4 font-medium">Stripe customer</th>
                <th className="py-1.5 pr-4 font-medium">Stripe status</th>
                <th className="py-1.5 pr-4 font-medium">App status</th>
                <th className="py-1.5 pr-4 font-medium">Plan</th>
                <th className="py-1.5 pr-4 font-medium">Value/mo</th>
                <th className="py-1.5 font-medium">Confidence</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {shown.map((issue) => (
                <tr key={issue.id} className="border-t border-edge/60" title={issue.explanation}>
                  <td className="py-2 pr-4">{issue.maskedEmail ?? "—"}</td>
                  <td className="py-2 pr-4">{issue.maskedCustomerId ?? "—"}</td>
                  <td className="py-2 pr-4">{issue.stripeStatus ?? "—"}</td>
                  <td className="py-2 pr-4">{issue.appStatus ?? "—"}</td>
                  <td className="py-2 pr-4">{issue.plan ?? "—"}</td>
                  <td className="py-2 pr-4 tabular-nums">
                    {issue.estimatedMonthlyValue !== null
                      ? formatUsd(issue.estimatedMonthlyValue)
                      : "—"}
                  </td>
                  <td className="py-2 font-sans text-muted">{CONFIDENCE_LABEL[issue.confidence]}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {issues.length > PREVIEW_LIMIT && (
            <p className="mt-3 text-xs text-muted">
              …and {issues.length - PREVIEW_LIMIT} more in this category (included in the full
              report export).
            </p>
          )}
          <p className="mt-3 text-xs text-muted">
            Identifiers are masked in this preview. Hover a row for the full explanation.
          </p>
        </div>
      )}
    </div>
  );
}

export function IssueBreakdown({ issues }: { issues: Issue[] }) {
  const byCategory = new Map<IssueCategory, Issue[]>();
  for (const issue of issues) {
    const bucket = byCategory.get(issue.category);
    if (bucket) bucket.push(issue);
    else byCategory.set(issue.category, [issue]);
  }

  if (issues.length === 0) {
    return (
      <div className="rounded-xl border border-accent/40 bg-accent/5 p-6 text-center">
        <p className="font-medium">No mismatches detected.</p>
        <p className="mt-1 text-sm text-muted">
          Your Stripe export and app export agree on every record the audit could match.
          Re-run after your next deploy or billing change.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((category) => (
        <CategorySection key={category} category={category} issues={byCategory.get(category)!} />
      ))}
    </div>
  );
}

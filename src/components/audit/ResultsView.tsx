"use client";

import { useState } from "react";
import { track } from "@/lib/analytics";
import { SQL_CHECKS } from "@/lib/engine";
import type { AuditResult } from "@/lib/engine";
import { buildMismatchCsv, downloadTextFile } from "@/lib/export";
import { IssueBreakdown } from "./IssueBreakdown";
import { LeadCaptureModal, type LeadRequestType } from "./LeadCaptureModal";
import { SummaryDashboard } from "./SummaryDashboard";

interface ResultsViewProps {
  result: AuditResult;
  leadSubmitted: boolean;
  isDemo: boolean;
  onLeadSubmitted: () => void;
  onRestart: () => void;
}

export function ResultsView({
  result,
  leadSubmitted,
  isDemo,
  onLeadSubmitted,
  onRestart,
}: ResultsViewProps) {
  const [modalRequest, setModalRequest] = useState<LeadRequestType | null>(null);

  const openGate = (request: LeadRequestType) => {
    if (leadSubmitted) return;
    setModalRequest(request);
  };

  const handleDownloadCsv = () => {
    downloadTextFile(buildMismatchCsv(result.issues), "entitleguard-mismatches.csv");
    track("report_exported", { kind: "csv" });
  };

  const handlePrint = () => {
    track("report_exported", { kind: "print" });
    window.print();
  };

  return (
    <div>
      {isDemo && (
        <div className="no-print mb-4 rounded-lg border border-warning/40 bg-warning/10 px-4 py-2.5 text-sm">
          You are viewing <span className="font-semibold">sample data</span> with pre-seeded
          drift.{" "}
          <button type="button" onClick={onRestart} className="text-accent underline underline-offset-2">
            Run the audit on your own exports
          </button>
          .
        </div>
      )}

      <SummaryDashboard result={result} />

      {/* Conversion CTAs (PRD section 20 + research paper Table 7) */}
      <div className="no-print mt-6 rounded-xl border border-accent/30 bg-accent/5 p-6">
        <h3 className="text-lg font-semibold">Want this checked automatically every day?</h3>
        <p className="mt-1 text-sm text-muted">
          Drift recurs with every deploy, webhook hiccup, and plan change. EntitleGuard is
          building daily Stripe-to-database reconciliation with Slack/email alerts, a
          historical drift log, and webhook failure detection — read-only, no write actions.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          {!leadSubmitted && (
            <>
              <button
                type="button"
                onClick={() => openGate("full_report")}
                className="rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-background hover:opacity-90"
              >
                Send me the full audit report
              </button>
              <button
                type="button"
                onClick={() => openGate("mismatch_csv")}
                className="rounded-lg border border-edge px-4 py-2 text-sm font-medium hover:border-accent/60"
              >
                Get the mismatch CSV + SQL checks
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => openGate("paid_audit")}
            className="rounded-lg border border-edge px-4 py-2 text-sm font-medium hover:border-accent/60"
          >
            $150 manual leak audit — free if we find nothing
          </button>
          <button
            type="button"
            onClick={() => openGate("monitoring_beta")}
            className="rounded-lg border border-edge px-4 py-2 text-sm font-medium hover:border-accent/60"
          >
            Join the $79/month monitoring beta
          </button>
        </div>
        {leadSubmitted && (
          <p className="mt-3 text-sm text-accent">
            Thanks — your full report is unlocked below and we will follow up by email.
          </p>
        )}
      </div>

      <div className="mt-8">
        <h3 className="mb-3 text-lg font-semibold">Issue breakdown</h3>
        <IssueBreakdown issues={result.issues} />
      </div>

      {/* Gated full report (FR9 + the research paper's SQL deliverable) */}
      <div className="mt-8 rounded-xl border border-edge bg-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Full report &amp; SQL reconciliation checks</h3>
            <p className="mt-1 text-sm text-muted">
              Mismatch CSV export, printable report, and copy-paste SQL checks to verify each
              finding directly against your database.
            </p>
          </div>
          {!leadSubmitted && (
            <button
              type="button"
              onClick={() => openGate("full_report")}
              className="no-print rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-background hover:opacity-90"
            >
              Unlock with work email
            </button>
          )}
        </div>

        {leadSubmitted ? (
          <div className="mt-5">
            <div className="no-print flex flex-wrap gap-3">
              <button
                type="button"
                onClick={handleDownloadCsv}
                className="rounded-lg border border-edge px-4 py-2 text-sm font-medium hover:border-accent/60"
              >
                Download mismatch CSV
              </button>
              <button
                type="button"
                onClick={handlePrint}
                className="rounded-lg border border-edge px-4 py-2 text-sm font-medium hover:border-accent/60"
              >
                Print / save as PDF
              </button>
            </div>
            <div className="mt-5 space-y-4">
              {SQL_CHECKS.map((check) => (
                <div key={check.title}>
                  <p className="text-sm font-medium">{check.title}</p>
                  <pre className="mt-1.5 overflow-x-auto rounded-lg border border-edge bg-background/70 p-3 font-mono text-xs leading-relaxed text-muted">
                    {check.sql}
                  </pre>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="mt-4 rounded-lg border border-dashed border-edge p-4 text-sm text-muted">
            The export and SQL checks unlock after you request the full report. Your CSV files
            still never leave the browser — we only receive your contact details and the
            aggregate summary.
          </p>
        )}
      </div>

      <div className="no-print mt-8 flex justify-between">
        <button
          type="button"
          onClick={onRestart}
          className="text-sm text-muted underline-offset-2 hover:text-foreground hover:underline"
        >
          ← Run another audit
        </button>
        <p className="text-xs text-muted">
          Completed {new Date(result.completedAt).toLocaleString()} · processed locally
        </p>
      </div>

      {modalRequest && (
        <LeadCaptureModal
          requestType={modalRequest}
          summary={result.summary}
          onClose={() => setModalRequest(null)}
          onSuccess={() => {
            setModalRequest(null);
            onLeadSubmitted();
          }}
        />
      )}
    </div>
  );
}

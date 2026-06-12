"use client";

import { useCallback, useEffect, useReducer, useRef } from "react";
import { track } from "@/lib/analytics";
import { exposureBucket } from "@/lib/analytics-shared";
import {
  detectAppMapping,
  detectStripeMapping,
  parseCsvFile,
  parseCsvText,
} from "@/lib/engine";
import type { AppField, AuditInput, ParsedCsv, StripeField } from "@/lib/engine";
import type { WorkerResponse } from "@/workers/reconcile.worker";
import { ColumnMapper, type MappingFieldDef } from "./ColumnMapper";
import { FileDropzone } from "./FileDropzone";
import { ProgressState } from "./ProgressState";
import { ResultsView } from "./ResultsView";
import {
  initialWizardState,
  mappingValidation,
  wizardReducer,
} from "./wizard-state";

const STRIPE_FIELDS: MappingFieldDef<StripeField>[] = [
  { field: "customerId", label: "Stripe customer ID", required: true },
  { field: "status", label: "Subscription status", required: true },
  { field: "email", label: "Customer email" },
  { field: "subscriptionId", label: "Subscription ID" },
  { field: "plan", label: "Plan / product name" },
  { field: "mrr", label: "MRR / amount", hint: "Enables dollar exposure estimates" },
  { field: "currency", label: "Currency" },
  { field: "currentPeriodEnd", label: "Current period end" },
  { field: "cancelAtPeriodEnd", label: "Cancel at period end" },
];

const APP_FIELDS: MappingFieldDef<AppField>[] = [
  { field: "stripeCustomerId", label: "Stripe customer ID", required: true },
  { field: "accessEnabled", label: "Access enabled flag", required: true },
  { field: "email", label: "Email" },
  { field: "userId", label: "User / workspace ID" },
  { field: "status", label: "Local subscription status" },
  { field: "plan", label: "Local plan", hint: "Improves free-account detection" },
  { field: "role", label: "Role / account type", hint: "Filters internal accounts" },
  { field: "createdAt", label: "Created date" },
  { field: "lastActiveAt", label: "Last active date" },
];

const STRIPE_EXPORT_HELP = (
  <>
    <p>
      In the Stripe Dashboard go to <span className="font-mono">Billing → Subscriptions</span>{" "}
      (or <span className="font-mono">Customers</span>) and click{" "}
      <span className="font-mono">Export</span>. Required: customer ID and status. Plan and
      amount enable exposure estimates.
    </p>
    <p className="mt-2">
      Email is optional — it is only used as a fallback join key if your database does not
      store Stripe customer IDs. If yours does, you can delete the email column from the CSV
      before loading it.
    </p>
  </>
);

const APP_EXPORT_HELP = (
  <>
    <p className="mb-2">
      Minimal Postgres export — adapt table/column names to your schema. It contains no names
      or emails; matching uses the Stripe customer ID:
    </p>
    <pre className="overflow-x-auto rounded bg-black/30 p-2 font-mono text-[11px] leading-relaxed">
      {`\\copy (
  SELECT id AS user_id, stripe_customer_id,
         subscription_status, plan, access_enabled, role
  FROM users
) TO 'app-users.csv' WITH CSV HEADER;`}
    </pre>
    <p className="mt-2">
      Prisma:{" "}
      <span className="font-mono">
        npx prisma db execute --stdin
      </span>{" "}
      with the same query, or export from any admin/BI tool.
    </p>
    <p className="mt-2">
      Only add an <span className="font-mono">email</span> column if you do not store{" "}
      <span className="font-mono">stripe_customer_id</span> — email then becomes the join key,
      at lower match confidence.
    </p>
    <p className="mt-2">
      Important: export the access/status columns your request path <em>actually reads</em> —
      not whatever column happens to be named &quot;status&quot;. If your middleware checks a
      boolean and a cron job checks a status column, export both; the audit flags rows where
      your own columns disagree with each other.
    </p>
  </>
);

interface AuditWizardProps {
  demo?: boolean;
}

export function AuditWizard({ demo = false }: AuditWizardProps) {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
  const workerRef = useRef<Worker | null>(null);
  const demoLoadedRef = useRef(false);

  useEffect(() => {
    track("audit_started");
    return () => workerRef.current?.terminate();
  }, []);

  // Drop-off tracking (FR10): user leaves while still mapping.
  useEffect(() => {
    if (state.step !== "mapping") return;
    const handler = () => track("mapping_dropoff");
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [state.step]);

  const loadStripeCsv = useCallback((csv: ParsedCsv) => {
    const { mapping, suggestions } = detectStripeMapping(csv);
    dispatch({ type: "STRIPE_CSV_LOADED", csv, mapping, suggestions });
    track("stripe_csv_uploaded", { rows: csv.rowCount, columns: csv.headers.length });
  }, []);

  const loadAppCsv = useCallback((csv: ParsedCsv) => {
    const { mapping, suggestions } = detectAppMapping(csv);
    dispatch({ type: "APP_CSV_LOADED", csv, mapping, suggestions });
    track("app_csv_uploaded", { rows: csv.rowCount, columns: csv.headers.length });
  }, []);

  const handleFile = useCallback(
    async (file: File, kind: "stripe" | "app") => {
      const result = await parseCsvFile(file);
      if (!result.ok) {
        dispatch({ type: "ERROR", message: result.error.message });
        dispatch({ type: "BACK_TO_UPLOAD" });
        alert(result.error.message);
        return;
      }
      if (kind === "stripe") loadStripeCsv(result.data);
      else loadAppCsv(result.data);
    },
    [loadAppCsv, loadStripeCsv],
  );

  // Demo mode: load the bundled sample CSVs (acceptance criteria: demoable).
  useEffect(() => {
    if (!demo || demoLoadedRef.current) return;
    demoLoadedRef.current = true;
    track("demo_mode_started");
    void (async () => {
      const [stripeText, appText] = await Promise.all([
        fetch("/samples/stripe-sample.csv").then((r) => r.text()),
        fetch("/samples/app-users-sample.csv").then((r) => r.text()),
      ]);
      const stripeParsed = parseCsvText(stripeText, "stripe-sample.csv");
      const appParsed = parseCsvText(appText, "app-users-sample.csv");
      if (stripeParsed.ok && appParsed.ok) {
        dispatch({ type: "MARK_DEMO" });
        loadStripeCsv(stripeParsed.data);
        loadAppCsv(appParsed.data);
        dispatch({ type: "GO_TO_MAPPING" });
      }
    })();
  }, [demo, loadAppCsv, loadStripeCsv]);

  const runAuditInWorker = useCallback(() => {
    if (!state.stripeCsv || !state.appCsv) return;
    track("mapping_completed");
    dispatch({ type: "RUN_STARTED" });

    const worker = new Worker(
      new URL("../../workers/reconcile.worker.ts", import.meta.url),
    );
    workerRef.current?.terminate();
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const msg = event.data;
      if (msg.type === "progress") {
        dispatch({ type: "PROGRESS", update: msg.update });
      } else if (msg.type === "result") {
        dispatch({ type: "RESULT", result: msg.result });
        const s = msg.result.summary;
        const mismatches = s.unpaidActiveCount + s.paidBlockedCount;
        track("audit_completed", {
          highConfidence: s.highConfidenceMismatches,
          dataQuality: s.dataQualityScore,
          exposureBucket: exposureBucket(s.leakage.estimatedMonthly),
          unpaidActive: s.unpaidActiveCount,
          paidBlocked: s.paidBlockedCount,
          ambiguous: s.ambiguousCount,
        });
        track(mismatches > 0 ? "mismatches_found" : "no_mismatches_found", {
          count: mismatches,
        });
        worker.terminate();
      } else {
        dispatch({ type: "ERROR", message: msg.message });
        worker.terminate();
      }
    };
    worker.onerror = () => {
      dispatch({ type: "ERROR", message: "The audit worker failed. Please try again." });
      worker.terminate();
    };

    const fallback = Number.parseFloat(state.fallbackValue);
    const input: AuditInput = {
      stripe: state.stripeCsv,
      app: state.appCsv,
      stripeMapping: state.stripeMapping,
      appMapping: state.appMapping,
      options: {
        fallbackMonthlyValue:
          Number.isFinite(fallback) && fallback > 0 ? fallback : undefined,
      },
    };
    worker.postMessage({ type: "run", input });
  }, [state.appCsv, state.appMapping, state.fallbackValue, state.stripeCsv, state.stripeMapping]);

  const validation = mappingValidation(state);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-20">
      {state.step !== "results" && <StepIndicator step={state.step} />}

      {state.step === "upload" && (
        <div>
          <div className="grid gap-5 md:grid-cols-2">
            <FileDropzone
              title="1. Stripe export"
              description="Subscriptions or customers CSV exported from the Stripe Dashboard."
              csv={state.stripeCsv}
              exportHelp={{ label: "How to export this from Stripe", content: STRIPE_EXPORT_HELP }}
              onFile={(f) => void handleFile(f, "stripe")}
              onClear={() => dispatch({ type: "CLEAR_STRIPE_CSV" })}
            />
            <FileDropzone
              title="2. App user export"
              description="Users / workspaces CSV from your application database."
              csv={state.appCsv}
              exportHelp={{ label: "Example Postgres/Prisma export SQL", content: APP_EXPORT_HELP }}
              onFile={(f) => void handleFile(f, "app")}
              onClear={() => dispatch({ type: "CLEAR_APP_CSV" })}
            />
          </div>

          <div className="mt-6 flex items-center justify-between gap-4">
            <p className="text-xs text-muted">
              Files are parsed and compared locally. No upload, no API keys, no database
              access. The recommended exports contain no names or emails.
            </p>
            <button
              type="button"
              disabled={!state.stripeCsv || !state.appCsv}
              onClick={() => dispatch({ type: "GO_TO_MAPPING" })}
              className="rounded-lg bg-accent-strong px-5 py-2.5 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-40"
            >
              Continue to column mapping →
            </button>
          </div>
        </div>
      )}

      {state.step === "mapping" && state.stripeCsv && state.appCsv && (
        <div>
          {state.error && (
            <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-4 py-2.5 text-sm text-danger">
              {state.error}
            </div>
          )}
          <div className="grid gap-5 md:grid-cols-2">
            <ColumnMapper
              title="Stripe file"
              fileName={state.stripeCsv.fileName}
              headers={state.stripeCsv.headers}
              fields={STRIPE_FIELDS}
              mapping={state.stripeMapping}
              suggestions={state.stripeSuggestions}
              onChange={(field, column) => dispatch({ type: "SET_STRIPE_FIELD", field, column })}
            />
            <ColumnMapper
              title="App file"
              fileName={state.appCsv.fileName}
              headers={state.appCsv.headers}
              fields={APP_FIELDS}
              mapping={state.appMapping}
              suggestions={state.appSuggestions}
              onChange={(field, column) => dispatch({ type: "SET_APP_FIELD", field, column })}
            />
          </div>

          <div className="mt-5 rounded-xl border border-edge bg-surface p-5">
            <label htmlFor="fallback-value" className="text-sm font-medium">
              Average monthly value per account (optional)
            </label>
            <p className="mt-1 text-xs text-muted">
              Used to estimate exposure when no MRR/amount column is mapped.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <span className="text-sm text-muted">$</span>
              <input
                id="fallback-value"
                type="number"
                min="0"
                step="1"
                value={state.fallbackValue}
                onChange={(e) => dispatch({ type: "SET_FALLBACK_VALUE", value: e.target.value })}
                placeholder="49"
                className="w-32 rounded-md border border-edge bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
              />
              <span className="text-sm text-muted">/ month</span>
            </div>
          </div>

          {(validation.blockers.length > 0 || validation.warnings.length > 0) && (
            <div className="mt-5 space-y-2">
              {validation.blockers.map((b) => (
                <p key={b} className="text-sm text-danger">
                  ✕ {b}
                </p>
              ))}
              {validation.warnings.map((w) => (
                <p key={w} className="text-sm text-warning">
                  ⚠ {w}
                </p>
              ))}
            </div>
          )}

          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={() => dispatch({ type: "BACK_TO_UPLOAD" })}
              className="text-sm text-muted underline-offset-2 hover:text-foreground hover:underline"
            >
              ← Back to upload
            </button>
            <button
              type="button"
              disabled={!validation.canRun}
              onClick={runAuditInWorker}
              className="rounded-lg bg-accent-strong px-5 py-2.5 text-sm font-semibold text-background hover:opacity-90 disabled:opacity-40"
            >
              Run local audit →
            </button>
          </div>
        </div>
      )}

      {state.step === "running" && <ProgressState progress={state.progress} />}

      {state.step === "results" && state.result && (
        <ResultsView
          result={state.result}
          leadSubmitted={state.leadSubmitted}
          isDemo={state.isDemo}
          onLeadSubmitted={() => dispatch({ type: "LEAD_SUBMITTED" })}
          onRestart={() => dispatch({ type: "RESET" })}
        />
      )}
    </div>
  );
}

function StepIndicator({ step }: { step: "upload" | "mapping" | "running" }) {
  const steps = [
    { id: "upload", label: "Upload" },
    { id: "mapping", label: "Map columns" },
    { id: "running", label: "Audit" },
  ];
  const currentIndex = steps.findIndex((s) => s.id === step);
  return (
    <ol className="mb-8 flex items-center gap-2 text-sm">
      {steps.map((s, i) => (
        <li key={s.id} className="flex items-center gap-2">
          <span
            className={`flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
              i <= currentIndex ? "bg-accent text-background" : "bg-surface text-muted"
            }`}
          >
            {i + 1}
          </span>
          <span className={i <= currentIndex ? "" : "text-muted"}>{s.label}</span>
          {i < steps.length - 1 && <span className="mx-1 text-muted">—</span>}
        </li>
      ))}
    </ol>
  );
}

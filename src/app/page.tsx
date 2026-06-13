import Link from "next/link";
import { LandingAnalytics } from "@/components/LandingAnalytics";
import { SiteHeader } from "@/components/SiteHeader";

const DRIFT_CAUSES = [
  {
    title: "Webhook failures",
    body: "A customer.subscription.deleted event times out or hits an unhandled exception — Stripe cancels, your database never hears about it.",
  },
  {
    title: "Out-of-order events",
    body: "Payment retries and plan changes arrive out of sequence. Your sync code applies an older state on top of a newer one.",
  },
  {
    title: "Deploys and migrations",
    body: "Every schema migration, billing rule change, and refactor introduces new edge cases between Stripe and your access checks.",
  },
];

const CATEGORIES = [
  {
    id: "A",
    label: "Unpaid but active",
    body: "Canceled, unpaid, or past-due in Stripe — still consuming your product (and your API/GPU bill).",
    severity: "High",
  },
  {
    id: "B",
    label: "Paid but blocked",
    body: "Paying customers your app marks inactive or blocked. Silent churn risk.",
    severity: "High",
  },
  {
    id: "C",
    label: "Missing billing link",
    body: "Active accounts with no Stripe reference. Comped on purpose — or leaking?",
    severity: "Medium",
  },
  {
    id: "D",
    label: "Orphaned Stripe subscription",
    body: "Paying Stripe customers with no matching app account. Failed provisioning.",
    severity: "Medium",
  },
  {
    id: "E",
    label: "Ambiguous state",
    body: "Grace periods, custom plans, internal accounts. Flagged for review, never overclaimed.",
    severity: "Review",
  },
];

const PRIVACY_POINTS = [
  "Files are parsed and compared in your browser — never sent to our servers",
  "Minimal export by design: matching works on Stripe customer IDs — no names or emails required",
  "No Stripe API keys",
  "No database credentials",
  "No login required to run the audit",
  "We only receive contact details if you request the full report",
];

export default function LandingPage() {
  return (
    <>
      <LandingAnalytics />
      <SiteHeader />
      <main className="flex-1">
        {/* Hero */}
        <section className="mx-auto max-w-5xl px-4 pb-16 pt-20 text-center">
          <p className="mx-auto mb-4 w-fit rounded-full border border-edge px-3 py-1 text-xs text-muted">
            Stripe-to-app-access reconciliation — for usage-heavy B2B SaaS
          </p>
          <h1 className="mx-auto max-w-3xl text-4xl font-bold leading-tight sm:text-5xl">
            Find Stripe users who may be{" "}
            <span className="text-danger">unpaid but still active</span> in your app.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">
            Final-state reconciliation — not a webhook fixer. Upload a Stripe export and a
            minimal app entitlement export. The comparison runs locally in your browser. No API
            keys. No database access. No server upload.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/audit"
              className="rounded-lg bg-accent-strong px-6 py-3 font-semibold text-background hover:opacity-90"
            >
              Run free local audit
            </Link>
            <Link
              href="/audit?demo=1"
              className="rounded-lg border border-edge px-6 py-3 font-medium hover:border-accent/60"
            >
              See example report
            </Link>
          </div>
          <p className="mt-5 text-xs text-muted">
            Free one-time audit today → nightly monitoring in beta. Your CSV files never leave
            your browser.
          </p>
        </section>

        {/* Differentiation */}
        <section className="border-t border-edge bg-surface/40">
          <div className="mx-auto max-w-5xl px-4 py-12">
            <h2 className="text-xl font-bold">Not a webhook retry tool</h2>
            <p className="mt-3 max-w-3xl text-muted">
              Webhook queues, idempotency, and replay help events get processed. EntitleGuard
              checks the result: does your <strong>current</strong> app access state agree with
              Stripe&apos;s <strong>current</strong> billing state? It catches cases where the
              webhook returned 200 but the DB row never updated — failed writes, rollbacks, manual
              overrides, or internal schema drift.
            </p>
          </div>
        </section>

        {/* Problem */}
        <section className="border-t border-edge bg-surface/40">
          <div className="mx-auto max-w-5xl px-4 py-16">
            <h2 className="text-2xl font-bold">
              Stripe is your billing source of truth. Your database decides who gets access.
              They drift.
            </h2>
            <p className="mt-3 max-w-3xl text-muted">
              Billing state and local access state are usually synced through webhooks, cron
              jobs, and custom code — and they fail silently. For usage-heavy SaaS (LLM APIs,
              compute, data processing), one unpaid-but-active account is a direct cash drain
              every single day.
            </p>
            <p className="mt-3 max-w-3xl text-sm text-muted">
              Built for existing SaaS with custom or legacy entitlement logic in their own
              database — exactly the systems Stripe-internal auditors cannot see, and a
              one-off cron script will not keep honest across deploys, status vocabularies,
              and plan changes.
            </p>
            <div className="mt-8 grid gap-4 md:grid-cols-3">
              {DRIFT_CAUSES.map((cause) => (
                <div key={cause.title} className="rounded-xl border border-edge bg-surface p-5">
                  <h3 className="font-semibold">{cause.title}</h3>
                  <p className="mt-2 text-sm text-muted">{cause.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mx-auto max-w-5xl px-4 py-16">
          <h2 className="text-2xl font-bold">Upload two CSVs. See drift in 60 seconds.</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              {
                step: "1",
                title: "Export",
                body: "Copy our minimal SQL (users or workspaces table) — IDs, statuses, and plans only, no names or emails. Export subscriptions from the Stripe Dashboard.",
              },
              {
                step: "2",
                title: "Map columns",
                body: "Columns are auto-detected (customer ID, email, status, access flag). Accept or adjust the mapping — partial mappings work.",
              },
              {
                step: "3",
                title: "Review the audit",
                body: "High-confidence mismatches, estimated monthly exposure, and the exact accounts to review — computed locally, identifiers masked.",
              },
            ].map((item) => (
              <div key={item.step} className="rounded-xl border border-edge bg-surface p-5">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 font-mono text-sm font-bold text-accent">
                  {item.step}
                </span>
                <h3 className="mt-3 font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm text-muted">{item.body}</p>
              </div>
            ))}
          </div>
          <div className="mt-8 rounded-xl border border-danger/30 bg-danger/5 p-5 text-sm">
            <p className="font-mono text-muted">Example output:</p>
            <p className="mt-1 text-lg font-semibold">
              “We found 7 users who appear unpaid in Stripe but active in your app. Estimated
              exposure: $420/month.”
            </p>
          </div>
        </section>

        {/* Categories */}
        <section className="border-t border-edge bg-surface/40">
          <div className="mx-auto max-w-5xl px-4 py-16">
            <h2 className="text-2xl font-bold">Every mismatch, classified — never overclaimed.</h2>
            <p className="mt-3 max-w-3xl text-muted">
              Each finding gets a category, a severity, and a confidence level. Uncertain cases
              default to “needs review” — the audit is a diagnostic, not a verdict.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CATEGORIES.map((c) => (
                <div key={c.id} className="rounded-xl border border-edge bg-surface p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-muted">Category {c.id}</span>
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                        c.severity === "High"
                          ? "bg-danger/15 text-danger"
                          : c.severity === "Medium"
                            ? "bg-warning/15 text-warning"
                            : "bg-edge text-muted"
                      }`}
                    >
                      {c.severity}
                    </span>
                  </div>
                  <h3 className="mt-2 font-semibold">{c.label}</h3>
                  <p className="mt-1 text-sm text-muted">{c.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Privacy */}
        <section className="mx-auto max-w-5xl px-4 py-16">
          <div className="grid items-center gap-10 md:grid-cols-2">
            <div>
              <h2 className="text-2xl font-bold">Built to be trusted with nothing.</h2>
              <p className="mt-3 text-muted">
                The audit is local-first by design. There is nothing to leak because nothing is
                collected. The output doubles as a provable entitlement-alignment artifact you
                can attach to compliance and billing reviews.
              </p>
              <p className="mt-3 text-sm text-muted">
                To be precise: local-only processing means we never receive your data — but
                exporting customer records remains your responsibility under GDPR and your own
                data policies. That is why the recommended export is minimal: pseudonymous IDs,
                statuses, and plans. No names or emails are required.
              </p>
            </div>
            <ul className="space-y-3">
              {PRIVACY_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 text-accent">✓</span>
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Final CTA */}
        <section className="border-t border-edge">
          <div className="mx-auto max-w-5xl px-4 py-16 text-center">
            <h2 className="text-3xl font-bold">
              Do Stripe and your database agree? Find out now.
            </h2>
            <p className="mx-auto mt-3 max-w-xl text-muted">
              Built for usage-heavy B2B SaaS on Stripe where an active account costs real money
              every month — AI, compute, scraping, enrichment. Initial focus: Postgres-style
              exports; nightly API reconciliation in beta.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/audit"
                className="rounded-lg bg-accent-strong px-6 py-3 font-semibold text-background hover:opacity-90"
              >
                Run free local audit
              </Link>
              <Link
                href="/audit?demo=1"
                className="rounded-lg border border-edge px-6 py-3 font-medium hover:border-accent/60"
              >
                Try it with sample data
              </Link>
            </div>
          </div>
        </section>

        <footer className="border-t border-edge">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted">
            <p>EntitleGuard — local-first Stripe-to-app-access reconciliation.</p>
            <p>CSV files are read locally in your browser and never sent to EntitleGuard.</p>
          </div>
        </footer>
      </main>
    </>
  );
}

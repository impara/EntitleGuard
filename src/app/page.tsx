import Link from "next/link";
import { LandingAnalytics } from "@/components/LandingAnalytics";
import { MonitoringBetaButton } from "@/components/MonitoringBetaButton";
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
  {
    title: "Manual CS/admin overrides",
    body: "Support or an admin changes app access without updating Stripe. No webhook pipeline catches this — the billing record and the access flag simply disagree.",
  },
  {
    title: "Acknowledged but not reflected",
    body: "A Stripe event was acknowledged, but final app access state never changed correctly — failed writes, rollbacks, wrong row updated, async job failure after ack, or local state overwritten later.",
  },
];

const CATEGORIES = [
  {
    id: "A",
    label: "Unpaid but active",
    body: "Canceled, unpaid, or past-due in Stripe — still consuming your product (and your API/GPU bill). Silent, cost-facing risk.",
    severity: "High",
  },
  {
    id: "B",
    label: "Paid but blocked",
    body: "Paying customers your app marks inactive or blocked — they'll email support before your cron catches it. Urgent, customer-facing risk.",
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

const MONITORING_FEATURES = [
  {
    title: "Paid-but-blocked alerts",
    body: "Page the operator when Stripe says paid but the application denies access—the incident most likely to reach support first.",
  },
  {
    title: "Fixed-reference drift alerts",
    body: "Compare mismatch rate with an older completed run instead of allowing a slowly worsening baseline to hide the change.",
  },
  {
    title: "Queue-age alerts",
    body: "See unresolved findings that have sat untriaged beyond your threshold, even when the overall mismatch rate looks stable.",
  },
  {
    title: "Acknowledgement and history",
    body: "Keep alert history, operator notes, resolution provenance, and explicit manual overrides instead of silently healing the evidence away.",
  },
];

const NOT_FOR = [
  "Apps that check Stripe live on every request and do not keep local entitlement state",
  "Very early SaaS products with a handful of customers and no meaningful usage cost",
  "Teams looking for a webhook retry queue, dead-letter replay tool, or automatic suspension system",
  "Companies that need vendor-hosted procurement, SOC 2 review, or enterprise SSO before running any audit",
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
            Read-only Stripe access monitoring for SaaS
          </p>
          <h1 className="mx-auto max-w-4xl text-4xl font-bold leading-tight sm:text-5xl">
            Know when a paying customer loses access—before support tells you.
          </h1>
          <p className="mx-auto mt-5 max-w-3xl text-lg text-muted">
            EntitleGuard compares Stripe billing with the access state your application actually
            uses. Get alerted about paid-but-blocked customers, broader entitlement drift, and
            mismatches nobody has triaged.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-4">
            <Link
              href="/audit"
              className="rounded-lg bg-accent-strong px-6 py-3 font-semibold text-background hover:opacity-90"
            >
              Run free local audit
            </Link>
            <MonitoringBetaButton className="rounded-lg border border-accent/50 px-6 py-3 font-semibold text-accent hover:bg-accent/10">
              Apply for monitoring beta — $79/month
            </MonitoringBetaButton>
          </div>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-4 gap-y-2 text-xs text-muted">
            <Link href="/audit?demo=1" className="hover:text-foreground hover:underline">
              See example report
            </Link>
            <span aria-hidden="true">·</span>
            <Link
              href="https://github.com/impara/EntitleGuard"
              className="hover:text-foreground hover:underline"
            >
              View source on GitHub
            </Link>
          </div>
          <p className="mx-auto mt-5 max-w-3xl text-xs text-muted">
            Start with a browser-only audit. Monitoring remains read-only and stores only
            pseudonymous findings and operational history.
          </p>
        </section>

        {/* Monitoring beta */}
        <section id="monitoring-beta" className="border-t border-edge bg-surface/40 scroll-mt-20">
          <div className="mx-auto max-w-5xl px-4 py-16">
            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-accent">
                  Monitoring beta · $79/month
                </p>
                <h2 className="mt-3 max-w-3xl text-3xl font-bold">
                  The audit finds drift once. Monitoring keeps it from becoming a support ticket.
                </h2>
                <p className="mt-3 max-w-3xl text-muted">
                  EntitleGuard runs nightly against a customer-owned, read-only HTTPS source
                  adapter. It records pseudonymous findings, alerts by email, and keeps the
                  operator history needed to see what was acknowledged, resolved, or intentionally
                  overridden.
                </p>
              </div>
              <MonitoringBetaButton className="shrink-0 rounded-lg bg-accent-strong px-5 py-2.5 font-semibold text-background hover:opacity-90">
                Apply for the beta
              </MonitoringBetaButton>
            </div>
            <div className="mt-8 grid gap-4 md:grid-cols-2">
              {MONITORING_FEATURES.map((feature) => (
                <div key={feature.title} className="rounded-xl border border-edge bg-surface p-5">
                  <h3 className="font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-sm text-muted">{feature.body}</p>
                </div>
              ))}
            </div>
            <p className="mt-6 max-w-3xl text-sm text-muted">
              Email-first and read-only. No Slack integration, automatic suspension, or SQL
              remediation in this beta. We help you define the source adapter for your current
              Stripe and entitlement schema.
            </p>
          </div>
        </section>

        {/* Differentiation */}
        <section className="border-t border-edge bg-surface/40">
          <div className="mx-auto max-w-5xl px-4 py-12">
            <h2 className="text-xl font-bold">Two layers — not a webhook retry tool</h2>
            <p className="mt-3 max-w-3xl text-muted">
              Mature Stripe integrations usually need both layers. EntitleGuard is the second
              one — final-state reconciliation after your webhook infrastructure.
            </p>
            <ul className="mt-4 max-w-3xl space-y-2 text-sm text-muted">
              <li>
                <strong className="text-foreground">Webhook reliability</strong> — did we
                receive and process the Stripe event correctly? Queues, idempotency, and replay
                help here.
              </li>
              <li>
                <strong className="text-foreground">Final-state reconciliation</strong> — does
                your current app access state agree with Stripe&apos;s current billing state?
                EntitleGuard checks this result, regardless of how you got there.
              </li>
            </ul>
            <p className="mt-4 max-w-3xl text-sm text-muted">
              Lazy sync on page view only heals accounts that open the billing page again. It
              does not catch users who keep hitting your API while Stripe says canceled. It also
              misses acknowledged-but-not-reflected cases — webhook returned 200, but the access
              row never updated.
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
            <div className="mt-8 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
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
            <p className="mt-6 max-w-3xl text-sm text-muted">
              Category A is usually silent and cost-facing — users keep consuming without opening
              a ticket. Category B is customer-facing and urgent — paying customers are likely to
              contact support before your cron catches it.
            </p>
          </div>
        </section>

        {/* Fit */}
        <section className="border-t border-edge bg-surface/40">
          <div className="mx-auto max-w-5xl px-4 py-16">
            <h2 className="text-2xl font-bold">Who this is not for</h2>
            <p className="mt-3 max-w-3xl text-muted">
              EntitleGuard is a read-only reconciliation backstop for existing SaaS teams with
              local billing/access state. It is intentionally narrow.
            </p>
            <div className="mt-6 grid gap-3 md:grid-cols-2">
              {NOT_FOR.map((item) => (
                <div key={item} className="rounded-xl border border-edge bg-surface p-4 text-sm text-muted">
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Privacy */}
        <section className="mx-auto max-w-5xl px-4 py-16">
          <div>
            <h2 className="text-2xl font-bold">Two products, two clear privacy boundaries.</h2>
            <p className="mt-3 max-w-3xl text-muted">
              The free audit and monitoring beta handle data differently. Neither requires raw
              customer rows to be stored by EntitleGuard.
            </p>
            <div className="mt-8 grid gap-5 md:grid-cols-2">
              <div className="rounded-xl border border-edge bg-surface p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
                  Free local audit
                </p>
                <h3 className="mt-2 text-lg font-semibold">Your CSV data stays in the browser.</h3>
                <p className="mt-3 text-sm text-muted">
                  CSV processing happens entirely in your browser. Customer rows and identifiers
                  are never uploaded. You do not provide Stripe API keys, database credentials, or
                  a login to run the audit.
                </p>
                <p className="mt-3 text-sm text-muted">
                  If you request a report or beta access, EntitleGuard receives the contact fields
                  you submit and, after an audit, aggregate counts—not CSV rows.
                </p>
              </div>
              <div className="rounded-xl border border-edge bg-surface p-6">
                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-accent">
                  Monitoring beta
                </p>
                <h3 className="mt-2 text-lg font-semibold">
                  Operational history is stored without raw customer identifiers.
                </h3>
                <p className="mt-3 text-sm text-muted">
                  EntitleGuard stores pseudonymous mismatch fingerprints, aggregate run results,
                  alert history, email delivery records, scheduler executions, and operator actions.
                </p>
                <p className="mt-3 text-sm text-muted">
                  The source adapter does not send raw customer emails, Stripe IDs, database
                  credentials, or CSV rows. Monitoring stays read-only and does not grant or revoke
                  access.
                </p>
              </div>
            </div>
            <p className="mt-5 text-sm text-muted">
              Verify the implementation on{" "}
              <Link
                href="https://github.com/impara/EntitleGuard"
                className="font-medium text-accent hover:underline"
              >
                GitHub
              </Link>
              .
            </p>
          </div>
        </section>

        {/* Final CTA */}
        <section className="border-t border-edge">
          <div className="mx-auto max-w-5xl px-4 py-16 text-center">
            <h2 className="text-3xl font-bold">
              Start with the audit. Monitor the drift that matters.
            </h2>
            <p className="mx-auto mt-3 max-w-2xl text-muted">
              Run the browser-only audit for a current snapshot. If entitlement incidents already
              create support work, apply for nightly read-only monitoring at $79/month.
            </p>
            <div className="mt-7 flex flex-wrap items-center justify-center gap-4">
              <Link
                href="/audit"
                className="rounded-lg bg-accent-strong px-6 py-3 font-semibold text-background hover:opacity-90"
              >
                Run free local audit
              </Link>
              <MonitoringBetaButton className="rounded-lg border border-accent/50 px-6 py-3 font-semibold text-accent hover:bg-accent/10">
                Apply for monitoring beta
              </MonitoringBetaButton>
            </div>
          </div>
        </section>

        <footer className="border-t border-edge">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-xs text-muted">
            <p>EntitleGuard — read-only Stripe-to-app-access monitoring.</p>
            <div className="flex flex-wrap items-center gap-3">
              <p>Local audit data stays in your browser; monitoring stores pseudonymous history.</p>
              <Link href="https://github.com/impara/EntitleGuard" className="text-accent hover:underline">
                GitHub
              </Link>
            </div>
          </div>
        </footer>
      </main>
    </>
  );
}

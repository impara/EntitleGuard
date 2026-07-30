# EntitleGuard

**Know when a paying customer loses access before support tells you.**

EntitleGuard is a read-only Stripe-to-app-access auditor for SaaS teams that keep entitlement state in their own database. It compares Stripe billing state with the access state the application actually uses and reports paid-but-blocked customers, unpaid-but-active accounts, missing billing links, orphaned subscriptions, ambiguous states, and explicit manual overrides.

The current public product is a **free one-time local audit**: upload a Stripe export CSV and an app entitlement export CSV, and the comparison runs entirely in the browser. The monitoring beta is under active development.

**Live app:** [entitleguard.amertech.online](https://entitleguard.amertech.online) · [Example report](https://entitleguard.amertech.online/audit?demo=1)

![EntitleGuard demo report](public/entitleguard-demo-report.png)

## Monitoring beta direction

The beta is centered on operational alerts rather than a dashboard people may forget to inspect:

- **Critical access alert:** page when `paid-but-blocked >= 1`.
- **Drift alert:** compare the current mismatch rate with one fixed historical reference run, normally the same weekday about four weeks earlier. Do not use a rolling mean that can silently absorb a slow degradation.
- **Queue-age alert:** warn when unresolved mismatches remain open beyond the configured age threshold.
- **Acknowledgement and history:** alerts must be owned, acknowledged, and preserved rather than merely displayed.
- **Override provenance:** intentional exceptions should record who decided, why, when, and optionally when the override expires.
- **Read-only by default:** no automatic access grant or revocation.

The first implementation milestone adds the monitoring domain model, persistent jobs/runs/findings/alerts, fixed-reference selection, and alert evaluation. Run ingestion, operator UI, scheduling, and email delivery follow in later milestones.

## Who this is not for

EntitleGuard is intentionally narrow. It is probably not useful for:

- Apps that check Stripe live on every request and do not keep local entitlement state.
- Very early SaaS products with a handful of customers and no meaningful support or usage cost.
- Teams looking for a webhook retry queue, dead-letter replay tool, or automatic suspension system.
- Large engineering teams that prefer to build and maintain a custom reconciler around deeply bespoke entitlement rules.
- Companies that require enterprise procurement, SOC 2 review, or enterprise SSO before a beta trial.

The likely buyer is a team where paid-but-blocked incidents already enter a support queue and consume engineering or support time, but nobody wants to own the monitoring job permanently.

## What this is not

EntitleGuard is **not a webhook retry tool**.

Webhook queues, idempotency, replay, and backfills help ensure events are processed. EntitleGuard checks the result: does the application's **current access state** agree with Stripe's **current billing state**?

It catches cases where a webhook returned 200 but the database never ended up reflecting the correct state: failed writes, rollbacks, wrong-row updates, migrations, manual changes, or later internal overwrites.

This is final-state reconciliation used as an access-reliability signal.

## Direction-aware reconciliation policy

Grant and revoke mismatches do not have the same blast radius:

- **Grant direction:** Stripe says paid/active while the app blocks access. A single verified case is urgent because a paying customer cannot use the product.
- **Revoke direction:** Stripe says canceled/unpaid while the app still grants access. Do not revoke from one observation. Require repeated agreement and human review.
- **Manual overrides:** comped, hand-granted, or manually blocked accounts should carry an explicit override flag and provenance instead of being repeatedly treated as unexplained drift.

Monitoring must retain every observation. Silent healing without history hides the fact that an access path is degrading.

## Minimal export SQL

The recommended app export contains only pseudonymous IDs, statuses, and plans. Adapt table and column names to your schema.

**Users table:**

```sql
SELECT
  id AS internal_user_id,
  stripe_customer_id,
  subscription_status,
  plan,
  access_enabled
FROM users;
```

**Workspaces table:**

```sql
SELECT
  id AS workspace_id,
  stripe_customer_id,
  subscription_status,
  plan,
  access_enabled
FROM workspaces;
```

Export the columns the request path actually reads for access decisions. If middleware checks a boolean while another process checks a status column, include both so internal contradictions can be detected.

For intentional exceptions, also export recognizable optional columns such as:

```sql
manual_access_override,
manual_override_reason
```

Accepted override values include `true`/`false`, `1`/`0`, and `yes`/`no`.

## Privacy model

### Free local audit

- CSV files are parsed and reconciled client-side in a Web Worker.
- Files are never sent to the EntitleGuard server.
- No Stripe API keys, database credentials, or login are required.
- The server receives analytics scalars and, only after explicit consent, contact details plus an aggregate audit summary.

### Monitoring beta

- The monitoring data path will be explicit and read-only.
- Findings are designed to use stable pseudonymous fingerprints rather than raw customer or user identifiers.
- Raw CSV rows are not part of the server-side monitoring schema.
- A design partner may still need a small adapter because entitlement truth lives in the customer's own schema; minimizing that integration burden is a core beta constraint.

## Stack

- Next.js App Router, TypeScript, React, and Tailwind CSS v4
- PapaParse for CSV parsing
- Pure-TypeScript reconciliation engine in `src/lib/engine`
- Monitoring alert logic in `src/lib/monitoring`
- SQLite with better-sqlite3 and Drizzle
- Vitest

## Getting started

```bash
npm install
npm run dev
```

Open `http://localhost:3000`. Use **See example report** for bundled sample data in `public/samples/`.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build |
| `npm test` | Unit and integration tests |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript check |

## Deploy with Coolify or Docker

The repository includes a multi-stage `Dockerfile` and `docker-compose.yml`.

1. In Coolify, add a Docker Compose resource pointing at this repository.
2. Configure the generated FQDN or override it with the intended domain.
3. Keep the `entitleguard-data` named volume mounted so the SQLite database at `/data/entitleguard.db` persists across deploys.

Run elsewhere with:

```bash
docker compose up -d --build
```

The container listens on port 3000.

## Admin page

The read-only `/admin` dashboard lists captured leads, aggregate audit summaries, analytics funnel events, and landing traffic sources. It is protected by HTTP Basic authentication through `ADMIN_PASSWORD`. If the variable is unset, `/admin` returns 404.

## Project layout

- `src/lib/engine/` — parsing, mapping, normalization, matching, classification, leakage estimation, masking
- `src/lib/monitoring/` — fixed-reference selection and alert evaluation
- `src/lib/export-sql-templates.ts` — minimal users/workspaces export SQL
- `src/workers/reconcile.worker.ts` — browser-side reconciliation worker
- `src/components/audit/` — upload, mapping, run, and results flow
- `src/db/` — SQLite schema for leads, analytics, monitoring jobs, runs, findings, and alerts
- `src/app/api/leads`, `src/app/api/events` — validated lead capture and analytics
- `public/samples/` — demo CSVs with pre-seeded drift

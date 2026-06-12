# EntitleGuard Audit

Local-first **Stripe-to-Postgres entitlement drift auditor for usage-based B2B SaaS**. Read-only by design: it finds mismatches and produces a reconciliation report; it never patches, suspends, or writes anything.

Upload a Stripe export CSV and an app user export CSV. The tool compares them **entirely in the browser** and reports potential entitlement drift: unpaid-but-active users, paid-but-blocked customers, missing billing links, orphaned subscriptions, and ambiguous cases — with estimated monthly exposure.

## Privacy model

- CSV files are parsed and reconciled client-side (Web Worker). They are never uploaded.
- Minimal export by design: the copy-paste SQL exports only internal ID, Stripe customer ID, status, plan, and access flag — no names or emails. Email is an optional fallback join key for databases that don't store `stripe_customer_id`.
- No Stripe API keys, no database credentials, no login.
- The server only ever receives: analytics events (scalar props), and — after explicit consent — contact details plus an aggregate audit summary (counts and bucketed exposure, no identifiers).
- Local-only processing removes vendor exposure, but exporting customer records remains the user's own GDPR/data-policy responsibility — the UI states this explicitly.

## Stack

- Next.js (App Router) + TypeScript + Tailwind CSS v4
- PapaParse for CSV parsing
- Pure-TypeScript reconciliation engine (`src/lib/engine`) — framework-free, unit-tested
- SQLite (better-sqlite3 + Drizzle) for lead capture and analytics
- Vitest for engine tests

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000. Use **See example report** for a demo with bundled sample data (`public/samples/`).

## Scripts

| Command             | Purpose                          |
| ------------------- | -------------------------------- |
| `npm run dev`       | Development server               |
| `npm run build`     | Production build                 |
| `npm test`          | Engine unit + integration tests  |
| `npm run lint`      | ESLint                           |
| `npm run typecheck` | TypeScript check                 |

## Deploy (Coolify / Docker)

The repo ships a multi-stage `Dockerfile` (Next.js standalone output, ~minimal Alpine runtime) and a `docker-compose.yml` ready for Coolify:

1. In Coolify, add a new resource → **Docker Compose** pointing at this repo.
2. Coolify picks up the `SERVICE_FQDN_ENTITLEGUARD_3000` magic variable and auto-assigns a subdomain from your wildcard domain (Cloudflare wildcard → Coolify proxy handles TLS and routing). Override the generated FQDN in the service settings if you want e.g. `entitleguard.yourdomain.com`.
3. The named volume `entitleguard-data` persists the SQLite database (`/data/entitleguard.db` — leads, audit summaries, analytics) across deploys.

### Admin page

A read-only dashboard at `/admin` lists captured leads (with their aggregate
audit summaries), the analytics event funnel, and landing traffic sources.
It is protected by HTTP Basic auth: set the `ADMIN_PASSWORD` environment
variable (in Coolify: service → Environment Variables) and log in as user
`admin`. If `ADMIN_PASSWORD` is not set, `/admin` returns 404.

To run it anywhere else:

```bash
docker compose up -d --build
```

The container listens on port 3000 (not published to the host by default — Coolify's proxy attaches over the Docker network).

## Project layout

- `src/lib/engine/` — CSV parsing, column auto-detection, status normalization, tiered matching, category A–E classification, leakage estimation, masking
- `src/workers/reconcile.worker.ts` — runs the engine off the main thread
- `src/components/audit/` — upload → mapping → run → results wizard
- `src/app/api/leads`, `src/app/api/events` — zod-validated lead capture and analytics (SQLite at `.data/entitleguard.db`)
- `public/samples/` — demo CSVs with pre-seeded drift

# Monitoring scheduler beta

The scheduler is deliberately small: the hosting platform calls one authenticated EntitleGuard endpoint nightly, EntitleGuard calls one customer-owned HTTPS source adapter for every active `nightly` job, persists the complete pseudonymous snapshot, evaluates alerts, and sends email through Resend.

EntitleGuard does not receive database credentials and does not execute customer SQL directly. The source adapter remains inside the design partner's environment and is responsible for expressing the entitlement truth in EntitleGuard's narrow contract.

## Required environment variables

```text
MONITORING_SCHEDULER_TOKEN=<strong bearer token for the cron trigger>
MONITORING_SOURCE_URL=https://customer-adapter.example.com/entitleguard/nightly
MONITORING_SOURCE_TOKEN=<bearer token sent to the source adapter>
MONITORING_ALERT_TO=owner@example.com,support-lead@example.com
MONITORING_ALERT_FROM=EntitleGuard <alerts@example.com>
RESEND_API_KEY=re_...
MONITORING_PUBLIC_URL=https://entitleguard.example.com
```

`MONITORING_PUBLIC_URL` is optional. The scheduler endpoint returns `404` while `MONITORING_SCHEDULER_TOKEN` is unset.

Use separate values for `MONITORING_SCHEDULER_TOKEN`, `MONITORING_SOURCE_TOKEN`, `MONITORING_OPERATOR_TOKEN`, and `MONITORING_INGEST_TOKEN`.

## Trigger endpoint

Call this once each night from Coolify, cron, GitHub Actions, or another scheduler:

```bash
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $MONITORING_SCHEDULER_TOKEN" \
  https://entitleguard.example.com/api/monitoring/scheduler/run
```

The request body is empty. EntitleGuard derives a UTC date key such as `2026-08-01` and claims each active nightly job once for that date.

A repeated invocation:

- skips jobs already completed for that UTC date;
- skips a fresh in-progress claim;
- reclaims failed or stale executions;
- relies on run idempotency and notification delivery records during retries.

The endpoint returns `502` when at least one job fails so an external scheduler can retry. Jobs that already completed are skipped during that retry.

## Source adapter request

For each job, EntitleGuard sends:

```http
POST /entitleguard/nightly
Authorization: Bearer <MONITORING_SOURCE_TOKEN>
Content-Type: application/json
```

```json
{
  "jobId": 1,
  "jobName": "Production subscriptions",
  "scheduleKey": "2026-08-01",
  "requestedAt": "2026-08-01T00:00:00.000Z"
}
```

The adapter should obtain current Stripe billing state and current application entitlement state, run or reuse the reconciliation logic appropriate to that schema, and return a **complete** pseudonymous finding snapshot.

## Source adapter response

```json
{
  "completeSnapshot": true,
  "startedAt": "2026-08-01T00:00:00.000Z",
  "completedAt": "2026-08-01T00:00:12.000Z",
  "totalAppRecords": 500,
  "totalStripeRecords": 498,
  "findings": [
    {
      "fingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "category": "B",
      "direction": "grant",
      "severity": "high"
    }
  ]
}
```

Rules:

- `completeSnapshot` must be exactly `true`. A partial response is rejected because absence is interpreted as resolution.
- `fingerprint` must be a stable 64-character SHA-256 or keyed HMAC hex value. Keyed HMAC is preferred.
- Do not return emails, Stripe customer IDs, internal user IDs, names, or raw rows.
- Fingerprints must be unique inside one snapshot.
- Optional manual override fields are `manualOverride`, `overrideActor`, `overrideReason`, and `overrideExpiresAt`.
- The adapter should return non-2xx when it cannot produce a trustworthy complete snapshot.

## Email policy

Alert email is intentionally asymmetric:

- `paid_blocked` is sent when first opened and then once per successful nightly run while it remains `open`;
- after the incident becomes `acknowledged`, repeated critical email stops;
- `drift` and `queue_age` warnings are sent only when a new alert incident opens;
- a cleared condition resolves the incident, so a later recurrence can notify again;
- failed provider calls are stored and retried without creating another monitoring run.

Email contains aggregate alert state only. It never contains finding fingerprints or customer identifiers.

## Persistence

The scheduler adds two durable records:

- `monitoring_schedule_executions` — one execution claim per job and UTC date, including retries and failure state;
- `monitoring_alert_notifications` — one retryable delivery record per alert, run, channel, and recipient set.

These tables are part of the same persistent SQLite volume as monitoring runs and findings.

## Current beta boundary

The scheduler uses one globally configured source adapter URL and one globally configured recipient set. That is intentional for the first design partner. Per-job credentials, delivery routing, Slack/PagerDuty, automatic remediation, and a hosted integration marketplace remain out of scope until real usage justifies them.

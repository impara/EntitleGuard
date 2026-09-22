# Monitoring reliability and rollout

This change hardens the existing read-only monitoring pipeline. It does not change billing/access classification, add remediation, move raw customer data to the server, or migrate the database.

## Paid-but-blocked acknowledgements

Paid-but-blocked alerts retain one active aggregate incident per job. The incident now records internal finding IDs and their incident-start run IDs, not customer identities or fingerprints. If an additional/replacement/reopened account becomes actionable (including an expired override), the old aggregate alert is archived as resolved with an explicit **superseded** note and a new open incident is created. The underlying findings are not marked resolved just because the alert is superseded.

The old acknowledgement, owner, and note remain on the historical incident. An acknowledgement from an old browser view therefore cannot silence newly affected accounts. Unchanged or shrinking membership stays acknowledged. Open critical incidents retain the existing nightly email behaviour. Existing alerts without membership metadata are conservatively superseded once on the next triggering run, which can produce one additional notification after deployment.

## Freshness and pipeline health

Operator responses include `dataHealth` separately from access-alert severity. The admin page displays it even when a known critical access incident is open.

- `fresh`: a successful snapshot less than 36 hours old (nightly cadence plus 12 hours of operational grace).
- `stale`: the last successful snapshot is at least 36 hours old.
- `failed`: a newer scheduled attempt failed, delivery failed for the latest run, a newer execution has been running for at least one hour, or the run timestamp is invalid/far in the future.
- `no_data`: no accepted snapshot exists.
- `paused`: the job is explicitly paused.

The 36-hour snapshot-age limit also applies to manual jobs, but manual/paused jobs are excluded from the external nightly heartbeat. A newer successful snapshot can clear an older failure. Known critical/warning access alerts remain visible; missing data never becomes an all-clear.

### Independent heartbeat

Set a dedicated random `MONITORING_HEALTH_TOKEN` in Coolify/the container environment. Docker Compose passes it through. It should differ from ingestion, operator, and scheduler tokens.

Configure an **independent** uptime monitor to request:

```sh
curl --fail --silent --show-error \
  -H "Authorization: Bearer $MONITORING_HEALTH_TOKEN" \
  https://YOUR-ENTITLEGUARD-HOST/api/monitoring/health
```

The endpoint is disabled (404) without the token and returns 401 for invalid credentials. Authenticated responses are `Cache-Control: no-store` and contain only aggregate pipeline counts. HTTP 200 means every active nightly job has fresh monitoring; HTTP 503 means a job is stale/failed/uninitialized, no active nightly jobs exist, or the health check itself failed. A fresh pipeline with a known access incident still returns 200: this endpoint monitors the monitor, not customer access.

The endpoint does not schedule its own checks or send outage notifications. Configure the external monitor to alert on 503, unexpected 401/404, connection failure, and timeout. Do not run this check from the same cron job it is meant to supervise. Do not replace the container liveness check with it: stale source data should not cause restart loops.

## Snapshot safety

The service boundary, not just the HTTP schema, checks `completeSnapshot: true`, nonnegative safe-integer source counts, and valid timestamps. Completion more than five minutes in the future is rejected; keep source clocks synchronized. Accepted timestamps are stored as UTC ISO strings. Legacy rows with timezone offsets are ordered by their actual instant.

Under a single immediate SQLite write transaction, ingestion checks idempotency and the last accepted snapshot before changing any findings/alerts:

- A distinct snapshot with an equal/older completion, or an acquisition start earlier than the previous acquisition, is rejected with `STALE_RUN` (HTTP 409). Backfills must not overwrite current incident state.
- A previously populated source becoming empty, or an 80%+ drop from a source of at least ten records, is rejected with `SUSPICIOUS_SNAPSHOT` (HTTP 422). App and Stripe sources are checked separately.
- Rejected snapshots insert no monitoring run and resolve no findings. The scheduler records its failure as before, making the failure visible to operator/heartbeat checks.
- An exact idempotency-key retry still returns the accepted run, even after later runs. It cannot rewind current incident state.

The source-count guard is a heuristic, not proof of completeness. A falsely marked complete snapshot with stable counts can still be wrong; adapters must verify pagination and source success themselves. A first-ever empty snapshot has no populated baseline and remains accepted.

### Confirming an expected source-count drop

Investigate the source first. For a legitimate count reduction, an authorized operator can submit a **fresh full snapshot** to `POST /api/monitoring/runs` using the existing ingestion token and the additional field:

```json
{
  "allowSourceCountDrop": true
}
```

This is an additional field on the existing full payload, not a standalone request. Use a descriptive, unique idempotency key. The exception is for that submission only and does not bypass timestamp or completeness checks. The scheduled adapter schema deliberately does not accept this flag; do not make it a permanent adapter default. After confirmation, the next scheduled snapshot must be newer than the accepted confirmation snapshot.

## Verification and scope

Regression coverage includes acknowledgement membership changes, equal-count replacements, reopening and override expiry, legacy alert migration, out-of-order runs, source collapse, explicit confirmation, idempotency, timezone normalization, service-boundary validation, separate pipeline/access health, authenticated heartbeat behaviour, and the scheduler-to-email path with mocked external services.

Run the repository CI commands: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`.

Deferred deliberately: richer access policies and unknown-state coverage, a customer-owned reference runner/adapter, local account drill-down, immutable finding-state snapshots, configurable monitoring intervals, and multi-tenant credentials. Those require separate contracts or migrations and are not silently bundled into this reliability fix.

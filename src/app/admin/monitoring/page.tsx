import Link from "next/link";
import { getMonitoringJobDetail, listMonitoringJobOverviews } from "@/lib/monitoring/operator";
import {
  listRecentMonitoringAlerts,
  type MonitoringAlertRecordView,
} from "@/lib/monitoring/alert-actions";
import { acknowledgeAlert, resolveAlert } from "./actions";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Monitoring — EntitleGuard admin",
  robots: { index: false, follow: false },
};

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatAge(iso: string | null): string {
  if (!iso) return "—";
  const hours = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000));
  if (hours < 48) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function scalarParam(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function healthClasses(health: string): string {
  switch (health) {
    case "critical":
      return "border-red-500/40 bg-red-500/10 text-red-700";
    case "warning":
      return "border-amber-500/40 bg-amber-500/10 text-amber-700";
    case "healthy":
      return "border-green-500/40 bg-green-500/10 text-green-700";
    default:
      return "border-edge bg-surface text-muted";
  }
}

function alertMessage(alert: MonitoringAlertRecordView): string {
  const message = alert.details?.message;
  return typeof message === "string" ? message : alert.title;
}

function AlertActionForms({ alert }: { alert: MonitoringAlertRecordView }) {
  if (alert.status === "resolved") return null;

  return (
    <div className="mt-4 grid gap-3 lg:grid-cols-2">
      {alert.status === "open" ? (
        <form action={acknowledgeAlert} className="rounded-lg border border-edge bg-surface p-3">
          <input type="hidden" name="alertId" value={alert.id} />
          <input type="hidden" name="jobId" value={alert.jobId} />
          <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
            Acknowledge note
          </label>
          <textarea
            name="note"
            maxLength={1000}
            rows={2}
            placeholder="Who owns the investigation and what is the next step?"
            className="mb-2 w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm"
          />
          <button
            type="submit"
            className="rounded-lg border border-edge px-3 py-2 text-sm font-semibold hover:border-accent hover:text-accent"
          >
            Acknowledge
          </button>
        </form>
      ) : (
        <div className="rounded-lg border border-edge bg-surface p-3 text-sm">
          <p className="font-semibold">Acknowledged by {alert.acknowledgedBy ?? "unknown"}</p>
          <p className="text-muted">{formatDate(alert.acknowledgedAt)}</p>
          {alert.acknowledgementNote ? (
            <p className="mt-2 whitespace-pre-wrap text-muted">{alert.acknowledgementNote}</p>
          ) : null}
        </div>
      )}

      <form action={resolveAlert} className="rounded-lg border border-edge bg-surface p-3">
        <input type="hidden" name="alertId" value={alert.id} />
        <input type="hidden" name="jobId" value={alert.jobId} />
        <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-muted">
          Resolution note
        </label>
        <textarea
          name="note"
          maxLength={1000}
          rows={2}
          placeholder="What changed, or why is this incident considered resolved?"
          className="mb-2 w-full rounded-lg border border-edge bg-background px-3 py-2 text-sm"
        />
        <button
          type="submit"
          className="rounded-lg border border-edge px-3 py-2 text-sm font-semibold hover:border-accent hover:text-accent"
        >
          Resolve incident
        </button>
      </form>
    </div>
  );
}

export default async function MonitoringAdminPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const updated = scalarParam(params.updated);
  const error = scalarParam(params.error);
  const jobs = listMonitoringJobOverviews();
  const dashboards = jobs.map(({ job }) => ({
    detail: getMonitoringJobDetail(job.id, undefined, { recentRunLimit: 14 }),
    alertHistory: listRecentMonitoringAlerts(job.id, undefined, 30),
  }));

  return (
    <main className="mx-auto max-w-6xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="mb-1 text-sm text-muted">
            <Link href="/admin" className="hover:text-accent">
              Admin
            </Link>{" "}
            / Monitoring
          </p>
          <h1 className="text-2xl font-bold">Monitoring operator</h1>
        </div>
        <p className="text-sm text-muted">
          Operator: {process.env.MONITORING_OPERATOR_NAME?.trim() || "admin"} · read-only remediation
        </p>
      </div>

      {updated ? (
        <p className="mb-6 rounded-xl border border-green-500/40 bg-green-500/10 p-4 text-sm text-green-800">
          {updated}
        </p>
      ) : null}
      {error ? (
        <p className="mb-6 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {dashboards.length === 0 ? (
        <p className="rounded-xl border border-edge bg-surface p-6 text-sm text-muted">
          No monitoring jobs exist yet. Bootstrap one through POST /api/monitoring/jobs.
        </p>
      ) : (
        <div className="space-y-10">
          {dashboards.map(({ detail, alertHistory }) => (
            <section
              id={`job-${detail.job.id}`}
              key={detail.job.id}
              className="scroll-mt-6 rounded-2xl border border-edge p-5"
            >
              <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{detail.job.name}</h2>
                  <p className="mt-1 text-sm text-muted">
                    {detail.job.schedule} · {detail.job.status} · job #{detail.job.id}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-wide ${healthClasses(detail.health)}`}
                >
                  {detail.health.replaceAll("_", " ")}
                </span>
              </div>

              <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
                <div className="rounded-xl border border-edge bg-surface p-3">
                  <p className="text-xs uppercase tracking-wide text-muted">Latest run</p>
                  <p className="mt-1 font-semibold">{formatDate(detail.latestRun?.completedAt ?? null)}</p>
                </div>
                <div className="rounded-xl border border-edge bg-surface p-3">
                  <p className="text-xs uppercase tracking-wide text-muted">Paid blocked</p>
                  <p className="mt-1 text-xl font-bold">{detail.latestRun?.paidBlockedCount ?? 0}</p>
                </div>
                <div className="rounded-xl border border-edge bg-surface p-3">
                  <p className="text-xs uppercase tracking-wide text-muted">Mismatch rate</p>
                  <p className="mt-1 text-xl font-bold">
                    {detail.latestRun ? formatPercent(detail.latestRun.mismatchRate) : "—"}
                  </p>
                </div>
                <div className="rounded-xl border border-edge bg-surface p-3">
                  <p className="text-xs uppercase tracking-wide text-muted">Actionable queue</p>
                  <p className="mt-1 text-xl font-bold">{detail.findings.actionable}</p>
                </div>
                <div className="rounded-xl border border-edge bg-surface p-3">
                  <p className="text-xs uppercase tracking-wide text-muted">Oldest unresolved</p>
                  <p className="mt-1 text-xl font-bold">
                    {formatAge(detail.findings.oldestActionableFirstSeenAt)}
                  </p>
                </div>
              </div>

              <section className="mb-8">
                <h3 className="mb-3 text-lg font-semibold">Active alerts</h3>
                {detail.activeAlerts.length === 0 ? (
                  <p className="rounded-xl border border-edge bg-surface p-4 text-sm text-muted">
                    No active alert incidents.
                  </p>
                ) : (
                  <div className="space-y-4">
                    {detail.activeAlerts.map((activeAlert) => {
                      const alert = alertHistory.find((candidate) => candidate.id === activeAlert.id);
                      if (!alert) return null;
                      return (
                        <article key={alert.id} className="rounded-xl border border-edge p-4">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-xs font-semibold uppercase tracking-wide text-muted">
                                {alert.severity} · {alert.type.replaceAll("_", " ")} · {alert.status}
                              </p>
                              <h4 className="mt-1 font-semibold">{alert.title}</h4>
                              <p className="mt-2 text-sm text-muted">{alertMessage(alert)}</p>
                            </div>
                            <div className="text-right text-xs text-muted">
                              <p>{alert.occurrenceCount} occurrence(s)</p>
                              <p>Last: {formatDate(alert.lastTriggeredAt)}</p>
                            </div>
                          </div>
                          <AlertActionForms alert={alert} />
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>

              <div className="grid gap-8 xl:grid-cols-2">
                <section>
                  <h3 className="mb-3 text-lg font-semibold">Recent runs</h3>
                  <div className="overflow-x-auto rounded-xl border border-edge">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-edge bg-surface text-xs uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-3 py-2">Completed</th>
                          <th className="px-3 py-2 text-right">Paid blocked</th>
                          <th className="px-3 py-2 text-right">Mismatches</th>
                          <th className="px-3 py-2 text-right">Rate</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.recentRuns.map((run) => (
                          <tr key={run.id} className="border-b border-edge last:border-0">
                            <td className="whitespace-nowrap px-3 py-2 text-muted">
                              {formatDate(run.completedAt)}
                            </td>
                            <td className="px-3 py-2 text-right font-semibold">{run.paidBlockedCount}</td>
                            <td className="px-3 py-2 text-right">{run.mismatchCount}</td>
                            <td className="px-3 py-2 text-right">{formatPercent(run.mismatchRate)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                <section>
                  <h3 className="mb-3 text-lg font-semibold">Alert history</h3>
                  <div className="overflow-x-auto rounded-xl border border-edge">
                    <table className="w-full text-left text-sm">
                      <thead className="border-b border-edge bg-surface text-xs uppercase tracking-wide text-muted">
                        <tr>
                          <th className="px-3 py-2">Incident</th>
                          <th className="px-3 py-2">Status</th>
                          <th className="px-3 py-2">Owner / resolver</th>
                        </tr>
                      </thead>
                      <tbody>
                        {alertHistory.map((alert) => (
                          <tr key={alert.id} className="border-b border-edge align-top last:border-0">
                            <td className="px-3 py-2">
                              <p className="font-medium">{alert.type.replaceAll("_", " ")}</p>
                              <p className="text-xs text-muted">{formatDate(alert.firstTriggeredAt)}</p>
                            </td>
                            <td className="px-3 py-2">
                              <span className="rounded-full border border-edge px-2 py-0.5 text-xs">
                                {alert.status}
                              </span>
                            </td>
                            <td className="px-3 py-2 text-muted">
                              {alert.status === "resolved"
                                ? alert.resolvedBy ?? "monitoring engine"
                                : alert.acknowledgedBy ?? "—"}
                              {alert.status === "resolved" && alert.resolutionNote ? (
                                <p className="mt-1 max-w-xs text-xs">{alert.resolutionNote}</p>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              </div>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}

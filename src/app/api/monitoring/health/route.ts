import { NextResponse } from "next/server";
import { hasValidBearerToken } from "../../../../lib/monitoring/http-auth";
import { listMonitoringJobOverviews } from "../../../../lib/monitoring/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = { "Cache-Control": "no-store" };

/** Poll from an independent uptime monitor, not from the cron being monitored. */
export async function GET(request: Request) {
  // A separate read-only credential avoids sharing the ingestion token with a monitor.
  const token = process.env.MONITORING_HEALTH_TOKEN;
  if (!token) return new NextResponse(null, { status: 404, headers });
  if (!hasValidBearerToken(request, token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers });
  }

  try {
    const jobs = listMonitoringJobOverviews().filter(
      ({ job }) => job.status === "active" && job.schedule === "nightly",
    );
    const counts = { fresh: 0, stale: 0, failed: 0, no_data: 0, paused: 0 };
    for (const job of jobs) counts[job.dataHealth.status] += 1;
    const healthy = jobs.length > 0 && counts.fresh === jobs.length;
    // Aggregate pipeline state only: no names, identifiers, findings, or provider errors.
    return NextResponse.json(
      { healthy, monitoredJobs: jobs.length, counts },
      { status: healthy ? 200 : 503, headers },
    );
  } catch {
    return NextResponse.json({ healthy: false, error: "Health check failed" }, { status: 503, headers });
  }
}

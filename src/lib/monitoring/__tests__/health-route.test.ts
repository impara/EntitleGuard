import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../../../app/api/monitoring/health/route";
import { listMonitoringJobOverviews, type MonitoringJobOverview } from "../operator";

vi.mock("../operator", () => ({ listMonitoringJobOverviews: vi.fn() }));

function overview(status: MonitoringJobOverview["dataHealth"]["status"] = "fresh"): MonitoringJobOverview {
  return {
    job: {
      id: 1, name: "private partner name", schedule: "nightly", status: "active",
      paidBlockedThreshold: 1, driftRateIncreaseBps: 100, queueAgeThresholdHours: 168,
      referenceAgeDays: 28, referenceToleranceDays: 7, createdAt: "2026-08-01", updatedAt: "2026-08-01",
    },
    health: "critical", // Access incidents must not make a fresh pipeline heartbeat fail.
    dataHealth: { status, lastSuccessAt: "2026-08-01T00:00:00Z", maxAgeHours: 36 },
    latestRun: null,
    activeAlertCounts: { critical: 1, warning: 0 },
    findings: {
      open: 1, actionable: 1, activeOverrides: 0, oldestActionableFirstSeenAt: "2026-08-01",
      actionableByCategory: { A: 0, B: 1, C: 0, D: 0, E: 0 },
    },
  };
}

const request = (token = "read-only-test-token") => new Request("https://example.invalid/api/monitoring/health", {
  headers: { Authorization: `Bearer ${token}` },
});

describe("monitoring heartbeat endpoint", () => {
  beforeEach(() => {
    vi.stubEnv("MONITORING_HEALTH_TOKEN", "read-only-test-token");
    vi.mocked(listMonitoringJobOverviews).mockReturnValue([overview()]);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetAllMocks();
  });

  it("stays disabled without its dedicated token", async () => {
    vi.stubEnv("MONITORING_HEALTH_TOKEN", "");
    expect((await GET(request())).status).toBe(404);
    expect(listMonitoringJobOverviews).not.toHaveBeenCalled();
  });

  it("rejects an invalid token before reading monitoring data", async () => {
    expect((await GET(request("wrong"))).status).toBe(401);
    expect(listMonitoringJobOverviews).not.toHaveBeenCalled();
  });

  it("reports a fresh pipeline despite an access incident, without exposing partner data", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.text();
    expect(JSON.parse(body)).toMatchObject({ healthy: true, monitoredJobs: 1, counts: { fresh: 1 } });
    expect(body).not.toContain("private partner name");
  });

  it.each(["stale", "failed", "no_data"] as const)("returns 503 for %s monitoring", async (status) => {
    vi.mocked(listMonitoringJobOverviews).mockReturnValue([overview(status)]);
    expect((await GET(request())).status).toBe(503);
  });

  it("does not report green when there are no active nightly jobs", async () => {
    const manual = overview();
    manual.job.schedule = "manual";
    const paused = overview("paused");
    paused.job.status = "paused";
    vi.mocked(listMonitoringJobOverviews).mockReturnValue([manual, paused]);
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ healthy: false, monitoredJobs: 0 });
  });

  it("fails closed on a database error without returning sensitive details", async () => {
    vi.mocked(listMonitoringJobOverviews).mockImplementation(() => { throw new Error("secret database path"); });
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("secret");
  });
});

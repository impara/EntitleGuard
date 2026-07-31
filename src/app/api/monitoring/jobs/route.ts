import { NextResponse } from "next/server";
import { z } from "zod";
import { hasValidBearerToken } from "@/lib/monitoring/http-auth";
import {
  createMonitoringJob,
  listMonitoringJobOverviews,
  MonitoringJobError,
} from "@/lib/monitoring/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createJobSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    schedule: z.enum(["nightly", "manual"]).optional(),
    status: z.enum(["active", "paused"]).optional(),
    paidBlockedThreshold: z.number().int().min(1).max(1_000).optional(),
    driftRateIncreaseBps: z.number().int().min(1).max(10_000).optional(),
    queueAgeThresholdHours: z.number().int().min(1).max(8_760).optional(),
    referenceAgeDays: z.number().int().min(7).max(365).optional(),
    referenceToleranceDays: z.number().int().min(0).max(28).optional(),
  })
  .strict();

function authorize(request: Request): NextResponse | null {
  const token = process.env.MONITORING_OPERATOR_TOKEN;
  if (!token) return new NextResponse(null, { status: 404 });
  if (!hasValidBearerToken(request, token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}

function jsonNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function GET(request: Request) {
  const unauthorized = authorize(request);
  if (unauthorized) return unauthorized;

  return jsonNoStore({ jobs: listMonitoringJobOverviews() });
}

export async function POST(request: Request) {
  const unauthorized = authorize(request);
  if (unauthorized) return unauthorized;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "Invalid JSON" }, 400);
  }

  const parsed = createJobSchema.safeParse(body);
  if (!parsed.success) {
    return jsonNoStore(
      { error: "Invalid monitoring job payload", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }

  try {
    return jsonNoStore({ job: createMonitoringJob(parsed.data) }, 201);
  } catch (error) {
    if (error instanceof MonitoringJobError) {
      return jsonNoStore({ error: error.message, code: error.code }, 400);
    }
    console.error("Monitoring job creation failed", error);
    return jsonNoStore({ error: "Monitoring job creation failed" }, 500);
  }
}

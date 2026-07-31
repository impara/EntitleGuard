import { NextResponse } from "next/server";
import { z } from "zod";
import { hasValidBearerToken } from "@/lib/monitoring/http-auth";
import {
  getMonitoringJobDetail,
  MonitoringJobError,
  updateMonitoringJob,
} from "@/lib/monitoring/operator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };

const updateJobSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    schedule: z.enum(["nightly", "manual"]).optional(),
    status: z.enum(["active", "paused"]).optional(),
    paidBlockedThreshold: z.number().int().min(1).max(1_000).optional(),
    driftRateIncreaseBps: z.number().int().min(1).max(10_000).optional(),
    queueAgeThresholdHours: z.number().int().min(1).max(8_760).optional(),
    referenceAgeDays: z.number().int().min(7).max(365).optional(),
    referenceToleranceDays: z.number().int().min(0).max(28).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one field is required");

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

async function jobIdFrom(context: RouteContext): Promise<number | null> {
  const { jobId } = await context.params;
  const parsed = Number(jobId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function jobErrorResponse(error: MonitoringJobError): NextResponse {
  return jsonNoStore(
    { error: error.message, code: error.code },
    error.code === "JOB_NOT_FOUND" ? 404 : 400,
  );
}

export async function GET(request: Request, context: RouteContext) {
  const unauthorized = authorize(request);
  if (unauthorized) return unauthorized;

  const jobId = await jobIdFrom(context);
  if (jobId === null) return jsonNoStore({ error: "Invalid monitoring job ID" }, 400);

  const url = new URL(request.url);
  const requestedLimit = url.searchParams.get("runs");
  const recentRunLimit = requestedLimit === null ? 30 : Number(requestedLimit);
  if (!Number.isInteger(recentRunLimit) || recentRunLimit < 1 || recentRunLimit > 100) {
    return jsonNoStore({ error: "runs must be an integer between 1 and 100" }, 400);
  }

  try {
    return jsonNoStore({ monitoring: getMonitoringJobDetail(jobId, undefined, { recentRunLimit }) });
  } catch (error) {
    if (error instanceof MonitoringJobError) return jobErrorResponse(error);
    console.error("Monitoring job read failed", error);
    return jsonNoStore({ error: "Monitoring job read failed" }, 500);
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  const unauthorized = authorize(request);
  if (unauthorized) return unauthorized;

  const jobId = await jobIdFrom(context);
  if (jobId === null) return jsonNoStore({ error: "Invalid monitoring job ID" }, 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "Invalid JSON" }, 400);
  }

  const parsed = updateJobSchema.safeParse(body);
  if (!parsed.success) {
    return jsonNoStore(
      { error: "Invalid monitoring job payload", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }

  try {
    return jsonNoStore({ job: updateMonitoringJob(jobId, parsed.data) });
  } catch (error) {
    if (error instanceof MonitoringJobError) return jobErrorResponse(error);
    console.error("Monitoring job update failed", error);
    return jsonNoStore({ error: "Monitoring job update failed" }, 500);
  }
}

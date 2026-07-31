import { NextResponse } from "next/server";
import { hasValidBearerToken } from "@/lib/monitoring/http-auth";
import { canarySnapshot, type CanaryMode } from "@/lib/monitoring/canary-source";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const sourceToken = process.env.MONITORING_SOURCE_TOKEN;
  if (!sourceToken) return new NextResponse(null, { status: 404 });
  if (!hasValidBearerToken(request, sourceToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const configuredMode = process.env.MONITORING_CANARY_MODE ?? "healthy";
  if (configuredMode !== "healthy" && configuredMode !== "paid_blocked") {
    return NextResponse.json(
      { error: "MONITORING_CANARY_MODE must be healthy or paid_blocked" },
      { status: 503 },
    );
  }

  return NextResponse.json(canarySnapshot(configuredMode as CanaryMode, sourceToken), {
    headers: { "Cache-Control": "no-store" },
  });
}

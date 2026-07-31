import { NextResponse } from "next/server";
import { hasValidBearerToken } from "@/lib/monitoring/http-auth";
import { runNightlyMonitoring } from "@/lib/monitoring/scheduler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function recipients(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((recipient) => recipient.trim())
    .filter(Boolean);
}

function jsonNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store" },
  });
}

export async function POST(request: Request) {
  const schedulerToken = process.env.MONITORING_SCHEDULER_TOKEN;
  if (!schedulerToken) return new NextResponse(null, { status: 404 });
  if (!hasValidBearerToken(request, schedulerToken)) {
    return jsonNoStore({ error: "Unauthorized" }, 401);
  }

  const required = {
    MONITORING_SOURCE_URL: process.env.MONITORING_SOURCE_URL,
    MONITORING_ALERT_TO: process.env.MONITORING_ALERT_TO,
    MONITORING_ALERT_FROM: process.env.MONITORING_ALERT_FROM,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
  };
  const missing = Object.entries(required)
    .filter(([, value]) => !value?.trim())
    .map(([name]) => name);
  if (missing.length > 0) {
    return jsonNoStore({ error: "Monitoring scheduler is not configured", missing }, 503);
  }

  try {
    const result = await runNightlyMonitoring({
      sourceUrl: required.MONITORING_SOURCE_URL!,
      sourceToken: process.env.MONITORING_SOURCE_TOKEN,
      alertTo: recipients(required.MONITORING_ALERT_TO),
      alertFrom: required.MONITORING_ALERT_FROM!,
      resendApiKey: required.RESEND_API_KEY!,
      publicUrl: process.env.MONITORING_PUBLIC_URL,
      allowInsecureSource: process.env.NODE_ENV !== "production",
    });
    return jsonNoStore(result, result.failed > 0 ? 502 : 200);
  } catch (error) {
    console.error("Nightly monitoring scheduler failed", error);
    return jsonNoStore(
      { error: error instanceof Error ? error.message : "Nightly monitoring scheduler failed" },
      500,
    );
  }
}

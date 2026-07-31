import { NextResponse } from "next/server";
import { z } from "zod";
import { hasValidBearerToken } from "@/lib/monitoring/http-auth";
import {
  MonitoringAlertActionError,
  transitionMonitoringAlert,
} from "@/lib/monitoring/alert-actions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ alertId: string }> };

const actionSchema = z
  .object({
    action: z.enum(["acknowledge", "resolve"]),
    actor: z.string().trim().min(1).max(200),
    note: z.string().trim().max(1_000).nullable().optional(),
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

async function alertIdFrom(context: RouteContext): Promise<number | null> {
  const { alertId } = await context.params;
  const parsed = Number(alertId);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function actionErrorResponse(error: MonitoringAlertActionError): NextResponse {
  const status =
    error.code === "ALERT_NOT_FOUND"
      ? 404
      : error.code === "INVALID_TRANSITION"
        ? 409
        : 400;
  return jsonNoStore({ error: error.message, code: error.code }, status);
}

export async function PATCH(request: Request, context: RouteContext) {
  const unauthorized = authorize(request);
  if (unauthorized) return unauthorized;

  const alertId = await alertIdFrom(context);
  if (alertId === null) return jsonNoStore({ error: "Invalid monitoring alert ID" }, 400);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonNoStore({ error: "Invalid JSON" }, 400);
  }

  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) {
    return jsonNoStore(
      { error: "Invalid monitoring alert action", details: parsed.error.flatten().fieldErrors },
      400,
    );
  }

  try {
    return jsonNoStore(transitionMonitoringAlert(alertId, parsed.data));
  } catch (error) {
    if (error instanceof MonitoringAlertActionError) return actionErrorResponse(error);
    console.error("Monitoring alert action failed", error);
    return jsonNoStore({ error: "Monitoring alert action failed" }, 500);
  }
}

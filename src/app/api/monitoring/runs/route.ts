import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ingestMonitoringRun,
  MonitoringIngestError,
} from "@/lib/monitoring/ingest-run";

export const runtime = "nodejs";

const timestampSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => !Number.isNaN(new Date(value).getTime()), "Invalid timestamp");

const findingSchema = z
  .object({
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
    category: z.enum(["A", "B", "C", "D", "E"]),
    direction: z.enum(["grant", "revoke"]).nullable().optional(),
    severity: z.enum(["high", "medium", "low"]),
    manualOverride: z.boolean().optional(),
    overrideActor: z.string().max(200).nullable().optional(),
    overrideReason: z.string().max(1_000).nullable().optional(),
    overrideExpiresAt: timestampSchema.nullable().optional(),
  })
  .strict();

const runSchema = z
  .object({
    jobId: z.number().int().positive(),
    idempotencyKey: z.string().trim().min(1).max(128),
    source: z.enum(["manual", "api", "scheduled"]).optional(),
    startedAt: timestampSchema,
    completedAt: timestampSchema,
    totalAppRecords: z.number().int().nonnegative(),
    totalStripeRecords: z.number().int().nonnegative(),
    findings: z.array(findingSchema).max(50_000),
  })
  .strict();

function isAuthorized(request: Request, expectedToken: string): boolean {
  const supplied = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${expectedToken}`;
  const suppliedBytes = Buffer.from(supplied);
  const expectedBytes = Buffer.from(expected);
  return (
    suppliedBytes.length === expectedBytes.length &&
    timingSafeEqual(suppliedBytes, expectedBytes)
  );
}

export async function POST(request: Request) {
  const ingestToken = process.env.MONITORING_INGEST_TOKEN;
  if (!ingestToken) {
    // Do not expose an unfinished beta endpoint unless ingestion is explicitly enabled.
    return new NextResponse(null, { status: 404 });
  }
  if (!isAuthorized(request, ingestToken)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = runSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid monitoring run payload", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  try {
    const result = ingestMonitoringRun(parsed.data);
    return NextResponse.json(result, { status: result.idempotent ? 200 : 201 });
  } catch (error) {
    if (error instanceof MonitoringIngestError) {
      const status = error.code === "JOB_NOT_FOUND" ? 404 : error.code === "JOB_INACTIVE" ? 409 : 400;
      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }
    console.error("Monitoring run ingestion failed", error);
    return NextResponse.json({ error: "Monitoring run ingestion failed" }, { status: 500 });
  }
}
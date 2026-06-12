import { NextResponse } from "next/server";
import { z } from "zod";
import { auditSummaries, db, leads } from "@/db";
import { exposureBucket } from "@/lib/analytics-shared";

/**
 * Lead capture (FR8). Accepts contact + qualification fields (PRD section 11)
 * plus a whitelisted aggregate audit summary. Raw rows, emails lists, or
 * identifier arrays are structurally rejected by the schema.
 */

const MRR_RANGES = [
  "Under $5k/month",
  "$5k-$15k/month",
  "$15k-$50k/month",
  "$50k-$150k/month",
  "$150k+/month",
] as const;

const DATABASES = ["PostgreSQL", "MySQL", "MongoDB", "Supabase", "Firebase", "DynamoDB", "Other"] as const;

const BILLING = ["Stripe", "Paddle", "Chargebee", "Recurly", "Lemon Squeezy", "Other"] as const;

const REQUEST_TYPES = [
  "full_report",
  "mismatch_csv",
  "paid_audit",
  "monitoring_beta",
  "review_call",
] as const;

const BETA_INTERESTS = [
  "daily_monitoring",
  "slack_alerts",
  "postgres_agent",
  "stripe_api",
  "sql_remediation",
  "webhook_detection",
  "paid_audit_review",
  "not_interested",
] as const;

/** Aggregate-only audit summary — counts and bucketed dollars, no identifiers. */
const summarySchema = z.object({
  totalAppRecords: z.number().int().nonnegative(),
  totalStripeRecords: z.number().int().nonnegative(),
  matchedRecords: z.number().int().nonnegative(),
  unpaidActiveCount: z.number().int().nonnegative(),
  paidBlockedCount: z.number().int().nonnegative(),
  missingBillingLinkCount: z.number().int().nonnegative(),
  orphanedStripeCount: z.number().int().nonnegative(),
  ambiguousCount: z.number().int().nonnegative(),
  highConfidenceMismatches: z.number().int().nonnegative(),
  dataQualityScore: z.number().min(0).max(100),
  estimatedMonthlyLeakage: z.number().nonnegative(),
});

const leadSchema = z.object({
  sessionId: z.string().min(1).max(64),
  email: z.string().email().max(254),
  company: z.string().min(1).max(200),
  role: z.string().min(1).max(100),
  mrrRange: z.enum(MRR_RANGES),
  billingPlatform: z.enum(BILLING),
  databaseType: z.enum(DATABASES).optional(),
  saasCategory: z.string().max(100).optional(),
  customerCount: z.string().max(50).optional(),
  usesUsageBasedCosts: z.boolean().optional(),
  wantsMonitoring: z.boolean().optional(),
  betaInterests: z.array(z.enum(BETA_INTERESTS)).max(8).optional(),
  requestType: z.enum(REQUEST_TYPES),
  consent: z.literal(true),
  summary: summarySchema.optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = leadSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid lead payload", details: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }

  const data = parsed.data;
  const consentAt = new Date().toISOString();

  const inserted = db
    .insert(leads)
    .values({
      email: data.email,
      company: data.company,
      role: data.role,
      mrrRange: data.mrrRange,
      billingPlatform: data.billingPlatform,
      databaseType: data.databaseType ?? null,
      saasCategory: data.saasCategory ?? null,
      customerCount: data.customerCount ?? null,
      usesUsageBasedCosts: data.usesUsageBasedCosts ?? null,
      wantsMonitoring: data.wantsMonitoring ?? null,
      betaInterests: data.betaInterests ? JSON.stringify(data.betaInterests) : null,
      requestType: data.requestType,
      consentAt,
    })
    .returning({ id: leads.id })
    .get();

  if (data.summary) {
    db.insert(auditSummaries)
      .values({
        leadId: inserted.id,
        sessionId: data.sessionId,
        summary: JSON.stringify(data.summary),
        exposureBucket: exposureBucket(data.summary.estimatedMonthlyLeakage),
        highConfidenceMismatches: data.summary.highConfidenceMismatches,
      })
      .run();
  }

  return NextResponse.json({ ok: true, leadId: inserted.id });
}

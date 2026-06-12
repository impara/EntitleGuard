/** Event names shared between the client tracker and the /api/events schema (FR10). */
export const ANALYTICS_EVENTS = [
  "landing_page_viewed",
  "audit_started",
  "stripe_csv_uploaded",
  "app_csv_uploaded",
  "mapping_completed",
  "audit_completed",
  "mismatches_found",
  "no_mismatches_found",
  "full_report_requested",
  "beta_signup_submitted",
  "call_booked",
  "mapping_dropoff",
  "demo_mode_started",
  "report_exported",
] as const;

export type AnalyticsEvent = (typeof ANALYTICS_EVENTS)[number];

/**
 * Exposure buckets keep server-side data aggregate-only while still letting
 * the founder evaluate kill thresholds (avg leakage < $50/month).
 */
export function exposureBucket(monthly: number): string {
  if (monthly <= 0) return "$0";
  if (monthly < 50) return "<$50";
  if (monthly < 100) return "$50-$100";
  if (monthly < 500) return "$100-$500";
  if (monthly < 2000) return "$500-$2k";
  return "$2k+";
}

/**
 * EntitleGuard reconciliation engine — pure TypeScript domain model.
 * No React/DOM dependencies: runs in Web Workers and in Vitest (node).
 */

// ---------------------------------------------------------------------------
// CSV parsing
// ---------------------------------------------------------------------------

export interface ParsedCsv {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
  rowCount: number;
  delimiter: string;
  warnings: string[];
}

export interface CsvParseError {
  code:
    | "EMPTY_FILE"
    | "NO_HEADERS"
    | "NO_ROWS"
    | "TOO_LARGE"
    | "PARSE_FAILED";
  message: string;
}

export type CsvParseResult =
  | { ok: true; data: ParsedCsv }
  | { ok: false; error: CsvParseError };

// ---------------------------------------------------------------------------
// Column mapping
// ---------------------------------------------------------------------------

export const STRIPE_FIELDS = [
  "customerId",
  "email",
  "subscriptionId",
  "status",
  "currentPeriodEnd",
  "cancelAtPeriodEnd",
  "plan",
  "mrr",
  "currency",
] as const;
export type StripeField = (typeof STRIPE_FIELDS)[number];

export const APP_FIELDS = [
  "userId",
  "email",
  "stripeCustomerId",
  "status",
  "plan",
  "accessEnabled",
  "role",
  "createdAt",
  "lastActiveAt",
] as const;
export type AppField = (typeof APP_FIELDS)[number];

/** field -> CSV column header */
export type StripeMapping = Partial<Record<StripeField, string>>;
export type AppMapping = Partial<Record<AppField, string>>;

export interface MappingSuggestion<F extends string> {
  field: F;
  column: string;
  /** 0..1 — how confident the auto-detector is */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

export type BillingState = "PAID" | "UNPAID" | "UNKNOWN";
export type AccessState = "ACCESS_ON" | "ACCESS_OFF" | "UNKNOWN";

export interface NormalizedStripeRecord {
  rowIndex: number;
  customerId: string | null;
  subscriptionId: string | null;
  email: string | null;
  normalizedEmail: string | null;
  rawStatus: string | null;
  billingState: BillingState;
  plan: string | null;
  monthlyValue: number | null;
  currency: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean | null;
}

export interface NormalizedAppRecord {
  rowIndex: number;
  userId: string | null;
  stripeCustomerId: string | null;
  email: string | null;
  normalizedEmail: string | null;
  rawStatus: string | null;
  rawAccessFlag: string | null;
  accessState: AccessState;
  /** true when the access flag and status column contradict each other */
  internalConflict: boolean;
  plan: string | null;
  role: string | null;
  looksInternal: boolean;
  looksFreePlan: boolean;
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export type MatchTier =
  | "customer_id"
  | "subscription_id"
  | "email_exact"
  | "email_normalized";

export type MatchConfidence = "high" | "medium" | "needs_review";

export interface MatchedPair {
  stripe: NormalizedStripeRecord;
  app: NormalizedAppRecord;
  tier: MatchTier;
  confidence: MatchConfidence;
  /** true when multiple candidates collided on the same key */
  collision: boolean;
}

export interface MatchResult {
  matches: MatchedPair[];
  unmatchedApp: NormalizedAppRecord[];
  unmatchedStripe: NormalizedStripeRecord[];
}

// ---------------------------------------------------------------------------
// Classification
// ---------------------------------------------------------------------------

export type IssueCategory = "A" | "B" | "C" | "D" | "E";
export type Severity = "high" | "medium" | "low";

export const CATEGORY_LABELS: Record<IssueCategory, string> = {
  A: "Unpaid but active",
  B: "Paid but blocked",
  C: "Missing billing link",
  D: "Orphaned Stripe subscription",
  E: "Ambiguous state",
};

export interface Issue {
  id: string;
  category: IssueCategory;
  severity: Severity;
  confidence: MatchConfidence;
  explanation: string;
  /** masked identifiers safe to render */
  maskedEmail: string | null;
  maskedCustomerId: string | null;
  maskedUserId: string | null;
  stripeStatus: string | null;
  appStatus: string | null;
  plan: string | null;
  /** estimated monthly $ value for leakage math (category A only) */
  estimatedMonthlyValue: number | null;
  matchTier: MatchTier | null;
}

// ---------------------------------------------------------------------------
// Leakage estimation
// ---------------------------------------------------------------------------

export interface LeakageEstimate {
  /** number of high/medium-confidence unpaid-but-active accounts */
  unpaidActiveCount: number;
  estimatedMonthly: number;
  estimatedAnnual: number;
  /** true when no per-account value was available and the fallback was used */
  usedFallbackValue: boolean;
  /** accounts that had no value at all (excluded from totals) */
  unvaluedAccounts: number;
}

// ---------------------------------------------------------------------------
// Audit result
// ---------------------------------------------------------------------------

export interface AuditSummary {
  totalAppRecords: number;
  totalStripeRecords: number;
  matchedRecords: number;
  unmatchedAppUsers: number;
  unmatchedStripeCustomers: number;
  unpaidActiveCount: number;
  paidBlockedCount: number;
  missingBillingLinkCount: number;
  orphanedStripeCount: number;
  ambiguousCount: number;
  highConfidenceMismatches: number;
  dataQualityScore: number;
  leakage: LeakageEstimate;
}

export interface AuditResult {
  summary: AuditSummary;
  issues: Issue[];
  recommendedActions: string[];
  completedAt: string;
}

export interface AuditOptions {
  /** used when no MRR/amount column is mapped */
  fallbackMonthlyValue?: number;
}

export interface AuditInput {
  stripe: ParsedCsv;
  app: ParsedCsv;
  stripeMapping: StripeMapping;
  appMapping: AppMapping;
  options?: AuditOptions;
}

export type ProgressPhase =
  | "normalizing"
  | "matching"
  | "classifying"
  | "estimating"
  | "done";

export interface ProgressUpdate {
  phase: ProgressPhase;
  /** 0..1 */
  fraction: number;
}

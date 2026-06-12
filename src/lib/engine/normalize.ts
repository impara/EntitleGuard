import type {
  AccessState,
  AppMapping,
  BillingState,
  NormalizedAppRecord,
  NormalizedStripeRecord,
  ParsedCsv,
  StripeMapping,
} from "./types";

// ---------------------------------------------------------------------------
// Status vocabularies (PRD section 8). Unknown labels stay UNKNOWN so they can
// never produce a high-confidence mismatch.
// ---------------------------------------------------------------------------

const STRIPE_PAID_STATUSES = new Set(["active", "trialing", "paid", "current", "complete"]);
const STRIPE_UNPAID_STATUSES = new Set([
  "canceled",
  "cancelled",
  "unpaid",
  "past_due",
  "past due",
  "incomplete_expired",
  "trial_expired",
  "expired",
  "void",
]);

const APP_ACTIVE_STATUSES = new Set(["active", "enabled", "paid", "subscribed", "trial", "trialing"]);
const APP_INACTIVE_STATUSES = new Set([
  "inactive",
  "disabled",
  "blocked",
  "suspended",
  "canceled",
  "cancelled",
  "deactivated",
  "churned",
  "expired",
]);

const TRUE_VALUES = new Set(["true", "1", "yes", "y", "t", "enabled", "on"]);
const FALSE_VALUES = new Set(["false", "0", "no", "n", "f", "disabled", "off"]);

const FREE_PLAN_HINTS = ["free", "trial", "none", "starter_free"];
const INTERNAL_ROLE_HINTS = ["admin", "internal", "staff", "test", "owner_internal", "superadmin"];

export function normalizeBillingStatus(raw: string | null): BillingState {
  if (!raw) return "UNKNOWN";
  const v = raw.trim().toLowerCase();
  if (STRIPE_PAID_STATUSES.has(v)) return "PAID";
  if (STRIPE_UNPAID_STATUSES.has(v)) return "UNPAID";
  return "UNKNOWN";
}

export function normalizeAccessState(
  rawStatus: string | null,
  rawAccessFlag: string | null,
): AccessState {
  // Explicit access flag wins over a textual status.
  if (rawAccessFlag) {
    const flag = rawAccessFlag.trim().toLowerCase();
    if (TRUE_VALUES.has(flag)) return "ACCESS_ON";
    if (FALSE_VALUES.has(flag)) return "ACCESS_OFF";
  }
  if (rawStatus) {
    const status = rawStatus.trim().toLowerCase();
    if (APP_ACTIVE_STATUSES.has(status)) return "ACCESS_ON";
    if (APP_INACTIVE_STATUSES.has(status)) return "ACCESS_OFF";
  }
  return "UNKNOWN";
}

/**
 * The app export disagrees with itself: the access flag says one thing and
 * the status column says the other. The tool cannot know which column the
 * app's access check actually reads, so this must surface as its own
 * needs-review finding instead of silently trusting the flag.
 */
export function detectAccessConflict(
  rawStatus: string | null,
  rawAccessFlag: string | null,
): boolean {
  const flag = parseBoolean(rawAccessFlag);
  if (flag === null || !rawStatus) return false;
  const status = rawStatus.trim().toLowerCase();
  const statusOn = APP_ACTIVE_STATUSES.has(status)
    ? true
    : APP_INACTIVE_STATUSES.has(status)
      ? false
      : null;
  if (statusOn === null) return false;
  return flag !== statusOn;
}

/** Exact-tier email key: trimmed and lowercased. */
export function emailKey(raw: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  return v.includes("@") ? v : null;
}

/** Normalized-tier email key: also strips +tags from the local part. */
export function normalizedEmailKey(raw: string | null): string | null {
  const key = emailKey(raw);
  if (!key) return null;
  const [local, domain] = key.split("@");
  const plusIndex = local.indexOf("+");
  const cleanedLocal = plusIndex === -1 ? local : local.slice(0, plusIndex);
  return `${cleanedLocal}@${domain}`;
}

/**
 * Parse a money-ish cell ("$49.00", "4900", "49,00", "49.00 USD") to a
 * monthly number. Returns null when unparseable or non-positive.
 */
export function parseMonetaryValue(raw: string | null): number | null {
  if (!raw) return null;
  let v = raw.trim().replace(/[^0-9.,-]/g, "");
  if (v.length === 0) return null;
  // A trailing comma followed by 1-2 digits marks an EU decimal separator
  // ("49,50", "1.234,56"); otherwise commas are thousands separators.
  if (/,\d{1,2}$/.test(v)) {
    v = v.replace(/\./g, "").replace(",", ".");
  } else {
    v = v.replace(/,/g, "");
  }
  const n = Number.parseFloat(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function parseBoolean(raw: string | null): boolean | null {
  if (!raw) return null;
  const v = raw.trim().toLowerCase();
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  return null;
}

function cell(row: Record<string, string>, column: string | undefined): string | null {
  if (!column) return null;
  const v = (row[column] ?? "").trim();
  return v.length > 0 ? v : null;
}

// ---------------------------------------------------------------------------
// Record normalization
// ---------------------------------------------------------------------------

export function normalizeStripeRecords(
  csv: ParsedCsv,
  mapping: StripeMapping,
): NormalizedStripeRecord[] {
  return csv.rows.map((row, rowIndex) => {
    const email = cell(row, mapping.email);
    const rawStatus = cell(row, mapping.status);
    return {
      rowIndex,
      customerId: cell(row, mapping.customerId),
      subscriptionId: cell(row, mapping.subscriptionId),
      email,
      normalizedEmail: normalizedEmailKey(email),
      rawStatus,
      billingState: normalizeBillingStatus(rawStatus),
      plan: cell(row, mapping.plan),
      monthlyValue: parseMonetaryValue(cell(row, mapping.mrr)),
      currency: cell(row, mapping.currency),
      currentPeriodEnd: cell(row, mapping.currentPeriodEnd),
      cancelAtPeriodEnd: parseBoolean(cell(row, mapping.cancelAtPeriodEnd)),
    };
  });
}

export function normalizeAppRecords(
  csv: ParsedCsv,
  mapping: AppMapping,
): NormalizedAppRecord[] {
  return csv.rows.map((row, rowIndex) => {
    const email = cell(row, mapping.email);
    const rawStatus = cell(row, mapping.status);
    const rawAccessFlag = cell(row, mapping.accessEnabled);
    const plan = cell(row, mapping.plan);
    const role = cell(row, mapping.role);
    const planLower = plan?.toLowerCase() ?? "";
    const roleLower = role?.toLowerCase() ?? "";
    return {
      rowIndex,
      userId: cell(row, mapping.userId),
      stripeCustomerId: cell(row, mapping.stripeCustomerId),
      email,
      normalizedEmail: normalizedEmailKey(email),
      rawStatus,
      rawAccessFlag,
      accessState: normalizeAccessState(rawStatus, rawAccessFlag),
      internalConflict: detectAccessConflict(rawStatus, rawAccessFlag),
      plan,
      role,
      looksInternal: INTERNAL_ROLE_HINTS.some((hint) => roleLower.includes(hint)),
      looksFreePlan: FREE_PLAN_HINTS.some((hint) => planLower === hint || planLower.startsWith(`${hint} `)),
    };
  });
}
